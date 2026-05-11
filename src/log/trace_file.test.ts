import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({
    ENV: {
        DEBUG_MODE: false,
        DEBUG_LOG_FILE: '',
        DEBUG_LOG_MAX_STRING_LENGTH: 16,
    },
}));

const { sanitizeForDebugLog } = await import('./trace_file');

describe('sanitizeForDebugLog', () => {
    it('redacts sensitive keys and bearer tokens', () => {
        const result = sanitizeForDebugLog({
            authorization: 'Bearer secret-token',
            apiKey: 'sk-secret-key',
            nested: {
                token: 'plain-secret',
            },
        }) as Record<string, any>;

        expect(result.authorization).toBe('[REDACTED]');
        expect(result.apiKey).toBe('[REDACTED]');
        expect(result.nested.token).toBe('[REDACTED]');
    });

    it('truncates long strings and summarizes binary payloads', () => {
        const result = sanitizeForDebugLog({
            text: 'abcdefghijklmnopqrstuvwxyz',
            bytes: new Uint8Array([1, 2, 3, 4]),
        }) as Record<string, any>;

        expect(result.text).toContain('[truncated');
        expect(result.bytes).toBe('[Binary 4 bytes]');
    });
});
