import { beforeEach, describe, expect, it, vi } from 'vitest';

const { canUseDocumentOcrMock, extractDocumentTextMock, fetchMock } = vi.hoisted(() => ({
    canUseDocumentOcrMock: vi.fn(() => true),
    extractDocumentTextMock: vi.fn(),
    fetchMock: vi.fn(),
}));

vi.mock('../../agent', () => ({
    loadASRLLM: vi.fn(),
    loadTTSLLM: vi.fn(),
    TTS_AGENTS: [],
}));

vi.mock('../../agent/document_ocr', () => ({
    canUseDocumentOcr: canUseDocumentOcrMock,
    extractDocumentText: extractDocumentTextMock,
}));

vi.mock('../../config/env', () => ({
    ENV: {
        DEFAULT_PARSE_MODE: 'MarkdownV2',
        DOCUMENT_OCR_PROVIDER: 'mistral',
        ENABLE_SHOWINFO: false,
        EXPANDABLE_BANNER: false,
        LOG_POSITION_ON_TOP: false,
    },
}));

vi.mock('../../log', () => ({
    getLog: vi.fn(() => ''),
    log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../../utils/image', () => ({
    imageToBase64String: vi.fn(),
}));

vi.mock('../../utils/others/audio', () => ({
    convertAudio: vi.fn(),
}));

vi.mock('./render_shared', () => ({
    SEGMENTATION_MARK: '---',
    wrapExpandableQuote: vi.fn((value: string) => value),
}));

vi.stubGlobal('fetch', fetchMock);

const { fileUrlToBase64Message } = await import('./media');

beforeEach(() => {
    canUseDocumentOcrMock.mockReset();
    canUseDocumentOcrMock.mockReturnValue(true);
    extractDocumentTextMock.mockReset();
    fetchMock.mockReset();
});

describe('fileUrlToBase64Message document OCR', () => {
    it('replaces PDF file parts with OCR text when extraction succeeds', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        });
        extractDocumentTextMock.mockResolvedValue('Detected OCR text');

        const params = await fileUrlToBase64Message({
            urls: ['https://telegram.example.test/file.pdf'],
            type: 'document',
            mimeType: 'application/pdf',
            fileName: 'file.pdf',
            params: {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Summarize this',
                    },
                ],
            },
            AUDIO_HANDLE_TYPE: 'chat',
            text: 'Summarize this',
        });

        expect(params.content).toEqual([
            {
                type: 'text',
                text: expect.stringContaining('Detected OCR text'),
            },
        ]);
        expect((params.content[0] as any).text).toContain('Document contents:');
        expect((params.content[0] as any).text).not.toContain('OCR provider:');
    });

    it('falls back to the native PDF file path when OCR fails', async () => {
        const pdf = new Uint8Array([9, 8, 7]);
        fetchMock.mockResolvedValue({
            ok: true,
            arrayBuffer: async () => pdf.buffer,
        });
        extractDocumentTextMock.mockRejectedValue(new Error('OCR unavailable'));

        const params = await fileUrlToBase64Message({
            urls: ['https://telegram.example.test/file.pdf'],
            type: 'document',
            mimeType: 'application/pdf',
            fileName: 'file.pdf',
            params: {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Summarize this',
                    },
                ],
            },
            AUDIO_HANDLE_TYPE: 'chat',
            text: 'Summarize this',
        });

        expect(params.content).toHaveLength(2);
        expect(params.content[1]).toEqual({
            type: 'file',
            data: pdf,
            mediaType: 'application/pdf',
            filename: 'file.pdf',
        });
    });

    it('uses OCR text for non-PDF documents accepted through the OCR provider', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new Uint8Array([5, 4, 3]).buffer,
        });
        extractDocumentTextMock.mockResolvedValue('Slides OCR text');

        const params = await fileUrlToBase64Message({
            urls: ['https://telegram.example.test/deck.pptx'],
            type: 'document',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            fileName: 'deck.pptx',
            params: {
                role: 'user',
                content: [],
            },
            AUDIO_HANDLE_TYPE: 'chat',
            text: '',
        });

        expect(params.content).toEqual([
            {
                type: 'text',
                text: expect.stringContaining('Slides OCR text'),
            },
        ]);
        expect((params.content[0] as any).text).toContain('The user attached a document.');
        expect((params.content[0] as any).text).toContain('Document contents:');
    });

    it('throws when a non-PDF OCR document cannot be extracted', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new Uint8Array([5, 4, 3]).buffer,
        });
        extractDocumentTextMock.mockRejectedValue(new Error('OCR unavailable'));

        await expect(fileUrlToBase64Message({
            urls: ['https://telegram.example.test/deck.pptx'],
            type: 'document',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            fileName: 'deck.pptx',
            params: {
                role: 'user',
                content: [],
            },
            AUDIO_HANDLE_TYPE: 'chat',
            text: '',
        })).rejects.toThrow('OCR unavailable');
    });
});
