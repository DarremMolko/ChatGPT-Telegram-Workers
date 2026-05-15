import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
    fetchMock: vi.fn(),
}));

vi.mock('../config/env', () => ({
    ENV: {
        DOCUMENT_OCR_PROVIDER: 'mistral',
        DOCUMENT_OCR_TIMEOUT: 120,
        MISTRAL_OCR_API_KEY: 'mistral-secret',
        MISTRAL_OCR_API_BASE: 'https://mistral.example.test/v1/',
        MISTRAL_OCR_MODEL: 'mistral-ocr-latest',
    },
}));

vi.mock('../log', () => ({
    log: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.stubGlobal('fetch', fetchMock);

const { canUseDocumentOcr, extractDocumentText } = await import('./document_ocr');

beforeEach(() => {
    fetchMock.mockReset();
});

describe('document OCR', () => {
    it('uploads the document, requests OCR, and deletes the temporary file', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'file-123' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                pages: [
                    { markdown: 'Page one' },
                    { markdown: 'Page two' },
                ],
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response('', { status: 200 }));

        const text = await extractDocumentText({
            data: new Uint8Array([1, 2, 3]),
            mimeType: 'application/pdf',
            fileName: 'scan.pdf',
        });

        expect(text).toBe('[Page 1]\n\nPage one\n\n[Page 2]\n\nPage two');
        expect(fetchMock).toHaveBeenCalledTimes(3);

        const uploadCall = fetchMock.mock.calls[0];
        expect(uploadCall[0]).toBe('https://mistral.example.test/v1/files');
        expect(uploadCall[1]?.method).toBe('POST');
        expect((uploadCall[1]?.body as FormData).get('purpose')).toBe('ocr');
        expect((uploadCall[1]?.body as FormData).get('file')).toBeInstanceOf(File);

        const ocrCall = fetchMock.mock.calls[1];
        expect(ocrCall[0]).toBe('https://mistral.example.test/v1/ocr');
        expect(ocrCall[1]?.method).toBe('POST');
        expect(JSON.parse(String(ocrCall[1]?.body))).toEqual({
            model: 'mistral-ocr-latest',
            document: {
                file_id: 'file-123',
            },
        });

        const deleteCall = fetchMock.mock.calls[2];
        expect(deleteCall[0]).toBe('https://mistral.example.test/v1/files/file-123');
        expect(deleteCall[1]?.method).toBe('DELETE');
    });

    it('returns null when OCR is disabled or the MIME type is unsupported', async () => {
        expect(canUseDocumentOcr('text/plain')).toBe(false);
        expect(canUseDocumentOcr('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'note.docx')).toBe(true);
        expect(canUseDocumentOcr('application/octet-stream', 'deck.pptx')).toBe(true);
        await expect(extractDocumentText({
            data: new Uint8Array([1, 2, 3]),
            mimeType: 'text/plain',
            fileName: 'note.txt',
        })).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
