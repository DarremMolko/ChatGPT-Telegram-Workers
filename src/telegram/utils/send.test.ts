import type * as Telegram from 'telegram-bot-api-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn();
const editMessageText = vi.fn();
const redisGet = vi.fn();
const redisPut = vi.fn();
const redisDelete = vi.fn();
const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

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
        REDIS: {
            get: redisGet,
            put: redisPut,
            delete: redisDelete,
        },
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
const { MessageSender, TelegraphSender } = await import('./send');

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
        redisGet.mockReset();
        redisPut.mockReset();
        redisDelete.mockReset();
        fetchMock.mockReset();
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
        const payload = sendMessage.mock.calls[0][0];
        expect(payload).toEqual(expect.objectContaining({
            chat_id: 123,
            text: 'streaming reply',
        }));
        expect(payload).not.toHaveProperty('parse_mode');
        expect(payload).not.toHaveProperty('entities');
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
        const payload = editMessageText.mock.calls[0][0];
        expect(payload).toEqual(expect.objectContaining({
            chat_id: 123,
            message_id: 99,
            text: 'second chunk',
        }));
        expect(payload).not.toHaveProperty('parse_mode');
        expect(payload).not.toHaveProperty('entities');
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
            text: 'User: Juan\n• Age: 30\n• City: Cucuta\n• Favorite Food: Arepas con queso',
            entities: [{
                type: 'bold',
                offset: 0,
                length: 10,
            }],
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
            text: 'Field: foo_bar_baz\n• Value: alpha_beta\n• Notes: note_value\n• Extra: extra_data',
            entities: [{
                type: 'bold',
                offset: 0,
                length: 18,
            }],
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

        const payload = sendMessage.mock.calls[0][0];
        expect(payload).toEqual(expect.objectContaining({
            chat_id: 123,
            text: '| User | Age | City | Favorite Food |\n| --- | --- | --- | --- |\n| Juan | 30 | Cucuta | Arepas con queso |',
        }));
        expect(payload).not.toHaveProperty('parse_mode');
        expect(payload).not.toHaveProperty('entities');
    });
});

describe('telegraphSender.send', () => {
    beforeEach(() => {
        redisGet.mockReset();
        redisPut.mockReset();
        redisDelete.mockReset();
        fetchMock.mockReset();
    });

    it('recreates the telegraph account when the cached token is invalid', async () => {
        redisGet
            .mockResolvedValueOnce('bad-token')
            .mockResolvedValueOnce(null);
        redisDelete.mockResolvedValue(1);
        redisPut.mockResolvedValue('OK');
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({
                ok: false,
                error: 'ACCESS_TOKEN_INVALID',
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                ok: true,
                result: { access_token: 'new-token' },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                ok: true,
                result: { path: 'new-path', url: 'https://telegra.ph/new-path' },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));

        const sender = new TelegraphSender('BotName', 'telegraph_access_token:123');
        const response = await sender.send('Title', 'Hello world');

        expect(response.ok).toBe(true);
        expect(redisGet).toHaveBeenCalledWith('telegraph_access_token:123');
        expect(redisDelete).toHaveBeenCalledWith('telegraph_access_token:123');
        expect(redisPut).toHaveBeenCalledWith('telegraph_access_token:123', 'new-token');
        expect(sender.teleph_path).toBe('new-path');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[0][0]).toContain('createPage');
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).access_token).toBe('bad-token');
        expect(fetchMock.mock.calls[1][0]).toContain('createAccount');
        expect(fetchMock.mock.calls[2][0]).toContain('createPage');
        expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).access_token).toBe('new-token');
    });
});
