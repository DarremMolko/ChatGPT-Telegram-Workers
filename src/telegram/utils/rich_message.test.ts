import type * as Telegram from 'telegram-bot-api-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn();
const editMessageText = vi.fn();
const sendRichMessage = vi.fn();
const sendRichMessageDraft = vi.fn();
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
        TELEGRAM_RICH_MESSAGES: false,
        TELEGRAM_MIN_STREAM_INTERVAL: 0,
        INLINE_QUERY_SEND_INTERVAL: 2000,
        TELEGRAPH_SCOPE: ['group', 'supergroup'],
        TELEGRAPH_NUM_LIMIT: -1,
        FILE_SIZE_LIMIT: -1,
        ADD_QUOTE_LIMIT: -1,
        ADD_QUOTE_SCOPE: ['group', 'supergroup'],
        QUOTE_EXPANDABLE: false,
        REDIS: {
            get: redisGet,
            put: redisPut,
            delete: redisDelete,
        },
    },
}));

vi.mock('../../log', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../log')>();
    return {
        ...actual,
        log: {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
        },
        tagMessageIds: new WeakMap(),
        writeDebugLog: vi.fn(),
    };
});

vi.mock('../api', () => ({
    createTelegramBotAPI: () => ({
        token: 'token',
        sendMessage,
        editMessageText,
        sendRichMessage,
        sendRichMessageDraft,
        request: vi.fn(),
    }),
}));

vi.mock('./tg_utils', () => ({
    waitUntil: async () => {},
    sendAction: vi.fn(),
}));

const { ENV } = await import('../../config/env');
const { MessageSender } = await import('./send');
const { OnStreamHander } = await import('../handler/chat');
const { handleUpdate } = await import('../handler/index');
const { registerActiveRequest } = await import('./active_request');

function createMessage(chatType: Telegram.ChatType, id = 123): Telegram.Message {
    return {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: {
            id,
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

describe('telegram Rich Messages and AI chat rendering', () => {
    beforeEach(() => {
        sendMessage.mockReset();
        editMessageText.mockReset();
        sendRichMessage.mockReset();
        sendRichMessageDraft.mockReset();
        redisGet.mockReset();
        redisPut.mockReset();
        redisDelete.mockReset();
        fetchMock.mockReset();
        ENV.TELEGRAM_RICH_MESSAGES = false;
        ENV.TELEGRAM_RENDER_PIPE_TABLES = true;
    });

    describe('messageSender rich message capabilities', () => {
        it('does not use rich draft when TELEGRAM_RICH_MESSAGES is disabled', async () => {
            ENV.TELEGRAM_RICH_MESSAGES = false;
            const sender = MessageSender.from('token', createMessage('private'));

            expect(sender.canUseRichDraft()).toBe(false);
            expect(sender.canUseRichMessage()).toBe(false);

            const result = await sender.sendRichDraft('streaming text');
            expect(result).toBeNull();
            expect(sendRichMessageDraft).not.toHaveBeenCalled();
        });

        it('does not use rich draft in group chats even when TELEGRAM_RICH_MESSAGES is enabled', async () => {
            ENV.TELEGRAM_RICH_MESSAGES = true;
            const sender = MessageSender.from('token', createMessage('group'));

            expect(sender.canUseRichDraft()).toBe(false);
            expect(sender.canUseRichMessage()).toBe(true);

            const result = await sender.sendRichDraft('streaming text');
            expect(result).toBeNull();
            expect(sendRichMessageDraft).not.toHaveBeenCalled();
        });

        it('sends rich message draft with stable draft_id and can_stop in private chat', async () => {
            ENV.TELEGRAM_RICH_MESSAGES = true;
            const sender = MessageSender.from('token', createMessage('private'));
            sendRichMessageDraft.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));

            const res1 = await sender.sendRichDraft('chunk 1');
            expect(res1?.ok).toBe(true);
            expect(sendRichMessageDraft).toHaveBeenCalledTimes(1);

            const call1 = sendRichMessageDraft.mock.calls[0][0];
            expect(call1).toEqual(expect.objectContaining({
                chat_id: 123,
                draft_id: expect.any(Number),
                rich_message: { markdown: 'chunk 1' },
                can_stop: true,
                keep_on_stop: true,
            }));

            const initialDraftId = call1.draft_id;
            expect(initialDraftId).toBeGreaterThan(0);

            // Subsequent chunk reuses the same draft_id for smooth Telegram animation
            await sender.sendRichDraft('chunk 1 + chunk 2');
            expect(sendRichMessageDraft).toHaveBeenCalledTimes(2);
            expect(sendRichMessageDraft.mock.calls[1][0].draft_id).toBe(initialDraftId);
            expect(sendRichMessageDraft.mock.calls[1][0].rich_message).toEqual({ markdown: 'chunk 1 + chunk 2' });
        });

        it('sends <tg-thinking> placeholder in draft for initial placeholder text', async () => {
            ENV.TELEGRAM_RICH_MESSAGES = true;
            const sender = MessageSender.from('token', createMessage('private'));
            sendRichMessageDraft.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));

            await sender.sendRichDraft('...');
            expect(sendRichMessageDraft).toHaveBeenCalledWith(expect.objectContaining({
                rich_message: { markdown: '<tg-thinking>Thinking...</tg-thinking>' },
            }));
        });

        it('disables draft and returns null when Telegram API returns an error', async () => {
            ENV.TELEGRAM_RICH_MESSAGES = true;
            const sender = MessageSender.from('token', createMessage('private'));
            sendRichMessageDraft.mockResolvedValue(new Response(JSON.stringify({
                ok: false,
                error_code: 400,
                description: 'Bad Request: draft streaming not supported',
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            }));

            const res = await sender.sendRichDraft('some text');
            expect(res).toBeNull();
            expect(sender.canUseRichDraft()).toBe(false);
        });

        it('sends persisted final rich message using sendRichMessage', async () => {
            ENV.TELEGRAM_RICH_MESSAGES = true;
            const sender = MessageSender.from('token', createMessage('private'));
            sendRichMessage.mockResolvedValue(new Response(JSON.stringify({
                ok: true,
                result: { message_id: 555 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));

            const markdown = '# Summary\n\n| Item | Cost |\n|---|---|\n| Coffee | $4 |';
            const res = await sender.sendRichMessage(markdown);

            expect(res.ok).toBe(true);
            expect(sendRichMessage).toHaveBeenCalledWith(expect.objectContaining({
                chat_id: 123,
                rich_message: { markdown },
            }));
            expect(sender.context.message_id).toBe(555);
        });

        it('falls back to sendLongMessage when sendRichMessage returns an error', async () => {
            ENV.TELEGRAM_RICH_MESSAGES = true;
            const sender = MessageSender.from('token', createMessage('private'));
            sendRichMessage.mockResolvedValue(new Response(JSON.stringify({
                ok: false,
                error_code: 400,
                description: 'Bad Request: unclosed tag',
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            }));
            sendMessage.mockResolvedValue(new Response(JSON.stringify({
                ok: true,
                result: { message_id: 777 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));

            const res = await sender.sendRichMessage('Some content');
            expect(res.ok).toBe(true);
            expect(sendMessage).toHaveBeenCalled();
        });
    });

    describe('streaming integration via OnStreamHander', () => {
        it('preserves native markdown tables without rewriting to cards when rich messages are enabled', async () => {
            ENV.TELEGRAM_RICH_MESSAGES = true;
            const sender = MessageSender.from('token', createMessage('private'));
            sendRichMessageDraft.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));
            sendRichMessage.mockResolvedValue(new Response(JSON.stringify({
                ok: true,
                result: { message_id: 101 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));

            const streamHandler = OnStreamHander(sender);
            const tableText = '| Name | Age |\n|---|---|\n| Alice | 30 |';

            await streamHandler.send!(tableText);
            expect(sendRichMessageDraft).toHaveBeenCalledWith(expect.objectContaining({
                rich_message: { markdown: tableText },
            }));

            await streamHandler.end!(tableText);
            expect(sendRichMessage).toHaveBeenCalledWith(expect.objectContaining({
                rich_message: { markdown: tableText },
            }));
        });

        it('cancels active LLM generation when stopped_message_generation update arrives', async () => {
            ENV.TELEGRAM_RICH_MESSAGES = true;
            const sender = MessageSender.from('token', createMessage('private', 888));
            sendRichMessageDraft.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));

            const scopeKey = 'history:888';
            const active = registerActiveRequest(scopeKey);
            const mockContext: any = {
                SHARE_CONTEXT: {
                    chatHistoryKey: scopeKey,
                    botName: 'TestBot',
                },
                USER_CONFIG: {},
            };

            const streamHandler = OnStreamHander(sender, mockContext);
            await streamHandler.send!('generating answer...');

            const draftId = sender.getDraftId();
            expect(draftId).toBeDefined();
            expect(active.signal.aborted).toBe(false);

            // Simulate Telegram client sending stopped_message_generation
            const stopUpdate: any = {
                update_id: 9999,
                stopped_message_generation: {
                    chat: { id: 888, type: 'private' },
                    draft_id: draftId,
                },
            };

            const stopResponse = await handleUpdate('token', stopUpdate);
            expect(stopResponse?.status).toBe(200);

            // Active request signal should be aborted immediately
            expect(active.signal.aborted).toBe(true);
            expect(active.isUserCancelled()).toBe(true);

            active.done();
        });
    });
});
