import { ENV } from '../../config/env';

const WEBHOOK_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

export function resolveTelegramAllowedUpdates(): string[] | undefined {
    return ENV.TELEGRAM_ALLOWED_UPDATES.length > 0
        ? ENV.TELEGRAM_ALLOWED_UPDATES
        : undefined;
}

export function resolveTelegramWebhookSecretToken(): string | undefined {
    return ENV.TELEGRAM_WEBHOOK_SECRET_TOKEN || undefined;
}

export function isTelegramWebhookRequestAuthorized(headers: Headers): boolean {
    const expected = resolveTelegramWebhookSecretToken();
    if (!expected) {
        return true;
    }
    return headers.get(WEBHOOK_SECRET_HEADER) === expected;
}
