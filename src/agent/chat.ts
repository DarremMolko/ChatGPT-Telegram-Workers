import type { ModelMessage } from 'ai';
import type { WorkerContext } from '../config/context';
import type { ChatAgent, ChatStreamTextHandler, HistoryItem, HistoryModifier, LLMChatParams, LLMChatRequestParams, ResponseMessage } from './types';
import { ENV } from '../config/env';
import { log, writeDebugLog } from '../log';
import { formatDiagnosticFields, summarizeHistory, summarizeModelMessages, summarizeUserConfig } from '../log/diagnostics';
import { formatLocalDateTime } from '../utils/others/time';

export async function loadHistory(key: string, length: number): Promise<HistoryItem[]> {
    // Load history records.
    let history = [];
    let loadedCount = 0;
    try {
        history = JSON.parse(await ENV.REDIS.get(key));
    } catch (e) {
        console.error(e);
    }
    if (!history || !Array.isArray(history)) {
        history = [];
    }
    loadedCount = history.length;

    const trimHistory = (list: HistoryItem[], maxLength: number) => {
        // Trim history when it exceeds the limit. Values below 0 disable trimming.
        if (maxLength >= 0 && list.length > maxLength) {
            list = list.splice(list.length - maxLength);
        }
        return list;
    };

    // Trim history
    if (ENV.AUTO_TRIM_HISTORY) {
        history = trimHistory(history, length);
    }

    log.info(`[HISTORY LOAD] ${formatDiagnosticFields({
        key,
        requestedLength: length,
        loadedCount,
        finalCount: history.length,
        autoTrim: ENV.AUTO_TRIM_HISTORY,
    })}`);
    writeDebugLog({
        source: 'llm',
        event: 'history-load',
        data: {
            key,
            requestedLength: length,
            loadedCount,
            finalCount: history.length,
            summary: summarizeHistory(history),
        },
    });

    return history;
}

export async function requestCompletionsFromLLM(params: LLMChatRequestParams | null, context: WorkerContext, agent: ChatAgent, modifier: HistoryModifier | null, onStream: ChatStreamTextHandler | null, abortSignal?: AbortSignal): Promise<{ messages: ResponseMessage[]; content: string }> {
    let history = context.MIDDLE_CONTEXT.history;
    const historyDisable = ENV.STORE_HISTORY_LENGTH <= 0;
    const originalHistoryCount = history.length;
    if (modifier) {
        const modifierData = modifier(history, params);
        history = modifierData.history;
        params = modifierData.message;
    }
    if (params === null) {
        throw new Error('Message is null');
    }

    const trimer = (list: HistoryItem[], maxLength: number) => {
        // Trim messages that exceed the allowed context length.
        if (list.length > 0 && list.length > maxLength) {
            list = list.slice(list.length - maxLength);
        }

        // Trim leading tool results to avoid malformed history sequences.
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

    // Trim history records
    const trimmedHistory = trimer(history, context.USER_CONFIG.MAX_HISTORY_LENGTH);

    const messages = [...trimmedHistory, params];
    const llmParams: LLMChatParams = {
        system: resolveSystemMessage(context.USER_CONFIG.SYSTEM_INIT_MESSAGE),
        messages,
        cache: [],
        abortSignal,
    };
    log.info(`[LLM REQUEST] ${formatDiagnosticFields({
        agent: agent.name,
        scopeKey: context.SHARE_CONTEXT.chatHistoryKey,
        historyLoaded: originalHistoryCount,
        historyAfterModifier: history.length,
        historyTrimmed: trimmedHistory.length,
        messageCount: messages.length,
        storeHistoryDisabled: historyDisable,
        stream: Boolean(onStream),
    })}`);
    writeDebugLog({
        source: 'llm',
        event: 'request-chat-completions',
        data: {
            agent: agent.name,
            scopeKey: context.SHARE_CONTEXT.chatHistoryKey,
            llmParams: {
                systemPresent: Boolean(llmParams.system),
                messages: summarizeModelMessages(messages),
                cacheKeys: llmParams.cache,
                abortSignal: Boolean(abortSignal),
            },
            userConfig: summarizeUserConfig(context.USER_CONFIG),
        },
    });
    const answer = await agent.request(llmParams, context.USER_CONFIG, onStream);
    const { messages: raw_messages } = answer;
    log.info(`[LLM RESPONSE] ${formatDiagnosticFields({
        agent: agent.name,
        responseMessages: raw_messages.length,
        contentLength: answer.content.length,
        lastRole: raw_messages.at(-1)?.role || '',
    })}`);
    writeDebugLog({
        source: 'llm',
        event: 'request-chat-response',
        data: {
            agent: agent.name,
            responseMessages: summarizeModelMessages(raw_messages as unknown as ModelMessage[]),
            contentLength: answer.content.length,
        },
    });

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
    log.info(`[STORE HISTORY] ${formatDiagnosticFields({
        key: historyKey,
        count: history.length,
    })}`);
    writeDebugLog({
        source: 'llm',
        event: 'history-store',
        data: {
            key: historyKey,
            summary: summarizeHistory(history),
        },
    });
}

export function resolveSystemMessage(systemMessage: string | null): string | undefined {
    if (systemMessage) {
        return systemMessage.replace('{{CURRENT_TIME}}', formatLocalDateTime());
    }
    return undefined;
}
