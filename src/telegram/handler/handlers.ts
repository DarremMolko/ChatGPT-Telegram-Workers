import type * as Telegram from 'telegram-bot-api-types';
import type { ImageResult } from '../../agent/types';
import type { WorkerContextBase } from '../../config/context';
import type { UnionData } from '../utils/tg_utils';
import type { MessageHandler } from './types';
import { WorkerContext } from '../../config/context';
import { ENV } from '../../config/env';
import { log, tagMessageIds } from '../../log';
import { recordUserActivity } from '../../utils/stats';
import { canAccessGroupChat, canUsePrivateChat, isPrivilegedUser } from '../access';
import { createTelegramBotAPI } from '../api';
import { handleCommandMessage } from '../command';
import { isAuthorized } from '../query';
import { renderSingleMessage } from '../utils/rich_text';
import { MessageSender } from '../utils/send';
import { extractMessageInfo, getMergedQuoteText, getMessageText, isTelegramChatTypeGroup } from '../utils/tg_utils';
import { HandleChunkMessage, HandleMediaGroupMessage, substituteMessage } from './msg_trimer';

export class SaveLastMessage implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        if (!ENV.DEBUG_MODE) {
            return null;
        }
        const lastMessageKey = `last_message:${context.SHARE_CONTEXT.chatHistoryKey}`;
        await ENV.REDIS.put(lastMessageKey, JSON.stringify(message));
        return null;
    };
}

export class OldMessageFilter implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        if (!ENV.SAFE_MODE) {
            return null;
        }
        const dedupeKey = `${context.SHARE_CONTEXT.lastMessageKey}:${message.message_id}`;
        const inserted = await ENV.REDIS.put(dedupeKey, '1', {
            condition: 'NX',
            expirationTtl: 60 * 60 * 24,
        }).catch((error) => {
            console.error(error);
            return true;
        });
        if (!inserted) {
            throw new Error('Ignore old message');
        }
        return null;
    };
}

export class EnvChecker implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        if (!ENV.REDIS) {
            return MessageSender
                .from(context.SHARE_CONTEXT.botToken, message)
                .sendPlainText('Redis is not configured');
        }
        return null;
    };
}

export class WhiteListFilter implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);

        // Handle private chat messages.
        if (message.chat.type === 'private') {
            if (!await canUsePrivateChat(message.from?.id ?? message.chat.id, context.SHARE_CONTEXT.botId)) {
                log.error(`[ACCESS] ${message.chat.id} ${message.from?.username ?? message.from?.first_name ?? ''} not allowed in private chat`);
                const text = ENV.I18N.whitelist.not_in_user_whitelist.replace('{ID}', `${message.chat.id}`);
                return sender.sendPlainText(text);
            }
            return null;
        }

        // Handle group chat messages.
        if (isTelegramChatTypeGroup(message.chat.type)) {
            // Group chat bot support is disabled; ignore the message.
            if (!ENV.GROUP_CHAT_BOT_ENABLE) {
                throw new Error('Not support');
            }
            if (!canAccessGroupChat(message.chat.id)) {
                log.error(`[ACCESS] ${message.chat.id} ${message.chat.username ?? ''} not in group allowlist`);
                const text = ENV.I18N.whitelist.not_in_group_whitelist.replace('{ID}', `${message.chat.id}`);
                return sender.sendPlainText(text);
            }
            return null;
        }

        return sender.sendPlainText(
            `Not support chat type: ${message.chat.type}`,
        );
    };
}

export class MessageFilter implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        if (ENV.IGNORE_TEXT_PREFIX && (message.text || message.caption || '').startsWith(ENV.IGNORE_TEXT_PREFIX)) {
            log.info(`[IGNORE MESSAGE] Ignore message`);
            return new Response('success', { status: 200 });
        }
        const messageInfo = extractMessageInfo(message, context.SHARE_CONTEXT.botId);
        const supportMessageType = ENV.SUPPORT_FORMAT;
        const types = [messageInfo.original_type, messageInfo.type];
        if (!types.every(type => supportMessageType.includes(type!))) {
            log.info(`[MESSAGE FILTER] Not supported message type: ${types.join(', ')}`);
            return new Response('success', { status: 200 });
        }
        context.MIDDLE_CONTEXT.messageInfo = messageInfo;
        return null;
    };
}

export class CommandHandler implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | UnionData | ImageResult | null> => {
        if (message.text || message.caption) {
            return await handleCommandMessage(message, context);
        }
        // Ignore non-text messages here.
        return null;
    };
}

export class InitUserConfig implements MessageHandler<WorkerContextBase> {
    handle = async (_message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        Object.assign(context, { USER_CONFIG: (await WorkerContext.from(context.SHARE_CONTEXT, context.MIDDLE_CONTEXT)).USER_CONFIG });
        return null;
    };
}

export class SubstituteHandler implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        if (context.USER_CONFIG.MESSAGE_REPLACER && (message.text || message.caption)) {
            substituteMessage(message, context.USER_CONFIG.MESSAGE_REPLACER);
        }
        return null;
    };
}

export class TagNeedDelete implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        // No tagged messages were recorded.
        if ((tagMessageIds.get(message) ?? new Set()).size === 0) {
            return null;
        }
        const botName = context.SHARE_CONTEXT?.botName;
        if (!botName) {
            throw new Error('Cannot find Bot Name, cannot set scheduled deletion.');
        }

        const chatId = message.chat.id;
        const scheduleDeteleKey = context.SHARE_CONTEXT.scheduleDeteleKey;
        const scheduledData = JSON.parse((await ENV.REDIS.get(scheduleDeteleKey)) || '{}');
        if (!scheduledData[botName]) {
            scheduledData[botName] = {};
        }
        if (!scheduledData[botName][chatId]) {
            scheduledData[botName][chatId] = [];
        }
        const offsetInMillisenconds = ENV.EXPIRED_TIME * 60 * 1000;
        scheduledData[botName][chatId].push({
            id: [...(tagMessageIds.get(message) || [])],
            ttl: Date.now() + offsetInMillisenconds,
        });

        await ENV.REDIS.put(scheduleDeteleKey, JSON.stringify(scheduledData));
        log.info(`[TAG MESSAGE] Record chat ${chatId}, message ids: ${[...(tagMessageIds.get(message) || [])]}`);
        return null;
    };
}

export class ReplyInlineHandler implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        const isMyInlineSetMessage = this.isMyInlineSetMessage(message, context);
        const authorized = isAuthorized(message?.from?.id ?? 0, message.reply_to_message?.reply_markup?.inline_keyboard ?? []);
        if (!isMyInlineSetMessage || !authorized) {
            return null;
        }
        const inlineKeyboard = message.reply_to_message!.reply_markup!.inline_keyboard.flat();
        const variable = inlineKeyboard.find(i => i.text.startsWith('✅'))?.text.split('✅')[1];
        if (variable) {
            message.text = `/set -${variable} ${message.text}`;
        } else {
            const rendered = renderSingleMessage('MarkdownV2', '```Tip\nSelect a variable first, then reply.\n```');
            return createTelegramBotAPI(context.SHARE_CONTEXT.botToken).sendMessage({
                chat_id: message.chat.id,
                text: rendered.text,
                ...(rendered.useEntities
                    ? { ...(rendered.entities ? { entities: rendered.entities } : {}) }
                    : { parse_mode: 'MarkdownV2' }),
            });
        }
        return null;
    };

    isMyInlineSetMessage = (message: Telegram.Message, context: WorkerContext) => {
        const isMyMessage = message.reply_to_message?.from?.id === Number(context.SHARE_CONTEXT.botId);
        const isInlineSetMessage = (message.reply_to_message?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data ?? '').endsWith(':set');
        return isMyMessage && isInlineSetMessage;
    };
}

export class MergeQuote implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        const isReplyMe = message.reply_to_message?.from?.id === Number(context.SHARE_CONTEXT.botId);
        const quoteText = message.quote?.text || '';
        const replyText = getMessageText(message.reply_to_message);
        // When extra quoted-message context is enabled, merge the quoted/replied content into the current message
        // as long as this is not a reply to the bot and there is reply text, or there is explicit quote text.
        if (ENV.EXTRA_MESSAGE_CONTEXT && ((!isReplyMe && replyText) || quoteText)) {
            message.text = `${getMessageText(message)}\n> ${getMergedQuoteText(message, context.SHARE_CONTEXT.botId)}`;
        }
        return null;
    };
}

export class ChunkMessageHandler implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        if (message.media_group_id || message.reply_to_message?.media_group_id) {
            return HandleMediaGroupMessage.handle(message, context);
        } else if (message.text) {
            return HandleChunkMessage.handle(message, context);
        }
        return null;
    };
}

export class BlocklistFilter implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        const blocklist = context.USER_CONFIG.BLOCKLIST;
        const userId = message.from?.id?.toString() ?? '';
        if (!await isPrivilegedUser(userId, context.SHARE_CONTEXT.botId) && blocklist.includes(userId)) {
            log.info(`[BLOCK] ${message.from?.id} ${message.from?.username ?? message.from?.first_name ?? ''} in blocklist`);
            return new Response('success', { status: 200 });
        }
        return null;
    };
}

export class RecordStatsHandler implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        // Record stats asynchronously without blocking the main flow.
        recordUserActivity(context, message).catch(e => console.error('Stats error:', e));
        return null;
    };
}
