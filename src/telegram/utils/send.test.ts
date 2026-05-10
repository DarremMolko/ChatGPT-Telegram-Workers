import type * as Telegram from 'telegram-bot-api-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequest = vi.fn();

vi.mock('../../config/env', () => ({
    ENV: {
        DISABLE_WEB_PREVIEW: false,
        DEFAULT_PARSE_MODE: 'MarkdownV2',
        EXPIRED_TIME: -1,
        AUDIO_TEXT_FORMAT: undefined,
        TELEGRAPH_AUTHOR_URL: '',
        SCHEDULE_GROUP_DELETE_TYPE: ['tip'],
        SCHEDULE_PRIVATE_DELETE_TYPE: ['tip'],
    },
}));

vi.mock('../../log', () => ({
    log: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
    tagMessageIds: new WeakMap(),
}));

vi.mock('../api', () => ({
    createTelegramBotAPI: () => ({
        request: apiRequest,
    }),
}));

vi.mock('./tg_utils', () => ({
    waitUntil: async () => {},
}));

const { MessageSender } = await import('./send');

function createMessage(chatType: Telegram.ChatType): Telegram.Message {
    return {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: {
            id: 123,
            type: chatType,
        } as Telegram.Chat,
        from: {
            id: 456,
            is_bot: false,
            first_name: 'User',
        },
        text: 'hello',
    } as Telegram.Message;
}

describe('messageSender.sendDraftRichText', () => {
    beforeEach(() => {
        apiRequest.mockReset();
    });

    it('uses sendMessageDraft in private chats', async () => {
        const sender = MessageSender.from('token', createMessage('private'));
        apiRequest.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        const response = await sender.sendDraftRichText('streaming reply');

        expect(response?.ok).toBe(true);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(apiRequest).toHaveBeenCalledWith('sendMessageDraft', expect.objectContaining({
            chat_id: 123,
            text: 'streaming reply',
            draft_id: expect.any(Number),
        }));
    });

    it('skips native drafts outside private chats', async () => {
        const sender = MessageSender.from('token', createMessage('group'));

        const response = await sender.sendDraftRichText('streaming reply');

        expect(response).toBeNull();
        expect(apiRequest).not.toHaveBeenCalled();
    });
});
