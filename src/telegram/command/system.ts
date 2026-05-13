/* eslint-disable no-cond-assign */
import type { UserModelMessage } from 'ai';
import type * as Telegram from 'telegram-bot-api-types';
import type { HistoryItem, TTSRequestOptions } from '../../agent/types';
import type { WorkerContext } from '../../config/context';
import type { AgentUserConfig } from '../../config/env';
import type { MessageSender } from '../utils/send';
import type { CommandHandler, InlineItem, ScopeType } from './types';
import { ASR_AGENTS, CHAT_AGENTS, customInfo, IMAGE_AGENTS, loadImageGen, TTS_AGENTS } from '../../agent';
import { resolveProviderApiBase } from '../../agent/api_base';
import { loadHistory } from '../../agent/chat';
import { updateModels } from '../../agent/models';
import { ENV } from '../../config/env';
import { ConfigMerger } from '../../config/merger';
import { log } from '../../log';
import { updateMcp } from '../../mcp';
import { formatLocalDateTime } from '../../utils/others/time';
import { getStats } from '../../utils/stats';
import { addRuntimeAdmin, canManageRuntimeConfigForAccess, canViewSensitiveConfigForAccess, isOwner, isPrivilegedUser, isSensitiveRuntimeConfigKey, removeRuntimeAdmin, resolveRuntimeConfigAccessLevel, resolveUserAccess } from '../access';
import { createTelegramBotAPI } from '../api';
import { chatWithLLM, mergeLogMessages, sendImages, stt, tts } from '../handler/chat';
import { cancelActiveRequests, getActiveRequestCount } from '../utils/active_request';
import { escape } from '../utils/md2tgmd';
import { checkIsNeedTagIds, sendAction } from '../utils/send';
import { chunkArray, getMessageText, getMessageTextWithoutBotShowInfo, getTelegramFile, stripMergedQuoteFromCommandText } from '../utils/tg_utils';
import { sendCommandError } from './error';

export const COMMAND_AUTH_CHECKER = {
    admin(_chatType: string): string[] {
        return ['admin'];
    },
    owner(_chatType: string): string[] {
        return ['owner'];
    },
};

function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;');
}

function describeAgentConfig(
    providerName: string | undefined,
    context: WorkerContext,
    agents: Array<{ name: string; modelKey: string; model: (ctx: AgentUserConfig) => string; enable: (ctx: AgentUserConfig) => boolean }>,
) {
    const provider = providerName || 'unknown';
    const agent = agents.find(item => item.name === provider);
    const modelKey = agent?.modelKey || `${provider.toUpperCase()}_MODEL`;
    let model = context.USER_CONFIG[modelKey] || 'not configured';
    let enabled = false;
    if (agent) {
        enabled = agent.enable(context.USER_CONFIG);
        try {
            model = agent.model(context.USER_CONFIG);
        } catch (error) {
            model = `ERROR: ${(error as Error).message}`;
        }
    }
    return {
        provider,
        modelKey,
        model,
        enabled,
    };
}

function isSensitiveEnvKey(key: string): boolean {
    return isSensitiveRuntimeConfigKey(key);
}

abstract class RenewConfig implements CommandHandler {
    abstract command: string;
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth: (chatType: string) => string[] | null = COMMAND_AUTH_CHECKER.owner;
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

function splitCommandTokens(text: string): { value: string }[] {
    const tokens: { value: string }[] = [];
    let i = 0;

    while (i < text.length) {
        while (i < text.length && /\s/.test(text[i])) {
            i++;
        }
        if (i >= text.length) {
            break;
        }

        const quote = text[i];
        if (quote === '"' || quote === '\'') {
            i++;
            let value = '';
            while (i < text.length) {
                if (text[i] === quote) {
                    i++;
                    break;
                }
                value += text[i];
                i++;
            }
            tokens.push({ value });
            continue;
        }

        const start = i;
        while (i < text.length && !/\s/.test(text[i])) {
            i++;
        }
        tokens.push({ value: text.slice(start, i) });
    }

    return tokens;
}

function tokenizeTTSSubcommand(subcommand: string): { flags: { flag: string; value: string | undefined }[]; remainingText: string } {
    const tokens = splitCommandTokens(subcommand);
    const flags: { flag: string; value: string | undefined }[] = [];
    const remainingTokens: string[] = [];
    const knownFlags = new Set(['-v', '-i', '-instructions']);

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].value;
        if (!knownFlags.has(token)) {
            remainingTokens.push(token);
            continue;
        }

        const nextToken = tokens[i + 1]?.value;
        const hasValue = nextToken !== undefined && !knownFlags.has(nextToken);
        flags.push({
            flag: token.slice(1),
            value: hasValue ? nextToken : undefined,
        });
        if (hasValue) {
            i++;
        }
    }

    const remainingText = remainingTokens.join(' ').trim();
    log.info(`flags: ${JSON.stringify(flags, null, 2)}, remainingText: ${remainingText}`);
    return { flags, remainingText };
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
            if (['image', 'photo'].includes(context.MIDDLE_CONTEXT.messageInfo?.type) && (context.MIDDLE_CONTEXT.messageInfo?.id?.length || 0) > 0) {
                extraParams.referenceImages = await getTelegramFile(context.MIDDLE_CONTEXT.messageInfo.id!, context.SHARE_CONTEXT.botToken, 'base64');
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
                return sendCommandError(sender, new Error(`${resp.status} ${resp.statusText}\n\n${await resp.text()}`), {
                    redactions: [context.SHARE_CONTEXT.botToken],
                });
            }
            return resp;
        } catch (e) {
            return sendCommandError(sender, e, { redactions: [context.SHARE_CONTEXT.botToken] });
        }
    };
}

export class HelpCommandHandler implements CommandHandler {
    command = '/help';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    handle = async (_message: Telegram.Message, _subcommand: string, _context: WorkerContext, sender: MessageSender): Promise<Response> => {
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
    static async handle(showID: boolean, message: Telegram.Message, _subcommand: string, context: WorkerContext): Promise<Response> {
        await ENV.REDIS.delete(context.SHARE_CONTEXT.chatHistoryKey);
        const text = ENV.I18N.command.new.new_chat_start + (showID ? `(${message.chat.id})` : '');
        const params: Telegram.SendMessageParams = {
            chat_id: message.chat.id,
            message_thread_id: (message.is_topic_message && message.message_thread_id) || undefined,
            text,
            reply_markup: {
                remove_keyboard: true,
                selective: true,
            },
        };
        const resp = createTelegramBotAPI(context.SHARE_CONTEXT.botToken).sendMessage(params);
        return checkIsNeedTagIds({ chatType: message.chat.type, message }, resp, 'tip');
    }
}

export class NewCommandHandler extends BaseNewCommandHandler implements CommandHandler {
    command = '/new';
    scopes: ScopeType[] = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.admin;
    handle = async (message: Telegram.Message, _subcommand: string, context: WorkerContext): Promise<Response> => {
        return BaseNewCommandHandler.handle(false, message, _subcommand, context);
    };
}

export class StartCommandHandler extends BaseNewCommandHandler implements CommandHandler {
    command = '/start';
    handle = async (message: Telegram.Message, _subcommand: string, context: WorkerContext): Promise<Response> => {
        return BaseNewCommandHandler.handle(true, message, _subcommand, context);
    };
}

export class SetEnvCommandHandler extends RenewConfig {
    command = '/setenv';
    handle = async (_message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
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
    handle = async (_message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
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
    handle = async (_message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
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
    handle = async (_message: Telegram.Message, _subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
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
    needAuth = COMMAND_AUTH_CHECKER.admin;
    handle = async (_message: Telegram.Message, _subcommand: string, _context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const current = {
            ts: ENV.BUILD_TIMESTAMP,
            sha: ENV.BUILD_VERSION,
        };
        const timeFormat = (ts: number): string => {
            return formatLocalDateTime(new Date(ts * 1000));
        };
        return sender.sendPlainText(`Current build: ${current.sha} (${timeFormat(current.ts)})`);
    };
}

export class SystemCommandHandler implements CommandHandler {
    command = '/system';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.owner;
    handle = async (_message: Telegram.Message, _subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const stats = getStats(String(context.SHARE_CONTEXT.botId));
        const chatAgent = describeAgentConfig(context.USER_CONFIG.AI_CHAT_PROVIDER, context, CHAT_AGENTS);
        const imageAgent = describeAgentConfig(context.USER_CONFIG.AI_IMAGE_PROVIDER, context, IMAGE_AGENTS);
        const asrAgent = describeAgentConfig(context.USER_CONFIG.AI_ASR_PROVIDER, context, ASR_AGENTS);
        const ttsAgent = describeAgentConfig(context.USER_CONFIG.AI_TTS_PROVIDER, context, TTS_AGENTS);
        const agent = {
            AI_CHAT_PROVIDER: chatAgent.provider,
            [chatAgent.modelKey]: chatAgent.model,
            TOOL_MODEL: context.USER_CONFIG.TOOL_MODEL || 'same as chat model',
            AI_IMAGE_PROVIDER: imageAgent.provider,
            [imageAgent.modelKey]: imageAgent.model,
            AI_ASR_PROVIDER: asrAgent.provider,
            [asrAgent.modelKey]: asrAgent.model,
            AI_TTS_PROVIDER: ttsAgent.provider,
            [ttsAgent.modelKey]: ttsAgent.model,
            VISION_MODEL: context.USER_CONFIG[`${chatAgent.provider.toUpperCase()}_VISION_MODEL`] || `Agent ${chatAgent.provider} not found`,
            PROVIDER_ENABLED: {
                chat: chatAgent.enabled,
                image: imageAgent.enabled,
                asr: asrAgent.enabled,
                tts: ttsAgent.enabled,
            },
        };
        const otherInfo = await customInfo(context.USER_CONFIG, { format: 'object' });
        let msg = `<b>Usage Statistics</b>\n`
            + `Total Users: <code>${stats.totalUsers}</code>\n`
            + `Total Groups: <code>${stats.totalGroups}</code>\n`
            + `Total Messages: <code>${stats.totalMessages}</code>\n`
            + `Today Messages: <code>${stats.todayMessages}</code>\n\n`
            + `<b>Agent</b>\n<pre>${escapeHtml(JSON.stringify(agent, null, 2))}</pre>\n\n`
            + `<b>Other</b>\n<pre>${escapeHtml(JSON.stringify(otherInfo, null, 2))}</pre>`;
        if (ENV.DEV_MODE) {
            const shareCtx = { ...context.SHARE_CONTEXT };
            shareCtx.botToken = '******';
            context.USER_CONFIG.OPENAI_API_KEY = ['******'];
            context.USER_CONFIG.OAILIKE_API_KEY = '******';
            const config = ConfigMerger.trim(context.USER_CONFIG);
            msg += `\n\n<b>Dev User Config</b>\n<pre>${escapeHtml(JSON.stringify(config, null, 2))}</pre>`;
            msg += `\n\n<b>Chat Context</b>\n<pre>${escapeHtml(JSON.stringify(sender.context || {}, null, 2))}</pre>`;
            msg += `\n\n<b>Share Context</b>\n<pre>${escapeHtml(JSON.stringify(shareCtx, null, 2))}</pre>`;
        }
        return sender.sendRichText(msg, 'HTML', 'tip');
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

export class StopCommandHandler implements CommandHandler {
    command = '/stop';
    scopes: ScopeType[] = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];

    handle = async (_message: Telegram.Message, _subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const scopeKey = context.SHARE_CONTEXT.chatHistoryKey;
        if (getActiveRequestCount(scopeKey) <= 0) {
            return sender.sendPlainText('No active response is running.', 'tip');
        }
        const cancelled = cancelActiveRequests(scopeKey);
        if (cancelled <= 0) {
            return sender.sendPlainText('No active response is running.', 'tip');
        }
        const label = cancelled === 1 ? 'response' : 'responses';
        return sender.sendPlainText(`Stopped ${cancelled} active ${label}.`, 'tip');
    };
}

export class CancelCommandHandler extends StopCommandHandler {
    command = '/cancel';
}

export class EchoCommandHandler implements CommandHandler {
    command = '/echo';
    handle = (message: Telegram.Message, _subcommand: string, _context: WorkerContext, sender: MessageSender): Promise<Response> => {
        let msg = '<pre>';
        msg += JSON.stringify({ message }, null, 2);
        msg += '</pre>';
        return sender.sendRichText(msg, 'HTML');
    };
}

export class SetCommandHandler extends RenewConfig implements CommandHandler {
    command = '/set';
    needAuth = COMMAND_AUTH_CHECKER.admin;
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
            this.ensureRuntimeConfigAccess(message, updatedKeys);
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
            return sendCommandError(sender, e, { redactions: [context.SHARE_CONTEXT.botToken] });
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
                // Preserve additional ':' characters inside the mapped value.
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

        // If the value is empty, fall back to the global default.
        ConfigMerger.merge(context.USER_CONFIG, { [key]: mappedValue || ENV.USER_CONFIG[key] });
        if (!context.USER_CONFIG.DEFINE_KEYS.includes(key) && mappedValue) {
            context.USER_CONFIG.DEFINE_KEYS.push(key);
        } else if (!mappedValue) {
            context.USER_CONFIG.DEFINE_KEYS = context.USER_CONFIG.DEFINE_KEYS.filter(k => k !== key);
        }
        log.info(`/set ${key} ${(JSON.stringify(mappedValue) || value || '').substring(0, 100)}...`);
        return key;
    }

    private ensureRuntimeConfigAccess(message: Telegram.Message, keys: string[]) {
        if (keys.length === 0) {
            return;
        }
        if (resolveRuntimeConfigAccessLevel(keys) === 'owner' && !isOwner(message.from?.id)) {
            throw new Error('Permission denied, need owner');
        }
    }
}

export class InlineCommandHandler implements CommandHandler {
    command = '/settings';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.admin;
    handle = async (message: Telegram.Message, _subcommand: string, context: WorkerContext, _sender?: MessageSender): Promise<Response> => {
        const access = await resolveUserAccess(message.from?.id, context.SHARE_CONTEXT.botId);
        const showSensitiveValues = canViewSensitiveConfigForAccess(access);
        const defaultInlines = await this.defaultInlines(context.USER_CONFIG, { access });
        const settingMsg = this.settingsMessage(context.USER_CONFIG, defaultInlines, { callBack: '', showSensitiveValues });
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
            ...(message.chat.type === 'private'
                ? {}
                : {
                        reply_parameters: {
                            message_id: message.message_id,
                            chat_id: message.chat.id,
                        },
                    }),
            text: escape(settingMsg, { quoteExpandable: true, addQuote: true }),
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [headKeyboard, ...this.inlineKeyboard(context.USER_CONFIG, defaultInlines), closeKeyboard],
            },
        });
    };

    defaultInlines = async (context: AgentUserConfig, options: { access?: Awaited<ReturnType<typeof resolveUserAccess>> } = {}): Promise<InlineItem[]> => {
        const allChatAgents = CHAT_AGENTS.map(agent => agent.name);
        const allImageAgents = IMAGE_AGENTS.map(agent => agent.name);
        const allTTSAgents = TTS_AGENTS.map(agent => agent.name);
        const allASRAgents = ASR_AGENTS.map(agent => agent.name);
        const chatAgent = context.AI_CHAT_PROVIDER;
        const access = options.access ?? { userId: '', isOwner: false, isAdmin: false };
        const showSensitiveValues = canViewSensitiveConfigForAccess(access);
        const configKeyHandler = (type: string) => {
            if (type === 'Tool') {
                return 'TOOL_MODEL';
            }
            const agent = context[`AI_${(type === 'Image' ? 'IMAGE' : 'CHAT')}_PROVIDER`];
            return `${agent.toUpperCase()}_${type.toUpperCase()}_MODEL`;
        };
        const envs = (showSensitiveValues
            ? Object.keys(context)
            : (ENV.ENVS_VARIABLES.length === 0 ? Object.keys(context) : ENV.ENVS_VARIABLES)
                    .filter(key => canManageRuntimeConfigForAccess(access, key)));
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
        ];
        if ((chatAgent === 'openai' || chatAgent === 'oailike') && resolveProviderApiBase(chatAgent, context).llmMode === 'responses') {
            inlines.push({
                label: 'Responses Tools',
                config_key: 'USE_OPENAI_BUILDIN',
                type: 'checkbox',
                value: context.OPENAI_BUILDIN,
            });
        }
        const filteredInlines = inlines.filter((inline) => {
            if (inline.config_key === 'ENVS') {
                return inline.value.length > 0;
            }
            return inline.config_key === ''
                || canManageRuntimeConfigForAccess(access, inline.config_key);
        });
        const result = (ENV.CALLBACK_MENU.length === 0 ? filteredInlines.sort((a, b) => a.label.localeCompare(b.label)) : ENV.CALLBACK_MENU.map(key => filteredInlines.find(inline => inline.config_key.endsWith(key))).filter(Boolean) as InlineItem[]);
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
    needAuth = COMMAND_AUTH_CHECKER.owner;
    handle = async (_message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const length = Number.parseInt(subcommand.trim()) || ENV.STORE_HISTORY_LENGTH;
        const history = await loadHistory(context.SHARE_CONTEXT.chatHistoryKey, length);
        return sender.sendDocument(new File([JSON.stringify(history, null, 2)], 'history.json', { type: 'application/json' }));
    };
}

export class MapCommandHandler extends RenewConfig {
    command = '/map';
    handle = async (_message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
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
    needAuth = COMMAND_AUTH_CHECKER.admin;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const cleanedSubcommand = ENV.EXTRA_MESSAGE_CONTEXT
            ? stripMergedQuoteFromCommandText(subcommand, message, context.SHARE_CONTEXT.botId)
            : subcommand.trim();
        const { flags, remainingText } = tokenizeTTSSubcommand(cleanedSubcommand);
        const replyText = (
            message.reply_to_message?.from?.id === Number(context.SHARE_CONTEXT.botId)
                ? getMessageTextWithoutBotShowInfo(message.reply_to_message)
                : getMessageText(message.reply_to_message)
        ).trim();
        const text = remainingText || replyText;
        if (text === '') {
            return sender.sendPlainText('Please input your text or reply to a message');
        }
        const agentName = context.USER_CONFIG.AI_TTS_PROVIDER;
        let requestOptions: TTSRequestOptions | undefined;
        for (const { flag, value } of flags) {
            if (flag === 'v') {
                if (value === undefined) {
                    return sender.sendPlainText('Please provide a voice after -v');
                }
                context.USER_CONFIG[`${agentName.toUpperCase()}_TTS_VOICE`] = value;
            } else if (flag === 'i' || flag === 'instructions') {
                if (value === undefined) {
                    return sender.sendPlainText('Please provide instructions after -i');
                }
                requestOptions = { instructions: value };
            }
        }
        await sender.sendPlainText(`Using agent ${context.USER_CONFIG.AI_TTS_PROVIDER} to generate audio...`);
        const audio = requestOptions
            ? await tts(text, context.USER_CONFIG, requestOptions)
            : await tts(text, context.USER_CONFIG);
        console.log(`audio size: ${(audio.size / 1024 / 1024).toFixed(3)}mb`);
        sendAction(context.SHARE_CONTEXT.botToken, sender.context.chat_id, 'upload_voice');
        const resp = await sender.sendVoice(audio, context.USER_CONFIG.AUDIO_CONTAINS_TEXT ? text : undefined);
        if (resp.ok) {
            return sender.api.deleteMessage({ chat_id: sender.context.chat_id, message_id: sender.context.message_id! });
        }
        throw new Error(`Failed to send voice message: ${resp.status} ${await resp.json().then(j => j.description)}`);
    };
}

export class STTCommandHandler implements CommandHandler {
    command = '/stt';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.admin;
    handle = async (_message: Telegram.Message, _subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const messageInfo = context.MIDDLE_CONTEXT.messageInfo;
        if (!messageInfo?.id?.length || !['audio', 'voice'].includes(messageInfo.type)) {
            return sender.sendPlainText('Please send or reply to an audio or voice message');
        }

        await sender.sendPlainText(`Using agent ${context.USER_CONFIG.AI_ASR_PROVIDER} to transcribe audio...`);
        const [audio] = await getTelegramFile(messageInfo.id, context.SHARE_CONTEXT.botToken, 'blob') as Blob[];
        if (!audio) {
            throw new Error('Audio file not found');
        }

        const text = await stt(audio, context.USER_CONFIG);
        return sender.sendRichText(mergeLogMessages(text, context.USER_CONFIG));
    };
}

function resolveTargetUser(message: Telegram.Message, subcommand: string): { targetId: string; targetUser?: Telegram.User } {
    const replyUser = message.reply_to_message?.from;
    const explicitId = subcommand.trim().match(/^[+-]?(\d+)/)?.[1] || '';
    return {
        targetId: explicitId || (replyUser?.id?.toString() ?? ''),
        targetUser: !explicitId || explicitId === replyUser?.id?.toString() ? replyUser : undefined,
    };
}

function describeTargetUser(targetId: string, targetUser?: Telegram.User): string {
    if (!targetUser) {
        return `user ${targetId}`;
    }
    if (targetUser.username) {
        return `@${targetUser.username} (${targetId})`;
    }
    const name = [targetUser.first_name, targetUser.last_name].filter(Boolean).join(' ');
    return name ? `${name} (${targetId})` : `user ${targetId}`;
}

async function storeUserConfig(context: WorkerContext): Promise<void> {
    await ENV.REDIS.put(
        context.SHARE_CONTEXT.configStoreKey,
        JSON.stringify(ConfigMerger.trim(context.USER_CONFIG)),
    );
}

function markUserConfigKey(context: WorkerContext, key: string): void {
    context.USER_CONFIG.DEFINE_KEYS.push(key);
    context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
}

export class PromoteCommandHandler implements CommandHandler {
    command = '/promote';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.owner;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const { targetId, targetUser } = resolveTargetUser(message, subcommand);
        if (!targetId) {
            return sender.sendPlainText('Reply to a user or provide a valid user id');
        }
        if (targetId === context.SHARE_CONTEXT.botId.toString()) {
            return sender.sendPlainText('You cannot promote the bot');
        }
        if (isOwner(targetId)) {
            return sender.sendPlainText('The owner already has full access');
        }
        if (await isPrivilegedUser(targetId, context.SHARE_CONTEXT.botId)) {
            return sender.sendPlainText(`${describeTargetUser(targetId, targetUser)} is already an admin`);
        }
        await addRuntimeAdmin(targetId, context.SHARE_CONTEXT.botId);
        return sender.sendPlainText(`Promoted ${describeTargetUser(targetId, targetUser)} to admin`);
    };
}

export class DemoteCommandHandler implements CommandHandler {
    command = '/demote';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.owner;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const { targetId, targetUser } = resolveTargetUser(message, subcommand);
        if (!targetId) {
            return sender.sendPlainText('Reply to a user or provide a valid user id');
        }
        if (isOwner(targetId)) {
            return sender.sendPlainText('You cannot demote the owner');
        }
        const result = await removeRuntimeAdmin(targetId, context.SHARE_CONTEXT.botId);
        if (result.blockedByConfig) {
            return sender.sendPlainText(`${describeTargetUser(targetId, targetUser)} is pinned in ADMIN_WHITE_LIST and cannot be demoted at runtime`);
        }
        if (!result.removed) {
            return sender.sendPlainText(`${describeTargetUser(targetId, targetUser)} is not a runtime admin`);
        }
        return sender.sendPlainText(`Demoted ${describeTargetUser(targetId, targetUser)} from admin`);
    };
}

export class BlockUserCommandHandler implements CommandHandler {
    command = '/block';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.owner;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const { targetId, targetUser } = resolveTargetUser(message, subcommand);
        if (!targetId) {
            return sender.sendPlainText('Reply to a user or provide a valid user id');
        }
        if (await isPrivilegedUser(targetId, context.SHARE_CONTEXT.botId)) {
            return sender.sendPlainText('You cannot block the owner or an admin');
        }
        if (targetId === context.SHARE_CONTEXT.botId.toString()) {
            return sender.sendPlainText('You cannot block the bot');
        }
        const blocklist = context.USER_CONFIG.BLOCKLIST;
        if (blocklist.includes(targetId)) {
            return sender.sendPlainText(`${describeTargetUser(targetId, targetUser)} has already been blocked`);
        }

        blocklist.push(targetId);
        markUserConfigKey(context, 'BLOCKLIST');
        await storeUserConfig(context);
        return sender.sendPlainText(`Blocked ${describeTargetUser(targetId, targetUser)}`);
    };
}

export class UnblockUserCommandHandler implements CommandHandler {
    command = '/unblock';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.owner;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const { targetId, targetUser } = resolveTargetUser(message, subcommand);
        if (!targetId) {
            return sender.sendPlainText('Reply to a user or provide a valid user id');
        }
        const blocklist = context.USER_CONFIG.BLOCKLIST;
        if (!blocklist.includes(targetId)) {
            return sender.sendPlainText(`${describeTargetUser(targetId, targetUser)} is not in the blocklist`);
        }

        context.USER_CONFIG.BLOCKLIST = blocklist.filter(id => id !== targetId);
        markUserConfigKey(context, 'BLOCKLIST');
        await storeUserConfig(context);
        return sender.sendPlainText(`Unblocked ${describeTargetUser(targetId, targetUser)}`);
    };
}

export class BlocklistCommandHandler implements CommandHandler {
    command = '/blocklist';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.owner;
    handle = async (_message: Telegram.Message, _subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const blocklist = context.USER_CONFIG.BLOCKLIST;
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
