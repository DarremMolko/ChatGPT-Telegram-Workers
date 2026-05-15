import type * as Telegram from 'telegram-bot-api-types';
import type { TTSRequestOptions } from '../../agent/types';
import type { WorkerContext } from '../../config/context';
import type { MessageSender } from '../utils/send';
import type { CommandHandler } from './types';
import { loadHistory } from '../../agent/chat';
import { ENV } from '../../config/env';
import { ConfigMerger } from '../../config/merger';
import { addRuntimeAdmin, isOwner, isPrivilegedUser, removeRuntimeAdmin } from '../access';
import { mergeLogMessages, stt, tts } from '../utils/media';
import { sendAction } from '../utils/send';
import { getMessageText, getMessageTextWithoutBotShowInfo, getTelegramFile, stripMergedQuoteFromCommandText } from '../utils/tg_utils';

export class HistoryCommandHandler implements CommandHandler {
    command = '/history';
    scopes: Array<'all_private_chats' | 'all_chat_administrators'> = ['all_private_chats', 'all_chat_administrators'];
    needAuth = () => ['owner'];
    handle = async (_message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        const length = Number.parseInt(subcommand.trim()) || ENV.STORE_HISTORY_LENGTH;
        const history = await loadHistory(context.SHARE_CONTEXT.chatHistoryKey, length);
        return sender.sendDocument(new File([JSON.stringify(history, null, 2)], 'history.json', { type: 'application/json' }));
    };
}

export class TTSCommandHandler implements CommandHandler {
    command = '/tts';
    scopes: Array<'all_private_chats' | 'all_chat_administrators'> = ['all_private_chats', 'all_chat_administrators'];
    needAuth = () => ['admin'];
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
    scopes: Array<'all_private_chats' | 'all_chat_administrators'> = ['all_private_chats', 'all_chat_administrators'];
    needAuth = () => ['admin'];
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

function markUserConfigKey(context: WorkerContext, key: string): void {
    context.USER_CONFIG.DEFINE_KEYS.push(key);
    context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
}

async function storeUserConfig(context: WorkerContext): Promise<void> {
    await ENV.REDIS.put(
        context.SHARE_CONTEXT.configStoreKey,
        JSON.stringify(ConfigMerger.trim(context.USER_CONFIG)),
    );
}

export class PromoteCommandHandler implements CommandHandler {
    command = '/promote';
    scopes: Array<'all_private_chats' | 'all_chat_administrators'> = ['all_private_chats', 'all_chat_administrators'];
    needAuth = () => ['owner'];
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
    scopes: Array<'all_private_chats' | 'all_chat_administrators'> = ['all_private_chats', 'all_chat_administrators'];
    needAuth = () => ['owner'];
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
    scopes: Array<'all_private_chats' | 'all_chat_administrators'> = ['all_private_chats', 'all_chat_administrators'];
    needAuth = () => ['owner'];
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
    scopes: Array<'all_private_chats' | 'all_chat_administrators'> = ['all_private_chats', 'all_chat_administrators'];
    needAuth = () => ['owner'];
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
    scopes: Array<'all_private_chats' | 'all_chat_administrators'> = ['all_private_chats', 'all_chat_administrators'];
    needAuth = () => ['owner'];
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

function tokenizeTTSSubcommand(subcommand: string): { flags: { flag: string; value: string | undefined }[]; remainingText: string } {
    return tokenizeKnownFlags(subcommand, new Set(['-v', '-i', '-instructions']));
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

    return {
        flags,
        remainingText: remainingTokens.join(' ').trim(),
    };
}
