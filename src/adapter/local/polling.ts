import type { Update } from 'telegram-bot-api-types';

export interface TelegramGetUpdatesError {
    code?: number;
    description: string;
    retryAfterSeconds?: number;
    retryable: boolean;
}

function parseRetryAfterSeconds(payload: Record<string, unknown>, headers?: Headers): number | undefined {
    const parameters = payload.parameters;
    if (parameters && typeof parameters === 'object') {
        const retryAfter = (parameters as Record<string, unknown>).retry_after;
        if (typeof retryAfter === 'number' && retryAfter > 0) {
            return retryAfter;
        }
    }
    const headerValue = headers?.get('Retry-After');
    if (!headerValue) {
        return undefined;
    }
    const retryAfter = Number.parseInt(headerValue, 10);
    return Number.isNaN(retryAfter) || retryAfter <= 0 ? undefined : retryAfter;
}

function isRetryableTelegramErrorCode(code?: number): boolean {
    if (code === undefined) {
        return true;
    }
    return code === 409 || code === 429 || code >= 500;
}

export async function parseTelegramResponseBody(response: Response): Promise<unknown> {
    const rawBody = await response.text();
    if (!rawBody) {
        return null;
    }
    try {
        return JSON.parse(rawBody);
    } catch {
        return rawBody;
    }
}

export function normalizeGetUpdatesPayload(payload: unknown, headers?: Headers): { updates: Update[]; error: TelegramGetUpdatesError | null } {
    if (!payload || typeof payload !== 'object') {
        return {
            updates: [],
            error: {
                description: 'Empty or invalid getUpdates payload',
                retryable: true,
            },
        };
    }

    const telegramPayload = payload as Record<string, unknown>;
    if (telegramPayload.ok === false) {
        const errorCode = typeof telegramPayload.error_code === 'number' ? telegramPayload.error_code : undefined;
        const description = typeof telegramPayload.description === 'string' ? telegramPayload.description : 'Unknown error';
        return {
            updates: [],
            error: {
                code: errorCode,
                description,
                retryAfterSeconds: parseRetryAfterSeconds(telegramPayload, headers),
                retryable: isRetryableTelegramErrorCode(errorCode),
            },
        };
    }

    if (!Array.isArray(telegramPayload.result)) {
        return {
            updates: [],
            error: {
                description: 'Telegram getUpdates response did not contain an update array',
                retryable: true,
            },
        };
    }

    return {
        updates: telegramPayload.result as Update[],
        error: null,
    };
}

export function formatPollingError(error: TelegramGetUpdatesError): string {
    const code = error.code ? ` (${error.code})` : '';
    return `Telegram getUpdates failed${code}: ${error.description}`;
}

export function normalizePollingException(error: unknown): TelegramGetUpdatesError {
    if (error instanceof Error) {
        return {
            description: error.message || error.name,
            retryable: true,
        };
    }
    return {
        description: `${error}`,
        retryable: true,
    };
}

export function computePollingBackoffMs(attempt: number, retryAfterSeconds?: number, randomFactor = Math.random()): number {
    if (retryAfterSeconds && retryAfterSeconds > 0) {
        return retryAfterSeconds * 1000;
    }
    const safeAttempt = Math.max(1, attempt);
    const baseDelay = Math.min(1000 * 2 ** (safeAttempt - 1), 30_000);
    const jitter = Math.floor(baseDelay * 0.2 * Math.max(0, Math.min(1, randomFactor)));
    return baseDelay + jitter;
}
