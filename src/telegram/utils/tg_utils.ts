import type * as Telegram from 'telegram-bot-api-types';
import { ENV } from '../../config/env';
import { log } from '../../log';
import { createTelegramBotAPI } from '../api';
import { findPhotoFileID } from '../handler/chat';

export function isTelegramChatTypeGroup(type: string): boolean {
    return type === 'group' || type === 'supergroup';
}

type MsgType = 'text' | 'photo' | 'voice' | 'image' | 'audio' | 'document' | 'sticker' | 'video' | 'animation' | 'unknown' | 'unsupported';
const TEXT_LIKE_DOCUMENT_MIME_TYPES = new Set([
    'application/json',
    'application/ld+json',
    'application/x-ndjson',
    'application/ndjson',
    'application/toml',
    'application/yaml',
    'application/x-yaml',
    'application/xml',
]);
const TEXT_LIKE_DOCUMENT_EXTENSIONS = new Set([
    'txt',
    'text',
    'md',
    'markdown',
    'csv',
    'tsv',
    'json',
    'jsonl',
    'ndjson',
    'yaml',
    'yml',
    'toml',
    'xml',
    'ini',
    'cfg',
    'conf',
    'env',
    'log',
    'sql',
]);
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
    const directSupport = mediaType.match(/^(audio|image|text|video)\//)?.[1];
    if (directSupport) {
        return directSupport as MsgType;
    }
    if (mediaType === 'application/pdf') {
        return 'document';
    }
    if (TEXT_LIKE_DOCUMENT_MIME_TYPES.has(mediaType)) {
        return 'text';
    }
    const extension = fileName?.split('.').pop()?.toLowerCase() || '';
    if (TEXT_LIKE_DOCUMENT_EXTENSIONS.has(extension)) {
        return 'text';
    }
    return 'unsupported';
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

export function UUIDv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
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

// export async function getStoreMediaIds(context: ShareContext, media_group_id: string | undefined): Promise<string[]> {
//     if (!media_group_id || !context.storeMediaMessageKey) {
//         return [];
//     }
//     const fileIds = JSON.parse(await ENV.REDIS.get(context.storeMediaMessageKey) || '{}');
//     return fileIds[media_group_id] || [];
// }

export async function waitUntil(timestamp: number) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, timestamp - Date.now())));
}
