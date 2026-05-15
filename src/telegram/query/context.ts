import type * as Telegram from 'telegram-bot-api-types';
import type { ShareContext, WorkerContext } from '../../config/context';
import type { AgentUserConfig } from '../../config/env';
import { ENV } from '../../config/env';
import { ConfigMerger } from '../../config/merger';
import { log, writeDebugLog } from '../../log';
import { formatDiagnosticFields, summarizeChosenInlineQuery, summarizeUserConfig } from '../../log/diagnostics';

export class CallbackQueryContext {
    query_id: string;
    from: Telegram.User;
    USER_CONFIG: AgentUserConfig;
    SHARE_CONTEXT: ShareContext;

    constructor(callbackQuery: Telegram.CallbackQuery, workContext: WorkerContext) {
        this.query_id = callbackQuery.id;
        this.from = callbackQuery.from!;
        this.USER_CONFIG = workContext.USER_CONFIG;
        this.SHARE_CONTEXT = workContext.SHARE_CONTEXT;
    }
}

export class InlineQueryContext {
    token: string;
    query_id: string;
    from: Telegram.User;
    chat_type: string | undefined;
    query: string;

    constructor(token: string, inlineQuery: Telegram.InlineQuery) {
        this.token = token;
        this.query_id = inlineQuery.id;
        this.from = inlineQuery.from;
        this.chat_type = inlineQuery.chat_type;
        this.query = inlineQuery.query;
    }
}

export class ChosenInlineContext {
    token: string;
    from_id: number;
    query: string;
    result_id: string;
    inline_message_id: string;
    constructor(token: string, choosenInlineQuery: Telegram.ChosenInlineResult) {
        this.token = token;
        this.from_id = choosenInlineQuery.from.id;
        this.query = choosenInlineQuery.query;
        this.result_id = choosenInlineQuery.result_id;
        this.inline_message_id = choosenInlineQuery.inline_message_id || '';
    }
}

export class ChosenInlineWorkerContext {
    USER_CONFIG: AgentUserConfig;
    botToken: string;
    MIDDLE_CONTEXT: Record<string, any>;
    SHARE_CONTEXT: Record<string, any>;
    constructor(chosenInline: Telegram.ChosenInlineResult, token: string, USER_CONFIG: AgentUserConfig) {
        this.USER_CONFIG = USER_CONFIG;
        this.botToken = token;
        // Simulate a private-chat message context.
        this.MIDDLE_CONTEXT = {
            messageInfo: { type: 'text' },
        };
        this.SHARE_CONTEXT = {
            botName: 'AI',
            telegraphAccessTokenKey: `telegraph_access_token:${chosenInline.from.id}`,
        };
    }

    static async from(token: string, chosenInline: Telegram.ChosenInlineResult): Promise<ChosenInlineWorkerContext> {
        const USER_CONFIG = { ...ENV.USER_CONFIG };
        // Same as private chat
        let userConfigKey = `user_config:${chosenInline.from.id}`;
        const botId = Number.parseInt(token.split(':')[0]);
        if (botId) {
            userConfigKey += `:${botId}`;
        }
        let hasStoredConfig = false;
        let storedConfigKeys: string[] = [];
        try {
            const storedRaw = await ENV.REDIS.get(userConfigKey);
            hasStoredConfig = Boolean(storedRaw);
            const userConfig: AgentUserConfig = JSON.parse(storedRaw || 'null');
            storedConfigKeys = Object.keys(userConfig || {});
            ConfigMerger.merge(USER_CONFIG, ConfigMerger.trim(userConfig) || {});
            USER_CONFIG.ENABLE_SHOWINFO = ENV.INLINE_QUERY_SHOW_INFO;
            // Telegram will reject requests that are too frequent.
            ENV.TELEGRAM_MIN_STREAM_INTERVAL = ENV.INLINE_QUERY_SEND_INTERVAL;
        } catch (e) {
            console.warn(e);
        }
        log.info(`[CONFIG LOAD] ${formatDiagnosticFields({
            scope: 'chosen-inline',
            source: hasStoredConfig ? 'redis' : 'default',
            configKey: userConfigKey,
            storedKeys: storedConfigKeys.length,
            userId: chosenInline.from.id,
        })}`);
        writeDebugLog({
            source: 'config',
            event: 'chosen-inline-context-load',
            data: {
                source: hasStoredConfig ? 'redis' : 'default',
                storedConfigKeys,
                chosenInline: summarizeChosenInlineQuery(chosenInline),
                userConfig: summarizeUserConfig(USER_CONFIG),
            },
        });
        return new ChosenInlineWorkerContext(chosenInline, token, USER_CONFIG);
    }
}
