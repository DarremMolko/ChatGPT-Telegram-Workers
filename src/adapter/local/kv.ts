import type { KVNamespace } from '../../config/types';
import { UpstashRedis } from '../../utils/cache/upstash';

type KVCondition = 'NX' | 'XX';

class UpstashKV implements KVNamespace {
    private readonly redis: UpstashRedis;

    constructor(baseUrl: string, token: string) {
        this.redis = new UpstashRedis(baseUrl, token);
    }

    async get(key: string | string[]): Promise<any> {
        if (Array.isArray(key)) {
            return this.redis.mget(key);
        }
        return this.redis.get(key, {});
    }

    async put(key: string, value: string, info?: { expirationTtl?: number; expiration?: number; condition?: KVCondition }): Promise<any> {
        return this.redis.put(key, value, info);
    }

    async delete(key: string | string[]): Promise<void> {
        await this.redis.delete(key);
    }

    async list(prefix?: string): Promise<string[]> {
        if (prefix) {
            console.warn('DATABASE.list(prefix) is not supported for Upstash Redis in local mode');
        }
        return [];
    }
}

export async function createDatabase(
    env: Record<string, any>,
): Promise<{ database: KVNamespace; label: string }> {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
        throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required');
    }
    return {
        database: new UpstashKV(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN),
        label: 'upstash redis',
    };
}
