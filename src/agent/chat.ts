import type { ModelMessage } from 'ai';
import type { WorkerContext } from '../config/context';
import type { ChatAgent, ChatStreamTextHandler, HistoryItem, HistoryModifier, LLMChatParams, LLMChatRequestParams, ResponseMessage } from './types';
import { ENV } from '../config/env';
import { log } from '../log/logger';
import { formatLocalDateTime } from '../utils/others/time';

export async function loadHistory(key: string, length: number): Promise<HistoryItem[]> {
    // 加载历史记录
    let history = [];
    try {
        history = JSON.parse(await ENV.REDIS.get(key));
    } catch (e) {
        console.error(e);
    }
    if (!history || !Array.isArray(history)) {
        history = [];
    }

    const trimHistory = (list: HistoryItem[], maxLength: number) => {
        // 历史记录超出长度需要裁剪, 小于0不裁剪
        if (maxLength >= 0 && list.length > maxLength) {
            list = list.splice(list.length - maxLength);
        }
        return list;
    };

    // 裁剪
    if (ENV.AUTO_TRIM_HISTORY) {
        history = trimHistory(history, length);
    }

    return history;
}

export async function requestCompletionsFromLLM(params: LLMChatRequestParams | null, context: WorkerContext, agent: ChatAgent, modifier: HistoryModifier | null, onStream: ChatStreamTextHandler | null, abortSignal?: AbortSignal): Promise<{ messages: ResponseMessage[]; content: string }> {
    let history = context.MIDDLE_CONTEXT.history;
    const historyDisable = ENV.STORE_HISTORY_LENGTH <= 0;
    if (modifier) {
        const modifierData = modifier(history, params);
        history = modifierData.history;
        params = modifierData.message;
    }
    if (params === null) {
        throw new Error('Message is null');
    }

    const trimer = (list: HistoryItem[], maxLength: number) => {
        // 裁剪超出上下文长度的历史消息
        if (list.length > 0 && list.length > maxLength) {
            list = list.slice(list.length - maxLength);
        }

        // 裁剪开始的tool result 以避免报错
        let validStart = 0;
        for (const h of list) {
            if (h.role === 'tool') {
                validStart++;
                continue;
            }
            break;
        }
        return list.slice(validStart);
    };

    // 裁剪历史记录
    const trimmedHistory = trimer(history, context.USER_CONFIG.MAX_HISTORY_LENGTH);

    const messages = [...trimmedHistory, params];
    const llmParams: LLMChatParams = {
        system: resolveSystemMessage(context.USER_CONFIG.SYSTEM_INIT_MESSAGE),
        messages,
        cache: [],
        abortSignal,
    };
    const answer = await agent.request(llmParams, context.USER_CONFIG, onStream);
    const { messages: raw_messages } = answer;

    if (!historyDisable && raw_messages.at(-1)?.role === 'assistant') {
        // only push valid chat history
        history.push(params);
        // last message cannot be tool-call
        let validEnd = raw_messages.length;
        for (const m of raw_messages) {
            if (m.role === 'assistant' && Array.isArray(m.content)) {
                // ai 5.0.0-beta.9 contain too many empty reasoning content
                m.content = m.content.filter((i: any) => {
                    if (i.type === 'reasoning')
                        return i.text !== '';
                    return true;
                });
            }
        }
        // When the last message is tool call message, delete it.
        for (const m of raw_messages.toReversed()) {
            if (m.role === 'assistant' && Array.isArray(m.content) && m.content.some((i: any) => i.type === 'tool-call')) {
                validEnd--;
                continue;
            }
            break;
        }
        history.push(...raw_messages.slice(0, validEnd));
        await storeHistory(history, context);
    }
    return answer;
}

export async function storeHistory(history: ModelMessage[], context: WorkerContext) {
    const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
    const userMessage = history.findLast(h => h.role === 'user');
    if (ENV.HISTORY_IMAGE_PLACEHOLDER && Array.isArray(userMessage?.content) && userMessage.content.length > 0) {
        userMessage.content = userMessage.content.map((c: any) => c.type === 'text' ? c.text : `[${c.type}]`).join('\n');
    }
    await ENV.REDIS.put(historyKey, JSON.stringify(history)).catch(console.error);
    log.info(`[STORE HISTORY] DONE`);
}

export function resolveSystemMessage(systemMessage: string | null): string | undefined {
    if (systemMessage) {
        return systemMessage.replace('{{CURRENT_TIME}}', formatLocalDateTime());
    }
    return undefined;
}
