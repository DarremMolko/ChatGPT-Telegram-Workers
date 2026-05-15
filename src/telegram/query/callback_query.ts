import type * as Telegram from 'telegram-bot-api-types';
import type { AgentUserConfig, WorkerContext } from '../../config/types';
import type { TelegramBotAPI } from '../api';
import type { InlineItem } from '../command/types';
import type { MessageHandler } from '../handler/types';
import type { CallbackQueryHandler } from './types';
import { WorkerContextBase } from '../../config/context';
import { ENV } from '../../config/env';
import { ConfigMerger } from '../../config/merger';
import { log } from '../../log/logger';
import { canManageRuntimeConfigForAccess, canUseAdminUtilityForAccess, canViewSensitiveConfigForAccess, describeAdminUtilityDisabled, resolveUserAccess } from '../access';
import { createTelegramBotAPI } from '../api';
import { buildSystemInlineKeyboard, InlineCommandHandler, parseSystemPanelCallback, renderSystemPanel } from '../command/system';
import { catchError } from '../handler';
import { EnvChecker, InitUserConfig } from '../handler/handlers';
import { buildRenderedTextParams } from '../utils/send';
import { chunkArray } from '../utils/tg_utils';
import { CallbackQueryContext } from './context';

function resolveEffectiveVisionModel(config: AgentUserConfig): string {
    if (config.VISION_MODEL?.trim()) {
        return config.VISION_MODEL.trim();
    }
    const provider = config.AI_CHAT_PROVIDER || 'openai';
    return config[`${provider.toUpperCase()}_VISION_MODEL`] || '';
}

function describeVisionConfig(config: AgentUserConfig): string {
    return [
        `AI_CHAT_PROVIDER=${config.AI_CHAT_PROVIDER || ''}`,
        `VISION_MODEL=${config.VISION_MODEL || ''}`,
        `OPENAI_VISION_MODEL=${config.OPENAI_VISION_MODEL || ''}`,
        `OAILIKE_VISION_MODEL=${config.OAILIKE_VISION_MODEL || ''}`,
        `effectiveVisionModel=${resolveEffectiveVisionModel(config)}`,
    ].join(' ');
}

class HandlerCallbackQuery implements CallbackQueryHandler<CallbackQueryContext> {
    handle = async (query: Telegram.CallbackQuery, context: CallbackQueryContext): Promise<Response | null> => {
        const api = createTelegramBotAPI(context.SHARE_CONTEXT.botToken);
        const message = query.message as Telegram.Message;
        const keyboard = message.reply_markup?.inline_keyboard ?? [];
        log.info(`[CALLBACK QUERY] data=${query.data || ''}`);
        const authorized = isAuthorized(query.from?.id ?? 0, keyboard);
        // Unauthorized user for this callback.
        if (!authorized) {
            log.error(`[CALLBACK QUERY] User ${context.from.first_name}, id: ${context.from.id} is not authorized for this callback`);
            return this.sendAlert(api, context.query_id, `⚠️ This is not your operation`, true);
        }
        const access = await resolveUserAccess(query.from?.id, context.SHARE_CONTEXT.botId);
        if (!canUseAdminUtilityForAccess(access, 'settings')) {
            return this.sendAlert(api, context.query_id, `⚠️ ${describeAdminUtilityDisabled('settings')}`, true);
        }
        // Unsupported callback query type.
        if (!query.data || !(query.message as Telegram.Message)?.reply_markup) {
            return new Response('Not supported callback query type', { status: 200 });
        }
        // Header row or page index button.
        if (query.data.startsWith(query.from.id.toString()) || query.data.startsWith('PAGE_INDEX:')) {
            return new Response('success', { status: 200 });
        }
        // Close the inline keyboard.
        if (query.data === 'close') {
            return this.closeInlineKeyboard(api, message);
        }
        const systemAction = parseSystemPanelCallback(query.data);
        if (systemAction) {
            if (!access.isOwner) {
                return this.sendAlert(api, context.query_id, '⚠️ You are not allowed to use system', true);
            }
            const text = await renderSystemPanel(context as unknown as WorkerContext, message, systemAction.section);
            return this.sendCallBackMessage(api, message, text, buildSystemInlineKeyboard(query.from!.id, systemAction.section));
        }

        const [row = 5, col = 3] = ENV.CALLBACK_QUERY_RC.split('x').map(Number);
        const pageLength = row * col;
        const queryHandler = new InlineCommandHandler();
        const showSensitiveValues = canViewSensitiveConfigForAccess(access);
        const defaltData = await queryHandler.defaultInlines(context.USER_CONFIG, { access });
        const pageIndexData = keyboard.flat().find(i => i.callback_data?.startsWith('PAGE_INDEX:'))?.callback_data?.replace('PAGE_INDEX:', '');
        const pathDetail = keyboard[0]?.[0]?.callback_data || '';
        let { path, data, pageIndex, pageNum, newCallBackData, configKey, label, callback } = getNextpage({ pathDetail, pageIndexData, callbackData: query.data, inlineList: defaltData, pageLength });

        try {
            if (query.data === 'fresh' || (configKey.endsWith('_MODEL') && data.length === 0)) {
                if (configKey && !canManageRuntimeConfigForAccess(access, configKey)) {
                    throw new Error('This operation requires higher privileges');
                }
                data = await callback?.(context, configKey) || [];
                this.sendAlert(api, context.query_id, `✅ ${label} updated successfully`, false);
                ({ data, pageNum } = paging(data, 0, pageLength));
            } else if (typeof newCallBackData === 'number' && configKey !== 'ENVS') {
                await this.updateConfig(context, api, { data: data as unknown as string[], configKey, newCallBack: newCallBackData });
            }
        } catch (e) {
            return this.sendAlert(api, context.query_id, `❌ Failed to refresh ${label}\n${(e as Error).message}`, true);
        }

        let inlineKeyboard: Telegram.InlineKeyboardButton[][] = [];
        inlineKeyboard = this.constructInlineList(
            {
                path,
                data,
                pageIndex,
                pageNum,
                col,
                label,
                key: configKey,
                config: context.USER_CONFIG,
                callbackData: newCallBackData,
                callback,
            },
        );
        const newData = await queryHandler.defaultInlines(context.USER_CONFIG, { access });
        const settingMessage = queryHandler.settingsMessage(context.USER_CONFIG, newData, {
            key: configKey,
            callBack: typeof newCallBackData === 'number' ? data[newCallBackData] : '',
            showSensitiveValues,
        });

        return this.sendCallBackMessage(api, message, settingMessage, inlineKeyboard);
    };

    private async sendAlert(api: TelegramBotAPI, query_id: string, text: string, show_alert?: boolean, cache_time?: number) {
        return api.answerCallbackQuery({
            callback_query_id: query_id,
            text,
            show_alert,
            cache_time,
        });
    }

    private async updateConfig(context: CallbackQueryContext, api: TelegramBotAPI, data: { data: string[]; configKey: string; newCallBack: number }) {
        const { data: dataList, configKey, newCallBack } = data;
        if (!Object.hasOwn(context.USER_CONFIG, configKey)) {
            return;
        }
        const access = await resolveUserAccess(context.from.id, context.SHARE_CONTEXT.botId);
        if (!canManageRuntimeConfigForAccess(access, configKey)) {
            throw new Error(`Permission denied to update ${configKey}`);
        }
        const oldValue = context.USER_CONFIG[configKey];
        const newValue = dataList[newCallBack];
        const type = Array.isArray(oldValue) ? 'array' : typeof oldValue;
        switch (type) {
            case 'string':
            case 'boolean':
            case 'undefined':
                if (oldValue === newValue) {
                    return;
                } else {
                    context.USER_CONFIG[configKey] = newValue;
                }
                break;
            case 'array':
                if (oldValue.includes(newValue)) {
                    oldValue.splice(oldValue.indexOf(newValue), 1);
                } else {
                    oldValue.push(newValue);
                }
                break;
            default:
                throw new TypeError('Not support config type');
        }

        if (!context.USER_CONFIG.DEFINE_KEYS.includes(configKey)) {
            context.USER_CONFIG.DEFINE_KEYS.push(configKey);
        }
        log.info(`[CALLBACK QUERY] Update config: ${configKey} old=${JSON.stringify(oldValue)} new=${JSON.stringify(context.USER_CONFIG[configKey])}`);
        if (configKey === 'VISION_MODEL' || configKey.endsWith('_VISION_MODEL') || configKey === 'AI_CHAT_PROVIDER') {
            log.info(`[VISION CONFIG] source=callback key=${configKey} ${describeVisionConfig(context.USER_CONFIG)}`);
        }
        await ENV.REDIS.put(context.SHARE_CONTEXT.configStoreKey, JSON.stringify(ConfigMerger.trim(context.USER_CONFIG))).catch(console.error);
        this.sendAlert(api, context.query_id, '✅ Data update successful', false);
    }

    private async closeInlineKeyboard(api: TelegramBotAPI, message: Telegram.Message) {
        return api.deleteMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
        }).then(r => r.json());
    }

    private async sendCallBackMessage(api: TelegramBotAPI, message: Telegram.Message, text: string, inline_keyboard: Telegram.InlineKeyboardButton[][]) {
        return api.editMessageText({
            chat_id: message.chat.id,
            message_id: message.message_id,
            ...buildRenderedTextParams('MarkdownV2', text, { quoteExpandable: true, addQuote: true }),
            reply_markup: { inline_keyboard },
        });
    }

    private constructInlineList({ path, data, label, key, config, callbackData, pageIndex, pageNum, col, callback }: { path: number[]; data: (string | InlineItem)[]; label?: string; key?: string; config: AgentUserConfig; callbackData: number | string; pageIndex: number; pageNum: number; col: number; callback?: (...args: any[]) => Promise<string[]> }): Telegram.InlineKeyboardButton[][] {
        const isSelected = (item: string | InlineItem, index: number) => {
            // Single-select
            if ((key && callbackData === index && !Array.isArray(config[key]))
                || (key && config[key] === item)
            // Multi-select
                || (key && (Array.isArray(config[key]) && (config[key].includes(item))))) {
                return '✅';
            }
            return '';
        };
        let inlineList: Telegram.InlineKeyboardButton[] = [];
        if (path.length > 1 && key) {
            inlineList = data.map((item, index) => ({
                text: `${isSelected(item, index)}${item}`,
                callback_data: index.toString(),
            }));
        } else {
            inlineList = data.map((item, index) => ({
                text: (item as InlineItem).label,
                callback_data: index.toString(),
            }));
        }

        const realCol = path.length === 1 || key === '' ? 3 : col;

        const chunkedList = chunkArray(inlineList, realCol) as Telegram.InlineKeyboardButton[][];
        chunkedList.unshift([{
            text: `Select ${label || key || 'an option to configure'}`,
            callback_data: path.join('.') + (key === 'ENVS' ? ':set' : ''),
        }]);

        const page: Telegram.InlineKeyboardButton[] = [];
        if (pageNum > 1) {
            if (pageIndex > 0) {
                page.push({
                    text: 'PREV',
                    callback_data: `prev`,
                });
            }
            page.push({
                text: `${pageIndex + 1} / ${pageNum}`,
                callback_data: `PAGE_INDEX:${pageIndex}`,
            });
            if (pageIndex < pageNum - 1) {
                page.push({
                    text: 'NEXT',
                    callback_data: `next`,
                });
            }
            chunkedList.push(page);
        }

        const footer: Telegram.InlineKeyboardButton[] = [{
            text: '❌',
            callback_data: 'close',
        }];

        if (callback) {
            footer.unshift({
                text: '🔄',
                callback_data: 'fresh',
            });
        }
        if (path.length > 1) {
            footer.unshift({
                text: '↩️',
                callback_data: 'back',
            });
        }

        chunkedList.push(footer);

        return chunkedList;
    }
}

export async function handleCallbackQuery(token: string, callbackQuery: Telegram.CallbackQuery) {
    try {
        log.info('handleCallbackQuery');
        const message = callbackQuery.message as Telegram.Message;
        if (!message?.reply_markup || !callbackQuery.data) {
            throw new Error('Not supported callback query type');
        }

        const workContext = new WorkerContextBase(token, message);

        const handlers: MessageHandler<any>[] = [
            new EnvChecker(),
            new InitUserConfig(),
        ];
        for (const handler of handlers) {
            const result = await handler.handle(message, workContext);
            if (result instanceof Response) {
                return result;
            }
        }

        const callbackQueryContext = new CallbackQueryContext(callbackQuery, workContext as WorkerContext);
        const result = await new HandlerCallbackQuery().handle(callbackQuery, callbackQueryContext);
        if (result instanceof Response) {
            return result;
        }
    } catch (e) {
        return catchError(e as Error);
    }
    return null;
}

export function isAuthorized(fromId: number, inline_keyboard: Array<Array<Telegram.InlineKeyboardButton>>) {
    const [id, _] = (inline_keyboard?.[0]?.[0]?.callback_data ?? '').split('.');
    return id === fromId.toString();
}

function getNextpage({ pathDetail, pageIndexData, callbackData, inlineList, pageLength }: { pathDetail: string; pageIndexData: string | undefined; callbackData: number | string; inlineList: InlineItem[]; pageLength: number }) {
    // Remove the trailing :set marker.
    const pathData = pathDetail.replace(':set', '');
    let pageIndex = pageIndexData ? Number(pageIndexData) : 0;
    const path = pathData.split('.').map(Number);
    (callbackData === 'back') && path.pop();
    let data = inlineList;
    let configKey = '';
    let label;
    let pageNum = 1;
    let callback;
    for (const i of path.slice(1)) {
        if (!data[i]) {
            throw new Error(`Invalid path: index ${i} not found in data array of length ${data.length}`);
        }
        // Safety check: ensure data[i] exists and has the required properties.
        if (!data[i].label || data[i].config_key === undefined) {
            throw new Error(`Invalid data at index ${i}: missing label or config_key`);
        }
        ({ label, config_key: configKey } = data[i]);
        callback = data[i].callback;
        data = data[i].value as InlineItem[];
    }

    switch (callbackData) {
        case 'prev':
            pageIndex -= 1;
            ({ data, pageNum } = paging(data, pageIndex, pageLength));
            break;
        case 'next':
            pageIndex += 1;
            ({ data, pageNum } = paging(data, pageIndex, pageLength));
            break;
        case 'back':
            callbackData = '';
            break;
        case 'fresh':
            pageIndex = 0;
            ({ data, pageNum } = paging(data, pageIndex, pageLength));
            break;
        default:
            callbackData = Number(callbackData);
            // Has children. If configKey is still empty, we are still navigating into a submenu,
            // so we must traverse the full array before paging.
            if (!configKey) {
                // Safety check: ensure the index is valid against the full array.
                if (!data[callbackData]) {
                    throw new Error(`Invalid callback index: ${callbackData} not found in data array of length ${data.length}`);
                }
                if (!data[callbackData].label || data[callbackData].config_key === undefined) {
                    throw new Error(`Invalid data at callback index ${callbackData}: missing label or config_key`);
                }
                path.push(callbackData);
                label = data[callbackData].label;
                configKey = data[callbackData].config_key;
                callback = data[callbackData].callback;
                data = data[callbackData].value as InlineItem[] || [];
                pageIndex = 0;
                ({ data, pageNum } = paging(data, pageIndex, pageLength));
                callbackData = '';
            } else {
                // Already at the final menu, so page the current data.
                ({ data, pageNum } = paging(data, pageIndex ?? 0, pageLength));
            }
    }
    return { path, data, pageIndex, pageNum, newCallBackData: callbackData, configKey, label, callback };
}

function paging(data: any[], pageIndex: number, pageLength: number) {
    let pageNum = 1; ;
    if (pageLength < data.length) {
        pageNum = Math.ceil(data.length / pageLength);
    }
    pageNum > 1 && (data = data.slice(pageIndex * pageLength, (pageIndex + 1) * pageLength));
    return { data, pageNum };
}
