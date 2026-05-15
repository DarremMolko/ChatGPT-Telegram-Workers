import type { RedisStorage } from '../../config/types';
import { createClient } from 'redis';

type RedisCondition = 'NX' | 'XX';

export class RedisStore implements RedisStorage {
    private readonly redis: ReturnType<typeof createClient>;
    private connectPromise: Promise<unknown> | null = null;

    constructor(private readonly url: string) {
        this.redis = createClient({
            url: this.url,
        });
        this.redis.on('error', (error) => {
            console.error('[REDIS] Client error:', error);
        });
    }

    private async connect(): Promise<void> {
        if (this.redis.isOpen) {
            return;
        }
        this.connectPromise ??= this.redis.connect()
            .finally(() => {
                if (!this.redis.isOpen) {
                    this.connectPromise = null;
                }
            });
        await this.connectPromise;
    }

    async get(key: string | string[]): Promise<any> {
        await this.connect();
        if (Array.isArray(key)) {
            if (key.length === 0) {
                return [];
            }
            return this.redis.sendCommand(['MGET', ...key]);
        }
        return this.redis.get(key);
    }

    async put(key: string, value: string, info?: { expirationTtl?: number; expiration?: number; condition?: RedisCondition }): Promise<any> {
        await this.connect();
        const data: string[] = ['SET', key, value];
        if (info?.expiration) {
            data.push('EXAT', String(Math.floor(info.expiration)));
        } else if (info?.expirationTtl) {
            const ttl = Number.parseInt(String(info.expirationTtl), 10);
            if (!Number.isNaN(ttl) && ttl > 0) {
                data.push('EX', String(ttl));
            }
        }
        if (info?.condition) {
            data.push(info.condition);
        }
        const result = await this.redis.sendCommand(data) as string | null;
        if (info?.condition) {
            return result === 'OK';
        }
        return result;
    }

    async delete(key: string | string[]): Promise<any> {
        await this.connect();
        if (Array.isArray(key)) {
            if (key.length === 0) {
                return 0;
            }
            return this.redis.sendCommand(['DEL', ...key]);
        }
        return this.redis.del(key);
    }

    async close(): Promise<void> {
        if (this.connectPromise) {
            await this.connectPromise.catch(() => {});
        }
        if (!this.redis.isOpen) {
            return;
        }
        await this.redis.quit().catch(async () => {
            await this.redis.disconnect();
        });
    }
}

export function createRedisStorage(
    env: Record<string, any>,
): { redis: RedisStorage; label: string } {
    if (!env.REDIS_URL) {
        throw new Error('REDIS_URL is required');
    }
    return {
        redis: new RedisStore(env.REDIS_URL),
        label: 'redis',
    };
}
