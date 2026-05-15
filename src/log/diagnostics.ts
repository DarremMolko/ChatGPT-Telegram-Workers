import type { ModelMessage } from 'ai';
import type * as Telegram from 'telegram-bot-api-types';
import type { ShareContext } from '../config/context';
import type { AgentUserConfig } from '../config/env';
import { sanitizeForDebugLog } from './trace_file';

function previewText(value: string, limit = 80): string {
    if (!value) {
        return '';
    }
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= limit) {
        return compact;
    }
    return `${compact.slice(0, limit)}...`;
}

function countBy(values: string[]): Record<string, number> {
    return values.reduce<Record<string, number>>((acc, value) => {
        acc[value] = (acc[value] || 0) + 1;
        return acc;
    }, {});
}

function formatValue(value: unknown): string {
    const sanitized = sanitizeForDebugLog(value);
    if (sanitized === null || sanitized === undefined) {
        return String(sanitized);
    }
    if (typeof sanitized === 'string') {
        return /^[\w./:@,-]+$/.test(sanitized) ? sanitized : JSON.stringify(sanitized);
    }
    return JSON.stringify(sanitized);
}

function resolveProviderModel(config: AgentUserConfig, provider: string | undefined, type: 'CHAT' | 'IMAGE' | 'STT' | 'TTS' | 'VISION'): string {
    if (!provider) {
        return '';
    }
    return config[`${provider.toUpperCase()}_${type}_MODEL`] || '';
}

function detectTelegramMessageKind(message: Telegram.Message): string {
    if (message.text) {
        return 'text';
    }
    if (message.photo) {
        return 'photo';
    }
    if (message.document) {
        return 'document';
    }
    if (message.video) {
        return 'video';
    }
    if (message.animation) {
        return 'animation';
    }
    if (message.voice) {
        return 'voice';
    }
    if (message.audio) {
        return 'audio';
    }
    if (message.sticker) {
        return 'sticker';
    }
    if (message.caption) {
        return 'caption-only';
    }
    return 'unknown';
}

function summarizeContentParts(parts: any[]): {
    partCount: number;
    partTypes: string[];
    textLength: number;
    imageCount: number;
    fileCount: number;
    toolCallCount: number;
    toolResultCount: number;
} {
    return {
        partCount: parts.length,
        partTypes: parts.map(part => part?.type || typeof part),
        textLength: parts.reduce((sum, part) => sum + (part?.type === 'text' ? `${part.text || ''}`.length : 0), 0),
        imageCount: parts.filter(part => part?.type === 'image').length,
        fileCount: parts.filter(part => part?.type === 'file').length,
        toolCallCount: parts.filter(part => part?.type === 'tool-call').length,
        toolResultCount: parts.filter(part => part?.type === 'tool-result').length,
    };
}

function summarizeModelContent(content: ModelMessage['content']) {
    if (typeof content === 'string') {
        return {
            kind: 'text',
            textLength: content.length,
            textPreview: previewText(content),
        };
    }
    if (Array.isArray(content)) {
        return {
            kind: 'parts',
            ...summarizeContentParts(content),
        };
    }
    return {
        kind: typeof content,
    };
}

export function formatDiagnosticFields(fields: Record<string, unknown>): string {
    return Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join(' ');
}

export function summarizeTelegramMessage(message: Telegram.Message) {
    const text = message.text || message.caption || '';
    return {
        messageId: message.message_id,
        chatId: message.chat.id,
        chatType: message.chat.type,
        userId: message.from?.id ?? null,
        username: message.from?.username || '',
        kind: detectTelegramMessageKind(message),
        textLength: text.length,
        textPreview: previewText(text),
        command: text.trim().startsWith('/') ? text.trim().split(/\s+/)[0] : '',
        hasReply: Boolean(message.reply_to_message),
        hasQuote: Boolean(message.quote?.text),
        mediaGroupId: message.media_group_id || '',
        messageThreadId: message.message_thread_id ?? null,
        isTopicMessage: Boolean(message.is_topic_message),
    };
}

export function summarizeTelegramUpdate(update: Telegram.Update) {
    if (update.message) {
        return {
            updateId: update.update_id,
            type: 'message',
            ...summarizeTelegramMessage(update.message),
        };
    }
    if (update.callback_query) {
        return {
            updateId: update.update_id,
            type: 'callback_query',
            queryId: update.callback_query.id,
            userId: update.callback_query.from?.id ?? null,
            username: update.callback_query.from?.username || '',
            data: update.callback_query.data || '',
            chatId: update.callback_query.message?.chat.id ?? null,
            messageId: update.callback_query.message?.message_id ?? null,
        };
    }
    if (update.inline_query) {
        return {
            updateId: update.update_id,
            type: 'inline_query',
            queryId: update.inline_query.id,
            userId: update.inline_query.from.id,
            username: update.inline_query.from.username || '',
            queryLength: update.inline_query.query.length,
            queryPreview: previewText(update.inline_query.query),
            chatType: update.inline_query.chat_type || '',
        };
    }
    if (update.chosen_inline_result) {
        return {
            updateId: update.update_id,
            type: 'chosen_inline_result',
            resultId: update.chosen_inline_result.result_id,
            userId: update.chosen_inline_result.from.id,
            username: update.chosen_inline_result.from.username || '',
            queryLength: update.chosen_inline_result.query.length,
            queryPreview: previewText(update.chosen_inline_result.query),
        };
    }
    if (update.edited_message) {
        return {
            updateId: update.update_id,
            type: 'edited_message',
            ...summarizeTelegramMessage(update.edited_message),
        };
    }
    return {
        updateId: update.update_id,
        type: 'unknown',
        keys: Object.keys(update),
    };
}

export function summarizeInlineQuery(query: Telegram.InlineQuery) {
    return {
        queryId: query.id,
        userId: query.from.id,
        username: query.from.username || '',
        queryLength: query.query.length,
        queryPreview: previewText(query.query),
        chatType: query.chat_type || '',
        offset: query.offset || '',
    };
}

export function summarizeChosenInlineQuery(query: Telegram.ChosenInlineResult) {
    return {
        resultId: query.result_id,
        inlineMessageId: query.inline_message_id || '',
        userId: query.from.id,
        username: query.from.username || '',
        queryLength: query.query.length,
        queryPreview: previewText(query.query),
    };
}

export function summarizeShareContext(context: Pick<ShareContext, 'botId' | 'botName' | 'chatId' | 'chatHistoryKey' | 'configStoreKey' | 'chunkMessageKey' | 'storeMediaMessageKey' | 'telegraphAccessTokenKey'>) {
    return {
        botId: context.botId,
        botName: context.botName || '',
        chatId: context.chatId,
        historyKey: context.chatHistoryKey,
        configKey: context.configStoreKey,
        chunkKey: context.chunkMessageKey || '',
        mediaKey: context.storeMediaMessageKey || '',
        telegraphKey: context.telegraphAccessTokenKey || '',
    };
}

export function summarizeUserConfig(config: AgentUserConfig) {
    const chatProvider = config.AI_CHAT_PROVIDER || '';
    const imageProvider = config.AI_IMAGE_PROVIDER || '';
    const asrProvider = config.AI_ASR_PROVIDER || '';
    const ttsProvider = config.AI_TTS_PROVIDER || '';
    return {
        chatProvider,
        chatModel: resolveProviderModel(config, chatProvider, 'CHAT'),
        visionOverride: config.VISION_MODEL?.trim() || '',
        visionModel: config.VISION_MODEL?.trim() || resolveProviderModel(config, chatProvider, 'VISION'),
        toolModel: config.TOOL_MODEL?.trim() || '',
        imageProvider,
        imageModel: resolveProviderModel(config, imageProvider, 'IMAGE'),
        asrProvider,
        asrModel: resolveProviderModel(config, asrProvider, 'STT'),
        ttsProvider,
        ttsModel: resolveProviderModel(config, ttsProvider, 'TTS'),
        useMcp: Array.isArray(config.USE_MCP) ? config.USE_MCP : [],
        useOpenAIBuiltin: Array.isArray(config.USE_OPENAI_BUILDIN) ? config.USE_OPENAI_BUILDIN : [],
        textHandleType: config.TEXT_HANDLE_TYPE,
        textOutput: config.TEXT_OUTPUT,
        audioHandleType: config.AUDIO_HANDLE_TYPE,
        audioOutput: config.AUDIO_OUTPUT,
        defineKeyCount: Array.isArray(config.DEFINE_KEYS) ? config.DEFINE_KEYS.length : 0,
    };
}

export function summarizeModelMessage(message: ModelMessage) {
    return {
        role: message.role,
        ...summarizeModelContent(message.content),
    };
}

export function summarizeModelMessages(messages: ModelMessage[]) {
    const roles = countBy(messages.map(message => message.role));
    return {
        count: messages.length,
        roles,
        multimodalMessages: messages.filter(message => Array.isArray(message.content)).length,
        lastMessage: messages.length > 0 ? summarizeModelMessage(messages.at(-1)!) : null,
    };
}

export function summarizeHistory(history: ModelMessage[]) {
    return summarizeModelMessages(history);
}
