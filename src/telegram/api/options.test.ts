import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
    ENV: {
        TELEGRAM_ALLOWED_UPDATES: ['message', 'callback_query'],
    },
}));

const { ENV } = await import('../../config/env');
const { resolveTelegramAllowedUpdates } = await import('./options');

describe('telegram api options', () => {
    beforeEach(() => {
        ENV.TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query'];
    });

    it('returns configured allowed updates when present', () => {
        expect(resolveTelegramAllowedUpdates()).toEqual(['message', 'callback_query']);
    });

    it('returns undefined when allowed updates are empty', () => {
        ENV.TELEGRAM_ALLOWED_UPDATES = [];

        expect(resolveTelegramAllowedUpdates()).toBeUndefined();
    });
});
