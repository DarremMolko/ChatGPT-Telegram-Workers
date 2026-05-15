import type { FilePart, TextPart } from 'ai';
import type * as Telegram from 'telegram-bot-api-types';
import type { ChatStreamTextHandler, HistoryModifier, LLMChatRequestParams } from '../../agent/types';
import type { WorkerContext } from '../../config/context';
import type { AgentUserConfig } from '../../config/env';
import type { ChosenInlineSender } from '../utils/send';
import type { MessageHandler } from './types';
import { APICallError } from 'ai';
import { loadChatLLM, loadImageGen } from '../../agent';
import { loadHistory, requestCompletionsFromLLM } from '../../agent/chat';
import { ENV } from '../../config/env';
import { clearLog, getLog, log } from '../../log';
import { isUserCancelledSignal } from '../../utils/abort';
import { createTelegramBotAPI } from '../api';
import { registerActiveRequest } from '../utils/active_request';
import { fileUrlToBase64Message, mergeLogMessages, sendImages, stt, tts } from '../utils/media';
import { MessageSender, sendAction } from '../utils/send';
import { transformPipeTables } from '../utils/table_render';
import { sendDocument, sendTelegraph, TelegraphSender } from '../utils/telegraph';
import { getTelegramFile, isTelegramChatTypeGroup, waitUntil } from '../utils/tg_utils';

/**
 * Get user identifier with fallback logic
 * Priority: username > full_name > first_name
 * Also includes user ID for better identification
 */
function getUserIdentifier(user?: Telegram.User): string | null {
    if (!user) {
        return null;
    }
    let identifier = '';

    // Priority 1: username with @ prefix
    if (user.username) {
        identifier = `@${user.username}`;
    } else if (user.last_name) {
        // Priority 2: full name (first_name + last_name)
        identifier = `${user.first_name} ${user.last_name}`;
    } else {
        // Priority 3: first_name only
        identifier = user.first_name;
    }

    // Always append user ID in parentheses for unique identification
    return `${identifier} (ID:${user.id})`;
}

async function messageInitialize(sender: MessageSender, context?: WorkerContext, message?: Telegram.Message): Promise<ChatStreamTextHandler> {
    setTimeout(sendAction, 0, sender.api.token, sender.context.chat_id, 'typing');
    log.info(`send init message`);
    const streamSender = OnStreamHander(sender, context, message?.text || message?.caption || '');
    streamSender.send('...');
    return streamSender;
}

export async function chatWithLLM(
    message: Telegram.Message,
    params: LLMChatRequestParams | null,
    context: WorkerContext,
    modifier: HistoryModifier | null,
    sender?: ChatStreamTextHandler,
    isMiddle?: boolean,
): Promise<Response | string> {
    const streamSender = sender ?? OnStreamHander(MessageSender.from(context.SHARE_CONTEXT.botToken, message), context, message?.text || message?.caption || '');
    const activeRequest = !isMiddle ? registerActiveRequest(context.SHARE_CONTEXT.chatHistoryKey) : null;
    try {
        const agent = loadChatLLM(context.USER_CONFIG);
        log.info(`start chat with LLM`);
        const answer = await requestCompletionsFromLLM(
            params,
            context,
            agent,
            modifier,
            ENV.STREAM_MODE && !isMiddle ? streamSender : null,
            activeRequest?.signal,
        );
        log.info(`chat with LLM done`);

        if (isMiddle) {
            return answer.content;
        }
        return streamSender.end!(answer.content);
    } catch (e) {
        if (activeRequest?.isUserCancelled()) {
            streamSender.clearHeartbeat?.();
            const partial = (streamSender.peek?.() || '').replace(/●\s*$/, '').trim();
            if (partial) {
                return streamSender.end!(partial);
            }
            const sender = streamSender.sender as MessageSender | undefined;
            if (sender) {
                return sender.sendPlainText('Stopped current response.', 'tip');
            }
            return new Response('cancelled');
        }
        log.error((e as Error).message, (e as Error).stack);
        if (APICallError.isInstance(e)) {
            log.error(e.responseBody);
        }
        let errMsg = '';
        if ((e as Error).name === 'AbortError' || isUserCancelledSignal(activeRequest?.signal)) {
            errMsg += 'Chat with LLM timeout';
        } else {
            errMsg += (e as Error).message;
            if (e instanceof APICallError && e.responseBody && errMsg === '') {
                log.error(`error detail: ${e.responseBody}`);
                errMsg += `\n\n${e.responseBody}`;
            }
        }
        errMsg = errMsg.trim().replace(context.SHARE_CONTEXT.botToken, '[REDACTED]').substring(0, 2048);
        return streamSender.end!(`\`\`\`Error\n${errMsg}\n\`\`\``, false, 'error');
    } finally {
        activeRequest?.done();
    }
}

export class ChatHandler implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        const streamSender = await messageInitialize(sender, context, message);
        try {
            log.info(`message type: ${context.MIDDLE_CONTEXT.messageInfo.type}`);
            await this.initializeHistory(context);

            // Process the original incoming message.
            const params = await this.processOriginalMessage(message, context);
            // Execute the workflow.
            await workflow(context, message, params, streamSender);
            return null;
        } catch (e) {
            streamSender.clearHeartbeat!();
            const sender = streamSender.sender as MessageSender;
            log.error((e as Error).stack);
            if ((e as Error).message.includes('524')) {
                return sender.sendRichText(`\`\`\`Error\nMaybe occur 524 error, see logs for more details.\n\`\`\``, undefined, 'tip');
            }
            const errMsg = (e as Error).message.replaceAll(context.SHARE_CONTEXT.botToken, '[REDACTED]').substring(0, 2048);
            return sender.sendRichText(`\`\`\`Error\n${errMsg}\n\`\`\``, undefined, 'tip');
        }
    };

    private async initializeHistory(context: WorkerContext): Promise<void> {
        // Initialize history messages.
        const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
        if (!historyKey) {
            throw new Error('History key not found');
        }
        if (ENV.STORE_HISTORY_LENGTH > 0) {
            context.MIDDLE_CONTEXT.history = await loadHistory(historyKey, ENV.STORE_HISTORY_LENGTH);
        }
    }

    private async processOriginalMessage(
        message: Telegram.Message,
        context: WorkerContext,
    ): Promise<LLMChatRequestParams> {
        const { type, id, mime_type, file_name } = context.MIDDLE_CONTEXT.messageInfo;
        let messageText = message.text || message.caption || '';

        // Get user identifier for group chats
        let userPrefix = '';
        if (ENV.GROUP_INCLUDE_USERNAME && isTelegramChatTypeGroup(message.chat.type)) {
            const userIdentifier = getUserIdentifier(message.from);
            if (userIdentifier) {
                userPrefix = `${userIdentifier}: `;
                if (messageText) {
                    messageText = userPrefix + messageText;
                }
            }
        }

        const params: LLMChatRequestParams = {
            role: 'user',
            content: messageText,
        };

        if (!id)
            return params;

        const urls = await getTelegramFile(id, context.SHARE_CONTEXT.botToken, 'url') as string[];
        if (urls.length === 0)
            return params;

        params.content = [];
        if (message.text || message.caption) {
            params.content.push({
                type: 'text',
                text: messageText,
            });
        } else {
            // For media without caption, generate descriptive text
            let defaultText = '';
            if (type === 'sticker') {
                defaultText = 'User sent a sticker to respond to you';
            } else if (['audio', 'voice'].includes(type)) {
                defaultText = context.USER_CONFIG.AUDIO_PROMPT;
            } else {
                defaultText = `Please explain the ${type}`;
            }

            // Add user identifier prefix if in group chat
            if (userPrefix) {
                defaultText = userPrefix + defaultText;
            }

            params.content.push({
                type: 'text',
                text: defaultText,
            });
        }

        return fileUrlToBase64Message({
            urls,
            type,
            mimeType: mime_type,
            fileName: file_name,
            params,
            text: messageText,
            AUDIO_HANDLE_TYPE: context.USER_CONFIG.AUDIO_HANDLE_TYPE,
        });
    }
}

export function OnStreamHander(sender: MessageSender | ChosenInlineSender, context?: WorkerContext, question?: string): ChatStreamTextHandler {
    let sentPromise = null as Promise<Response | undefined> | null;
    let nextEnableTime: number | null = null;
    const isMessageSender = sender instanceof MessageSender;
    const sendInterval = isMessageSender ? ENV.TELEGRAM_MIN_STREAM_INTERVAL : ENV.INLINE_QUERY_SEND_INTERVAL;
    const isSendTelegraph = (text: string) => {
        return isMessageSender
            ? ENV.TELEGRAPH_SCOPE.includes(sender.context.chatType) && ENV.TELEGRAPH_NUM_LIMIT > 0 && text.length > ENV.TELEGRAPH_NUM_LIMIT
            : sender.context.inline_message_id && text.length > 4096;
    };

    const isSendDocument = (text: string) => {
        return ENV.FILE_SIZE_LIMIT > 0 && ENV.QUOTE_EXPANDABLE && text.length > ENV.ADD_QUOTE_LIMIT && text.length > ENV.FILE_SIZE_LIMIT;
    };
    const addQuotePrerequisites = ENV.ADD_QUOTE_LIMIT > 0 && ENV.ADD_QUOTE_SCOPE.includes(sender.context.chatType);
    const expandParams = { addQuote: false, quoteExpandable: false };
    const botName = context?.SHARE_CONTEXT?.botName || 'AI';
    const telegraphAccessTokenKey = context?.SHARE_CONTEXT?.telegraphAccessTokenKey || '';
    const telegraphSender = new TelegraphSender(botName, telegraphAccessTokenKey);
    let hasSentTelegraphLink = false;
    let isSendDocumentTip = false;
    const telegraphContext = (isEnd: boolean, containRaw: boolean) => {
        return {
            context: context!,
            textSender: sender,
            telegraphSender,
            hasSentTelegraphLink,
            isEnd,
            containRaw,
        };
    };

    const immediatePromise = Promise.resolve('[PROMISE DONE]');

    let cache = '';
    let heartWaitedTime = 0;
    let heartbeatId: NodeJS.Timeout;
    const HEARTBEAT_INTERVAL = 10_000;

    const streamSender = {
        send: null as ((text: string, type?: 'chat' | 'error' | 'heartbeat') => Promise<any>) | null,
        end: null as ((text: string, needLog?: boolean, type?: 'chat' | 'error' | 'heartbeat') => Promise<any>) | null,
        peek: () => cache,
        sender,
        clearHeartbeat: () => {
            heartbeatId && clearInterval(heartbeatId);
        },
    };

    const updateHeartbeat = () => {
        heartbeatId && clearInterval(heartbeatId);
        heartbeatId = setInterval(async () => {
            heartWaitedTime += HEARTBEAT_INTERVAL / 1000;
            await sentPromise;
            sentPromise = streamSender.send!(`${cache}\n\nwaited for ${heartWaitedTime}s`, 'heartbeat');
        }, HEARTBEAT_INTERVAL);
    };

    streamSender.send = async (text: string, type = 'chat'): Promise<any> => {
        try {
            const outboundText = transformPipeTables(text, { enabled: ENV.TELEGRAM_RENDER_PIPE_TABLES });
            if (type === 'chat') {
                cache = outboundText;
                heartWaitedTime = 0;
                updateHeartbeat();
            }
            // Check whether we need to wait before the next send.
            if ((nextEnableTime || 0) > Date.now()) {
                log.info(`Need await: ${(nextEnableTime || 0) - Date.now()}ms`);
                return;
            }
            // Skip sending if the previous send is still in progress.
            if (sentPromise && (await Promise.race([sentPromise, immediatePromise]) === '[PROMISE DONE]')) {
                return;
            }

            // Enforce the minimum stream interval.
            if (sendInterval > 0 && type === 'chat') {
                nextEnableTime = Date.now() + sendInterval;
            }

            if (isSendDocument(outboundText)) {
                if (isSendDocumentTip) {
                    return;
                }
                isSendDocumentTip = true;
                cache = `${outboundText}\n\n**Hold on, answer will be sent as a document.**`;
            }

            const displayText = isSendDocumentTip ? cache : outboundText;

            if (isSendTelegraph(displayText)) {
                sentPromise = sendTelegraph(telegraphContext(false, false), question || 'Redo Question', displayText);
                hasSentTelegraphLink = true;
                return;
            }

            const data = mergeLogMessages(displayText, context?.USER_CONFIG, { quoteInfo: true });
            expandParams.addQuote = addQuotePrerequisites && data.length > ENV.ADD_QUOTE_LIMIT;
            log.info(`sent message ids: ${isMessageSender ? sender.context.sentMessageIds : sender.context.inline_message_id}`);
            isMessageSender && sendAction(sender.api.token, sender.context.chat_id, 'typing');
            sentPromise = sender.sendRichText(data, undefined, 'chat', expandParams);
            const resp = await sentPromise as Response;
            // Handle 429 responses.
            if (resp.status === 429) {
                // Read the retry-after duration.
                const retryAfter = Number.parseInt(resp.headers.get('Retry-After') || '');
                if (retryAfter) {
                    nextEnableTime = Date.now() + retryAfter * 1000;
                    log.error(`Status 429, need wait: ${nextEnableTime - Date.now()}ms`);
                    return;
                }
            }

            if (!resp.ok) {
                log.error(`send message failed: ${resp.status} ${await resp.json().then(j => j.description)}`);
            }
        } catch (e) {
            log.error((e as Error).stack);
        }
    };

    streamSender.end = async (text: string, needLog = true, type = 'chat'): Promise<any> => {
        log.info('--- start end ---');
        streamSender.clearHeartbeat();
        await sentPromise;
        if ((nextEnableTime || 0) > Date.now()) {
            log.info(`Need await: ${(nextEnableTime || 0) - Date.now()}ms`);
            await waitUntil(nextEnableTime! + 10);
        }
        if (type === 'error') {
            text = `${cache}\n${text}`;
        }
        const outboundText = transformPipeTables(text, { enabled: ENV.TELEGRAM_RENDER_PIPE_TABLES });
        if (isSendDocument(outboundText)) {
            return sendDocument(sender as MessageSender, { question: question || 'Redo Question', answer: outboundText, log: getLog(context?.USER_CONFIG || {} as AgentUserConfig, { onlyModel: false, isParagraph: true }) });
        }
        if (isSendTelegraph(outboundText)) {
            return sendTelegraph(telegraphContext(true, false), question || 'Redo Question', outboundText);
        }
        const data = context && needLog ? mergeLogMessages(outboundText, context.USER_CONFIG, { quoteInfo: true }) : outboundText;
        log.info(`sent message ids: ${isMessageSender ? sender.context.sentMessageIds : sender.context.inline_message_id}`);
        expandParams.addQuote = addQuotePrerequisites && data.length > ENV.ADD_QUOTE_LIMIT;
        let maxFetchFailedTimes = 3;
        while (true) {
            try {
                const finalResp = await sender.sendRichText(data, undefined, 'chat', expandParams);
                if (finalResp.status === 429) {
                    const retryAfter = Number.parseInt(finalResp.headers.get('Retry-After') || '') ?? 10;
                    log.error(`Status 429, need wait: ${retryAfter}s`);
                    await waitUntil(Date.now() + retryAfter * 1000 + 10);
                    continue;
                }
                if (!finalResp.ok) {
                    (sender as MessageSender).context.sentMessageIds.length = 0;
                    log.error(`send message failed: ${finalResp.status} ${await finalResp.json().then(j => j.description)}`);
                    await sendTelegraph(telegraphContext(true, true), question || 'Redo Question', text);
                    return;
                }
                return finalResp;
            } catch (e) {
                log.error((e as Error).stack);
                if (e instanceof TypeError && e.message.includes('fetch failed')) {
                    maxFetchFailedTimes--;
                    if (maxFetchFailedTimes <= 0) {
                        throw e;
                    }
                    continue;
                }
                throw e;
            }
        }
    };

    return streamSender as unknown as ChatStreamTextHandler;
}

type WorkflowHandler = (
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    handleKey: string,
) => Promise<Response | Blob | string>;

const WORKFLOW_HANDLERS: Record<string, WorkflowHandler> = {
    'text:image': handleTextToImage,
    'audio:audio': handleAudio,
    'audio:text': handleAudio,
    'stt:text': handleAudio,
    'stt:audio': handleAudio,
};

function workflowHandlers(type: string): WorkflowHandler {
    return WORKFLOW_HANDLERS[type] ?? handleText;
}

async function workflow(
    context: WorkerContext,
    message: Telegram.Message,
    params: LLMChatRequestParams,
    streamSender: ChatStreamTextHandler,
): Promise<Response | Blob | string> {
    const msgType = context.MIDDLE_CONTEXT.messageInfo.type;
    let handlerKey = `${msgType}:`;
    if (msgType === 'text') {
        handlerKey = `${context.USER_CONFIG.TEXT_HANDLE_TYPE}:${context.USER_CONFIG.TEXT_OUTPUT}`;
    } else if (msgType === 'audio' || msgType === 'voice') {
        handlerKey = `${context.USER_CONFIG.AUDIO_HANDLE_TYPE}:${context.USER_CONFIG.AUDIO_OUTPUT}`;
    } else {
        handlerKey += 'text';
    }
    if ((!['audio', 'stt', 'chat'].includes(context.USER_CONFIG.AUDIO_HANDLE_TYPE)) && ['audio', 'voice'].includes(msgType)) {
        handlerKey = 'stt:text';
    } else if ((!['tts', 'text', 'chat'].includes(context.USER_CONFIG.TEXT_HANDLE_TYPE)) && msgType === 'text') {
        handlerKey = 'text:text';
    }
    const handler = workflowHandlers(handlerKey);
    return handler(message, params, context, streamSender, handlerKey);
}

async function handleText(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    handleKey: string,
): Promise<Response | string> {
    switch (handleKey) {
        case 'tts:audio':
        case 'tts:text':
        case 'text:audio':
            return handleTextToAudio(message, params, context, streamSender, handleKey);
        default:
            return chatWithLLM(message, params, context, null, streamSender);
    }
}

async function handleTextToImage(
    message: Telegram.Message,
    _params: LLMChatRequestParams,
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    _handleKey: string,
): Promise<Response> {
    streamSender.clearHeartbeat!();
    const agent = loadImageGen(context.USER_CONFIG);
    const sender = streamSender.sender!;
    if (!agent) {
        return sender.sendPlainText('ERROR: Image generator not found');
    }
    sendAction(context.SHARE_CONTEXT.botToken, message.chat.id);
    await sender.sendPlainText('Please wait a moment...', 'tip').then(r => r.json());
    const result = await agent.request(message.text || message.caption || '', context.USER_CONFIG);
    log.info('imageresult', JSON.stringify(result));
    await sendImages(result, ENV.SEND_IMAGE_AS_FILE, sender, context.USER_CONFIG);
    const api = createTelegramBotAPI(context.SHARE_CONTEXT.botToken);
    return api.deleteMessage({ chat_id: sender.context.chat_id, message_id: sender.context.message_id! });
}

async function handleAudio(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    handleKey: string,
): Promise<Response | string> {
    const url = (params.content as FilePart[]).at(-1)?.data as string;
    const audio = await fetch(url).then(b => b.blob());
    const text = await stt(audio, context.USER_CONFIG);
    context.MIDDLE_CONTEXT.history.push({ role: 'user', content: text });
    const sender = streamSender.sender!;
    if (handleKey.endsWith('text') || !ENV.HIDE_MIDDLE_MESSAGE) {
        await streamSender.end!(mergeLogMessages(text, context.USER_CONFIG, { quoteInfo: true }));
    }
    if (handleKey.startsWith('stt')) {
        streamSender.clearHeartbeat!();
        return new Response('audio handle done');
    }
    clearLog(context.USER_CONFIG);
    !ENV.HIDE_MIDDLE_MESSAGE && (sender.context.sentMessageIds = []);
    const isMiddle = handleKey === 'audio:audio';
    const otherText = (params.content as TextPart[]).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    const resp = await chatWithLLM(message, { role: 'user', content: `[AUDIO TRANSCRIPTION]: ${text}\n${otherText}` }, context, null, streamSender, isMiddle);
    streamSender.clearHeartbeat!();
    if (isMiddle) {
        const audio = await tts(resp as unknown as string, context.USER_CONFIG);
        console.log(`audio size: ${(audio.size / 1024 / 1024).toFixed(3)}mb`);
        ENV.HIDE_MIDDLE_MESSAGE && sender.api.deleteMessage({ chat_id: sender.context.chat_id, message_id: sender.context.message_id! });
        sendAction(context.SHARE_CONTEXT.botToken, sender.context.chat_id, 'upload_voice');
        return sender.sendVoice(audio);
    }
    return resp;
}

async function handleTextToAudio(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    handleKey: string,
): Promise<Response> {
    let text = params.content as string;
    const sender = streamSender.sender!;
    if (handleKey === 'text:audio') {
        !ENV.HIDE_MIDDLE_MESSAGE && streamSender.send('Chat with LLM in progress');
        text = await chatWithLLM(message, params, context, null, streamSender, true) as string;
        !ENV.HIDE_MIDDLE_MESSAGE && streamSender.send('Chat with LLM done');
    }
    const audio = await tts(text, context.USER_CONFIG);
    console.log(`audio size: ${(audio.size / 1024 / 1024).toFixed(3)}mb`);
    sendAction(context.SHARE_CONTEXT.botToken, sender.context.chat_id, 'upload_voice');
    const resp = await sender.sendVoice(audio, context.USER_CONFIG.AUDIO_CONTAINS_TEXT ? text : undefined);
    streamSender.clearHeartbeat!();
    if (resp.ok) {
        return sender.api.deleteMessage({ chat_id: sender.context.chat_id, message_id: sender.context.message_id! });
    }
    // log.error(`Failed to send voice message: ${resp.status} ${await resp.text()}`);
    throw new Error(`Failed to send voice message: ${resp.status} ${await resp.json().then(j => j.description)}`);
}
