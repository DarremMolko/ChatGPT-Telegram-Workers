import type * as Telegram from 'telegram-bot-api-types';
import type { MessageHandler } from './types';
import { WorkerContextBase } from '../../config/context';
import { ENV } from '../../config/env';
import { log } from '../../log/logger';
import { resolveMatchedCommand } from '../command';
import { handleCallbackQuery, handleChosenInlineQuery, handleInlineQuery } from '../query';
import { getPendingScopedExecutionCount, runScopedExecution, ScopeBusyError, ScopeSupersededError } from '../utils/active_request';
import { MessageSender } from '../utils/send';
import { ChatHandler } from './chat';
import { GroupMention } from './group';
import {
    BlocklistFilter,
    ChunkMessageHandler,
    CommandHandler,
    EnvChecker,
    InitUserConfig,
    MergeQuote,
    MessageFilter,
    OldMessageFilter,
    RecordStatsHandler,
    ReplyInlineHandler,
    SaveLastMessage,
    SubstituteHandler,
    TagNeedDelete,
    WhiteListFilter,
} from './handlers';

function loadMessage(body: Telegram.Update) {
    switch (true) {
        case !!body.message:
            return (token: string) => handleMessage(token, body.message!);
        case !!body.inline_query:
            return (token: string) => handleInlineQuery(token, body.inline_query!);
        case !!body.callback_query:
            return (token: string) => handleCallbackQuery(token, body.callback_query!);
        case !!body.chosen_inline_result:
            return (token: string) => handleChosenInlineQuery(token, body.chosen_inline_result!);
        case !!body.edited_message:
            log.info('Ignore edited message');
            return null;
        default:
            log.info(`Not support message type: ${JSON.stringify(body, null, 2)}`);
            return null;
    }
}

const exitHanders: MessageHandler<any>[] = [new TagNeedDelete()];
const preHandlers: MessageHandler<any>[] = [
    new EnvChecker(),
    new WhiteListFilter(),
    new MessageFilter(),
    new OldMessageFilter(),
    new ReplyInlineHandler(),
    new GroupMention(),
    new ChunkMessageHandler(),
    new SaveLastMessage(),
    new MergeQuote(),
    new InitUserConfig(),
    new RecordStatsHandler(),
    new BlocklistFilter(),
    new SubstituteHandler(),
];
const postHandlers: MessageHandler<any>[] = [
    new CommandHandler(),
    new ChatHandler(),
];

function isExecutionBypassCommand(message: Telegram.Message): boolean {
    const text = (message.text || message.caption || '').trim();
    const command = resolveMatchedCommand(text);
    return command?.command === '/stop' || command?.command === '/cancel';
}

export async function handleUpdate(token: string, update: Telegram.Update): Promise<Response | null> {
    log.debug(`handleUpdate`, update.message?.chat ?? `callback_query: ${JSON.stringify(update.callback_query?.from, null, 2)}`);
    const messageHandler = loadMessage(update);
    return messageHandler ? messageHandler(token) : null;
}

async function handleMessage(token: string, message: Telegram.Message) {
    const context = new WorkerContextBase(token, message);
    try {
        let response: Response | null = null;
        for (const handler of preHandlers) {
            const result = await handler.handle(message, context);
            if (result instanceof Response) {
                response = result;
                break;
            }
        }

        if (!(response instanceof Response)) {
            const runPostHandlers = async () => {
                for (const handler of postHandlers) {
                    const result = await handler.handle(message, context);
                    if (result instanceof Response) {
                        return result;
                    }
                }
                return null;
            };

            if (isExecutionBypassCommand(message)) {
                response = await runPostHandlers();
            } else {
                const scopeKey = context.SHARE_CONTEXT.chatHistoryKey;
                const policy = ENV.CHAT_CONCURRENCY_POLICY;
                if (policy === 'queue' && getPendingScopedExecutionCount(scopeKey) > 0) {
                    await MessageSender.from(token, message)
                        .sendPlainText('Another response is already running in this chat. Your message has been queued.', 'tip');
                }
                try {
                    response = await runScopedExecution(scopeKey, policy, runPostHandlers);
                } catch (error) {
                    if (error instanceof ScopeSupersededError) {
                        response = null;
                    } else if (error instanceof ScopeBusyError) {
                        response = await MessageSender.from(token, message)
                            .sendPlainText('Another response is already running in this chat. Please wait or send /stop.', 'tip');
                    } else {
                        throw error;
                    }
                }
            }
        }

        for (const handler of exitHanders) {
            const result = await handler.handle(message, context);
            if (result && result instanceof Response) {
                return result;
            }
        }
        return response;
    } catch (e) {
        return catchError(e as Error);
    }
}

export function catchError(e: Error) {
    console.error(e.message);
    return new Response(JSON.stringify({
        message: e.message,
        stack: e.stack,
    }), { status: 500 });
}
