import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
    ENV: {
        TELEGRAM_ALLOWED_UPDATES: ['message', 'callback_query'],
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'secret-token',
    },
}));

const { ENV } = await import('../../config/env');
const {
    isTelegramWebhookRequestAuthorized,
    resolveTelegramAllowedUpdates,
    resolveTelegramWebhookSecretToken,
} = await import('./options');

describe('telegram api options', () => {
    beforeEach(() => {
        ENV.TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query'];
        ENV.TELEGRAM_WEBHOOK_SECRET_TOKEN = 'secret-token';
    });

    it('returns configured allowed updates when present', () => {
        expect(resolveTelegramAllowedUpdates()).toEqual(['message', 'callback_query']);
    });

    it('returns undefined when allowed updates are empty', () => {
        ENV.TELEGRAM_ALLOWED_UPDATES = [];

        expect(resolveTelegramAllowedUpdates()).toBeUndefined();
    });

    it('returns the configured webhook secret token when present', () => {
        expect(resolveTelegramWebhookSecretToken()).toBe('secret-token');
    });

    it('authorizes webhook requests when the secret token matches', () => {
        const headers = new Headers({
            'X-Telegram-Bot-Api-Secret-Token': 'secret-token',
        });

        expect(isTelegramWebhookRequestAuthorized(headers)).toBe(true);
    });

    it('rejects webhook requests when the secret token does not match', () => {
        const headers = new Headers({
            'X-Telegram-Bot-Api-Secret-Token': 'wrong-token',
        });

        expect(isTelegramWebhookRequestAuthorized(headers)).toBe(false);
    });

    it('allows webhook requests when no secret token is configured', () => {
        ENV.TELEGRAM_WEBHOOK_SECRET_TOKEN = '';

        expect(isTelegramWebhookRequestAuthorized(new Headers())).toBe(true);
    });
});
