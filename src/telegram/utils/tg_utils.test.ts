import type * as Telegram from 'telegram-bot-api-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFileWithReturns, fetchMock } = vi.hoisted(() => ({
    getFileWithReturns: vi.fn(),
    fetchMock: vi.fn(),
}));

vi.mock('../../config/env', () => ({
    ENV: {
        DOCUMENT_OCR_PROVIDER: '',
        EXTRA_MESSAGE_CONTEXT: false,
        LOG_POSITION_ON_TOP: false,
        TELEGRAM_PHOTO_SIZE_OFFSET: -1,
        TELEGRAM_API_DOMAIN: 'https://telegram.example.test/',
        TELEGRAM_FILE_DOWNLOAD_MAX_SIZE: 1024,
    },
}));

vi.mock('../api', () => ({
    createTelegramBotAPI: () => ({
        getFileWithReturns,
    }),
}));

vi.stubGlobal('fetch', fetchMock);

const { ENV } = await import('../../config/env');
const { extractMessageInfo, getMessageTextWithoutBotShowInfo, getTelegramFile } = await import('./tg_utils');

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

beforeEach(() => {
    ENV.DOCUMENT_OCR_PROVIDER = '';
    ENV.LOG_POSITION_ON_TOP = false;
    getFileWithReturns.mockReset();
    fetchMock.mockReset();
});

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

    it('maps supported image documents to image input', () => {
        const info = extractMessageInfo(createDocumentMessage('image/webp', 'sticker.webp'), 999);

        expect(info).toEqual(expect.objectContaining({
            type: 'image',
            original_type: 'document',
            mime_type: 'image/webp',
            file_name: 'sticker.webp',
        }));
    });

    it('marks unsupported image documents as unsupported instead of failing later', () => {
        const info = extractMessageInfo(createDocumentMessage('image/tiff', 'scan.tiff'), 999);

        expect(info).toEqual(expect.objectContaining({
            type: 'unsupported',
            original_type: 'document',
            mime_type: 'image/tiff',
            file_name: 'scan.tiff',
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

    it('marks OCR-only document MIME types as unsupported when OCR is disabled', () => {
        const info = extractMessageInfo(createDocumentMessage('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'note.docx'), 999);

        expect(info).toEqual(expect.objectContaining({
            type: 'unsupported',
            original_type: 'document',
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            file_name: 'note.docx',
        }));
    });

    it('maps OCR-supported office documents to document input when OCR is enabled', () => {
        ENV.DOCUMENT_OCR_PROVIDER = 'mistral';

        const info = extractMessageInfo(createDocumentMessage('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'note.docx'), 999);

        expect(info).toEqual(expect.objectContaining({
            type: 'document',
            original_type: 'document',
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            file_name: 'note.docx',
        }));
    });

    it('falls back to OCR-supported extensions for generic document MIME types', () => {
        ENV.DOCUMENT_OCR_PROVIDER = 'mistral';

        const info = extractMessageInfo(createDocumentMessage('application/octet-stream', 'deck.pptx'), 999);

        expect(info).toEqual(expect.objectContaining({
            type: 'document',
            mime_type: 'application/octet-stream',
            file_name: 'deck.pptx',
        }));
    });

    it('rejects files that exceed the configured download limit', () => {
        const message = createDocumentMessage('application/pdf', 'large.pdf');
        message.document!.file_size = 2048;

        expect(() => extractMessageInfo(message, 999)).toThrow('File size over limit');
    });
});

describe('getTelegramFile', () => {
    it('uses the configured Telegram API domain for file URLs', async () => {
        getFileWithReturns.mockResolvedValue({
            ok: true,
            result: {
                file_path: 'documents/file.txt',
            },
        });

        const result = await getTelegramFile(['document-file-id'], '123456789:ABCdef_GHIjklMNOpqrSTUvwxYZ0123456789', 'url');

        expect(result).toEqual([
            'https://telegram.example.test/file/bot123456789:ABCdef_GHIjklMNOpqrSTUvwxYZ0123456789/documents/file.txt',
        ]);
    });

    it('downloads binary content from the configured Telegram API domain', async () => {
        getFileWithReturns.mockResolvedValue({
            ok: true,
            result: {
                file_path: 'audio/file.ogg',
            },
        });
        fetchMock.mockResolvedValue({
            arrayBuffer: async () => new TextEncoder().encode('hello').buffer,
        });

        const result = await getTelegramFile(['audio-file-id'], '123456789:ABCdef_GHIjklMNOpqrSTUvwxYZ0123456789', 'base64');

        expect(fetchMock).toHaveBeenCalledWith('https://telegram.example.test/file/bot123456789:ABCdef_GHIjklMNOpqrSTUvwxYZ0123456789/audio/file.ogg', {});
        expect(result).toEqual(['aGVsbG8=']);
    });
});

describe('getMessageTextWithoutBotShowInfo', () => {
    it('strips SHOW_INFO quote lines appended to the bottom of a bot message', () => {
        const message = {
            text: 'Actual answer\nmodel 1.0s\n12,34',
            entities: [
                { type: 'blockquote', offset: 14, length: 10 },
                { type: 'code', offset: 14, length: 10 },
                { type: 'blockquote', offset: 25, length: 5 },
                { type: 'code', offset: 25, length: 5 },
            ],
        } as Telegram.Message;

        expect(getMessageTextWithoutBotShowInfo(message)).toBe('Actual answer');
    });

    it('strips SHOW_INFO quote lines prepended to the top of a bot message', () => {
        ENV.LOG_POSITION_ON_TOP = true;
        const message = {
            text: 'model 1.0s\n12,34\nActual answer',
            entities: [
                { type: 'blockquote', offset: 0, length: 10 },
                { type: 'code', offset: 0, length: 10 },
                { type: 'blockquote', offset: 11, length: 5 },
                { type: 'code', offset: 11, length: 5 },
            ],
        } as Telegram.Message;

        expect(getMessageTextWithoutBotShowInfo(message)).toBe('Actual answer');
    });
});
