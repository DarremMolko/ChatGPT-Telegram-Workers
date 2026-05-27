import { Cache } from '../cache';

const IMAGE_CACHE = new Cache<Blob>();
const IMAGE_MIME_TYPE_TO_EXTENSION: Record<string, string> = {
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

async function fetchImage(url: string): Promise<Blob> {
    const cache = IMAGE_CACHE.get(url);
    if (cache) {
        return cache;
    }
    return fetch(url)
        .then(resp => resp.blob())
        .then((blob) => {
            IMAGE_CACHE.set(url, blob);
            return blob;
        });
}

async function urlToBase64String(url: string): Promise<string> {
    try {
        const { Buffer } = await import('node:buffer');
        return fetchImage(url)
            .then(blob => blob.arrayBuffer())
            .then(buffer => Buffer.from(buffer).toString('base64'));
    } catch {
    // Fallback for runtimes without native Buffer support.
        return fetchImage(url)
            .then(blob => blob.arrayBuffer())
            .then(buffer => btoa(String.fromCharCode.apply(null, new Uint8Array(buffer) as unknown as number[])));
    }
}

export function detectImageMimeTypeFromBase64(base64String: string): string {
    const firstChar = base64String.charAt(0);
    switch (firstChar) {
        case '/':
            return 'image/jpeg';
        case 'i':
            return 'image/png';
        case 'R':
            return 'image/gif';
        case 'U':
            return 'image/webp';
        default:
            throw new Error('Unsupported image format');
    }
}

export function resolveImageMimeType(format?: string | null): string {
    const normalized = `${format || ''}`.trim().toLowerCase();
    if (!normalized) {
        return 'image/png';
    }
    if (normalized.includes('/')) {
        return normalized;
    }
    if (normalized === 'jpg') {
        return 'image/jpeg';
    }
    return `image/${normalized}`;
}

export function resolveImageFileName(mimeType?: string | null, basename = 'image'): string {
    const normalizedMimeType = resolveImageMimeType(mimeType);
    const extension = IMAGE_MIME_TYPE_TO_EXTENSION[normalizedMimeType] || 'png';
    return `${basename}.${extension}`;
}

export function createImageFile(data: BlobPart, mimeTypeOrFormat?: string | null, basename = 'image'): File {
    const mimeType = resolveImageMimeType(mimeTypeOrFormat);
    return new File([data], resolveImageFileName(mimeType, basename), { type: mimeType });
}

interface Base64DataWithFormat {
    data: string;
    format: string;
}

export async function imageToBase64String(url: string): Promise<Base64DataWithFormat> {
    const base64String = await urlToBase64String(url);
    const format = detectImageMimeTypeFromBase64(base64String);
    return {
        data: base64String,
        format,
    };
}

export async function base64StringToBlob(base64String: string, type = 'image/png'): Promise<Blob> {
    try {
        const { Buffer } = await import('node:buffer');
        const buffer = Buffer.from(base64String, 'base64');
        return new Blob([buffer], { type });
    } catch {
        const uint8Array = Uint8Array.from(atob(base64String), c => c.charCodeAt(0));
        return new Blob([uint8Array], { type });
    }
}
