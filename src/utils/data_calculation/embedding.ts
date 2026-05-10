import type { AgentUserConfig } from '../../config/env';
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany } from 'ai';
import { OpenAIBase } from '../../agent/openai';
import { OpenAILikeBase } from '../../agent/openailike';

export class OpenaiEmbedding extends OpenAIBase {
    readonly request = async (data: string[], context: AgentUserConfig): Promise<Array<{ embed: number[]; value: string }>> => {
        const { embeddings, values } = await embedMany({
            model: createOpenAI({
                baseURL: context.OPENAI_API_BASE,
                apiKey: this.apikey(context),
            }).embedding(context.OPENAI_EMBEDDING_MODEL),
            values: data,
            maxRetries: 0,
        });
        return values.map((value, i) => ({ embed: embeddings[i], value }));
    };
}

export class OpenAILikeEmbedding extends OpenAILikeBase {
    readonly request = async (data: string[], context: AgentUserConfig): Promise<Array<{ embed: number[]; value: string }>> => {
        const { embeddings, values } = await embedMany({
            model: createOpenAI({
                baseURL: context.OAILIKE_API_BASE,
                apiKey: context.OAILIKE_API_KEY || undefined,
            }).embedding(context.OAILIKE_EMBEDDING_MODEL),
            values: data,
        });
        return values.map((value, i) => ({ embed: embeddings[i], value }));
    };
}
