import type * as Telegram from 'telegram-bot-api-types';
import { canUseDocumentOcr } from '../../agent/document_ocr';
import { ENV } from '../../config/env';
import { log } from '../../log';
import { isTextLikeDocumentInput } from '../../utils/document_input';
import { createTelegramBotAPI } from '../api';

export function isTelegramChatTypeGroup(type: string): boolean {
    return type === 'group' || type === 'supergroup';
}

type MsgType = 'text' | 'photo' | 'voice' | 'image' | 'audio' | 'document' | 'sticker' | 'video' | 'animation' | 'unknown' | 'unsupported';
export interface UnionData {
    type: MsgType;
    original_type?: MsgType;
    mime_type?: string;
    file_name?: string;
    media_group_id?: string;
    text?: string;
    // reply_text?: string;
    id?: string[];
    url?: string[];
    raw?: Blob[];
}

const SUPPORTED_INLINE_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
]);

const SUPPORTED_INLINE_IMAGE_EXTENSIONS = new Set([
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
]);

export function getMessageText(message?: Pick<Telegram.Message, 'text' | 'caption'> | null): string {
    return message?.text || message?.caption || '';
}

type MessageTextLike = Pick<Telegram.Message, 'text' | 'caption' | 'entities' | 'caption_entities'>;

export function getMessageTextWithoutBotShowInfo(message?: MessageTextLike | null): string {
    const text = getMessageText(message);
    if (text === '') {
        return text;
    }

    const infoRange = resolveBotShowInfoRange(message, text);
    if (!infoRange) {
        return text;
    }
    return `${text.slice(0, infoRange.start)}${text.slice(infoRange.end)}`.trim();
}

function resolveBotShowInfoRange(message: MessageTextLike | null | undefined, text: string): { start: number; end: number } | null {
    const entities = message?.text !== undefined
        ? (message.entities || [])
        : (message?.caption_entities || []);
    if (entities.length === 0) {
        return null;
    }

    const quotedChars = getEntityCoverage(text.length, entities, new Set(['blockquote', 'expandable_blockquote']));
    const codeChars = getEntityCoverage(text.length, entities, new Set(['code', 'pre']));
    const resolvers = ENV.LOG_POSITION_ON_TOP
        ? [resolveQuotedPrefixRange, resolveQuotedSuffixRange]
        : [resolveQuotedSuffixRange, resolveQuotedPrefixRange];

    for (const resolver of resolvers) {
        const range = resolver(text, quotedChars, codeChars);
        if (range) {
            return range;
        }
    }
    return null;
}

function getEntityCoverage(textLength: number, entities: Telegram.MessageEntity[], types: Set<Telegram.MessageEntityType>): boolean[] {
    const coverage: boolean[] = [];
    for (let i = 0; i < textLength; i++) {
        coverage.push(false);
    }
    for (const entity of entities) {
        if (!types.has(entity.type)) {
            continue;
        }
        const start = Math.max(0, entity.offset);
        const end = Math.min(textLength, entity.offset + entity.length);
        for (let i = start; i < end; i++) {
            coverage[i] = true;
        }
    }
    return coverage;
}

function resolveQuotedSuffixRange(text: string, quotedChars: boolean[], codeChars: boolean[]): { start: number; end: number } | null {
    let visibleEnd = text.length;
    while (visibleEnd > 0 && /\s/.test(text[visibleEnd - 1])) {
        visibleEnd--;
    }
    if (visibleEnd === 0 || !quotedChars[visibleEnd - 1]) {
        return null;
    }

    let start = visibleEnd;
    let sawCode = false;
    for (let i = visibleEnd - 1; i >= 0; i--) {
        if (quotedChars[i]) {
            start = i;
            sawCode ||= codeChars[i];
            continue;
        }
        if (/\s/.test(text[i])) {
            start = i;
            continue;
        }
        break;
    }

    if (!sawCode) {
        return null;
    }
    return { start, end: text.length };
}

function resolveQuotedPrefixRange(text: string, quotedChars: boolean[], codeChars: boolean[]): { start: number; end: number } | null {
    let visibleStart = 0;
    while (visibleStart < text.length && /\s/.test(text[visibleStart])) {
        visibleStart++;
    }
    if (visibleStart >= text.length || !quotedChars[visibleStart]) {
        return null;
    }

    let end = visibleStart;
    let sawCode = false;
    for (let i = visibleStart; i < text.length; i++) {
        if (quotedChars[i]) {
            end = i + 1;
            sawCode ||= codeChars[i];
            continue;
        }
        if (/\s/.test(text[i])) {
            end = i + 1;
            continue;
        }
        break;
    }

    if (!sawCode) {
        return null;
    }
    return { start: 0, end };
}

function formatReplyUserInfo(user: Telegram.User): string {
    if (user.username) {
        return `@${user.username} (ID:${user.id})`;
    }
    if (user.last_name) {
        return `${user.first_name} ${user.last_name} (ID:${user.id})`;
    }
    return `${user.first_name} (ID:${user.id})`;
}

export function getMergedQuoteText(message: Telegram.Message, currentBotId: number): string {
    const quoteText = message.quote?.text || '';
    const replyText = getMessageText(message.reply_to_message);
    const mergedQuoteText = quoteText || replyText;
    if (mergedQuoteText === '') {
        return '';
    }
    if (message.reply_to_message?.from?.id === Number(currentBotId) || !message.reply_to_message?.from) {
        return mergedQuoteText;
    }
    return `${mergedQuoteText} — ${formatReplyUserInfo(message.reply_to_message.from)}`;
}

export function stripMergedQuoteFromCommandText(subcommand: string, message: Telegram.Message, currentBotId: number): string {
    const trimmedSubcommand = subcommand.trim();
    const mergedQuoteText = getMergedQuoteText(message, currentBotId);
    if (mergedQuoteText === '') {
        return trimmedSubcommand;
    }
    const mergedQuoteBlock = `> ${mergedQuoteText}`;
    if (trimmedSubcommand === mergedQuoteBlock) {
        return '';
    }
    const mergedQuoteSuffix = `\n${mergedQuoteBlock}`;
    if (trimmedSubcommand.endsWith(mergedQuoteSuffix)) {
        return trimmedSubcommand.slice(0, -mergedQuoteSuffix.length).trim();
    }
    return trimmedSubcommand;
}

function assertWithinDownloadLimit(fileSize: number | undefined, type: string) {
    const maxSize = Number(ENV.TELEGRAM_FILE_DOWNLOAD_MAX_SIZE);
    if (!Number.isFinite(maxSize) || maxSize <= 0 || !fileSize) {
        return;
    }
    if (fileSize > maxSize) {
        const actualSizeMb = (fileSize / 1024 / 1024).toFixed(1);
        const maxSizeMb = (maxSize / 1024 / 1024).toFixed(1);
        throw new Error(`File size over limit: ${actualSizeMb}MB. The maximum ${type} size is ${maxSizeMb}MB.`);
    }
}

export function extractMessageInfo(message: Telegram.Message, currentBotId: number): UnionData {
    const messageData = extractTypeFromMessage(message);

    if (messageData.type === 'text' && isNeedGetReplyMessage(message, currentBotId)) {
        const { type, id, mime_type, file_name, media_group_id } = extractTypeFromMessage(message.reply_to_message as any) || {};
        if (type && type !== 'text' && type !== 'unknown')
            messageData.type = type;
        if (id && id.length > 0)
            messageData.id = id;
        if (mime_type)
            messageData.mime_type = mime_type;
        if (file_name)
            messageData.file_name = file_name;
        if (media_group_id)
            messageData.media_group_id = media_group_id;
    }

    return messageData;
}

function resolveDocumentUnionType(mimeType?: string, fileName?: string): MsgType {
    const mediaType = mimeType?.toLowerCase() || '';
    if (mediaType.startsWith('image/')) {
        return isSupportedInlineImageInput(mediaType, fileName) ? 'image' : 'unsupported';
    }
    const directSupport = mediaType.match(/^(audio|text|video)\//)?.[1];
    if (directSupport) {
        return directSupport as MsgType;
    }
    if (mediaType === 'application/pdf') {
        return 'document';
    }
    if (isTextLikeDocumentInput(mediaType, fileName)) {
        return 'text';
    }
    if (canUseDocumentOcr(mediaType, fileName)) {
        return 'document';
    }
    return 'unsupported';
}

function isSupportedInlineImageInput(mimeType?: string, fileName?: string): boolean {
    const normalizedMimeType = `${mimeType || ''}`.trim().toLowerCase();
    if (SUPPORTED_INLINE_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
        return true;
    }
    const extension = fileName?.split('.').pop()?.toLowerCase() || '';
    return SUPPORTED_INLINE_IMAGE_EXTENSIONS.has(extension);
}

function findPhotoFileID(photos: Telegram.PhotoSize[], offset: number): string {
    let sizeIndex = offset >= 0 ? offset : photos.length + offset;
    sizeIndex = Math.max(0, Math.min(sizeIndex, photos.length - 1));
    return photos[sizeIndex].file_id;
}

function extractTypeFromMessage(message: Telegram.Message): UnionData {
    const msgTypes: string[] = ['text', 'photo', 'voice', 'document', 'audio', 'animation', 'sticker', 'video'];
    const msgType = Object.keys(message).find(t => msgTypes.includes(t));
    const typeInfo = {
        type: msgType ?? 'unknown',
        original_type: msgType ?? 'unknown',
    } as UnionData;

    switch (msgType) {
        case 'text':
            return typeInfo;
        case 'photo':
        {
            const file_id = findPhotoFileID(message.photo as Telegram.PhotoSize[], ENV.TELEGRAM_PHOTO_SIZE_OFFSET);
            if (!file_id) {
                console.error('photo file_id not found', message);
            }
            assertWithinDownloadLimit((message.photo as Telegram.PhotoSize[]).find(item => item.file_id === file_id)?.file_size, 'photo');
            return {
                type: msgType,
                original_type: 'photo',
                id: file_id ? [file_id] : undefined,
                media_group_id: message.media_group_id,
            };
        }
        case 'document':
        {
            assertWithinDownloadLimit(message[msgType]?.file_size, 'document');
            const id = message[msgType]?.file_id;
            if (!id) {
                throw new Error('file_id not found');
            }
            const mimeType = message.document?.mime_type;
            const fileName = message.document?.file_name;
            typeInfo.type = resolveDocumentUnionType(mimeType, fileName);
            return {
                type: typeInfo.type,
                original_type: msgType,
                mime_type: mimeType,
                file_name: fileName,
                id: id ? [id] : undefined,
                media_group_id: message.media_group_id,
            };
        }
        case 'audio':
        case 'voice':
        case 'animation':
        case 'sticker':
        case 'video':
        {
            assertWithinDownloadLimit(message[msgType]?.file_size, msgType);
            const id = message[msgType]?.file_id;
            if (!id) {
                throw new Error('file_id not found');
            }
            return {
                type: typeInfo.type,
                original_type: msgType,
                id: id ? [id] : undefined,
                media_group_id: message.media_group_id,
            };
        }
        default:
            return typeInfo;
    }
}

function isNeedGetReplyMessage(message: Telegram.Message, currentBotId: number) {
    const replyMsg = message.reply_to_message;
    return ENV.EXTRA_MESSAGE_CONTEXT && replyMsg && (replyMsg.from?.id !== currentBotId || replyMsg.photo || replyMsg.audio || replyMsg.document || replyMsg.video || replyMsg.voice);
}

export const isCfWorker = typeof globalThis !== 'undefined'
    && typeof (globalThis as any).ServiceWorkerGlobalScope !== 'undefined'
    && globalThis instanceof ((globalThis as any).ServiceWorkerGlobalScope);

export function chunkArray(arr: any[], size: number): any[][] {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}

export async function getTelegramFile(fileIds: string[], botToken: string, type: 'url' | 'blob' | 'base64' = 'url') {
    const api = createTelegramBotAPI(botToken);
    const files = await Promise.all(fileIds.map(id => api.getFileWithReturns({ file_id: id })));
    const errorFile = files.find(f => !f.ok) as unknown as Telegram.ResponseError | undefined;
    if (errorFile) {
        throw new Error(errorFile.description);
    }

    const paths = files.map(f => f.result?.file_path).filter(Boolean) as string[];
    const telegramBaseUrl = ENV.TELEGRAM_API_DOMAIN.replace(/\/+$/, '');
    log.info(`[getTelegramFile] resolved ${paths.length} Telegram file(s)`);
    const urls = paths.map(p => `${telegramBaseUrl}/file/bot${botToken}/${p}`);

    switch (type) {
        case 'url':
            return urls;
        case 'blob':
            return await Promise.all(urls.map(url => fetch(url, {
            }).then(res => res.blob())));
        case 'base64':
            return await Promise.all(urls.map(url => fetch(url, {
            }).then(res => res.arrayBuffer()).then(buffer => Buffer.from(buffer).toString('base64'))));
    }
}

export async function waitUntil(timestamp: number) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, timestamp - Date.now())));
}
