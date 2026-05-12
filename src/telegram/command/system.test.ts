import type * as Telegram from 'telegram-bot-api-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runtimeAdminStore, redisMock, sendActionMock, ttsMock } = vi.hoisted(() => {
    const store = new Map<string, string>();
    return {
        runtimeAdminStore: store,
        redisMock: {
            delete: vi.fn(async (key: string) => store.delete(key)),
            get: vi.fn(async (key: string) => store.get(key) ?? null),
            put: vi.fn(async (key: string, value: string) => {
                store.set(key, value);
                return true;
            }),
        },
        sendActionMock: vi.fn(),
        ttsMock: vi.fn(),
    };
});

vi.mock('../../agent', () => ({
    ASR_AGENTS: [],
    CHAT_AGENTS: [],
    IMAGE_AGENTS: [],
    TTS_AGENTS: [],
    customInfo: vi.fn(),
    loadImageGen: vi.fn(),
}));

vi.mock('../../agent/api_base', () => ({
    resolveProviderApiBase: vi.fn(),
}));

vi.mock('../../agent/chat', () => ({
    loadHistory: vi.fn(),
}));

vi.mock('../../agent/models', () => ({
    updateModels: vi.fn(),
}));

vi.mock('../../config/env', () => ({
    ENV: {
        ADMIN_WHITE_LIST: ['2'],
        BLOCK_COMMANDS: [],
        CUSTOM_COMMAND: {},
        DEV_MODE: false,
        EXTRA_MESSAGE_CONTEXT: true,
        GROUP_CHAT_BOT_SHARE_MODE: false,
        HIDE_COMMAND_BUTTONS: [],
        I18N: {
            command: {
                help: {},
            },
        },
        OWNER_ID: '1',
        REDIS: redisMock,
    },
}));

vi.mock('../../config/merger', () => ({
    ConfigMerger: {
        merge: vi.fn(),
        trim: vi.fn(value => value),
    },
}));

vi.mock('../../log', () => ({
    log: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('../../mcp', () => ({
    updateMcp: vi.fn(),
}));

vi.mock('../../utils/others/time', () => ({
    formatLocalDateTime: vi.fn(),
}));

vi.mock('../../utils/stats', () => ({
    getStats: vi.fn(),
}));

vi.mock('.', () => ({
    authChecker: vi.fn(),
}));

vi.mock('../api', () => ({
    createTelegramBotAPI: vi.fn(() => ({})),
}));

vi.mock('../handler/chat', () => ({
    chatWithLLM: vi.fn(),
    sendImages: vi.fn(),
    tts: ttsMock,
}));

vi.mock('../utils/active_request', () => ({
    cancelActiveRequests: vi.fn(),
    getActiveRequestCount: vi.fn(),
}));

vi.mock('../utils/md2tgmd', () => ({
    escape: vi.fn((value: string) => value),
}));

vi.mock('../utils/send', () => ({
    checkIsNeedTagIds: vi.fn(),
    sendAction: sendActionMock,
}));

vi.mock('../utils/tg_utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/tg_utils')>();
    return {
        ...actual,
        chunkArray: vi.fn(),
        getTelegramFile: vi.fn(),
        isTelegramChatTypeGroup: vi.fn(() => false),
    };
});

const { BlockUserCommandHandler, BlocklistCommandHandler, DemoteCommandHandler, PromoteCommandHandler, TTSCommandHandler, UnblockUserCommandHandler } = await import('./system');

function createReplyMessage(text: string): Telegram.Message {
    return {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: {
            id: 123,
            type: 'private',
        } as Telegram.Chat,
        from: {
            id: 789,
            is_bot: false,
            first_name: 'Alice',
        },
        text,
    } as Telegram.Message;
}

function createMessage(text: string, replyText?: string): Telegram.Message {
    return {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: {
            id: 123,
            type: 'private',
        } as Telegram.Chat,
        from: {
            id: 456,
            is_bot: false,
            first_name: 'User',
        },
        text,
        reply_to_message: replyText ? createReplyMessage(replyText) : undefined,
    } as Telegram.Message;
}

function createContext() {
    return {
        SHARE_CONTEXT: {
            botId: 999,
            configStoreKey: 'user_config:123:999',
            botToken: 'bot-token',
        },
        USER_CONFIG: {
            AI_TTS_PROVIDER: 'openai',
            AUDIO_CONTAINS_TEXT: true,
            BLOCKLIST: [],
            DEFINE_KEYS: [],
            OPENAI_TTS_VOICE: 'alloy',
        },
    } as any;
}

function createSender() {
    const deleteMessage = vi.fn(async () => new Response('deleted', { status: 200 }));
    return {
        api: {
            deleteMessage,
        },
        context: {
            chat_id: 123,
            message_id: 1,
        },
        sendPlainText: vi.fn(async () => new Response('ok', { status: 200 })),
        sendRichText: vi.fn(async () => new Response('ok', { status: 200 })),
        sendVoice: vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })),
    } as any;
}

describe('tTSCommandHandler', () => {
    beforeEach(() => {
        runtimeAdminStore.clear();
        redisMock.delete.mockClear();
        redisMock.get.mockClear();
        redisMock.put.mockClear();
        sendActionMock.mockReset();
        ttsMock.mockReset();
    });

    it('uses the replied message text when the command only has flags plus merged quote context', async () => {
        ttsMock.mockResolvedValue(new Blob(['audio']));
        const handler = new TTSCommandHandler();
        const message = createMessage('/tts', 'Hello from reply');
        const sender = createSender();
        const context = createContext();

        const response = await handler.handle(message, '-v nova\n> Hello from reply — Alice (ID:789)', context, sender);

        expect(response.ok).toBe(true);
        expect(context.USER_CONFIG.OPENAI_TTS_VOICE).toBe('nova');
        expect(ttsMock).toHaveBeenCalledWith('Hello from reply', context.USER_CONFIG);
        expect(sender.sendVoice).toHaveBeenCalledWith(expect.any(Blob), 'Hello from reply');
        expect(sender.api.deleteMessage).toHaveBeenCalledWith({ chat_id: 123, message_id: 1 });
    });

    it('prefers explicit inline text over the replied message text', async () => {
        ttsMock.mockResolvedValue(new Blob(['audio']));
        const handler = new TTSCommandHandler();
        const message = createMessage('/tts custom text', 'Hello from reply');
        const sender = createSender();
        const context = createContext();

        await handler.handle(message, 'Custom narration\n> Hello from reply — Alice (ID:789)', context, sender);

        expect(ttsMock).toHaveBeenCalledWith('Custom narration', context.USER_CONFIG);
        expect(sender.sendVoice).toHaveBeenCalledWith(expect.any(Blob), 'Custom narration');
    });

    it('passes command-level instructions through to the TTS request', async () => {
        ttsMock.mockResolvedValue(new Blob(['audio']));
        const handler = new TTSCommandHandler();
        const message = createMessage('/tts -i "speak slowly" Custom narration');
        const sender = createSender();
        const context = createContext();

        await handler.handle(message, '-i "speak slowly" Custom narration', context, sender);

        expect(ttsMock).toHaveBeenCalledWith('Custom narration', context.USER_CONFIG, {
            instructions: 'speak slowly',
        });
        expect(sender.sendVoice).toHaveBeenCalledWith(expect.any(Blob), 'Custom narration');
    });

    it('promotes a replied user into the runtime admin list', async () => {
        const handler = new PromoteCommandHandler();
        const message = createMessage('/promote', 'Hello from reply');
        const sender = createSender();
        const context = createContext();

        await handler.handle(message, '', context, sender);

        expect(redisMock.put).toHaveBeenCalledWith('admin_whitelist:999', JSON.stringify(['789']));
        expect(sender.sendPlainText).toHaveBeenCalledWith('Promoted Alice (789) to admin');
    });

    it('demotes a runtime admin by explicit user id', async () => {
        runtimeAdminStore.set('admin_whitelist:999', JSON.stringify(['789']));
        const handler = new DemoteCommandHandler();
        const message = createMessage('/demote 789');
        const sender = createSender();
        const context = createContext();

        await handler.handle(message, '789', context, sender);

        expect(redisMock.delete).toHaveBeenCalledWith('admin_whitelist:999');
        expect(sender.sendPlainText).toHaveBeenCalledWith('Demoted user 789 from admin');
    });

    it('refuses to demote an env-pinned admin at runtime', async () => {
        const handler = new DemoteCommandHandler();
        const message = createMessage('/demote 2');
        const sender = createSender();
        const context = createContext();

        await handler.handle(message, '2', context, sender);

        expect(redisMock.delete).not.toHaveBeenCalled();
        expect(sender.sendPlainText).toHaveBeenCalledWith('user 2 is pinned in ADMIN_WHITE_LIST and cannot be demoted at runtime');
    });

    it('blocks a replied user into the current chat blocklist', async () => {
        const handler = new BlockUserCommandHandler();
        const message = createMessage('/block', 'Hello from reply');
        const sender = createSender();
        const context = createContext();

        await handler.handle(message, '', context, sender);

        expect(context.USER_CONFIG.BLOCKLIST).toEqual(['789']);
        expect(context.USER_CONFIG.DEFINE_KEYS).toContain('BLOCKLIST');
        expect(redisMock.put).toHaveBeenCalledWith('user_config:123:999', JSON.stringify(context.USER_CONFIG));
        expect(sender.sendPlainText).toHaveBeenCalledWith('Blocked Alice (789)');
    });

    it('unblocks a user by explicit id', async () => {
        const handler = new UnblockUserCommandHandler();
        const message = createMessage('/unblock 789');
        const sender = createSender();
        const context = createContext();
        context.USER_CONFIG.BLOCKLIST = ['789'];

        await handler.handle(message, '789', context, sender);

        expect(context.USER_CONFIG.BLOCKLIST).toEqual([]);
        expect(redisMock.put).toHaveBeenCalledWith('user_config:123:999', JSON.stringify(context.USER_CONFIG));
        expect(sender.sendPlainText).toHaveBeenCalledWith('Unblocked user 789');
    });

    it('rejects blocking an admin', async () => {
        const handler = new BlockUserCommandHandler();
        const message = createMessage('/block 2');
        const sender = createSender();
        const context = createContext();

        await handler.handle(message, '2', context, sender);

        expect(context.USER_CONFIG.BLOCKLIST).toEqual([]);
        expect(redisMock.put).not.toHaveBeenCalled();
        expect(sender.sendPlainText).toHaveBeenCalledWith('You cannot block the owner or an admin');
    });

    it('ignores extra blocklist arguments and still lists blocked users', async () => {
        const handler = new BlocklistCommandHandler();
        const message = createMessage('/blocklist clear');
        const sender = createSender();
        const context = createContext();
        context.USER_CONFIG.BLOCKLIST = ['789'];

        await handler.handle(message, 'clear', context, sender);

        expect(context.USER_CONFIG.BLOCKLIST).toEqual(['789']);
        expect(redisMock.put).not.toHaveBeenCalled();
        expect(sender.sendRichText).toHaveBeenCalledWith('Blocked users:\n- `789`', 'MarkdownV2', 'tip', {
            addQuote: true,
            quoteExpandable: true,
        });
    });
});
