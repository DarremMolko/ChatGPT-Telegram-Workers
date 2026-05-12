import type { MessageSender } from '../utils/send';

const TELEGRAM_MESSAGE_LIMIT = 4096;

export function formatCommandErrorMessage(error: unknown, { redactions = [] }: { redactions?: string[] } = {}): string {
    const detail = redactErrorMessage(extractErrorMessage(error), redactions);
    const message = `Error\n${detail || 'Unknown error'}`;
    return message.slice(0, TELEGRAM_MESSAGE_LIMIT);
}

export function sendCommandError(sender: MessageSender, error: unknown, { redactions = [] }: { redactions?: string[] } = {}) {
    return sender.sendPlainText(formatCommandErrorMessage(error, { redactions }));
}

function extractErrorMessage(error: unknown): string {
    return unwrapErrorValue(error, new Set()) || 'Unknown error';
}

function unwrapErrorValue(value: unknown, seen: Set<unknown>): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (value instanceof Error) {
        return unwrapErrorString(value.message, seen) || value.name;
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
        if (seen.has(value)) {
            return undefined;
        }
        seen.add(value);
        const objectValue = value as Record<string, unknown>;
        for (const key of ['message', 'error', 'description', 'detail', 'details', 'reason']) {
            const message = unwrapErrorValue(objectValue[key], seen);
            if (message) {
                return message;
            }
        }
        return JSON.stringify(value);
    }
    return String(value);
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
                return [head.trim(), detail].filter(Boolean).join('\n\n');
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

function redactErrorMessage(message: string, redactions: string[]): string {
    return redactions.filter(Boolean).reduce((text, item) => text.replaceAll(item, '[REDACTED]'), message);
}
