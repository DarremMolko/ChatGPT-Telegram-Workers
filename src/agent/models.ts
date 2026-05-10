import type { AgentUserConfig } from '../config/types';
import type { CallbackQueryContext } from '../telegram/query';
import { loadChatLLM } from '.';
import { ENV } from '../config/env';
import { resolveProviderApiBase } from './api_base';

export async function getModels(context: AgentUserConfig, agent: string) {
    const configKey = `${agent}_MODELS_API`;
    let url = context[configKey];
    if (!url) {
        throw new Error(`${agent} models api not found`);
    }
    if (!url.startsWith('http')) {
        url = `${resolveProviderApiBase(agent.toLowerCase() as 'openai' | 'oailike', context).rootURL}${url}`;
    }

    const headers: Record<string, string> = {};
    headers.Authorization = `Bearer ${context[`${agent}_API_KEY`]}`;

    const result = await fetch(url, { headers });
    if (!result.ok) {
        throw new Error(`${agent} models api error: ${result.status} ${result.statusText}`);
    }
    const modelsData = await result.json();
    return (modelsData.data || []).map((model: any) => model.id).filter(Boolean);
}

export async function updateModels(context: CallbackQueryContext, modelKey: string) {
    let agent;
    if (modelKey === 'TOOL_MODEL') {
        agent = loadChatLLM(context.USER_CONFIG).name.toUpperCase();
    } else {
        agent = modelKey.split('_')[0];
    }
    const models = await getModels(context.USER_CONFIG, agent);
    if (models.length === 0) {
        throw new Error('No models found');
    }

    const targetModelKey = `${agent}_MODELS`;
    context.USER_CONFIG[targetModelKey] = models;
    if (!context.USER_CONFIG.DEFINE_KEYS.includes(targetModelKey)) {
        context.USER_CONFIG.DEFINE_KEYS.push(targetModelKey);
    }
    await ENV.REDIS.put(context.SHARE_CONTEXT.configStoreKey, JSON.stringify(context.USER_CONFIG)).catch(console.error);
    return models;
}
