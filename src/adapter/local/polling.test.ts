import { describe, expect, it } from 'vitest';
import { computePollingBackoffMs, normalizeGetUpdatesPayload } from './polling';

describe('normalizeGetUpdatesPayload', () => {
    it('returns updates for a valid Telegram success payload', () => {
        const result = normalizeGetUpdatesPayload({
            ok: true,
            result: [
                {
                    update_id: 123,
                },
            ],
        });

        expect(result.error).toBeNull();
        expect(result.updates).toHaveLength(1);
        expect(result.updates[0].update_id).toBe(123);
    });

    it('returns an error for Telegram error payloads', () => {
        const result = normalizeGetUpdatesPayload({
            ok: false,
            error_code: 409,
            description: 'Conflict: terminated by other getUpdates request',
        });

        expect(result.updates).toEqual([]);
        expect(result.error?.code).toBe(409);
        expect(result.error?.description).toContain('Conflict');
        expect(result.error?.retryable).toBe(true);
    });

    it('returns an error when result is not an array', () => {
        const result = normalizeGetUpdatesPayload({
            ok: true,
            result: null,
        });

        expect(result.updates).toEqual([]);
        expect(result.error?.description).toContain('update array');
    });

    it('reads retry_after from the payload when Telegram rate limits polling', () => {
        const result = normalizeGetUpdatesPayload({
            ok: false,
            error_code: 429,
            description: 'Too Many Requests',
            parameters: {
                retry_after: 7,
            },
        });

        expect(result.error?.retryAfterSeconds).toBe(7);
        expect(result.error?.retryable).toBe(true);
    });
});

describe('computePollingBackoffMs', () => {
    it('uses Telegram retry_after when provided', () => {
        expect(computePollingBackoffMs(4, 9)).toBe(9000);
    });

    it('uses exponential backoff with bounded jitter', () => {
        expect(computePollingBackoffMs(1, undefined, 0)).toBe(1000);
        expect(computePollingBackoffMs(3, undefined, 1)).toBe(4800);
    });
});
