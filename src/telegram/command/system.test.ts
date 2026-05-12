import type * as Telegram from 'telegram-bot-api-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendActionMock, ttsMock } = vi.hoisted(() => ({
    sendActionMock: vi.fn(),
    ttsMock: vi.fn(),
}));

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
        BLOCK_COMMANDS: [],
        CHAT_WHITE_LIST: [],
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

const { TTSCommandHandler } = await import('./system');

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
            botToken: 'bot-token',
        },
        USER_CONFIG: {
            AI_TTS_PROVIDER: 'openai',
            AUDIO_CONTAINS_TEXT: true,
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
        sendVoice: vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })),
    } as any;
}

describe('tTSCommandHandler', () => {
    beforeEach(() => {
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
});
