import type * as Telegram from 'telegram-bot-api-types';
import type { MessageHandler } from './types';
import { WorkerContextBase } from '../../config/context';
import { ENV } from '../../config/env';
import { log, writeDebugLog } from '../../log';
import { formatDiagnosticFields, summarizeShareContext, summarizeTelegramMessage, summarizeTelegramUpdate } from '../../log/diagnostics';
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
    const summary = summarizeTelegramUpdate(update);
    log.info(`[UPDATE] ${formatDiagnosticFields(summary)}`);
    writeDebugLog({
        source: 'telegram',
        event: 'update-received',
        data: summary,
    });
    const messageHandler = loadMessage(update);
    return messageHandler ? messageHandler(token) : null;
}

async function handleMessage(token: string, message: Telegram.Message) {
    const context = new WorkerContextBase(token, message);
    const messageSummary = summarizeTelegramMessage(message);
    const shareSummary = summarizeShareContext(context.SHARE_CONTEXT);
    log.info(`[MESSAGE] start ${formatDiagnosticFields({
        ...messageSummary,
        scopeKey: context.SHARE_CONTEXT.chatHistoryKey,
        configKey: context.SHARE_CONTEXT.configStoreKey,
    })}`);
    writeDebugLog({
        source: 'telegram',
        event: 'message-context',
        data: {
            message: messageSummary,
            shareContext: shareSummary,
        },
    });
    try {
        let response: Response | null = null;
        for (const handler of preHandlers) {
            writeDebugLog({
                source: 'telegram',
                event: 'handler-start',
                data: {
                    stage: 'pre',
                    handler: handler.constructor.name,
                    message: messageSummary,
                },
            });
            const result = await handler.handle(message, context);
            if (result instanceof Response) {
                log.info(`[MESSAGE] handled stage=pre handler=${handler.constructor.name} status=${result.status}`);
                response = result;
                break;
            }
        }

        if (!(response instanceof Response)) {
            const runPostHandlers = async () => {
                for (const handler of postHandlers) {
                    writeDebugLog({
                        source: 'telegram',
                        event: 'handler-start',
                        data: {
                            stage: 'post',
                            handler: handler.constructor.name,
                            message: messageSummary,
                        },
                    });
                    const result = await handler.handle(message, context);
                    if (result instanceof Response) {
                        log.info(`[MESSAGE] handled stage=post handler=${handler.constructor.name} status=${result.status}`);
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
                const pendingCount = getPendingScopedExecutionCount(scopeKey);
                if (policy === 'queue' && pendingCount > 0) {
                    log.info(`[CONCURRENCY] queued scope=${scopeKey} policy=${policy} pending=${pendingCount}`);
                    await MessageSender.from(token, message)
                        .sendPlainText('Another response is already running in this chat. Your message has been queued.', 'tip');
                }
                try {
                    response = await runScopedExecution(scopeKey, policy, runPostHandlers);
                } catch (error) {
                    if (error instanceof ScopeSupersededError) {
                        log.info(`[CONCURRENCY] superseded scope=${scopeKey} policy=${policy}`);
                        response = null;
                    } else if (error instanceof ScopeBusyError) {
                        log.warn(`[CONCURRENCY] busy scope=${scopeKey} policy=${policy}`);
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
                log.info(`[MESSAGE] handled stage=exit handler=${handler.constructor.name} status=${result.status}`);
                return result;
            }
        }
        log.info(`[MESSAGE] done chatId=${message.chat.id} responseStatus=${response?.status ?? 'null'}`);
        return response;
    } catch (e) {
        return catchError(e as Error);
    }
}

export function catchError(e: Error) {
    log.error(`[HANDLE ERROR] ${e.message}`, e.stack);
    writeDebugLog({
        source: 'telegram',
        event: 'handler-error',
        data: e,
    });
    return new Response(JSON.stringify({
        message: e.message,
        stack: e.stack,
    }), { status: 500 });
}
