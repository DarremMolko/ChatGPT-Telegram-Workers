/* eslint-disable antfu/if-newline */
import type * as Telegram from 'telegram-bot-api-types';
import type { WorkerContext } from '../../config/context';
import type { TelegramBotAPI } from '../api';
import type { ExpandParams } from './render_shared';
import type { RenderedText } from './rich_text';
import { ENV } from '../../config/env';
import { getLog, log, tagMessageIds } from '../../log';
import { createTelegramBotAPI } from '../api';
import { parseMarkdownDocument, renderMarkdownDocumentToTelegraph } from './markdown_core';
import { renderMessageChunks, renderSingleMessage } from './rich_text';
import { waitUntil } from './tg_utils';

class MessageContext implements Record<string, any> {
    chat_id: number;
    message_id: number | null = null; // The currently sent message, used for follow-up edits.
    reply_to_message_id: number | null;
    parse_mode: Telegram.ParseMode | null = null;
    allow_sending_without_reply: boolean | null = null;
    disable_web_page_preview: boolean | null = ENV.DISABLE_WEB_PREVIEW;
    message_thread_id: number | null = null;
    chatType: string; // Chat type
    message: Telegram.Message; // Original message, used to tag IDs that may need deletion
    sentMessageIds: number[] = [];

    constructor(message: Telegram.Message) {
        this.chat_id = message.chat.id;
        this.chatType = message.chat.type;
        this.message = message;
        // this.messageId = message.message_id;
        if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
            // Whether to reply to the replied-to message instead.
            if (message?.reply_to_message && ENV.EXTRA_MESSAGE_CONTEXT && !message.is_topic_message
                && ENV.ENABLE_REPLY_TO_MENTION && !message.reply_to_message.from?.is_bot) {
                this.reply_to_message_id = message.reply_to_message.message_id;
            } else {
                this.reply_to_message_id = message.message_id;
            }

            this.allow_sending_without_reply = true;
            if (message.is_topic_message && message.message_thread_id) {
                this.message_thread_id = message.message_thread_id;
            }
        } else {
            this.reply_to_message_id = null;
        }
    }
}

export class MessageSender {
    api: TelegramBotAPI;
    context: MessageContext;

    constructor(token: string, context: MessageContext) {
        this.api = createTelegramBotAPI(token);
        this.context = context;
        this.sendRichText = this.sendRichText.bind(this);
        this.sendPlainText = this.sendPlainText.bind(this);
        this.sendPhoto = this.sendPhoto.bind(this);
        this.sendMediaGroup = this.sendMediaGroup.bind(this);
        this.sendDocument = this.sendDocument.bind(this);
        this.sendVoice = this.sendVoice.bind(this);
        this.editMessageMedia = this.editMessageMedia.bind(this);
    }

    static from(token: string, message: Telegram.Message): MessageSender {
        return new MessageSender(token, new MessageContext(message));
    }

    with(message: Telegram.Message): MessageSender {
        this.context = new MessageContext(message);
        return this;
    }

    update(context: MessageContext | Record<string, any>): MessageSender {
        if (!this.context) {
            this.context = context as any;
            return this;
        }
        for (const key in context) {
            (this.context as any)[key] = (context as any)[key];
        }
        return this;
    }

    private async sendMessage(message: RenderedText, context: MessageContext, retryCount = 0): Promise<Response> {
        const maxRetries = 3;
        let resp: Response;

        if (context?.message_id) {
            const params: Telegram.EditMessageTextParams = {
                chat_id: context.chat_id,
                message_id: context.message_id,
                text: message.text,
                ...(message.useEntities
                    ? { ...(message.entities ? { entities: message.entities } : {}) }
                    : { parse_mode: context.parse_mode || undefined }),
            };
            if (context.disable_web_page_preview) {
                params.link_preview_options = {
                    is_disabled: true,
                };
            }
            resp = await this.api.editMessageText(params);
        } else {
            const params: Telegram.SendMessageParams = {
                chat_id: context.chat_id,
                message_thread_id: context.message_thread_id || undefined,
                text: message.text,
                ...(message.useEntities
                    ? { ...(message.entities ? { entities: message.entities } : {}) }
                    : { parse_mode: context.parse_mode || undefined }),
            };
            if (context.reply_to_message_id) {
                params.reply_parameters = {
                    message_id: context.reply_to_message_id,
                    chat_id: context.chat_id,
                    allow_sending_without_reply: context.allow_sending_without_reply || undefined,
                };
            }
            if (context.disable_web_page_preview) {
                params.link_preview_options = {
                    is_disabled: true,
                };
            }
            resp = await this.api.sendMessage(params);
        }

        // Handle 429 rate limit errors with retry
        if (resp.status === 429 && retryCount < maxRetries) {
            const errorBody = await resp.clone().json() as { parameters?: { retry_after?: number } };
            const retryAfter = errorBody.parameters?.retry_after || resp.headers.get('Retry-After');
            const waitTime = retryAfter ? Number.parseInt(retryAfter as string) : 5;
            log.error(`Status 429, need wait: ${waitTime}s (retry ${retryCount + 1}/${maxRetries})`);
            await waitUntil(Date.now() + waitTime * 1000);
            return this.sendMessage(message, context, retryCount + 1);
        }

        return resp;
    }

    private async sendLongMessage(message: string, context: MessageContext, expandParams?: ExpandParams): Promise<Response> {
        const chatContext = { ...context };
        const messages = renderMessageChunks(context.parse_mode, message, expandParams);
        let lastMessageResponse = null;
        let lastMessageRespJson = null;
        for (let i = 0; i < messages.length; i++) {
            if (ENV.LOG_POSITION_ON_TOP) {
                // Do not send middle chunks.
                if (i > 0 && i < context.sentMessageIds.length - 1) {
                    continue;
                }
            } else if (context.sentMessageIds.length > 2 && i < context.sentMessageIds.length - 2) {
                // Send only the final two chunks, since logs may be split into two parts.
                continue;
            }

            // Do not send empty messages.
            if (messages[i].text.trim() === '') {
                continue;
            }

            chatContext.message_id = context.sentMessageIds[i] ?? null;
            // If reply_to_message_id exists and this is not the first chunk, reply to the previous chunk.
            context.reply_to_message_id && i > 0 && (chatContext.reply_to_message_id = context.sentMessageIds[i - 1]);
            log.info(`message id: ${chatContext.message_id}`);
            // log.debug(`chunk:\n${messages[i]}`);
            lastMessageResponse = await this.sendMessage(messages[i], chatContext);
            if (lastMessageResponse.status === 400) {
                const message = (await lastMessageResponse.clone().json() as Telegram.ResponseError).description;
                if (message.includes('not modified')) {
                    continue;
                }
            }
            if (lastMessageResponse.status !== 200) {
                break;
            }
            lastMessageRespJson = await lastMessageResponse.clone().json() as Telegram.ResponseWithMessage;
            this.context.sentMessageIds[i] = lastMessageRespJson.result.message_id;
            // Used later for media edits.
            this.context.message_id = lastMessageRespJson.result.message_id;
        }
        if (lastMessageResponse === null) {
            throw new Error('Send message failed');
        }
        return lastMessageResponse;
    }

    sendRichText(
        message: string,
        parseMode: Telegram.ParseMode | null = ENV.DEFAULT_PARSE_MODE as Telegram.ParseMode,
        type: 'tip' | 'chat' = 'chat',
        expandParams?: ExpandParams,
    ): Promise<Response> {
        if (!this.context) {
            throw new Error('Message context not set');
        }
        return checkIsNeedTagIds(this.context, this.sendLongMessage(message, {
            ...this.context,
            parse_mode: parseMode,
        }, expandParams), type);
    }

    sendPlainText(message: string, type: 'tip' | 'chat' = 'tip'): Promise<Response> {
        if (!this.context) {
            throw new Error('Message context not set');
        }
        return checkIsNeedTagIds(this.context, this.sendLongMessage(message, {
            ...this.context,
            parse_mode: null,
        }), type);
    }

    sendPhoto(photo: string | Blob, caption?: string | undefined, parse_mode?: Telegram.ParseMode): Promise<Response> {
        if (!this.context) {
            throw new Error('Message context not set');
        }
        const renderedCaption = caption ? renderSingleMessage(parse_mode || null, caption) : null;
        const params: Telegram.SendPhotoParams = {
            chat_id: this.context.chat_id,
            message_thread_id: this.context.message_thread_id || undefined,
            photo,
            ...(renderedCaption
                ? {
                        caption: renderedCaption.text,
                        ...(renderedCaption.useEntities
                            ? { ...(renderedCaption.entities ? { caption_entities: renderedCaption.entities } : {}) }
                            : { parse_mode }),
                    }
                : {}),
        };
        if (this.context.reply_to_message_id) {
            params.reply_parameters = {
                message_id: this.context.reply_to_message_id,
                chat_id: this.context.chat_id,
                allow_sending_without_reply: this.context.allow_sending_without_reply || undefined,
            };
        }
        return checkIsNeedTagIds(this.context, this.api.sendPhoto(params), 'chat');
    }

    sendMediaGroup(media: Telegram.InputMedia[], files?: File[]): Promise<Response> {
        if (!this.context) {
            throw new Error('Message context not set');
        }
        const renderedMedia = media.map((item) => {
            if (!item.caption || item.parse_mode !== 'MarkdownV2') {
                return item;
            }
            const renderedCaption = renderSingleMessage(item.parse_mode, item.caption);
            return {
                ...item,
                caption: renderedCaption.text,
                ...(renderedCaption.entities ? { caption_entities: renderedCaption.entities } : {}),
                ...(renderedCaption.useEntities ? { parse_mode: undefined } : {}),
            };
        });
        const params: Telegram.SendMediaGroupParams = {
            chat_id: this.context.chat_id,
            message_thread_id: this.context.message_thread_id || undefined,
            media: renderedMedia,
        };
        if (this.context.reply_to_message_id) {
            params.reply_parameters = {
                message_id: this.context.reply_to_message_id,
                chat_id: this.context.chat_id,
                allow_sending_without_reply: this.context.allow_sending_without_reply || undefined,
            };
        }

        if (files) {
            params.media.forEach((media, index) => {
                media.media = `attach://file${index}`;
                (params as unknown as Record<string, unknown>)[`file${index}`] = files[index];
            });
        }

        return checkIsNeedTagIds(this.context, this.api.sendMediaGroup(params), 'chat');
    }

    sendDocument(document: string | Blob, caption?: string | undefined, parse_mode?: Telegram.ParseMode): Promise<Response> {
        if (!this.context) {
            throw new Error('Message context not set');
        }
        const renderedCaption = caption ? renderSingleMessage(parse_mode || null, caption) : null;
        const params: Telegram.SendDocumentParams = {
            chat_id: this.context.chat_id,
            message_thread_id: this.context.message_thread_id || undefined,
            document,
            ...(renderedCaption
                ? {
                        caption: renderedCaption.text,
                        ...(renderedCaption.useEntities
                            ? { ...(renderedCaption.entities ? { caption_entities: renderedCaption.entities } : {}) }
                            : { parse_mode }),
                    }
                : {}),
        };
        if (this.context.reply_to_message_id) {
            params.reply_parameters = {
                message_id: this.context.reply_to_message_id,
                chat_id: this.context.chat_id,
                allow_sending_without_reply: this.context.allow_sending_without_reply || undefined,
            };
        }
        return checkIsNeedTagIds(this.context, this.api.sendDocument(params), 'chat');
    }

    editMessageMedia(media: Telegram.InputMedia, parse_mode?: Telegram.ParseMode, file?: File): Promise<Response> {
        if (!this.context) {
            throw new Error('Message context not set');
        }
        if (!this.context.message_id) {
            throw new Error('Message id is null');
        }
        const renderedCaption = media.caption ? renderSingleMessage(parse_mode || null, media.caption) : null;
        const params: Telegram.EditMessageMediaParams = {
            chat_id: this.context.chat_id,
            message_id: this.context.message_id,
            media: {
                ...media,
                ...(renderedCaption
                    ? {
                            caption: renderedCaption.text,
                            ...(renderedCaption.useEntities
                                ? { ...(renderedCaption.entities ? { caption_entities: renderedCaption.entities } : {}) }
                                : { parse_mode }),
                        }
                    : { parse_mode }),
                ...(file && { media: `attach://file` }),
            },
            ...(file && { file }),
        };

        return checkIsNeedTagIds(this.context, this.api.request('editMessageMedia', { ...params, file }), 'chat');
    }

    sendVoice(voice: Blob, caption?: string | undefined): Promise<Response> {
        const params: Telegram.SendVoiceParams = {
            chat_id: this.context.chat_id,
            voice,
            caption,
        };
        if (caption && ['spoiler', 'bold', 'italic', 'underline', 'strikethrough', 'code', 'pre'].includes(ENV.AUDIO_TEXT_FORMAT || '')) {
            params.caption_entities = [{
                type: ENV.AUDIO_TEXT_FORMAT as Telegram.MessageEntityType,
                offset: 0,
                length: caption.length,
            }];
        }
        if (this.context.reply_to_message_id) {
            params.reply_parameters = {
                message_id: this.context.reply_to_message_id,
                chat_id: this.context.chat_id,
                allow_sending_without_reply: this.context.allow_sending_without_reply || undefined,
            };
        }
        return checkIsNeedTagIds(this.context, this.api.sendVoice(params), 'chat');
    }
}

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
};

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
        const url = `https://api.telegra.ph/createAccount?short_name=${short_name}&author_name=${author_name}`;
        const resp = await fetch(url).then(r => r.json());
        if (resp.ok) {
            console.log('create telegraph account success:', resp.result.access_token);
            return resp.result.access_token;
        } else {
            throw new Error('create telegraph account failed');
        }
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
        const headers = { 'Content-Type': 'application/json' };
        return fetch(url, {
            method: 'post',
            headers,
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
        let endPoint = 'https://api.telegra.ph/editPage';
        await this.ensureAccessToken();

        if (!this.teleph_path) {
            endPoint = 'https://api.telegra.ph/createPage';
        }
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

interface TelegraphSendContext {
    context: WorkerContext;
    textSender: MessageSender | ChosenInlineSender;
    telegraphSender: TelegraphSender;
    hasSentTelegraphLink?: boolean;
    isEnd?: boolean;
    containRaw?: boolean;
}

interface TelegraphDocumentText {
    question: string;
    answer: string;
    log: string;
}

export async function sendTelegraph(sendContext: TelegraphSendContext, question: string, text: string) {
    log.info(`start send telegraph`);
    const { context, textSender, telegraphSender, hasSentTelegraphLink, isEnd, containRaw } = sendContext;
    let trimedQuestion = question;
    if (question.length > 600) {
        trimedQuestion = `${question.slice(0, 300)}...${question.slice(-300)}`;
    }
    const prefix = `#Question\n\`\`\`\n${trimedQuestion}\n\`\`\`\n---`;

    const telegraph_prefix = `${prefix}\n#Answer\n🤖 **${getLog(context.USER_CONFIG, { onlyModel: true, isParagraph: true })}**\n`;
    const debug_info = `${getLog(context.USER_CONFIG, { onlyModel: false, isParagraph: true })}`;
    const telegraph_suffix = `\n---\n\`\`\`\n${debug_info}\n\`\`\``;
    const textLength = (telegraph_prefix + text + telegraph_suffix).length;
    try {
        if (textLength >= 10917 * 6) {
            throw new Error('Telegraph message too long');
        }
        const resp = await telegraphSender.send(
            'Daily Q&A',
            telegraph_prefix + text + telegraph_suffix,
            containRaw ? text : undefined,
        );

        if (!hasSentTelegraphLink) {
            const url = `https://telegra.ph/${telegraphSender.teleph_path}`;
            const msg = `${containRaw ? 'Rendering failed, ' : ''}the answer was converted into an article.\n[🔗Click here to view it](${url})`.trim();
            log.info(`send telegraph message: ${msg}`);
            return textSender.sendRichText(msg);
        }
        return resp;
    } catch {
        if (isEnd) {
            return sendDocument(textSender as MessageSender, { question, answer: text, log: debug_info });
        }
    }
}

export async function sendDocument(textSender: MessageSender, document: TelegraphDocumentText) {
    const { question, answer, log: documentLog } = document;
    const text = `🆀 ${question}\n🅻 ${documentLog}\n\n🅰${answer}\n`;
    const file = new File([text], 'answer.md', { type: 'text/markdown' });
    return textSender.sendDocument(file, '>`Answer is cooked, check the document`', 'MarkdownV2');
}

export function sendAction(botToken: string, chat_id: number, action: Telegram.ChatAction = 'typing') {
    const api = createTelegramBotAPI(botToken);
    setTimeout(() => api.sendChatAction({
        chat_id,
        action,
    }).catch(console.error), 0);
}

export async function checkIsNeedTagIds(context: { chatType: string; message: Telegram.Message }, resp: Promise<Response>, msgType: 'tip' | 'chat') {
    const { chatType, message } = context;
    let message_id: number[] = [];
    const original_resp = await resp;
    do {
        if (ENV.EXPIRED_TIME <= 0) break;
        const clone_resp = await original_resp.clone().json() as Telegram.SendMediaGroupResponse | Telegram.SendMessageResponse;
        if (Array.isArray(clone_resp.result)) {
            message_id = clone_resp?.result?.map((i: { message_id: any }) => i.message_id);
        } else {
            message_id = [clone_resp?.result?.message_id];
        }
        if (message_id.filter(Boolean).length === 0) {
            log.error('resp:', JSON.stringify(clone_resp));
            break;
            // throw new Error('Message send failed, see logs for more details');
        }
        const isGroup = ['group', 'supergroup'].includes(chatType);
        const isNeedTag
            = (isGroup && ENV.SCHEDULE_GROUP_DELETE_TYPE.includes(msgType))
                || (!isGroup && ENV.SCHEDULE_PRIVATE_DELETE_TYPE.includes(msgType));
        if (isNeedTag) {
            if (!tagMessageIds.has(message)) {
                tagMessageIds.set(message, new Set());
            }
            message_id.forEach(id => tagMessageIds.get(message)?.add(id));
        }
    } while (false);

    return original_resp;
}

class ChosenInlineContext {
    result_id: string;
    inline_message_id?: string;
    query: string;
    parse_mode: Telegram.ParseMode | null = null;
    telegraphAccessTokenKey?: string;
    chatType = 'private';
    constructor(result: Telegram.ChosenInlineResult) {
        this.result_id = result.result_id;
        this.inline_message_id = result.inline_message_id;
        this.query = result.query;
        if (ENV.TELEGRAPH_NUM_LIMIT > 0) {
            this.telegraphAccessTokenKey = `telegraph_access_token:${result.from.id}`;
        }
    }
}

export class ChosenInlineSender {
    api: TelegramBotAPI;
    context: ChosenInlineContext;
    constructor(token: string, context: ChosenInlineContext) {
        this.api = createTelegramBotAPI(token);
        this.context = context;
    }

    static from(token: string, result: Telegram.ChosenInlineResult): ChosenInlineSender {
        return new ChosenInlineSender(token, new ChosenInlineContext(result));
    }

    sendRichText(
        text: string,
        parseMode: Telegram.ParseMode = ENV.DEFAULT_PARSE_MODE as Telegram.ParseMode,
        _type: 'tip' | 'chat' = 'chat',
        expandParams?: ExpandParams,
    ): Promise<Response> {
        return this.editMessageText(text, parseMode, expandParams);
    }

    sendPlainText(text: string): Promise<Response> {
        return this.editMessageText(text);
    }

    editMessageText(text: string, parse_mode?: Telegram.ParseMode, expandParams?: ExpandParams): Promise<Response> {
        const rendered = renderSingleMessage(parse_mode || null, text, expandParams);
        return this.api.editMessageText({
            inline_message_id: this.context.inline_message_id,
            text: rendered.text,
            ...(rendered.useEntities
                ? { ...(rendered.entities ? { entities: rendered.entities } : {}) }
                : { parse_mode }),
            link_preview_options: {
                is_disabled: ENV.DISABLE_WEB_PREVIEW,
            },
        });
    }

    editMessageMedia(media: Telegram.InputMedia, parse_mode?: Telegram.ParseMode): Promise<Response> {
        return this.api.editMessageMedia({
            inline_message_id: this.context.inline_message_id,
            media: {
                ...media,
                parse_mode,
            },
        });
    }
}
