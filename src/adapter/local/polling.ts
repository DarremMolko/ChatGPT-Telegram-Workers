import type { Update } from 'telegram-bot-api-types';

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

export function normalizeGetUpdatesPayload(payload: unknown): { updates: Update[]; error: string | null } {
    if (!payload || typeof payload !== 'object') {
        return {
            updates: [],
            error: 'Empty or invalid getUpdates payload',
        };
    }

    const telegramPayload = payload as Record<string, unknown>;
    if (telegramPayload.ok === false) {
        const errorCode = typeof telegramPayload.error_code === 'number' ? telegramPayload.error_code : undefined;
        const description = typeof telegramPayload.description === 'string' ? telegramPayload.description : 'Unknown error';
        const code = errorCode ? ` (${errorCode})` : '';
        return {
            updates: [],
            error: `Telegram getUpdates failed${code}: ${description}`,
        };
    }

    if (!Array.isArray(telegramPayload.result)) {
        return {
            updates: [],
            error: 'Telegram getUpdates response did not contain an update array',
        };
    }

    return {
        updates: telegramPayload.result as Update[],
        error: null,
    };
}
