import { ENV } from '../config/env';
import { log } from '../log';
import { getDocumentExtension } from '../utils/document_input';

type DocumentOcrProvider = 'mistral';

const OCR_SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/epub+zip',
    'application/rtf',
    'text/rtf',
]);

const OCR_SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
    'pdf',
    'doc',
    'docx',
    'ppt',
    'pptx',
    'xls',
    'xlsx',
    'odt',
    'epub',
    'rtf',
]);

export interface DocumentOcrRequest {
    data: Uint8Array;
    mimeType: string;
    fileName?: string;
}

interface UploadedMistralFile {
    id: string;
}

interface MistralOcrPage {
    markdown?: string;
}

interface MistralOcrResponse {
    pages?: MistralOcrPage[];
}

function normalizeBaseUrl(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

function joinApiPath(baseUrl: string, path: string): string {
    return `${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

function summarizeResponseBody(body: string): string {
    const trimmed = body.trim();
    if (trimmed === '') {
        return '';
    }
    if (trimmed.startsWith('<')) {
        return trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return trimmed;
}

function tryParseJson(body: string): any {
    try {
        return JSON.parse(body);
    } catch {
        return undefined;
    }
}

function extractErrorMessage(payload: any): string | undefined {
    return payload?.error?.message || payload?.error || payload?.message || payload?.detail;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
    const body = await response.text();
    const payload = tryParseJson(body);
    if (!response.ok) {
        const detail = extractErrorMessage(payload) || summarizeResponseBody(body);
        throw new Error(detail ? `${response.status} ${response.statusText}\n\n${detail}` : `${response.status} ${response.statusText}`);
    }
    return payload as T;
}

function resolveDocumentOcrProvider(): DocumentOcrProvider | '' {
    return ENV.DOCUMENT_OCR_PROVIDER === 'mistral' ? 'mistral' : '';
}

function createTimeoutSignal(): AbortSignal | undefined {
    const timeoutMs = Math.max(1, Number(ENV.DOCUMENT_OCR_TIMEOUT || 0)) * 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || typeof AbortSignal.timeout !== 'function') {
        return undefined;
    }
    return AbortSignal.timeout(timeoutMs);
}

function createMistralHeaders(): Record<string, string> {
    return {
        Authorization: `Bearer ${ENV.MISTRAL_OCR_API_KEY}`,
    };
}

async function uploadMistralDocument({ data, mimeType, fileName }: DocumentOcrRequest): Promise<UploadedMistralFile> {
    const fileBytes = Uint8Array.from(data);
    const formData = new FormData();
    formData.append('purpose', 'ocr');
    formData.append(
        'file',
        new File([fileBytes], fileName || 'document.pdf', {
            type: mimeType || 'application/pdf',
        }),
    );

    const response = await fetch(joinApiPath(ENV.MISTRAL_OCR_API_BASE, '/files'), {
        method: 'POST',
        headers: createMistralHeaders(),
        body: formData,
        signal: createTimeoutSignal(),
    });
    const payload = await parseJsonResponse<UploadedMistralFile>(response);
    if (!payload?.id) {
        throw new Error('Mistral OCR upload did not return a file id');
    }
    return payload;
}

async function deleteMistralDocument(fileId: string): Promise<void> {
    const response = await fetch(joinApiPath(ENV.MISTRAL_OCR_API_BASE, `/files/${fileId}`), {
        method: 'DELETE',
        headers: createMistralHeaders(),
        signal: createTimeoutSignal(),
    });
    if (!response.ok) {
        const body = await response.text();
        log.warn(`Failed to delete Mistral OCR file ${fileId}: ${response.status} ${response.statusText} ${summarizeResponseBody(body)}`.trim());
    }
}

function extractMistralMarkdown(payload: MistralOcrResponse): string {
    const pages = Array.isArray(payload?.pages) ? payload.pages : [];
    const sections = pages
        .map(page => `${page?.markdown || ''}`.trim())
        .filter(Boolean);

    if (sections.length === 0) {
        throw new Error('Mistral OCR response did not include any extracted text');
    }

    if (sections.length === 1) {
        return sections[0];
    }

    return sections
        .map((section, index) => [`[Page ${index + 1}]`, section].join('\n\n'))
        .join('\n\n');
}

async function requestMistralDocumentOcr(request: DocumentOcrRequest): Promise<string> {
    if (!ENV.MISTRAL_OCR_API_KEY) {
        throw new Error('MISTRAL_OCR_API_KEY is required when DOCUMENT_OCR_PROVIDER is set to mistral');
    }

    const uploadedFile = await uploadMistralDocument(request);
    try {
        const response = await fetch(joinApiPath(ENV.MISTRAL_OCR_API_BASE, '/ocr'), {
            method: 'POST',
            headers: {
                ...createMistralHeaders(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: ENV.MISTRAL_OCR_MODEL,
                document: {
                    file_id: uploadedFile.id,
                },
            }),
            signal: createTimeoutSignal(),
        });
        return extractMistralMarkdown(await parseJsonResponse<MistralOcrResponse>(response));
    } finally {
        await deleteMistralDocument(uploadedFile.id);
    }
}

export function canUseDocumentOcr(mimeType?: string, fileName?: string): boolean {
    return resolveDocumentOcrProvider() !== '' && supportsDocumentOcrInput(mimeType, fileName);
}

export function supportsDocumentOcrInput(mimeType?: string, fileName?: string): boolean {
    const normalizedMimeType = `${mimeType || ''}`.trim().toLowerCase();
    if (OCR_SUPPORTED_DOCUMENT_MIME_TYPES.has(normalizedMimeType)) {
        return true;
    }
    return OCR_SUPPORTED_DOCUMENT_EXTENSIONS.has(getDocumentExtension(fileName));
}

export async function extractDocumentText(request: DocumentOcrRequest): Promise<string | null> {
    const provider = resolveDocumentOcrProvider();
    if (!provider) {
        return null;
    }
    if (!supportsDocumentOcrInput(request.mimeType, request.fileName)) {
        return null;
    }
    if (provider === 'mistral') {
        return requestMistralDocumentOcr(request);
    }
    return null;
}
