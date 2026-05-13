import type * as Telegram from 'telegram-bot-api-types';
import type { ImageResult } from '../../agent/types';
import type { UnionData } from '../utils/tg_utils';

// Middleware shape: function (message: TelegramMessage, context: Context): Promise<Response | null>
// 1. If the function throws, message handling stops and the error is returned.
// 2. If the function returns a Response, message handling stops and that Response is returned.
// 3. If the function returns null, processing continues to the next middleware.
export interface MessageHandler<Ctx = any> {
    handle: (message: Telegram.Message, context: Ctx) => Promise<Response | UnionData | ImageResult | null>;
}

export interface CallbackQueryHandler<Ctx = any> {
    handle: (message: Telegram.Message, context: Ctx) => Promise<Response | UnionData | null>;
}

export interface InlineQueryHandler<Ctx = any> {
    handle: (inlineQuery: Telegram.InlineQuery, context: Ctx) => Promise<Response | UnionData | null>;
}

export interface ChosenInlineQueryHandler<Ctx = any> {
    handle: (chosenInline: Telegram.ChosenInlineResult, context: Ctx) => Promise<Response | UnionData | null>;
}
