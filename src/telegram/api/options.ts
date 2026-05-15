import { ENV } from '../../config/env';

export function resolveTelegramAllowedUpdates(): string[] | undefined {
    return ENV.TELEGRAM_ALLOWED_UPDATES.length > 0
        ? ENV.TELEGRAM_ALLOWED_UPDATES
        : undefined;
}
