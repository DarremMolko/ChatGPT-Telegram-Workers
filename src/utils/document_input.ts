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
    'bib',
    'fb2',
    'ipynb',
    'opml',
    'tex',
    '1',
    'man',
]);

export function getDocumentExtension(fileName?: string): string {
    return fileName?.split('.').pop()?.toLowerCase() || '';
}

export function isTextLikeDocumentInput(mimeType?: string, fileName?: string): boolean {
    const mediaType = mimeType?.toLowerCase() || '';
    if (TEXT_LIKE_DOCUMENT_MIME_TYPES.has(mediaType)) {
        return true;
    }
    return TEXT_LIKE_DOCUMENT_EXTENSIONS.has(getDocumentExtension(fileName));
}
