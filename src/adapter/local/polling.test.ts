import { describe, expect, it } from 'vitest';
import { normalizeGetUpdatesPayload } from './polling';

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
        expect(result.error).toContain('409');
        expect(result.error).toContain('Conflict');
    });

    it('returns an error when result is not an array', () => {
        const result = normalizeGetUpdatesPayload({
            ok: true,
            result: null,
        });

        expect(result.updates).toEqual([]);
        expect(result.error).toContain('update array');
    });
});
