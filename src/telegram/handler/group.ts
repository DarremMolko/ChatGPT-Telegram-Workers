import type * as Telegram from 'telegram-bot-api-types';
import type { WorkerContext } from '../../config/context';
import type { MessageHandler } from './types';
import { ENV } from '../../config/env';
import { log } from '../../log/logger';
import { createTelegramBotAPI } from '../api';
import { checkIsNeedTagIds } from '../utils/send';
import { isTelegramChatTypeGroup } from '../utils/tg_utils';

function checkMention(content: string, entities: Telegram.MessageEntity[], botName: string, botId: number): {
    isMention: boolean;
    content: string;
} {
    let isMention = false;
    for (const entity of entities) {
        const entityStr = content.slice(entity.offset, entity.offset + entity.length);
        switch (entity.type) {
            case 'mention': // "mention" applies to regular users with usernames
                if (entityStr === `@${botName}`) {
                    isMention = true;
                    content = content.slice(0, entity.offset) + content.slice(entity.offset + entity.length);
                }
                break;
            case 'text_mention': // "text_mention" applies to users without usernames or ID-based mentions
                if (`${entity.user?.id}` === `${botId}`) {
                    isMention = true;
                    content = content.slice(0, entity.offset) + content.slice(entity.offset + entity.length);
                }
                break;
            case 'bot_command': // "bot_command" applies to commands
                if (entityStr.endsWith(`@${botName}`)) {
                    isMention = true;
                    const newEntityStr = entityStr.replace(`@${botName}`, '');
                    content = content.slice(0, entity.offset) + newEntityStr + content.slice(entity.offset + entity.length);
                }
                break;
            default:
                break;
        }
    }
    return {
        isMention,
        content,
    };
}

/**
 * Process trigger-prefix substitution.
 *
 * @param {Telegram.Message} message
 * @returns {boolean} Returns true if a trigger prefix is found; otherwise false.
 */
function checkTrigger(message: Telegram.Message): boolean {
    const textBefore = message.text || message.caption || '';
    const text = textBefore.replace(new RegExp(`^${ENV.CHAT_TRIGGER_PREFIX}`), '');
    message.text = text;
    return text !== textBefore;
}

export class GroupMention implements MessageHandler {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        const isTriggered = checkTrigger(message);

        // Non-group messages are not checked here; pass them to the next middleware.
        if (!isTelegramChatTypeGroup(message.chat.type)) {
            return this.noneMessage(message, context);
        }

        // Handle replies. If the reply targets the current bot, pass it through.
        const replyMe = `${message.reply_to_message?.from?.id}` === `${context.SHARE_CONTEXT.botId}`;
        if (replyMe) {
            if (context.SHARE_CONTEXT.botName && message.text?.endsWith(`@${context.SHARE_CONTEXT.botName}`)) {
                message.text = message.text.slice(0, -context.SHARE_CONTEXT.botName.length - 1);
            }
            return null;
        }

        // Process group messages and strip out the mention segment.
        let botName = context.SHARE_CONTEXT.botName;
        if (!botName) {
            const res = await createTelegramBotAPI(context.SHARE_CONTEXT.botToken).getMeWithReturns();
            botName = res.result.username || null;
            context.SHARE_CONTEXT.botName = botName;
        }
        if (!botName) {
            throw new Error('Not set bot name');
        }
        let isMention = false;
        // Check whether the text mentions the bot.
        if (message.text && message.entities) {
            const res = checkMention(message.text, message.entities, botName, context.SHARE_CONTEXT.botId);
            isMention = res.isMention;
            message.text = res.content.trim();
        }
        // Check whether the caption mentions the bot.
        if (message.caption && message.caption_entities) {
            const res = checkMention(message.caption, message.caption_entities, botName, context.SHARE_CONTEXT.botId);
            isMention = res.isMention || isMention;
            message.caption = res.content.trim();
        }
        // substituteMention
        if (isTriggered && !isMention) {
            isMention = true;
        }

        // If this is part of a media group that was already triggered, allow it through
        if (!isMention && message.media_group_id) {
            const storeMediaMessageKey = context.SHARE_CONTEXT?.storeMediaMessageKey;
            if (storeMediaMessageKey) {
                const data: Record<string, string[]> = JSON.parse(await ENV.REDIS.get(storeMediaMessageKey) || '{}');
                // If this media_group_id already has stored images, it means a triggered message already passed
                if (data[message.media_group_id] && data[message.media_group_id].length > 0) {
                    log.info(`[GROUP MENTION] Allowing media group ${message.media_group_id} image without trigger (part of triggered group)`);
                    isMention = true;
                }
            }
        }

        if (!isMention) {
            // The message was not triggered. If it has already been cached, return immediately.
            return new Response('Not mention');
        }

        return this.noneMessage(message, context);
    };

    noneMessage = async (message: Telegram.Message, context: WorkerContext) => {
        const messageInfo = context.MIDDLE_CONTEXT.messageInfo;
        if (messageInfo.original_type === 'text' && messageInfo.type === 'text' && message.text === '' && (message.reply_to_message?.text ?? '') === '') {
            const resp = createTelegramBotAPI(context.SHARE_CONTEXT.botToken).sendMessage({
                chat_id: message.chat.id,
                text: '?',
            });
            return checkIsNeedTagIds({ chatType: message.chat.type, message }, resp, 'chat');
        }
        return null;
    };
}
