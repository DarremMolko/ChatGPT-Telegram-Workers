import type * as Telegram from 'telegram-bot-api-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn();
const editMessageText = vi.fn();

vi.mock('../../config/env', () => ({
    ENV: {
        DISABLE_WEB_PREVIEW: false,
        DEFAULT_PARSE_MODE: 'MarkdownV2',
        EXPIRED_TIME: -1,
        AUDIO_TEXT_FORMAT: undefined,
        TELEGRAPH_AUTHOR_URL: '',
        SCHEDULE_GROUP_DELETE_TYPE: ['tip'],
        SCHEDULE_PRIVATE_DELETE_TYPE: ['tip'],
        EXTRA_MESSAGE_CONTEXT: false,
        ENABLE_REPLY_TO_MENTION: false,
        LOG_POSITION_ON_TOP: true,
        TELEGRAM_RENDER_PIPE_TABLES: true,
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
        token: 'token',
        sendMessage,
        editMessageText,
        request: vi.fn(),
    }),
}));

vi.mock('./tg_utils', () => ({
    waitUntil: async () => {},
}));

const { ENV } = await import('../../config/env');
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

describe('messageSender.sendRichText', () => {
    beforeEach(() => {
        sendMessage.mockReset();
        editMessageText.mockReset();
        ENV.TELEGRAM_RENDER_PIPE_TABLES = true;
    });

    it('sends a new message on first stream chunk', async () => {
        const sender = MessageSender.from('token', createMessage('private'));
        sendMessage.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        const response = await sender.sendRichText('streaming reply');

        expect(response.ok).toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            chat_id: 123,
            text: 'streaming reply',
        }));
        expect(editMessageText).not.toHaveBeenCalled();
    });

    it('edits the existing message on subsequent stream chunks', async () => {
        const sender = MessageSender.from('token', createMessage('private'));
        sendMessage.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        editMessageText.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await sender.sendRichText('first chunk');
        const response = await sender.sendRichText('second chunk');

        expect(response.ok).toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(editMessageText).toHaveBeenCalledTimes(1);
        expect(editMessageText).toHaveBeenCalledWith(expect.objectContaining({
            chat_id: 123,
            message_id: 99,
            text: 'second chunk',
        }));
    });

    it('transforms pipe tables before sending rich text', async () => {
        const sender = MessageSender.from('token', createMessage('private'));
        sendMessage.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await sender.sendRichText([
            '| User | Age | City | Favorite Food |',
            '| --- | --- | --- | --- |',
            '| Juan | 30 | Cucuta | Arepas con queso |',
        ].join('\n'));

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            chat_id: 123,
            text: '*User: Juan*\n• Age: 30\n• City: Cucuta\n• Favorite Food: Arepas con queso',
        }));
    });

    it('keeps snake_case cell values escaped in card rendering', async () => {
        const sender = MessageSender.from('token', createMessage('private'));
        sendMessage.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await sender.sendRichText([
            '| Field | Value | Notes | Extra |',
            '| --- | --- | --- | --- |',
            '| foo_bar_baz | alpha_beta | note_value | extra_data |',
        ].join('\n'));

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            chat_id: 123,
            text: '*Field: foo\\_bar\\_baz*\n• Value: alpha\\_beta\n• Notes: note\\_value\n• Extra: extra\\_data',
        }));
    });

    it('passes raw pipe tables through when TELEGRAM_RENDER_PIPE_TABLES is disabled', async () => {
        ENV.TELEGRAM_RENDER_PIPE_TABLES = false;
        const sender = MessageSender.from('token', createMessage('private'));
        sendMessage.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await sender.sendRichText([
            '| User | Age | City | Favorite Food |',
            '| --- | --- | --- | --- |',
            '| Juan | 30 | Cucuta | Arepas con queso |',
        ].join('\n'));

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            chat_id: 123,
            text: '\\| User \\| Age \\| City \\| Favorite Food \\|\n\\| \\-\\-\\- \\| \\-\\-\\- \\| \\-\\-\\- \\| \\-\\-\\- \\|\n\\| Juan \\| 30 \\| Cucuta \\| Arepas con queso \\|',
        }));
    });
});
