export function extractErrorMessage(error: unknown): string {
    return unwrapErrorValue(error, new Set()) || 'Unknown error';
}

export function formatErrorAsMarkdown(error: unknown, { redactions = [], maxLength = Number.POSITIVE_INFINITY }: { redactions?: string[]; maxLength?: number } = {}): string {
    const structured = extractStructuredErrorPayload(error);
    if (structured !== undefined) {
        const headline = redactText(extractErrorHeadline(error) || '', redactions).trim();
        const jsonBody = redactText(JSON.stringify(structured, null, 2), redactions);
        return truncateStructuredMarkdownError(headline, jsonBody, maxLength);
    }

    const detail = redactText(extractErrorMessage(error), redactions) || 'Unknown error';
    return truncatePlainMarkdownError(detail, maxLength);
}

function unwrapErrorValue(value: unknown, seen: Set<unknown>): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (value instanceof Error) {
        return unwrapErrorObject(value as unknown as Record<string, unknown>, seen, value.name);
    }
    if (typeof value === 'string') {
        return unwrapErrorString(value, seen);
    }
    if (Array.isArray(value)) {
        const messages = value
            .map(item => unwrapErrorValue(item, seen))
            .filter(Boolean);
        return messages.length > 0 ? messages.join('\n') : undefined;
    }
    if (typeof value === 'object') {
        return unwrapErrorObject(value as Record<string, unknown>, seen);
    }
    return String(value);
}

function unwrapErrorObject(value: Record<string, unknown>, seen: Set<unknown>, fallbackName?: string): string | undefined {
    if (seen.has(value)) {
        return undefined;
    }
    seen.add(value);

    const primary = withStatusPrefix(
        unwrapMessageField(value.message, seen) || (fallbackName && fallbackName !== 'Error' ? fallbackName : undefined),
        value,
    );

    const detail = [
        'responseBody',
        'body',
        'error',
        'description',
        'detail',
        'details',
        'reason',
        'cause',
        'data',
    ]
        .map(key => key === 'message' ? undefined : unwrapDetailField(value[key], seen, primary))
        .find(Boolean);

    if (detail) {
        return mergeErrorMessages(primary, detail);
    }
    if (primary) {
        return primary;
    }

    const statusOnly = withStatusPrefix(undefined, value);
    if (statusOnly) {
        return statusOnly;
    }

    return JSON.stringify(value);
}

function unwrapMessageField(value: unknown, seen: Set<unknown>): string | undefined {
    if (typeof value === 'string') {
        return unwrapErrorString(value, seen);
    }
    if (value && typeof value === 'object') {
        return unwrapErrorValue(value, seen);
    }
    return undefined;
}

function unwrapDetailField(value: unknown, seen: Set<unknown>, primary?: string): string | undefined {
    const detail = unwrapErrorValue(value, seen);
    if (!detail) {
        return undefined;
    }
    if (!primary) {
        return detail;
    }

    const normalizedPrimary = primary.trim();
    const normalizedDetail = detail.trim();

    if (normalizedDetail === normalizedPrimary) {
        return undefined;
    }
    if (normalizedDetail.startsWith(normalizedPrimary) && normalizedDetail.length > normalizedPrimary.length) {
        return normalizedDetail.slice(normalizedPrimary.length).trim();
    }

    return normalizedDetail;
}

function withStatusPrefix(message: string | undefined, value: Record<string, unknown>): string | undefined {
    const statusCode = readNumericStatus(value.statusCode ?? value.status);
    const statusText = typeof value.statusText === 'string' && value.statusText.trim() !== ''
        ? value.statusText.trim()
        : undefined;

    if (!statusCode) {
        return message || statusText;
    }

    if (!message) {
        return statusText ? `${statusCode} ${statusText}` : String(statusCode);
    }

    if (new RegExp(`^${statusCode}(?:\\b|\\s)`).test(message)) {
        return message;
    }

    return `${statusCode} ${message}`;
}

function readNumericStatus(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        return Number.parseInt(value.trim(), 10);
    }
    return undefined;
}

function mergeErrorMessages(primary: string | undefined, detail: string): string {
    const normalizedDetail = detail.trim();
    if (!primary) {
        return normalizedDetail;
    }

    const normalizedPrimary = primary.trim();
    if (normalizedDetail === '' || normalizedDetail === normalizedPrimary) {
        return normalizedPrimary;
    }
    if (normalizedPrimary.includes(normalizedDetail)) {
        return normalizedPrimary;
    }
    if (normalizedDetail.includes(normalizedPrimary)) {
        return normalizedDetail;
    }

    return `${normalizedPrimary}\n\n${normalizedDetail}`;
}

function unwrapErrorString(value: string, seen: Set<unknown>): string | undefined {
    const trimmed = value.trim();
    if (trimmed === '') {
        return undefined;
    }

    const stripped = trimmed.replace(/^Error:\s*/i, '').trim();
    const parsed = tryParseJson(stripped);
    if (parsed !== undefined) {
        return unwrapErrorValue(parsed, seen) || stripped;
    }

    const [head, ...tailParts] = stripped.split(/\n\s*\n/);
    if (tailParts.length > 0) {
        const tail = tailParts.join('\n\n').trim();
        const parsedTail = tryParseJson(tail);
        if (parsedTail !== undefined) {
            const detail = unwrapErrorValue(parsedTail, seen);
            if (detail) {
                return mergeErrorMessages(head.trim(), detail);
            }
        }
    }

    return stripped;
}

function tryParseJson(value: string): unknown | undefined {
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

function extractStructuredErrorPayload(error: unknown): Record<string, unknown> | unknown[] | undefined {
    return findStructuredPayload(error, new Set());
}

function findStructuredPayload(value: unknown, seen: Set<unknown>): Record<string, unknown> | unknown[] | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (value instanceof Error) {
        const errorValue = value as unknown as Record<string, unknown>;
        if (seen.has(errorValue)) {
            return undefined;
        }
        seen.add(errorValue);
        for (const key of ['responseBody', 'body', 'error', 'details', 'detail', 'data', 'cause', 'message']) {
            const payload = findStructuredPayload(errorValue[key], seen);
            if (payload !== undefined) {
                return payload;
            }
        }
        return undefined;
    }
    if (typeof value === 'string') {
        return parseStructuredPayloadFromString(value, seen);
    }
    if (Array.isArray(value)) {
        if (value.every(item => typeof item !== 'object' || item === null)) {
            return undefined;
        }
        return value as unknown[];
    }
    if (typeof value !== 'object') {
        return undefined;
    }
    if (seen.has(value)) {
        return undefined;
    }
    seen.add(value);

    const objectValue = value as Record<string, unknown>;
    for (const key of ['responseBody', 'body', 'error', 'details', 'detail', 'data', 'cause', 'message']) {
        const payload = findStructuredPayload(objectValue[key], seen);
        if (payload !== undefined) {
            return payload;
        }
    }

    return isStructuredPayload(objectValue) ? objectValue : undefined;
}

function parseStructuredPayloadFromString(value: string, seen: Set<unknown>): Record<string, unknown> | unknown[] | undefined {
    const trimmed = value.trim();
    if (trimmed === '') {
        return undefined;
    }

    const stripped = trimmed.replace(/^Error:\s*/i, '').trim();
    const parsed = tryParseJson(stripped);
    if (isStructuredPayload(parsed)) {
        return parsed;
    }

    const parts = stripped.split(/\n\s*\n/);
    if (parts.length <= 1) {
        return undefined;
    }

    const tail = parts.slice(1).join('\n\n').trim();
    const parsedTail = tryParseJson(tail);
    if (isStructuredPayload(parsedTail)) {
        return parsedTail;
    }

    if (parsedTail !== undefined) {
        return findStructuredPayload(parsedTail, seen);
    }

    return undefined;
}

function extractErrorHeadline(error: unknown): string | undefined {
    return findErrorHeadline(error, new Set());
}

function findErrorHeadline(value: unknown, seen: Set<unknown>): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (value instanceof Error) {
        const errorValue = value as unknown as Record<string, unknown>;
        if (seen.has(errorValue)) {
            return value.name;
        }
        seen.add(errorValue);
        const headline = withStatusPrefix(
            extractHeadlineCandidate(errorValue.message, seen),
            errorValue,
        );
        if (headline) {
            return headline;
        }
        for (const key of ['error', 'description', 'detail', 'details', 'reason', 'cause']) {
            const nested = findErrorHeadline(errorValue[key], seen);
            if (nested) {
                return nested;
            }
        }
        return value.name;
    }
    if (typeof value === 'string') {
        return extractHeadlineFromString(value, seen);
    }
    if (Array.isArray(value)) {
        return value.map(item => findErrorHeadline(item, seen)).find(Boolean);
    }
    if (typeof value !== 'object') {
        return String(value);
    }
    if (seen.has(value)) {
        return undefined;
    }
    seen.add(value);

    const objectValue = value as Record<string, unknown>;
    const headline = withStatusPrefix(
        extractHeadlineCandidate(objectValue.message, seen),
        objectValue,
    );
    if (headline) {
        return headline;
    }

    for (const key of ['error', 'description', 'detail', 'details', 'reason', 'cause']) {
        const nested = findErrorHeadline(objectValue[key], seen);
        if (nested) {
            return nested;
        }
    }

    return undefined;
}

function extractHeadlineCandidate(value: unknown, seen: Set<unknown>): string | undefined {
    if (typeof value === 'string') {
        return extractHeadlineFromString(value, seen);
    }
    if (value && typeof value === 'object') {
        return findErrorHeadline(value, seen);
    }
    return undefined;
}

function extractHeadlineFromString(value: string, seen: Set<unknown>): string | undefined {
    const trimmed = value.trim();
    if (trimmed === '') {
        return undefined;
    }

    const stripped = trimmed.replace(/^Error:\s*/i, '').trim();
    const parsed = tryParseJson(stripped);
    if (parsed !== undefined) {
        return findErrorHeadline(parsed, seen);
    }

    const [head, ...tail] = stripped.split(/\n\s*\n/);
    if (tail.length > 0) {
        return head.trim() || undefined;
    }

    return stripped;
}

function isStructuredPayload(value: unknown): value is Record<string, unknown> | unknown[] {
    if (Array.isArray(value)) {
        return true;
    }
    return typeof value === 'object' && value !== null;
}

function truncateStructuredMarkdownError(headline: string, jsonBody: string, maxLength: number): string {
    const prefix = ['Error', headline].filter(Boolean).join('\n');
    const open = '\n\n```json\n';
    const close = '\n```';
    const content = truncateToFit(jsonBody, maxLength - prefix.length - open.length - close.length);
    return `${prefix}${open}${content}${close}`;
}

function truncatePlainMarkdownError(detail: string, maxLength: number): string {
    const open = '```\n';
    const close = '\n```';
    const body = `Error\n${detail}`;
    const content = truncateToFit(body, maxLength - open.length - close.length);
    return `${open}${content}${close}`;
}

function truncateToFit(value: string, limit: number): string {
    if (!Number.isFinite(limit) || limit <= 0) {
        return '';
    }
    if (value.length <= limit) {
        return value;
    }
    if (limit <= 1) {
        return value.slice(0, limit);
    }
    return `${value.slice(0, limit - 1)}…`;
}

function redactText(message: string, redactions: string[]): string {
    return redactions.filter(Boolean).reduce((text, item) => text.replaceAll(item, '[REDACTED]'), message);
}
