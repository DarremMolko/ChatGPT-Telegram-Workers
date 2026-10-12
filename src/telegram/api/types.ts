import type * as Telegram from 'telegram-bot-api-types';

export interface InputRichMessage {
    markdown?: string;
    html?: string;
    blocks?: any[];
    media?: any[];
    is_rtl?: boolean;
    skip_entity_detection?: boolean;
}

export interface SendRichMessageParams {
    chat_id: number | string;
    rich_message: InputRichMessage;
    message_thread_id?: number;
    direct_messages_topic_id?: number;
    ephemeral_message_parameters?: Record<string, any>;
    disable_notification?: boolean;
    protect_content?: boolean;
    allow_paid_broadcast?: boolean;
    message_effect_id?: string;
    suggested_post_parameters?: Record<string, any>;
    reply_parameters?: Telegram.ReplyParameters;
    reply_markup?: Telegram.InlineKeyboardMarkup | Telegram.ReplyKeyboardMarkup | Telegram.ReplyKeyboardRemove | Telegram.ForceReply;
}

export interface SendRichMessageDraftParams {
    chat_id: number;
    draft_id: number;
    rich_message: InputRichMessage;
    message_thread_id?: number;
    can_stop?: boolean;
    keep_on_stop?: boolean;
}

export interface SendMessageDraftParams {
    chat_id: number;
    draft_id: number;
    text?: string;
    message_thread_id?: number;
    parse_mode?: Telegram.ParseMode | string;
    entities?: Telegram.MessageEntity[];
    can_stop?: boolean;
    keep_on_stop?: boolean;
}

export interface MessageGenerationStopped {
    chat: Telegram.Chat;
    draft_id: number;
    message_thread_id?: number;
}

export type EditRichMessageTextParams = (
    | (Omit<Telegram.EditMessageTextParams, 'text'> & { text?: string; rich_message: InputRichMessage })
    | Telegram.EditMessageTextParams
);

export interface TelegramRichBotMethods {
    editMessageText: (params: EditRichMessageTextParams) => Promise<Response>;
    sendRichMessage: (params: SendRichMessageParams) => Promise<Response>;
    sendRichMessageWithReturns: (params: SendRichMessageParams) => Promise<Telegram.ResponseWithMessage>;
    sendRichMessageDraft: (params: SendRichMessageDraftParams) => Promise<Response>;
    sendMessageDraft: (params: SendMessageDraftParams) => Promise<Response>;
}
