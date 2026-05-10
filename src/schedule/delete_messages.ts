import { parseArray } from '../config/merger';
import { log } from '../log/logger';
import { createTelegramBotAPI } from '../telegram/api';

interface ScheduledData {
    [botName: string]: Chat;
}

interface Message {
    id: number[];
    ttl: number;
}

interface Chat {
    [chatId: string]: Message[];
}

interface DeleteMessagesReturns {
    ok: boolean;
    description?: string;
}

type ScheduleRespType = (ok: boolean, reason?: string) => Response;

interface SortMessagesType {
    rest: Chat;
    expired: {
        [chatId: string]: number[];
    };
}

const scheduleResp: ScheduleRespType = (ok, reason = '') => {
    const result = {
        ok,
        ...((reason && { reason }) || {}),
    };
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
};

export async function schedule_detele_message(env: any) {
    try {
        log.info('- Start task: schedule_detele_message');
        checkRedis(env);
        const botTokens: string[] = extractArrayData(env.TELEGRAM_AVAILABLE_TOKENS);
        const botNames: string[] = extractArrayData(env.TELEGRAM_BOT_NAME);
        const scheduleDeteleKey = 'schedule_detele_message';
        const scheduledData = await getData<ScheduledData>(env, scheduleDeteleKey);
        const taskPromises: Promise<DeleteMessagesReturns>[] = [];

        for (const [botName, chats] of Object.entries(scheduledData)) {
            const botToken = checkBotIsVaild(botName, botNames, botTokens);
            if (!botToken) {
                continue;
            }

            const api = createTelegramBotAPI(botToken);
            const sortData = sortDeleteMessages(chats);
            scheduledData[botName] = sortData.rest;

            Object.entries(sortData.expired).forEach(([chatId, messages]) => {
                log.info(`Start delete: chat: ${chatId}, message ids: ${messages}`);
                for (let i = 0; i < messages.length; i += 100) {
                    taskPromises.push(api.deleteMessages({ chat_id: chatId, message_ids: messages.slice(i, i + 100) }));
                }
            });
        }

        if (taskPromises.length === 0) {
            log.info(`Rest ids: ${JSON.stringify(scheduledData)}\nNothing need to delete.`);
            return scheduleResp(true);
        }

        const resp: DeleteMessagesReturns[] = await Promise.all(taskPromises);
        log.info('all task result: ', resp.map(r => r.ok));
        await setData<ScheduledData>(env, scheduleDeteleKey, scheduledData);

        return scheduleResp(true);
    } catch (error: any) {
        console.error(error.message, error.stack);
        return scheduleResp(false, error.message);
    }
}

function checkBotIsVaild(botName: string, botNames: string[], botTokens: string[]): null | string {
    const botIndex = botNames.indexOf(botName);
    if (botIndex < 0) {
        console.error(`bot name: ${botName} is not exist.`);
        return null;
    }
    const botToken = botTokens[botIndex];
    if (!botToken) {
        console.error(`Cant find bot ${botName} - position ${botIndex + 1}'s token`);
        return null;
    }
    return botToken;
}

function extractArrayData(data: string[] | string): string[] {
    return Array.isArray(data) ? data : parseArray(data);
}

async function getData<T>(env: any, key: string): Promise<T> {
    return JSON.parse((await env.REDIS.get(key)) || '{}');
}

async function setData<T>(env: any, key: string, data: T): Promise<void> {
    await env.REDIS.put(key, JSON.stringify(data));
}

function sortDeleteMessages(chats: Chat): SortMessagesType {
    const sortedMessages: SortMessagesType = { rest: {}, expired: {} };

    for (const [chatId, messages] of Object.entries(chats)) {
        if (messages.length === 0) {
            continue;
        }

        sortedMessages.expired[chatId] = messages
            .filter(msg => msg.ttl <= Date.now())
            .map(msg => msg.id)
            .flat();

        sortedMessages.rest[chatId] = messages.filter(msg => msg.ttl > Date.now());
    }

    return sortedMessages;
}

function checkRedis(env: any) {
    if (!env.REDIS) {
        throw new Error('REDIS is not configured');
    }
}
