import type { RedisStorage } from '../../config/types';
import { UpstashRedis } from './upstash';

type RedisCondition = 'NX' | 'XX';

export class RedisStore implements RedisStorage {
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

    async put(key: string, value: string, info?: { expirationTtl?: number; expiration?: number; condition?: RedisCondition }): Promise<any> {
        return this.redis.put(key, value, info);
    }

    async delete(key: string | string[]): Promise<any> {
        return this.redis.delete(key);
    }
}

export function createRedisStorage(
    env: Record<string, any>,
): { redis: RedisStorage; label: string } {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
        throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required');
    }
    return {
        redis: new RedisStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN),
        label: 'upstash redis',
    };
}
