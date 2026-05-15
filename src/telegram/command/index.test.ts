import type * as Telegram from 'telegram-bot-api-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendPlainTextMock, sendRichTextMock, ttsHandleMock } = vi.hoisted(() => ({
    sendPlainTextMock: vi.fn(async (message: string) => new Response(message, { status: 200 })),
    sendRichTextMock: vi.fn(async (message: string) => new Response(message, { status: 200 })),
    ttsHandleMock: vi.fn(),
}));

vi.mock('../../config/env', () => ({
    ENV: {
        CUSTOM_COMMAND: {},
        DEV_MODE: false,
        I18N: {
            command: {
                help: {},
            },
        },
    },
}));

vi.mock('../../log/logger', () => ({
    log: {
        info: vi.fn(),
    },
}));

vi.mock('../access', () => ({
    canUseAdminUtilityForAccess: vi.fn(() => true),
    describeCommandAccess: vi.fn(() => 'admin'),
    resolveCommandAccess: vi.fn(value => value),
    resolveUserAccess: vi.fn(async () => ({
        isAdmin: true,
        isOwner: false,
        userId: '456',
    })),
}));

vi.mock('../utils/send', () => ({
    MessageSender: {
        from: vi.fn(() => ({
            sendPlainText: sendPlainTextMock,
            sendRichText: sendRichTextMock,
        })),
    },
}));

vi.mock('./system', () => {
    class DummyCommand {
        command = '/dummy';
        handle = vi.fn(async () => null);
    }

    class TTSCommandHandler {
        command = '/tts';
        relaxAuth = true;
        handle = ttsHandleMock;
    }

    return {
        BlocklistCommandHandler: DummyCommand,
        BlockUserCommandHandler: DummyCommand,
        CancelCommandHandler: DummyCommand,
        ClearEnvCommandHandler: DummyCommand,
        DelEnvCommandHandler: DummyCommand,
        DemoteCommandHandler: DummyCommand,
        EchoCommandHandler: DummyCommand,
        HelpCommandHandler: DummyCommand,
        HistoryCommandHandler: DummyCommand,
        ImgCommandHandler: DummyCommand,
        InlineCommandHandler: DummyCommand,
        MapCommandHandler: DummyCommand,
        NewCommandHandler: DummyCommand,
        PromoteCommandHandler: DummyCommand,
        RedoCommandHandler: DummyCommand,
        SetCommandHandler: DummyCommand,
        SetEnvCommandHandler: DummyCommand,
        SetEnvsCommandHandler: DummyCommand,
        StartCommandHandler: DummyCommand,
        StopCommandHandler: DummyCommand,
        STTCommandHandler: DummyCommand,
        SystemCommandHandler: DummyCommand,
        TTSCommandHandler,
        UnblockUserCommandHandler: DummyCommand,
        VersionCommandHandler: DummyCommand,
        VisionCommandHandler: DummyCommand,
    };
});

const { handleCommandMessage } = await import('./index');

function createMessage(text: string): Telegram.Message {
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
    } as Telegram.Message;
}

function createContext() {
    return {
        SHARE_CONTEXT: {
            botId: 999,
            botToken: 'bot-token',
        },
    } as any;
}

describe('handleCommandMessage', () => {
    beforeEach(() => {
        sendPlainTextMock.mockClear();
        sendRichTextMock.mockClear();
        ttsHandleMock.mockReset();
    });

    it('catches async command failures and sends the error message', async () => {
        ttsHandleMock.mockRejectedValue(new Error('voice invalid'));

        const response = await handleCommandMessage(createMessage('/tts'), createContext());

        expect(response).toBeInstanceOf(Response);
        expect(ttsHandleMock).toHaveBeenCalledTimes(1);
        expect(sendRichTextMock).toHaveBeenCalledWith('```\nError\nvoice invalid\n```', undefined, 'tip');
        await expect((response as Response).text()).resolves.toBe('```\nError\nvoice invalid\n```');
    });
});
