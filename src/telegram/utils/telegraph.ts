import type { WorkerContext } from '../../config/context';
import type { ChosenInlineSender, MessageSender } from './send';
import { ENV } from '../../config/env';
import { getLog, log } from '../../log';
import { parseMarkdownDocument, renderMarkdownDocumentToTelegraph } from './markdown_core';
import { waitUntil } from './tg_utils';

interface Author {
    short_name: string;
    author_name: string;
    author_url?: string;
}

interface CreateOrEditPageResponse {
    ok: boolean;
    result?: {
        path: string;
        url: string;
    };
    error?: string;
}

export interface TelegraphSendContext {
    context: WorkerContext;
    textSender: MessageSender | ChosenInlineSender;
    telegraphSender: TelegraphSender;
    hasSentTelegraphLink?: boolean;
    isEnd?: boolean;
    containRaw?: boolean;
}

export interface TelegraphDocumentText {
    question: string;
    answer: string;
    log: string;
}

export class TelegraphSender {
    readonly telegraphAccessTokenKey: string;
    telegraphAccessToken?: string;
    teleph_path?: string;
    author: Author = {
        short_name: 'Mewo',
        author_name: 'A Cat',
        author_url: ENV.TELEGRAPH_AUTHOR_URL,
    };

    constructor(botName: string | null, telegraphAccessTokenKey: string) {
        this.telegraphAccessTokenKey = telegraphAccessTokenKey;
        if (botName) {
            this.author = {
                short_name: botName,
                author_name: botName,
                author_url: ENV.TELEGRAPH_AUTHOR_URL,
            };
        }
    }

    private async createAccount(): Promise<string> {
        const { short_name, author_name } = this.author;
        const params = new URLSearchParams({
            short_name,
            author_name,
        });
        const resp = await fetch(`https://api.telegra.ph/createAccount?${params}`).then(r => r.json());
        if (resp.ok) {
            console.log('create telegraph account success:', resp.result.access_token);
            return resp.result.access_token;
        }
        throw new Error('create telegraph account failed');
    }

    private async createOrEditPage(url: string, title: string, content: string, raw?: string): Promise<Response> {
        const contentNode = renderMarkdownDocumentToTelegraph(parseMarkdownDocument(content));
        if (raw) {
            contentNode.push(...[
                { tag: 'hr' },
                {
                    tag: 'blockquote',
                    children: ['RAW DATA'],
                },
                {
                    tag: 'pre',
                    children: [
                        {
                            tag: 'code',
                            attrs: { class: 'language-plaintext' },
                            children: [raw.trim()],
                        },
                    ],
                },
            ]);
        }
        const body = {
            access_token: this.telegraphAccessToken,
            path: this.teleph_path ?? undefined,
            title: title || 'Daily Q&A',
            content: contentNode,
            ...this.author,
        };
        return fetch(url, {
            method: 'post',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    private async ensureAccessToken() {
        if (!this.telegraphAccessToken) {
            this.telegraphAccessToken = await ENV.REDIS.get(this.telegraphAccessTokenKey);
            if (!this.telegraphAccessToken) {
                this.telegraphAccessToken = await this.createAccount();
                await ENV.REDIS.put(this.telegraphAccessTokenKey, this.telegraphAccessToken).catch(console.error);
            }
        }
    }

    private async resetAccount() {
        this.telegraphAccessToken = undefined;
        this.teleph_path = undefined;
        if (this.telegraphAccessTokenKey) {
            await ENV.REDIS.delete(this.telegraphAccessTokenKey).catch(console.error);
        }
    }

    async send(title: string, content: string, raw?: string, retried = false): Promise<Response> {
        await this.ensureAccessToken();

        const endPoint = this.teleph_path ? 'https://api.telegra.ph/editPage' : 'https://api.telegra.ph/createPage';
        const resp = await this.createOrEditPage(endPoint, title, content, raw);
        if (resp.ok) {
            const data = await resp.json() as CreateOrEditPageResponse;
            if (!data.ok) {
                if (data.error === 'ACCESS_TOKEN_INVALID' && !retried) {
                    await this.resetAccount();
                    return this.send(title, content, raw, true);
                }
                console.error('telegraph send error:', JSON.stringify(data));
                throw new Error(JSON.stringify(data));
            }
            this.teleph_path = data.result?.path;
        } else if (resp.status === 429) {
            const retryAfter = Number.parseInt(resp.headers.get('Retry-After') || '');
            log.error(`Send telegraph page failed, Status 429, need wait: ${retryAfter || 10}s`);
            if (retryAfter) {
                await waitUntil(Date.now() + retryAfter * 1000);
            } else {
                await waitUntil(Date.now() + 5_000);
            }
            return this.send(title, content, raw, retried);
        } else if (!resp.ok) {
            log.error('Send telegraph page failed:', resp.status);
            throw new Error(await resp.text());
        }
        return resp;
    }
}

export async function sendTelegraph(sendContext: TelegraphSendContext, question: string, text: string) {
    log.info('start send telegraph');
    const { context, textSender, telegraphSender, hasSentTelegraphLink, isEnd, containRaw } = sendContext;
    let trimmedQuestion = question;
    if (question.length > 600) {
        trimmedQuestion = `${question.slice(0, 300)}...${question.slice(-300)}`;
    }
    const prefix = `#Question\n\`\`\`\n${trimmedQuestion}\n\`\`\`\n---`;
    const telegraphPrefix = `${prefix}\n#Answer\n🤖 **${getLog(context.USER_CONFIG, { onlyModel: true, isParagraph: true })}**\n`;
    const debugInfo = `${getLog(context.USER_CONFIG, { onlyModel: false, isParagraph: true })}`;
    const telegraphSuffix = `\n---\n\`\`\`\n${debugInfo}\n\`\`\``;
    const textLength = (telegraphPrefix + text + telegraphSuffix).length;
    try {
        if (textLength >= 10917 * 6) {
            throw new Error('Telegraph message too long');
        }
        await telegraphSender.send(
            'Daily Q&A',
            telegraphPrefix + text + telegraphSuffix,
            containRaw ? text : undefined,
        );

        if (!hasSentTelegraphLink) {
            const url = `https://telegra.ph/${telegraphSender.teleph_path}`;
            const msg = `${containRaw ? 'Rendering failed, ' : ''}the answer was converted into an article.\n[🔗Click here to view it](${url})`.trim();
            log.info(`send telegraph message: ${msg}`);
            return textSender.sendRichText(msg);
        }
        return undefined;
    } catch {
        if (isEnd) {
            return sendDocument(textSender as MessageSender, { question, answer: text, log: debugInfo });
        }
        return undefined;
    }
}

export async function sendDocument(textSender: MessageSender, document: TelegraphDocumentText) {
    const { question, answer, log: documentLog } = document;
    const text = `🆀 ${question}\n🅻 ${documentLog}\n\n🅰${answer}\n`;
    const file = new File([text], 'answer.md', { type: 'text/markdown' });
    return textSender.sendDocument(file, '>`Answer is cooked, check the document`', 'MarkdownV2');
}
