import type * as Telegram from 'telegram-bot-api-types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
    ENV: {
        EXTRA_MESSAGE_CONTEXT: false,
        TELEGRAM_PHOTO_SIZE_OFFSET: -1,
    },
}));

vi.mock('../handler/chat', () => ({
    findPhotoFileID: vi.fn(() => 'photo-file-id'),
}));

const { extractMessageInfo } = await import('./tg_utils');

function createDocumentMessage(mimeType: string, fileName = 'file.bin'): Telegram.Message {
    return {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: {
            id: 123,
            type: 'private',
        } as Telegram.Chat,
        from: {
            id: 456,
            is_bot: false,
            first_name: 'User',
        },
        document: {
            file_id: 'document-file-id',
            file_unique_id: 'document-file-unique-id',
            file_name: fileName,
            mime_type: mimeType,
            file_size: 1024,
        },
    } as Telegram.Message;
}

describe('extractMessageInfo', () => {
    it('keeps PDFs as supported documents', () => {
        const info = extractMessageInfo(createDocumentMessage('application/pdf', 'paper.pdf'), 999);

        expect(info).toEqual(expect.objectContaining({
            type: 'document',
            original_type: 'document',
            mime_type: 'application/pdf',
            file_name: 'paper.pdf',
            id: ['document-file-id'],
        }));
    });

    it('maps text documents to text input', () => {
        const info = extractMessageInfo(createDocumentMessage('text/plain', 'note.txt'), 999);

        expect(info).toEqual(expect.objectContaining({
            type: 'text',
            original_type: 'document',
            mime_type: 'text/plain',
            file_name: 'note.txt',
        }));
    });

    it('maps common text-like application MIME types to text input', () => {
        expect(extractMessageInfo(createDocumentMessage('application/json', 'data.json'), 999)).toEqual(expect.objectContaining({
            type: 'text',
            file_name: 'data.json',
        }));
        expect(extractMessageInfo(createDocumentMessage('application/toml', 'config.toml'), 999)).toEqual(expect.objectContaining({
            type: 'text',
            file_name: 'config.toml',
        }));
        expect(extractMessageInfo(createDocumentMessage('application/x-yaml', 'config.yaml'), 999)).toEqual(expect.objectContaining({
            type: 'text',
            file_name: 'config.yaml',
        }));
    });

    it('falls back to filename extension for text-like octet-stream documents', () => {
        const info = extractMessageInfo(createDocumentMessage('application/octet-stream', 'settings.toml'), 999);

        expect(info).toEqual(expect.objectContaining({
            type: 'text',
            mime_type: 'application/octet-stream',
            file_name: 'settings.toml',
        }));
    });

    it('marks unsupported document MIME types as unsupported', () => {
        const info = extractMessageInfo(createDocumentMessage('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'note.docx'), 999);

        expect(info).toEqual(expect.objectContaining({
            type: 'unsupported',
            original_type: 'document',
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            file_name: 'note.docx',
        }));
    });
});
