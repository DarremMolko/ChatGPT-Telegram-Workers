/* eslint-disable no-cond-assign */
import type { UserModelMessage } from 'ai';
import type * as Telegram from 'telegram-bot-api-types';
import type { HistoryItem, LLMChatRequestParams } from '../../agent/types';
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
import { canManageRuntimeConfigForAccess, canViewSensitiveConfigForAccess, isOwner, isSensitiveRuntimeConfigKey, resolveRuntimeConfigAccessLevel, resolveUserAccess } from '../access';
import { createTelegramBotAPI } from '../api';
import { chatWithLLM } from '../handler/chat';
import { cancelActiveRequests, getActiveRequestCount } from '../utils/active_request';
import { sendImages } from '../utils/media';
import { buildRenderedTextParams, checkIsNeedTagIds, sendAction } from '../utils/send';
import { chunkArray, getTelegramFile, stripMergedQuoteFromCommandText } from '../utils/tg_utils';
import { sendCommandError } from './error';

export {
    BlocklistCommandHandler,
    BlockUserCommandHandler,
    DemoteCommandHandler,
    HistoryCommandHandler,
    PromoteCommandHandler,
    STTCommandHandler,
    TTSCommandHandler,
    UnblockUserCommandHandler,
} from './system_extras';

export const COMMAND_AUTH_CHECKER = {
    admin(_chatType: string): string[] {
        return ['admin'];
    },
    owner(_chatType: string): string[] {
        return ['owner'];
    },
};

export const SYSTEM_PANEL_PREFIX = 'system:';

export type SystemPanelSection
    = | 'summary'
        | 'stats'
        | 'agent'
        | 'other'
        | 'dev_config'
        | 'chat_context'
        | 'share_context';

const SYSTEM_PANEL_LABELS: Record<SystemPanelSection, string> = {
    summary: 'Summary',
    stats: 'Usage',
    agent: 'Agents',
    other: 'Other',
    dev_config: 'Dev Config',
    chat_context: 'Chat Ctx',
    share_context: 'Share Ctx',
};

function isSystemPanelSection(value: string): value is SystemPanelSection {
    return value in SYSTEM_PANEL_LABELS;
}

function buildSystemDebugMessageContext(message: Telegram.Message) {
    return {
        chat_id: message.chat.id,
        message_id: message.message_id ?? null,
        reply_to_message_id: message.reply_to_message?.message_id ?? null,
        message_thread_id: message.message_thread_id ?? null,
        chatType: message.chat.type,
        sentMessageIds: [],
    };
}

function buildSectionCodeBlock(title: string, value: unknown): string {
    return `*${title}*\n\`\`\`\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

interface SystemPanelSnapshot {
    stats: ReturnType<typeof getStats>;
    agent: Record<string, unknown>;
    otherInfo: unknown;
    activeRequests: number;
    build: {
        sha: string;
        timestamp: number;
        formattedTime: string;
    };
    dev: null | {
        userConfig: Record<string, unknown>;
        chatContext: Record<string, unknown>;
        shareContext: Record<string, unknown>;
    };
}

async function collectSystemPanelSnapshot(context: Pick<WorkerContext, 'USER_CONFIG' | 'SHARE_CONTEXT'>, message: Telegram.Message): Promise<SystemPanelSnapshot> {
    const stats = getStats(String(context.SHARE_CONTEXT.botId));
    const chatAgent = describeAgentConfig(context.USER_CONFIG.AI_CHAT_PROVIDER, context as WorkerContext, CHAT_AGENTS);
    const imageAgent = describeAgentConfig(context.USER_CONFIG.AI_IMAGE_PROVIDER, context as WorkerContext, IMAGE_AGENTS);
    const asrAgent = describeAgentConfig(context.USER_CONFIG.AI_ASR_PROVIDER, context as WorkerContext, ASR_AGENTS);
    const ttsAgent = describeAgentConfig(context.USER_CONFIG.AI_TTS_PROVIDER, context as WorkerContext, TTS_AGENTS);
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
    const build = {
        sha: ENV.BUILD_VERSION,
        timestamp: ENV.BUILD_TIMESTAMP,
        formattedTime: formatLocalDateTime(new Date(ENV.BUILD_TIMESTAMP * 1000)),
    };
    const activeRequests = context.SHARE_CONTEXT.chatHistoryKey
        ? getActiveRequestCount(context.SHARE_CONTEXT.chatHistoryKey)
        : 0;

    let dev: SystemPanelSnapshot['dev'] = null;
    if (ENV.DEV_MODE) {
        const shareContext = { ...context.SHARE_CONTEXT } as Record<string, unknown>;
        shareContext.botToken = '******';

        const userConfig = ConfigMerger.trim(structuredClone(context.USER_CONFIG)) as Record<string, unknown>;
        if (Array.isArray(userConfig.OPENAI_API_KEY)) {
            userConfig.OPENAI_API_KEY = ['******'];
        }
        if (typeof userConfig.OAILIKE_API_KEY === 'string' && userConfig.OAILIKE_API_KEY) {
            userConfig.OAILIKE_API_KEY = '******';
        }

        dev = {
            userConfig,
            chatContext: buildSystemDebugMessageContext(message),
            shareContext,
        };
    }

    return {
        stats,
        agent,
        otherInfo,
        activeRequests,
        build,
        dev,
    };
}

export async function renderSystemPanel(context: Pick<WorkerContext, 'USER_CONFIG' | 'SHARE_CONTEXT'>, message: Telegram.Message, section: SystemPanelSection = 'summary'): Promise<string> {
    const snapshot = await collectSystemPanelSnapshot(context, message);
    const title = SYSTEM_PANEL_LABELS[section];

    if (section === 'stats') {
        return `*System*\nSelected view: \`${title}\`\n\n`
            + `*Usage Statistics*\n`
            + `Total Users: \`${snapshot.stats.totalUsers}\`\n`
            + `Total Groups: \`${snapshot.stats.totalGroups}\`\n`
            + `Total Messages: \`${snapshot.stats.totalMessages}\`\n`
            + `Today Messages: \`${snapshot.stats.todayMessages}\`\n`
            + `Active Requests In This Chat: \`${snapshot.activeRequests}\`\n\n`
            + `*Build*\n`
            + `SHA: \`${snapshot.build.sha}\`\n`
            + `Time: \`${snapshot.build.formattedTime}\``;
    }

    if (section === 'agent') {
        return `*System*\nSelected view: \`${title}\`\n\n${buildSectionCodeBlock('Agent', snapshot.agent)}`;
    }

    if (section === 'other') {
        return `*System*\nSelected view: \`${title}\`\n\n${buildSectionCodeBlock('Other', snapshot.otherInfo)}`;
    }

    if (section === 'dev_config') {
        return `*System*\nSelected view: \`${title}\`\n\n${buildSectionCodeBlock('Dev User Config', snapshot.dev?.userConfig || {})}`;
    }

    if (section === 'chat_context') {
        return `*System*\nSelected view: \`${title}\`\n\n${buildSectionCodeBlock('Chat Context', snapshot.dev?.chatContext || {})}`;
    }

    if (section === 'share_context') {
        return `*System*\nSelected view: \`${title}\`\n\n${buildSectionCodeBlock('Share Context', snapshot.dev?.shareContext || {})}`;
    }

    return `*System*\nSelected view: \`${title}\`\n\n`
        + `*Usage Statistics*\n`
        + `Total Users: \`${snapshot.stats.totalUsers}\`\n`
        + `Total Groups: \`${snapshot.stats.totalGroups}\`\n`
        + `Total Messages: \`${snapshot.stats.totalMessages}\`\n`
        + `Today Messages: \`${snapshot.stats.todayMessages}\`\n`
        + `Active Requests In This Chat: \`${snapshot.activeRequests}\`\n\n`
        + `*Agent Summary*\n`
        + `Chat: \`${snapshot.agent.AI_CHAT_PROVIDER}\`\n`
        + `Chat Model: \`${snapshot.agent[Object.keys(snapshot.agent).find(key => key.endsWith('CHAT_MODEL')) || 'TOOL_MODEL']}\`\n`
        + `Tool Model: \`${snapshot.agent.TOOL_MODEL}\`\n`
        + `Image: \`${snapshot.agent.AI_IMAGE_PROVIDER}\`\n`
        + `ASR: \`${snapshot.agent.AI_ASR_PROVIDER}\`\n`
        + `TTS: \`${snapshot.agent.AI_TTS_PROVIDER}\`\n\n`
        + `*Build*\n`
        + `SHA: \`${snapshot.build.sha}\`\n`
        + `Time: \`${snapshot.build.formattedTime}\``;
}

export function buildSystemInlineKeyboard(userId: number, selected: SystemPanelSection = 'summary'): Telegram.InlineKeyboardButton[][] {
    const sections = (Object.keys(SYSTEM_PANEL_LABELS) as SystemPanelSection[])
        .filter(section => ENV.DEV_MODE || (
            !section.startsWith('dev_')
            && section !== 'chat_context'
            && section !== 'share_context'
        ));
    const rows = chunkArray(sections.map(section => ({
        text: `${section === selected ? '✅ ' : ''}${SYSTEM_PANEL_LABELS[section]}`,
        callback_data: `${SYSTEM_PANEL_PREFIX}view:${section}`,
    })), 3) as Telegram.InlineKeyboardButton[][];
    rows.unshift([{
        text: 'System',
        callback_data: `${userId}.system`,
    }]);
    rows.push([
        {
            text: '🔄',
            callback_data: `${SYSTEM_PANEL_PREFIX}refresh:${selected}`,
        },
        {
            text: '❌',
            callback_data: 'close',
        },
    ]);
    return rows;
}

export function parseSystemPanelCallback(data: string): { action: 'view' | 'refresh'; section: SystemPanelSection } | null {
    const [prefix, action, section] = data.split(':');
    if (prefix !== SYSTEM_PANEL_PREFIX.slice(0, -1)) {
        return null;
    }
    if ((action !== 'view' && action !== 'refresh') || !section || !isSystemPanelSection(section)) {
        return null;
    }
    return {
        action,
        section,
    };
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

function tokenizeKnownFlags(subcommand: string, knownFlags: Set<string>): { flags: { flag: string; value: string | undefined }[]; remainingText: string } {
    const tokens = splitCommandTokens(subcommand);
    const flags: { flag: string; value: string | undefined }[] = [];
    const remainingTokens: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].value;
        if (!knownFlags.has(token)) {
            remainingTokens.push(token);
            continue;
        }

        const nextToken = tokens[i + 1]?.value;
        const hasValue = nextToken !== undefined && !knownFlags.has(nextToken);
        flags.push({
            flag: token.replace(/^-+/, ''),
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

function tokenizeImgSubcommand(subcommand: string): { flags: { flag: string; value: string | undefined }[]; remainingText: string } {
    return tokenizeKnownFlags(subcommand, new Set([
        '-n',
        '--n',
        '--count',
        '--quantity',
        '-s',
        '--s',
        '-size',
        '--size',
        '-m',
        '--m',
        '-model',
        '--model',
        '-q',
        '--q',
        '-quality',
        '--quality',
        '-f',
        '--f',
        '-format',
        '--format',
        '-c',
        '--c',
        '-compression',
        '--compression',
        '-bg',
        '--bg',
        '-background',
        '--background',
        '-mod',
        '--mod',
        '-moderation',
        '--moderation',
        '-if',
        '--if',
        '-input-fidelity',
        '--input-fidelity',
    ]));
}

function tokenizeVisionSubcommand(subcommand: string): { flags: { flag: string; value: string | undefined }[]; remainingText: string } {
    return tokenizeKnownFlags(subcommand, new Set([
        '-p',
        '--p',
        '-prompt',
        '--prompt',
    ]));
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function parseVisionUrlSubcommand(subcommand: string): { urls: string[]; remainingText: string } {
    const tokens = splitCommandTokens(subcommand);
    const urls: string[] = [];
    const remainingTokens: string[] = [];

    for (const token of tokens) {
        if (isHttpUrl(token.value)) {
            urls.push(token.value);
            continue;
        }
        remainingTokens.push(token.value);
    }

    return {
        urls,
        remainingText: remainingTokens.join(' ').trim(),
    };
}

async function initializeCommandHistory(context: WorkerContext): Promise<void> {
    if (ENV.STORE_HISTORY_LENGTH > 0 && context.SHARE_CONTEXT.chatHistoryKey) {
        context.MIDDLE_CONTEXT.history = await loadHistory(context.SHARE_CONTEXT.chatHistoryKey, ENV.STORE_HISTORY_LENGTH);
        return;
    }
    context.MIDDLE_CONTEXT.history = context.MIDDLE_CONTEXT.history || [];
}

export class ImgCommandHandler implements CommandHandler {
    command = '/img';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        if (subcommand === '') {
            return sender.sendPlainText(ENV.I18N.command.help.img);
        }
        try {
            const cleanedSubcommand = ENV.EXTRA_MESSAGE_CONTEXT
                ? stripMergedQuoteFromCommandText(subcommand, message, context.SHARE_CONTEXT.botId)
                : subcommand.trim();
            const { flags, remainingText } = tokenizeImgSubcommand(cleanedSubcommand);
            if (remainingText === '') {
                return sender.sendPlainText('Please input your image prompt');
            }
            const extraParams: Record<string, any> = {};
            if (['image', 'photo'].includes(context.MIDDLE_CONTEXT.messageInfo?.type) && (context.MIDDLE_CONTEXT.messageInfo?.id?.length || 0) > 0) {
                extraParams.referenceImages = await getTelegramFile(context.MIDDLE_CONTEXT.messageInfo.id!, context.SHARE_CONTEXT.botToken, 'base64');
            }
            for (const { flag, value } of flags) {
                if (flag === 'n' || flag === 'count' || flag === 'quantity') {
                    if (value === undefined) {
                        return sender.sendPlainText('Please provide a quantity after -n');
                    }
                    const quantity = Number.parseInt(value, 10);
                    if (!Number.isInteger(quantity) || quantity <= 0) {
                        return sender.sendPlainText('Please provide a positive integer after -n');
                    }
                    extraParams.n = quantity;
                    continue;
                }
                if (flag === 's' || flag === 'size') {
                    if (value === undefined) {
                        return sender.sendPlainText('Please provide a size after -s');
                    }
                    extraParams.size = value;
                    continue;
                }
                if (flag === 'm' || flag === 'model') {
                    if (value === undefined) {
                        return sender.sendPlainText('Please provide a model after -m');
                    }
                    extraParams.model = value;
                    continue;
                }
                if (flag === 'q' || flag === 'quality') {
                    if (value === undefined) {
                        return sender.sendPlainText('Please provide a quality after -q');
                    }
                    extraParams.quality = value;
                    continue;
                }
                if (flag === 'f' || flag === 'format') {
                    if (value === undefined) {
                        return sender.sendPlainText('Please provide an output format after -f');
                    }
                    extraParams.outputFormat = value;
                    continue;
                }
                if (flag === 'c' || flag === 'compression') {
                    if (value === undefined) {
                        return sender.sendPlainText('Please provide an output compression after -c');
                    }
                    const compression = Number.parseInt(value, 10);
                    if (!Number.isInteger(compression) || compression < 0 || compression > 100) {
                        return sender.sendPlainText('Please provide an integer between 0 and 100 after -c');
                    }
                    extraParams.outputCompression = compression;
                    continue;
                }
                if (flag === 'bg' || flag === 'background') {
                    if (value === undefined) {
                        return sender.sendPlainText('Please provide a background after -bg');
                    }
                    extraParams.background = value;
                    continue;
                }
                if (flag === 'mod' || flag === 'moderation') {
                    if (value === undefined) {
                        return sender.sendPlainText('Please provide a moderation mode after -mod');
                    }
                    extraParams.moderation = value;
                    continue;
                }
                if (flag === 'if' || flag === 'input-fidelity') {
                    if (value === undefined) {
                        return sender.sendPlainText('Please provide an input fidelity after -if');
                    }
                    extraParams.inputFidelity = value;
                }
            }
            const agent = loadImageGen(context.USER_CONFIG);
            await sender.sendPlainText('Please wait a moment...');
            sendAction(context.SHARE_CONTEXT.botToken, message.chat.id, 'upload_photo');
            const img = await agent.request(remainingText, context.USER_CONFIG, extraParams);
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

export class VisionCommandHandler implements CommandHandler {
    command = '/vision';
    scopes: ScopeType[] = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const cleanedSubcommand = ENV.EXTRA_MESSAGE_CONTEXT
            ? stripMergedQuoteFromCommandText(subcommand, message, context.SHARE_CONTEXT.botId)
            : subcommand.trim();
        const { flags, remainingText } = tokenizeVisionSubcommand(cleanedSubcommand);
        let promptFlag: string | undefined;
        for (const { flag, value } of flags) {
            if (flag === 'p' || flag === 'prompt') {
                if (value === undefined) {
                    return sender.sendPlainText('Please provide a prompt after -p');
                }
                promptFlag = value;
            }
        }
        const { urls, remainingText: inlinePrompt } = parseVisionUrlSubcommand(remainingText);
        if (urls.length === 0) {
            return sender.sendPlainText('Please provide at least one image URL');
        }
        if (inlinePrompt) {
            return sender.sendPlainText('Please provide the prompt with -p');
        }
        if (!promptFlag) {
            return sender.sendPlainText('Please provide a prompt with -p');
        }

        const params: LLMChatRequestParams = {
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: promptFlag,
                },
                ...urls.map(url => ({
                    type: 'image' as const,
                    image: new URL(url),
                })),
            ],
        };

        await initializeCommandHistory(context);
        return chatWithLLM(message, params, context, null) as unknown as Response;
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
    handle = async (message: Telegram.Message, _subcommand: string, context: WorkerContext, _sender: MessageSender): Promise<Response> => {
        const text = await renderSystemPanel(context, message, 'summary');
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
            ...buildRenderedTextParams('MarkdownV2', text, { quoteExpandable: true, addQuote: true }),
            reply_markup: {
                inline_keyboard: buildSystemInlineKeyboard(message.from!.id, 'summary'),
            },
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
        const msg = `\`\`\`\n${JSON.stringify({ message }, null, 2)}\n\`\`\``;
        return sender.sendRichText(msg, 'MarkdownV2');
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
                return sender.sendRichText(`\`\`\`\n${detailSet}\n\`\`\``, 'MarkdownV2');
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
            return sender.sendRichText(`\`\`\`\n${msg}\n\`\`\``, 'MarkdownV2', 'tip');
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
            ...buildRenderedTextParams('MarkdownV2', settingMsg, { quoteExpandable: true, addQuote: true }),
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
