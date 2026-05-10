import type { AgentUserConfig } from '../../config/env';
import { cosineSimilarity } from 'ai';
import { OpenaiEmbedding, OpenAILikeEmbedding } from './embedding';

interface RerankResult {
    similar: number;
    value: string;
}

const RERANK_AGENTS = {
    openai: new OpenaiEmbedding(),
    oailikeV1: new OpenAILikeEmbedding(),
    oailikeV2: new OpenAILikeEmbedding(),
};

export class Rerank {
    readonly rank = async (context: AgentUserConfig, data: string[], topN: number = 1): Promise<RerankResult[]> => {
        switch (context.RERANK_AGENT) {
            case 'openai':
            case 'oailikeV1':
                return this.generalRerankAgent(context, data, topN);
            case 'oailikeV2':
                return this.oailikeV2(context, data, topN);
            default:
                return this.generalRerankAgent({ ...context, RERANK_AGENT: 'openai' }, data, topN);
        }
    };

    readonly generalRerankAgent = async (context: AgentUserConfig, data: string[], topN: number): Promise<RerankResult[]> => {
        const embeddings = await RERANK_AGENTS[context.RERANK_AGENT as keyof typeof RERANK_AGENTS].request(data, context);
        const inputEmbeddings = embeddings[0].embed;
        return embeddings.slice(1)
            .map(({ embed, value }) => ({ similar: cosineSimilarity(inputEmbeddings, embed), value }))
            .sort((a, b) => b.similar - a.similar)
            .slice(0, topN);
    };

    readonly oailikeV2 = async (context: AgentUserConfig, data: string[], topN: number): Promise<RerankResult[]> => {
        const url = `${context.OAILIKE_API_BASE}/rerank`;
        const result = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${context.OAILIKE_API_KEY}`,
            },
            body: JSON.stringify({
                model: context.OAILIKE_RERANK_MODEL,
                query: data[0],
                documents: data.slice(1),
                top_n: topN,
                return_documents: true,
            }),
        }).then(res => res.json());
        if (!result.results) {
            throw new Error(`${JSON.stringify(result)}`);
        }
        return result.results.map((item: any) => ({ similar: item.relevance_score, value: item.document.text }));
    };
}
