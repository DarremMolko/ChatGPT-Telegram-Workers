import type * as Telegram from 'telegram-bot-api-types';
import type { HistoryItem } from '../agent/types';
import type { MessageSender } from '../telegram/utils/send';
import type { UnionData } from '../telegram/utils/tg_utils';
import type { AgentUserConfig } from './env';
import { ENV } from './env';
import { ConfigMerger } from './merger';

export class ShareContext {
    botId: number;
    botToken: string;
    botName: string | null = null;
    chatId: number;

    // Keys stored in KV/Redis
    chatHistoryKey: string;
    lastMessageKey: string;
    configStoreKey: string;
    telegraphAccessTokenKey?: string;
    readonly scheduleDeteleKey: string = 'schedule_detele_message';
    storeMediaMessageKey?: string;
    chunkMessageKey?: string;
    // mediaMessageLock?: string;
    // chunkMessageLock?: string;

    constructor(token: string, message: Telegram.Message) {
        const botId = Number.parseInt(token.split(':')[0]);

        const telegramIndex = ENV.TELEGRAM_AVAILABLE_TOKENS.indexOf(token);
        if (telegramIndex === -1) {
            throw new Error('Token not allowed');
        }
        if (ENV.TELEGRAM_BOT_NAME.length > telegramIndex) {
            this.botName = ENV.TELEGRAM_BOT_NAME[telegramIndex];
        }

        this.botToken = token;
        this.botId = botId;
        const id = message?.chat?.id;
        if (id === undefined || id === null) {
            throw new Error('Chat id not found');
        }
        this.chatId = id;
        // message_id changes for every message.
        // In private chats:
        //   message.chat.id is the speaker id.
        // In group chats:
        //   message.chat.id is the group id.
        //   message.from.id is the speaker id.
        // When group shared-session mode is disabled, include the speaker id as well.
        //  chatHistoryKey = history:chat_id:bot_id:(from_id)
        //  configStoreKey =  user_config:chat_id:bot_id:(from_id)
        //  storeMediaMessageKey = store_media_message:chat_id:(from_id)
        //  chunkMessageKey = chunk_message:chat_id:(from_id)

        let historyKey = `history:${id}`;
        let configStoreKey = `user_config:${id}`;
        let chunkMessageKey = ENV.STORE_TEXT_CHUNK_MESSAGE ? `chunk_message:${id}` : undefined;
        let storeMediaMessageKey = ENV.STORE_MEDIA_MESSAGE ? `store_media_message:${id}` : undefined;

        if (botId) {
            historyKey += `:${botId}`;
            configStoreKey += `:${botId}`;
        }
        // Mark group chat messages
        switch (message.chat.type) {
            case 'group':
            case 'supergroup':
                if (!ENV.GROUP_CHAT_BOT_SHARE_MODE && message.from?.id) {
                    historyKey += `:${message.from.id}`;
                    configStoreKey += `:${message.from.id}`;
                }
                if (message.from?.id) {
                    chunkMessageKey = chunkMessageKey ? `${chunkMessageKey}:${message.from.id}` : undefined;
                    storeMediaMessageKey = storeMediaMessageKey ? `${storeMediaMessageKey}:${message.from.id}` : undefined;
                }
                break;
            default:
                break;
        }

        // Check whether this is a forum topic thread
        if (message?.chat.is_forum && message?.is_topic_message) {
            if (message?.message_thread_id) {
                historyKey += `:${message.message_thread_id}`;
                configStoreKey += `:${message.message_thread_id}`;
            }
        }

        this.chatHistoryKey = historyKey;
        this.lastMessageKey = `last_message_id:${historyKey}`;
        this.configStoreKey = configStoreKey;
        this.chunkMessageKey = chunkMessageKey;
        this.storeMediaMessageKey = storeMediaMessageKey;

        // Do not distinguish whether group shared-session mode is enabled

        if (ENV.TELEGRAPH_NUM_LIMIT > 0) {
            this.telegraphAccessTokenKey = `telegraph_access_token:${id}`;
        }
    };
}

export class MiddleContext {
    messageInfo: UnionData = { type: 'text' };
    history: HistoryItem[] = [];
    sender: MessageSender | null = null;
}

export class WorkerContextBase {
    SHARE_CONTEXT: ShareContext;
    MIDDLE_CONTEXT: MiddleContext = new MiddleContext();

    constructor(token: string, message: Telegram.Message) {
        this.SHARE_CONTEXT = new ShareContext(token, message);
    }
}

export class WorkerContext implements WorkerContextBase {
    // User configuration
    USER_CONFIG: AgentUserConfig;
    SHARE_CONTEXT: ShareContext;
    MIDDLE_CONTEXT: MiddleContext;

    constructor(USER_CONFIG: AgentUserConfig, SHARE_CONTEXT: ShareContext, MIDDLE_CONTEXT: MiddleContext) {
        this.USER_CONFIG = USER_CONFIG;
        this.SHARE_CONTEXT = SHARE_CONTEXT;
        this.MIDDLE_CONTEXT = MIDDLE_CONTEXT;
    }

    static async from(SHARE_CONTEXT: ShareContext, MIDDLE_CONTEXT: MiddleContext): Promise<WorkerContext> {
        const USER_CONFIG = { ...ENV.USER_CONFIG };
        try {
            const userConfig: AgentUserConfig = JSON.parse(await ENV.REDIS.get(SHARE_CONTEXT.configStoreKey)) || {};
            ConfigMerger.merge(USER_CONFIG, ConfigMerger.trim(userConfig) || {});
        } catch (e) {
            console.warn(e);
        }
        return new WorkerContext(USER_CONFIG, SHARE_CONTEXT, MIDDLE_CONTEXT);
    }
}
