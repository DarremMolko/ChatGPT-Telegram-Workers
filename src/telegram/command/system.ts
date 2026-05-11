/* eslint-disable unused-imports/no-unused-vars */
/* eslint-disable no-cond-assign */
import type { UserModelMessage } from 'ai';
import type * as Telegram from 'telegram-bot-api-types';
import type { HistoryItem } from '../../agent/types';
import type { WorkerContext } from '../../config/context';
import type { AgentUserConfig } from '../../config/env';
import type { MessageSender } from '../utils/send';
import type { CommandHandler, InlineItem, ScopeType } from './types';
import { authChecker } from '.';
import { ASR_AGENTS, CHAT_AGENTS, customInfo, IMAGE_AGENTS, loadASRLLM, loadChatLLM, loadImageGen, loadTTSLLM, TTS_AGENTS } from '../../agent';
import { loadHistory } from '../../agent/chat';
import { updateModels } from '../../agent/models';
import { ENV } from '../../config/env';
import { ConfigMerger } from '../../config/merger';
import { log } from '../../log';
import { updateMcp } from '../../mcp';
import { getStats } from '../../utils/stats';
import { createTelegramBotAPI } from '../api';
import { chatWithLLM, sendImages, tts } from '../handler/chat';
import { escape } from '../utils/md2tgmd';
import { checkIsNeedTagIds, sendAction } from '../utils/send';
import { chunkArray, getTelegramFile, isTelegramChatTypeGroup } from '../utils/tg_utils';

export const COMMAND_AUTH_CHECKER = {
    default(chatType: string): string[] | null {
        if (isTelegramChatTypeGroup(chatType)) {
            return ['administrator', 'creator'];
        }
        return null;
    },
    shareModeGroup(chatType: string): string[] | null {
        if (isTelegramChatTypeGroup(chatType)) {
            // 每个人在群里有上下文的时候，不限制
            if (!ENV.GROUP_CHAT_BOT_SHARE_MODE) {
                return null;
            }
            return ['administrator', 'creator'];
        }
        return null;
    },
    whiteList(chatType: string): string[] {
        return ['whitelist'];
    },
};

function isWhitelistAdmin(userId?: number): boolean {
    return userId !== undefined && ENV.CHAT_WHITE_LIST.includes(userId.toString());
}

function isSensitiveEnvKey(key: string): boolean {
    return key.endsWith('KEY')
        || key.endsWith('TOKEN')
        || key.endsWith('SECRET')
        || key.endsWith('COOKIE')
        || key.endsWith('ID')
        || key.endsWith('API')
        || key.endsWith('CREDENTIALS');
}

abstract class RenewConfig implements CommandHandler {
    abstract command: string;
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth: (chatType: string) => string[] | null = COMMAND_AUTH_CHECKER.shareModeGroup;
    abstract handle: (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender) => Promise<Response | null>;
    store = async (data: Record<string, any>, context: WorkerContext, isStore: boolean = true): Promise<void> => {
        Object.keys(data).forEach((key) => {
            context.USER_CONFIG.DEFINE_KEYS.push(key);
        });
        context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
        ConfigMerger.merge(context.USER_CONFIG, data);
        if (isStore) {
            await ENV.REDIS.put(
                context.SHARE_CONTEXT.configStoreKey,
                JSON.stringify(ConfigMerger.trim(context.USER_CONFIG)),
            );
        }
    };
}

function tokenizeSubcommand(subcommand: string): { flags: { flag: string; value: string | undefined }[]; remainingText: string } {
    const regex = /^\s*-(\w+)(?:\s+("[^"]*"|'[^']*'|\S+|$)|$)/;
    const flags: { flag: string; value: string | undefined }[] = [];
    let text = subcommand;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const flag = match[1];
        let value = match[2];
        if ((value?.startsWith('"') && value?.endsWith('"')) || (value?.startsWith('\'') && value?.endsWith('\''))) {
            value = value.slice(1, -1);
        }
        flags.push({ flag, value });
        text = text.slice(match[0].length);
    }

    log.info(`flags: ${JSON.stringify(flags, null, 2)}, remainingText: ${text}`);
    return { flags, remainingText: text.trim() };
}

export class ImgCommandHandler implements CommandHandler {
    command = '/img';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        if (subcommand === '') {
            return sender.sendPlainText(ENV.I18N.command.help.img);
        }
        try {
            const agent = loadImageGen(context.USER_CONFIG);
            const extraParams: Record<string, any> = {};
            if (agent.name === 'openai' && ['image', 'photo'].includes(context.MIDDLE_CONTEXT.messageInfo?.type) && (context.MIDDLE_CONTEXT.messageInfo?.id?.length || 0) > 0) {
                extraParams.referenceImages = await getTelegramFile(context.MIDDLE_CONTEXT.messageInfo.id!, context.SHARE_CONTEXT.botToken, ENV.TELEGRAM_IMAGE_TRANSFER_MODE as any);
            }
            await sender.sendPlainText('Please wait a moment...');
            sendAction(context.SHARE_CONTEXT.botToken, message.chat.id, 'upload_photo');
            const img = await agent.request(subcommand, context.USER_CONFIG, extraParams);
            log.info(`img has been generated: ${JSON.stringify(img.url || img.message)} prompt: ${img.text}`);
            if ((img.raw || img.url)?.length === 0) {
                return sender.sendPlainText(`${img.text || 'ERROR: No image found'}`);
            }
            const resp = await sendImages(img, ENV.SEND_IMAGE_AS_FILE, sender, context.USER_CONFIG);

            if (!resp.ok) {
                return sender.sendPlainText(`\`\`\`Error\n${resp.statusText} ${await resp.text()}\n\`\`\``);
            }
            return resp;
        } catch (e) {
            return sender.sendRichText(`\`\`\`Error\n${(e as Error).message}\n\`\`\``);
        }
    };
}

export class HelpCommandHandler implements CommandHandler {
    command = '/help';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        let helpMsg = `${ENV.I18N.command.help.summary}\n`;
        for (const [k, v] of Object.entries(ENV.I18N.command.help)) {
            if (k === 'summary') {
                continue;
            }
            helpMsg += `/${k}: ${v}\n`;
        }
        for (const [k, v] of Object.entries(ENV.CUSTOM_COMMAND)) {
            if (v.description) {
                helpMsg += `${k}: ${v.description}\n`;
            }
        }
        helpMsg = helpMsg.split('\n').map(line => `> ${line}`).join('\n');
        return sender.sendRichText(helpMsg, 'MarkdownV2', 'tip');
    };
}

class BaseNewCommandHandler {
    static async handle(showID: boolean, message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> {
        await ENV.REDIS.delete(context.SHARE_CONTEXT.chatHistoryKey);
        const text = ENV.I18N.command.new.new_chat_start + (showID ? `(${message.chat.id})` : '');
        const params: Telegram.SendMessageParams = {
            chat_id: message.chat.id,
            message_thread_id: (message.is_topic_message && message.message_thread_id) || undefined,
            text,
        };
        if (ENV.SHOW_REPLY_BUTTON && !isTelegramChatTypeGroup(message.chat.type)) {
            params.reply_markup = {
                keyboard: [[{ text: '/new' }, { text: '/redo' }]],
                selective: true,
                resize_keyboard: true,
                one_time_keyboard: false,
            };
        } else {
            params.reply_markup = {
                remove_keyboard: true,
                selective: true,
            };
        }
        const resp = createTelegramBotAPI(context.SHARE_CONTEXT.botToken).sendMessage(params);
        return checkIsNeedTagIds({ chatType: message.chat.type, message }, resp, 'tip');
    }
}

export class NewCommandHandler extends BaseNewCommandHandler implements CommandHandler {
    command = '/new';
    scopes: ScopeType[] = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        return BaseNewCommandHandler.handle(false, message, subcommand, context);
    };
}

export class StartCommandHandler extends BaseNewCommandHandler implements CommandHandler {
    command = '/start';
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        return BaseNewCommandHandler.handle(true, message, subcommand, context);
    };
}

export class SetEnvCommandHandler extends RenewConfig {
    command = '/setenv';
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        const kv = subcommand.indexOf('=');
        if (kv === -1) {
            return sender.sendPlainText(ENV.I18N.command.help.setenv);
        }
        const key = subcommand.slice(0, kv);
        const value = subcommand.slice(kv + 1);
        if (!Object.keys(context.USER_CONFIG).includes(key)) {
            return sender.sendPlainText(`Key ${key} not found`);
        }
        try {
            this.store({ [key]: value }, context);
            log.info('Update user config: ', key, context.USER_CONFIG[key]);
            return sender.sendPlainText('Update user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class SetEnvsCommandHandler extends RenewConfig {
    command = '/setenvs';
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        try {
            const values = JSON.parse(subcommand);
            const configKeys = Object.keys(context.USER_CONFIG);
            for (const ent of Object.entries(values)) {
                const [key, value] = ent;
                if (!configKeys.includes(key)) {
                    return sender.sendPlainText(`Key ${key} not found`);
                }
                this.store({ [key]: value }, context, false);
                log.info('Update user config: ', key, context.USER_CONFIG[key]);
            }
            this.store({}, context);
            return sender.sendPlainText('Update user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class DelEnvCommandHandler extends RenewConfig {
    command = '/delenv';
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        try {
            context.USER_CONFIG[subcommand] = null;
            context.USER_CONFIG.DEFINE_KEYS = context.USER_CONFIG.DEFINE_KEYS.filter(key => key !== subcommand);
            this.store({}, context);
            return sender.sendPlainText('Delete user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class ClearEnvCommandHandler extends RenewConfig {
    command = '/clearenv';
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        try {
            await ENV.REDIS.put(
                context.SHARE_CONTEXT.configStoreKey,
                JSON.stringify({}),
            );
            return sender.sendPlainText('Clear user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class VersionCommandHandler implements CommandHandler {
    command = '/version';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.default;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const current = {
            ts: ENV.BUILD_TIMESTAMP,
            sha: ENV.BUILD_VERSION,
        };
        const timeFormat = (ts: number): string => {
            return new Date(ts * 1000).toLocaleString('en-US', {});
        };
        return sender.sendPlainText(`Current build: ${current.sha} (${timeFormat(current.ts)})`);
    };
}

export class SystemCommandHandler implements CommandHandler {
    command = '/system';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.default;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        const stats = getStats(String(context.SHARE_CONTEXT.botId));
        const chatAgent = loadChatLLM(context.USER_CONFIG);
        const imageAgent = loadImageGen(context.USER_CONFIG);
        const asrAgent = loadASRLLM(context.USER_CONFIG);
        const ttsAgent = loadTTSLLM(context.USER_CONFIG);
        const agent = {
            AI_CHAT_PROVIDER: chatAgent?.name,
            [chatAgent?.modelKey || 'AI_CHAT_PROVIDER_NOT_FOUND']: chatAgent?.model ? chatAgent.model(context.USER_CONFIG) : 'AI_CHAT_PROVIDER_NOT_FOUND',
            TOOL_MODEL: context.USER_CONFIG.TOOL_MODEL || 'same as chat model',
            AI_IMAGE_PROVIDER: imageAgent?.name,
            [imageAgent?.modelKey || 'AI_IMAGE_PROVIDER_NOT_FOUND']: imageAgent?.model ? imageAgent.model(context.USER_CONFIG) : 'AI_IMAGE_PROVIDER_NOT_FOUND',
            [asrAgent?.modelKey || 'AI_ASR_PROVIDER_NOT_FOUND']: asrAgent?.model ? asrAgent.model(context.USER_CONFIG) : 'AI_ASR_PROVIDER_NOT_FOUND',
            [ttsAgent?.modelKey || 'AI_TTS_PROVIDER_NOT_FOUND']: ttsAgent?.model(context.USER_CONFIG),
            VISION_MODEL: context.USER_CONFIG[`${chatAgent?.name?.toUpperCase()}_VISION_MODEL`] || `Agent ${chatAgent?.name ?? ''} not found`,
        };
        let msg = `📊 *Usage Statistics*:\n  Total Users: \`${stats.totalUsers}\`\n  Total Groups: \`${stats.totalGroups}\`\n  Total Messages: \`${stats.totalMessages}\`\n  Today Messages: \`${stats.todayMessages}\`\n\nsystem info:\n\nAGENT: ${JSON.stringify(agent, null, 2).split('\n').map(line => `\`${line}\``).join('\n')}\n\nOTHERS: ${await customInfo(context.USER_CONFIG)}\n`;
        if (ENV.DEV_MODE) {
            const shareCtx = { ...context.SHARE_CONTEXT };
            shareCtx.botToken = '******';
            context.USER_CONFIG.OPENAI_API_KEY = ['******'];
            context.USER_CONFIG.OAILIKE_API_KEY = '******';
            const config = ConfigMerger.trim(context.USER_CONFIG);
            msg = `${msg}\n`;
            msg += `USER_CONFIG: ${JSON.stringify(config, null, 2)}\n`;
            msg += `CHAT_CONTEXT: ${JSON.stringify(sender.context || {}, null, 2)}\n`;
            msg += `SHARE_CONTEXT: ${JSON.stringify(shareCtx, null, 2)}`;
        }
        return sender.sendRichText(msg, 'MarkdownV2', 'tip', {
            addQuote: true,
            quoteExpandable: true,
        });
    };
}

export class RedoCommandHandler implements CommandHandler {
    command = '/redo';
    scopes: ScopeType[] = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const mf = (history: HistoryItem[], message: UserModelMessage | null): any => {
            let nextMessage = message;
            if (!(history && Array.isArray(history) && history.length > 0)) {
                throw new Error('History not found');
            }
            const historyCopy = structuredClone(history);
            while (true) {
                const data = historyCopy.pop();
                if (data === undefined || data === null) {
                    break;
                } else if (data.role === 'user') {
                    nextMessage = data;
                    break;
                }
            }
            if (subcommand) {
                nextMessage = {
                    role: 'user',
                    content: subcommand,
                };
            }
            if (nextMessage === null) {
                throw new Error('Redo message not found');
            }
            return { history: historyCopy, message: nextMessage };
        };
        context.MIDDLE_CONTEXT.history = await loadHistory(context.SHARE_CONTEXT.chatHistoryKey, ENV.STORE_HISTORY_LENGTH);
        return chatWithLLM(message, null, context, mf) as unknown as Response;
    };
}

export class EchoCommandHandler implements CommandHandler {
    command = '/echo';
    handle = (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        let msg = '<pre>';
        msg += JSON.stringify({ message }, null, 2);
        msg += '</pre>';
        return sender.sendRichText(msg, 'HTML');
    };
}

export class SetCommandHandler extends RenewConfig implements CommandHandler {
    command = '/set';
    relaxAuth = true;
    handle = async (
        message: Telegram.Message,
        subcommand: string,
        context: WorkerContext,
        sender: MessageSender,
    ): Promise<Response | null> => {
        try {
            if (!subcommand) {
                const detailSet = ENV.I18N.command?.detail?.set || 'No detailed help is available for this language.';
                return sender.sendRichText(`<pre>${detailSet}</pre>`, 'HTML');
            }

            const { keys, values } = this.parseMappings(context);
            const { flags, remainingText } = tokenizeSubcommand(subcommand);
            const needUpdate = remainingText === '';
            let msg = '';
            const updatedKeys: string[] = [];

            if (context.USER_CONFIG.AI_CHAT_PROVIDER === 'auto') {
                context.USER_CONFIG.AI_CHAT_PROVIDER = 'openai';
            }

            for (const { flag, value } of flags) {
                const result = await this.processSubcommand(flag, value, keys, values, context, sender);
                if (result instanceof Response) {
                    return result;
                }
                updatedKeys.push(result);
            }
            await this.RelaxAuthCheck(message, context, updatedKeys, needUpdate);
            if (needUpdate && updatedKeys.length > 0 && context.SHARE_CONTEXT?.configStoreKey) {
                await this.store({}, context);
                const suffixWhiteList = ['_PROVIDER', '_MODEL', '_MODELS', '_TOOLS', '_TYPE', '_OUTPUT', '_AGENT', '_TEMPERATURE', 'MAPPING_KEY', 'MAPPING_VALUE', 'USE_MCP', 'USE_OPENAI_BUILDIN'];
                msg += `${updatedKeys
                    .filter(key => suffixWhiteList.some(suffix => key.endsWith(suffix)))
                    .map(key => `${key}: ${context.USER_CONFIG[key]}`)
                    .join('\n')}\n${updatedKeys.filter(key => !suffixWhiteList.some(suffix => key.endsWith(suffix))).join('\n')}`;
            }

            if (remainingText) {
                message.text = remainingText;
                return null;
            }
            return sender.sendRichText(`<pre><code class="language-update">${msg}</code></pre>`, 'HTML', 'tip');
        } catch (e) {
            log.error(`/set error: ${(e as Error).message}`);
            return sender.sendRichText(`<pre><code class="language-error">${(e as Error).message}</code></pre>`, 'HTML', 'tip');
        }
    };

    private parseMappings(context: WorkerContext): { keys: Record<string, string>; values: Record<string, string> } {
        const parseMapping = (mapping: string, type: string): Record<string, string> => {
            if (!mapping) {
                return {};
            }
            const entries: [string, string][] = [];
            const pairs = mapping.split('|');
            for (const k of pairs) {
                const [key, ...rest] = k.split(':');
                if (!key) {
                    console.warn(`Invalid key in mapping: "${k}"`);
                    continue;
                }
                // 防止映射值中同样包含:
                const value = rest.length > 0 ? rest.join(':') : '';
                if (type === 'key') {
                    entries.push([key.replace(/^-/, ''), value]);
                    continue;
                }
                entries.push([key, value]);
            }

            return Object.fromEntries(entries);
        };

        const keys = parseMapping(context.USER_CONFIG.MAPPING_KEY, 'key');
        const values = parseMapping(context.USER_CONFIG.MAPPING_VALUE, 'value');
        return { keys, values };
    }

    private async processSubcommand(
        flag: string,
        value: string | undefined,
        keys: Record<string, string>,
        values: Record<string, any>,
        context: WorkerContext,
        sender: MessageSender,
    ): Promise<string | Response> {
        let key = keys[flag]
            || (Object.values(keys).includes(flag)
                || Object.keys(context.USER_CONFIG).some(k => k.endsWith(flag))
                ? flag
                : null);
        let mappedValue = value && (values[value] ?? value);

        if (!key) {
            throw new Error(`Mapping Key ${flag} not found`);
        }

        switch (key) {
            case 'SYSTEM_INIT_MESSAGE':
                mappedValue = value && (context.USER_CONFIG.PROMPT[value] || value);
                break;
            case 'CHAT_MODEL':
            case 'VISION_MODEL':
                key = context.USER_CONFIG.AI_CHAT_PROVIDER
                    ? `${context.USER_CONFIG.AI_CHAT_PROVIDER.toUpperCase()}_${key}`
                    : key;
                break;
            case 'IMAGE_MODEL':
                key = context.USER_CONFIG.AI_IMAGE_PROVIDER
                    ? `${context.USER_CONFIG.AI_IMAGE_PROVIDER.toUpperCase()}_${key}`
                    : key;
                break;
            case 'STT_MODEL':
                key = context.USER_CONFIG.AI_ASR_PROVIDER
                    ? `${context.USER_CONFIG.AI_ASR_PROVIDER.toUpperCase()}_${key}`
                    : key;
                break;
            case 'TTS_MODEL':
                key = context.USER_CONFIG.AI_TTS_PROVIDER
                    ? `${context.USER_CONFIG.AI_TTS_PROVIDER.toUpperCase()}_${key}`
                    : key;
                break;
            default:
                break;
        }

        if (!(key in context.USER_CONFIG)) {
            return sender.sendPlainText(`Key ${key} not found`);
        }

        // 设置的值为空，则使用全局默认值
        ConfigMerger.merge(context.USER_CONFIG, { [key]: mappedValue || ENV.USER_CONFIG[key] });
        if (!context.USER_CONFIG.DEFINE_KEYS.includes(key) && mappedValue) {
            context.USER_CONFIG.DEFINE_KEYS.push(key);
        } else if (!mappedValue) {
            context.USER_CONFIG.DEFINE_KEYS = context.USER_CONFIG.DEFINE_KEYS.filter(k => k !== key);
        }
        log.info(`/set ${key} ${(JSON.stringify(mappedValue) || value || '').substring(0, 100)}...`);
        return key;
    }

    private async RelaxAuthCheck(message: Telegram.Message, context: WorkerContext, keys: string[], needUpdate: boolean) {
        if (needUpdate || (keys.length > 0 && keys.some(key => !ENV.RELAX_AUTH_KEYS.includes(key)))) {
            await authChecker(this, message, context);
        }
    }
}

export class InlineCommandHandler implements CommandHandler {
    command = '/settings';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender?: MessageSender): Promise<Response> => {
        const showAllEnvs = isWhitelistAdmin(message.from?.id);
        const defaultInlines = await this.defaultInlines(context.USER_CONFIG, { showAllEnvs });
        const settingMsg = this.settingsMessage(context.USER_CONFIG, defaultInlines, { callBack: '', showSensitiveValues: showAllEnvs });
        const headKeyboard = [
            {
                text: 'Select a setting',
                callback_data: message.from!.id.toString(),
            },
        ];
        const closeKeyboard = [{
            text: '❌',
            callback_data: 'close',
        }];

        return createTelegramBotAPI(context.SHARE_CONTEXT.botToken).sendMessage({
            chat_id: message.chat.id,
            ...(message.chat.type === 'private' ? {} : { reply_to_message_id: message.message_id }),
            text: escape(settingMsg, { quoteExpandable: true, addQuote: true }),
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [headKeyboard, ...this.inlineKeyboard(context.USER_CONFIG, defaultInlines), closeKeyboard],
            },
        });
    };

    defaultInlines = async (context: AgentUserConfig, options: { showAllEnvs?: boolean } = {}): Promise<InlineItem[]> => {
        const allChatAgents = CHAT_AGENTS.map(agent => agent.name);
        const allImageAgents = IMAGE_AGENTS.map(agent => agent.name);
        const allTTSAgents = TTS_AGENTS.map(agent => agent.name);
        const allASRAgents = ASR_AGENTS.map(agent => agent.name);
        const allRerankAgents = ['openai', 'oailikeV1', 'oailikeV2'];
        const chatAgent = context.AI_CHAT_PROVIDER;
        const { showAllEnvs = false } = options;
        const configKeyHandler = (type: string) => {
            if (type === 'Tool') {
                return 'TOOL_MODEL';
            }
            const agent = context[`AI_${(type === 'Image' ? 'IMAGE' : 'CHAT')}_PROVIDER`];
            return `${agent.toUpperCase()}_${type.toUpperCase()}_MODEL`;
        };
        const envs = showAllEnvs
            ? Object.keys(context)
            : ENV.ENVS_VARIABLES.length === 0
                ? Object.keys(context).filter(key => !isSensitiveEnvKey(key))
                : ENV.ENVS_VARIABLES;
        const inlines: InlineItem[] = [
            {
                label: 'Chat Agent',
                config_key: 'AI_CHAT_PROVIDER',
                type: 'radio',
                value: allChatAgents,
            },
            {
                label: 'Image Agent',
                config_key: 'AI_IMAGE_PROVIDER',
                type: 'radio',
                value: allImageAgents,
            },
            {
                label: 'TTS Agent',
                config_key: 'AI_TTS_PROVIDER',
                type: 'radio',
                value: allTTSAgents,
            },
            {
                label: 'ASR Agent',
                config_key: 'AI_ASR_PROVIDER',
                type: 'radio',
                value: allASRAgents,
            },
            {
                label: 'Rerank Agent',
                config_key: 'RERANK_AGENT',
                type: 'radio',
                value: allRerankAgents,
            },
            {
                label: 'MCP',
                config_key: 'USE_MCP',
                type: 'checkbox',
                value: Object.keys(ENV.MCP_CONFIG),
                callback: updateMcp,
            },
            ...['Chat', 'Image', 'Vision', 'Tool'].map((type) => {
                const config_key = configKeyHandler(type);
                const modelProvider = context[`AI_${type.toUpperCase()}_PROVIDER`] || context.AI_CHAT_PROVIDER;
                return {
                    label: `${type} Model`,
                    config_key,
                    type: 'radio' as const,
                    value: context[`${modelProvider.toUpperCase()}_MODELS`],
                    callback: updateModels,
                };
            }),
            {
                label: 'Envs',
                config_key: 'ENVS',
                type: 'radio' as const,
                value: envs,
            },
            {
                label: 'Text Handler',
                config_key: '',
                type: 'radio',
                value: [{
                    label: 'Handle Type',
                    config_key: 'TEXT_HANDLE_TYPE',
                    type: 'radio',
                    value: ['tts', 'text', 'chat'],
                }, {
                    label: 'Output',
                    config_key: 'TEXT_OUTPUT',
                    type: 'radio',
                    value: ['audio', 'text'],
                }],
            },
            {
                label: 'Audio Handler',
                config_key: '',
                type: 'radio',
                value: [{
                    label: 'Handle Type',
                    config_key: 'AUDIO_HANDLE_TYPE',
                    type: 'radio',
                    value: ['stt', 'audio', 'chat'],
                }, {
                    label: 'Output',
                    config_key: 'AUDIO_OUTPUT',
                    type: 'radio',
                    value: ['audio', 'text'],
                }],
            },
            // {
            //     label: 'Models',
            //     config_key: '',
            //     value: ['Chat', 'Image', 'Vision', 'Tool'].map((type) => {
            //         const config_key = configKeyHandler(type);
            //         const modelProvider = context[`AI_${type.toUpperCase()}_PROVIDER`] || context.AI_CHAT_PROVIDER;
            //         return {
            //             label: `${type} Model`,
            //             config_key,
            //             type: 'radio',
            //             value: context[`${modelProvider.toUpperCase()}_MODELS`],
            //         };
            //     }),
            // },
        ];
        if (chatAgent === 'openai') {
            inlines.push({
                label: 'OpenAI Tools',
                config_key: 'USE_OPENAI_BUILDIN',
                type: 'checkbox',
                value: context.OPENAI_BUILDIN,
            });
        }
        const result = (ENV.CALLBACK_MENU.length === 0 ? inlines.sort((a, b) => a.label.localeCompare(b.label)) : ENV.CALLBACK_MENU.map(key => inlines.find(inline => inline.config_key.endsWith(key))).filter(Boolean) as InlineItem[]);
        return result;
    };

    settingsMessage = (context: AgentUserConfig, inlines: InlineItem[], { key, callBack, showSensitiveValues = false }: { key?: string; callBack: string | InlineItem; showSensitiveValues?: boolean }) => {
        let settingMsg = 'Current configuration:\n\n';
        settingMsg += `${inlines.map(({ label, config_key }) => {
            return Object.hasOwn(context, config_key) ? `\`${label}: ${context[config_key] || 'Null'}\`` : '';
        }).filter(Boolean).join('\n')}`;
        let configValue = '';
        if (key && typeof callBack === 'string') {
            const newKey = key === 'ENVS' ? callBack : key;
            configValue = context[newKey] || '';
            (typeof configValue !== 'string') && (configValue = JSON.stringify(configValue));
            if (!showSensitiveValues && isSensitiveEnvKey(newKey)) {
                configValue = `${configValue.slice(0, 5)}********${configValue.slice(-2)}`;
            } else if (!showSensitiveValues && (newKey.endsWith('URL') || newKey.endsWith('BASE'))) {
                configValue = `${configValue.slice(0, 12)}********${configValue.slice(-3)}`;
            }
        }

        if (key === 'ENVS' && typeof callBack === 'string') {
            settingMsg += `\n\nSelected variable: \`${callBack || 'None'}\``
                + `\n\nCurrent value: \`${configValue ?? 'None'}\``
                + `\n\n**Tip: Select a variable and reply to this message with the new value.**\n`;
        } else if (key) {
            settingMsg += `\n\nSelected setting: \`${key}\`\nCurrent value: \`${configValue}\``;
        }
        return `${settingMsg.substring(0, 4000)}`;
    };

    inlineKeyboard = (_context: AgentUserConfig, inlines: InlineItem[]): Telegram.InlineKeyboardButton[][] => {
        const inline_keyboard_list = inlines.map(({ label }, index) => ({
            text: label,
            callback_data: index.toString(),
        })) as Telegram.InlineKeyboardButton[];

        return chunkArray(inline_keyboard_list, 3);
    };
}

export class HistoryCommandHandler implements CommandHandler {
    command = '/history';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.whiteList;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const length = Number.parseInt(subcommand.trim()) || ENV.STORE_HISTORY_LENGTH;
        const history = await loadHistory(context.SHARE_CONTEXT.chatHistoryKey, length);
        return sender.sendDocument(new File([JSON.stringify(history, null, 2)], 'history.json', { type: 'application/json' }));
    };
}

export class MapCommandHandler extends RenewConfig {
    command = '/map';
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        subcommand = subcommand.trim();
        let type = 'value';
        if (subcommand.startsWith('key')) {
            type = 'key';
        }

        const setKey = `MAPPING_${type.toUpperCase()}`;
        if (subcommand === '') {
            const msg = 'Usage:\n'
                + `- Add mappings: /map [type] +key:value (without + it also adds; separate multiple mappings with spaces)\n`
                + `- Remove mappings: /map [type] -key\n`
                + `- View mappings: /map [type]\n`
                + `- Clear mappings: /map [type] clear\n\n`
                + `Available type values: key, value. They map to MAPPING\\_KEY and MAPPING\\_VALUE. Without a type, the default is ${setKey}.`;
            return this.send(msg, sender);
        }
        const mappedTip = (map: Map<string, string>) => `Current mappings:\n${Array.from(map.entries()).map(([key, value]) => `- \`${key}\` -> \`${value}\``).join('\n')}`;

        if (/^(?:key|value)$/.test(subcommand)) {
            subcommand = subcommand.replace(/^key|value/, '').trim();
            const map = this.getMaps(context.USER_CONFIG[setKey]);
            const msg = map.size > 0 ? mappedTip(map) : `${setKey} is empty`;
            return this.send(msg, sender);
        }
        subcommand = subcommand.replace(/^key|value/, '').trim();
        if (subcommand === 'clear') {
            this.store({ [setKey]: '' }, context);
            return this.send(`${setKey} was cleared`, sender);
        }
        const mapString = context.USER_CONFIG[setKey];
        const currentMap = this.getMaps(mapString);
        const maps = subcommand.split(' ').map(i => i.trim().split(':'));
        maps.forEach(([key, value]) => {
            if (key.startsWith('-')) {
                currentMap.delete(key.replace(/^-/, ''));
            } else {
                currentMap.set(key.replace(/^\+/, ''), value);
            }
        });
        this.store({ [setKey]: Array.from(currentMap.entries()).map(([key, value]) => `${key}:${value}`).join('|') }, context);
        const msg = `${type} mappings updated\n${mappedTip(currentMap)}`;
        return this.send(msg, sender);
    };

    getMaps = (mapString: string) => {
        if (mapString === '') {
            return new Map();
        }
        return new Map(mapString.split('|').map((item: string) => [item.split(':')[0].replace(/^-/, ''), item.split(':')[1]]));
    };

    send = (msg: string, sender: MessageSender) => {
        return sender.sendRichText(msg, 'MarkdownV2', 'tip', {
            addQuote: true,
            quoteExpandable: true,
        });
    };
}

export class TTSCommandHandler implements CommandHandler {
    command = '/tts';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        if (ENV.EXTRA_MESSAGE_CONTEXT && message.reply_to_message?.from?.id !== context.SHARE_CONTEXT.botId) {
            const reply_text = message.reply_to_message?.text || message.reply_to_message?.caption || '';
            reply_text && (subcommand = subcommand.substring(0, subcommand.length - (reply_text.length + '\n> '.length)));
        }
        const { flags, remainingText } = tokenizeSubcommand(subcommand);
        if (remainingText === '') {
            return sender.sendPlainText('Please input your text');
        }
        const agentName = context.USER_CONFIG.AI_TTS_PROVIDER;
        for (const { flag, value } of flags) {
            if (flag === 'v') {
                context.USER_CONFIG[`${agentName.toUpperCase()}_TTS_VOICE`] = value;
            }
        }
        await sender.sendPlainText(`Using agent ${context.USER_CONFIG.AI_TTS_PROVIDER} to generate audio...`);
        const audio = await tts(remainingText, context.USER_CONFIG);
        console.log(`audio size: ${(audio.size / 1024 / 1024).toFixed(3)}mb`);
        sendAction(context.SHARE_CONTEXT.botToken, sender.context.chat_id, 'upload_voice');
        const resp = await sender.sendVoice(audio, context.USER_CONFIG.AUDIO_CONTAINS_TEXT ? remainingText : undefined);
        if (resp.ok) {
            return sender.api.deleteMessage({ chat_id: sender.context.chat_id, message_id: sender.context.message_id! });
        }
        throw new Error(`Failed to send voice message: ${resp.status} ${await resp.json().then(j => j.description)}`);
    };
}

export class BlockUserCommandHandler implements CommandHandler {
    command = '/block';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.whiteList;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const replyId = message.reply_to_message?.from?.id;
        let blockedId = replyId?.toString() ?? '';

        let op = '+';
        if (subcommand) {
            const [, operator, id] = subcommand.trim().match(/^([+-]?)(\d+)?/) ?? [];
            id && (blockedId = id);
            op = operator || '+';
        }
        if (!blockedId) {
            return sender.sendPlainText('Please input a valid user id');
        }
        if (ENV.CHAT_WHITE_LIST.includes(blockedId) && op === '+') {
            return sender.sendPlainText('You cannot block a user in the chat whitelist');
        }
        if (blockedId === context.SHARE_CONTEXT.botId.toString()) {
            return sender.sendPlainText('You cannot block the bot');
        }
        const blocklist = context.USER_CONFIG.BLOCKLIST;
        if (blocklist.includes(blockedId) && op === '+') {
            return sender.sendRichText(`User \`${blockedId}\` has already been blocked`, 'MarkdownV2', 'tip');
        }
        if (!blocklist.includes(blockedId) && op === '-') {
            return sender.sendRichText(`User \`${blockedId}\` is not in the blocklist`, 'MarkdownV2', 'tip');
        }

        if (op === '+') {
            blocklist.push(blockedId);
        } else {
            context.USER_CONFIG.BLOCKLIST = blocklist.filter(id => id !== blockedId);
        }
        context.USER_CONFIG.DEFINE_KEYS.push('BLOCKLIST');
        context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
        await ENV.REDIS.put(
            context.SHARE_CONTEXT.configStoreKey,
            JSON.stringify(ConfigMerger.trim(context.USER_CONFIG)),
        );
        return sender.sendRichText(`${op === '+' ? 'Blocked' : 'Unblocked'} user ${replyId ?? message.reply_to_message!.from!.first_name ?? ''}, id: \`${blockedId}\``, 'MarkdownV2', 'tip');
    };
}

export class BlocklistCommandHandler implements CommandHandler {
    command = '/blocklist';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.whiteList;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const blocklist = context.USER_CONFIG.BLOCKLIST;
        const isClear = subcommand.trim() === 'clear';
        if (isClear) {
            context.USER_CONFIG.BLOCKLIST = [];
            await ENV.REDIS.put(
                context.SHARE_CONTEXT.configStoreKey,
                JSON.stringify(ConfigMerger.trim(context.USER_CONFIG)),
            );
            return sender.sendRichText(`Blocked users cleared`, 'MarkdownV2', 'tip');
        }
        let tip = 'No blocked users';
        if (blocklist.length > 0) {
            tip = `Blocked users:\n${blocklist.map(id => `- \`${id}\``).join('\n')}`;
        }
        return sender.sendRichText(tip, 'MarkdownV2', 'tip', {
            addQuote: true,
            quoteExpandable: true,
        });
    };
}
