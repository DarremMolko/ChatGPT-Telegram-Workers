import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ENV } from '../config/env';

const DEFAULT_DEBUG_LOG_FILE = resolve(process.cwd(), 'logs', 'chatgpt-telegram-workers.debug.ndjson');
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 100;
const SENSITIVE_KEY_PATTERN = /authorization|api[-_]?key|password|secret|cookie|session|(?:^|[_-])token(?:$|[_-])|(?:^|[_-])(?:access|refresh|bearer|bot|auth|id)[_-]?tokens?(?:$|[_-])|(?:api|access|refresh|bearer|bot|auth|id)Token/i;
const TELEGRAM_BOT_TOKEN_PATTERN = /\b\d{6,}:[\w-]{20,}\b/g;
const TELEGRAM_BOT_TOKEN_URL_PATTERN = /\/bot\d{6,}:[\w-]{20,}\//g;

const preparedDirectories = new Set<string>();
const failedLogPaths = new Set<string>();

export interface DebugLogEntry {
    source: 'logger' | 'llm';
    event: string;
    level?: string;
    traceId?: string;
    data?: unknown;
}

export function getDebugLogFilePath(): string | null {
    const configuredPath = ENV.DEBUG_LOG_FILE?.trim();
    if (configuredPath) {
        return resolve(process.cwd(), configuredPath);
    }
    if (ENV.DEBUG_MODE) {
        return DEFAULT_DEBUG_LOG_FILE;
    }
    return null;
}

export function isDebugLogEnabled(): boolean {
    return Boolean(getDebugLogFilePath());
}

export function writeDebugLog(entry: DebugLogEntry) {
    const filePath = getDebugLogFilePath();
    if (!filePath) {
        return;
    }

    try {
        prepareDirectory(filePath);
        appendFileSync(filePath, `${JSON.stringify({
            ts: new Date().toISOString(),
            source: entry.source,
            event: entry.event,
            ...(entry.level && { level: entry.level }),
            ...(entry.traceId && { trace_id: entry.traceId }),
            ...(entry.data !== undefined && { data: sanitizeForDebugLog(entry.data) }),
        })}\n`, 'utf8');
    } catch (error) {
        reportWriteFailure(filePath, error);
    }
}

export function sanitizeForDebugLog(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'string') {
        return sanitizeString(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (typeof value === 'function') {
        const namedFunction = value as { name?: string };
        return `[Function ${namedFunction.name || 'anonymous'}]`;
    }

    if (depth >= MAX_DEPTH) {
        return '[Max depth reached]';
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: sanitizeString(value.message),
            ...(value.stack && { stack: sanitizeString(value.stack) }),
        };
    }

    if (value instanceof URL) {
        return sanitizeString(value.toString());
    }

    if (value instanceof URLSearchParams) {
        return sanitizeString(value.toString());
    }

    if (value instanceof Headers) {
        return sanitizeForDebugLog(Object.fromEntries(value.entries()), depth + 1, seen);
    }

    if (value instanceof FormData) {
        return {
            type: 'FormData',
            entries: Array.from(value.entries()).slice(0, MAX_ARRAY_ITEMS).map(([key, item]) => ({
                key,
                value: typeof item === 'string'
                    ? sanitizeString(item)
                    : { type: 'Blob', size: item.size, mimeType: item.type || 'application/octet-stream' },
            })),
        };
    }

    if (value instanceof Blob) {
        return {
            type: 'Blob',
            size: value.size,
            mimeType: value.type || 'application/octet-stream',
        };
    }

    if (ArrayBuffer.isView(value)) {
        return `[Binary ${value.byteLength} bytes]`;
    }

    if (value instanceof ArrayBuffer) {
        return `[Binary ${value.byteLength} bytes]`;
    }

    if (Array.isArray(value)) {
        const arrayValue = value as unknown[];
        return [
            ...arrayValue.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeForDebugLog(item, depth + 1, seen)),
            ...(arrayValue.length > MAX_ARRAY_ITEMS ? [`[${arrayValue.length - MAX_ARRAY_ITEMS} more items truncated]`] : []),
        ];
    }

    if (typeof value === 'object') {
        const objectValue = value as Record<string, unknown>;
        if (seen.has(objectValue)) {
            return '[Circular]';
        }
        seen.add(objectValue);

        const entries = Object.entries(objectValue);
        const sanitizedEntries = entries.slice(0, MAX_OBJECT_KEYS).map(([key, currentValue]) => [
            key,
            SENSITIVE_KEY_PATTERN.test(key)
                ? '[REDACTED]'
                : sanitizeForDebugLog(currentValue, depth + 1, seen),
        ]);

        const sanitizedObject = Object.fromEntries(sanitizedEntries);
        if (entries.length > MAX_OBJECT_KEYS) {
            sanitizedObject.__truncated_keys = entries.length - MAX_OBJECT_KEYS;
        }
        return sanitizedObject;
    }

    return String(value);
}

function sanitizeString(value: string): string {
    const configuredMaxLength = Number(ENV.DEBUG_LOG_MAX_STRING_LENGTH);
    const maxLength = Number.isFinite(configuredMaxLength) && configuredMaxLength > 0
        ? configuredMaxLength
        : 8_000;
    const redacted = redactSensitiveText(value);

    if (redacted.length <= maxLength) {
        return redacted;
    }

    return `${redacted.slice(0, maxLength)}...[truncated ${redacted.length - maxLength} chars]`;
}

export function redactSensitiveText(value: string): string {
    return value
        .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
        .replace(/sk-[\w-]+/g, 'sk-[REDACTED]')
        .replace(TELEGRAM_BOT_TOKEN_URL_PATTERN, '/bot[REDACTED]/')
        .replace(TELEGRAM_BOT_TOKEN_PATTERN, '[REDACTED_BOT_TOKEN]');
}

function prepareDirectory(filePath: string) {
    const directory = dirname(filePath);
    if (preparedDirectories.has(directory)) {
        return;
    }
    mkdirSync(directory, { recursive: true });
    preparedDirectories.add(directory);
}

function reportWriteFailure(filePath: string, error: unknown) {
    if (failedLogPaths.has(filePath)) {
        return;
    }
    failedLogPaths.add(filePath);
    console.error(`[ERROR] Failed to write debug log file "${filePath}":`, error);
}
