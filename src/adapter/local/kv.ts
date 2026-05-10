import type { KVNamespace } from '../../config/types';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { UpstashRedis } from '../../utils/cache/upstash';

type KVCondition = 'NX' | 'XX';

interface KVEntry {
    expiresAt: number | null;
    value: string;
}

interface DatabaseConfig {
    path?: string;
    type?: 'memory' | 'local' | 'sqlite' | 'redis';
}

function normalizeExpiration(info?: { expirationTtl?: number; expiration?: number }): number | null {
    if (info?.expiration) {
        return info.expiration * 1000;
    }
    if (info?.expirationTtl) {
        return Date.now() + info.expirationTtl * 1000;
    }
    return null;
}

function matchesPrefix(key: string, prefix?: string): boolean {
    if (!prefix) {
        return true;
    }
    if (!prefix.includes('*')) {
        return key.startsWith(prefix);
    }
    const escaped = prefix.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
    return new RegExp(`^${escaped}$`).test(key);
}

class MemoryKV implements KVNamespace {
    protected readonly store = new Map<string, KVEntry>();

    constructor(seed: Record<string, KVEntry> = {}) {
        for (const [key, value] of Object.entries(seed)) {
            if (value && typeof value.value === 'string') {
                this.store.set(key, {
                    expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : null,
                    value: value.value,
                });
            }
        }
    }

    protected async afterMutation(): Promise<void> {}

    protected async pruneExpiredKey(key: string): Promise<void> {
        const item = this.store.get(key);
        if (item && item.expiresAt !== null && item.expiresAt <= Date.now()) {
            this.store.delete(key);
            await this.afterMutation();
        }
    }

    protected async pruneExpired(): Promise<void> {
        let changed = false;
        for (const [key, value] of this.store.entries()) {
            if (value.expiresAt !== null && value.expiresAt <= Date.now()) {
                this.store.delete(key);
                changed = true;
            }
        }
        if (changed) {
            await this.afterMutation();
        }
    }

    protected async hasKey(key: string): Promise<boolean> {
        await this.pruneExpiredKey(key);
        return this.store.has(key);
    }

    private async getValue(key: string): Promise<string | null> {
        await this.pruneExpiredKey(key);
        return this.store.get(key)?.value ?? null;
    }

    async get(key: string | string[]): Promise<any> {
        if (Array.isArray(key)) {
            return Promise.all(key.map(item => this.getValue(item)));
        }
        return this.getValue(key);
    }

    async put(key: string, value: string, info?: { expirationTtl?: number; expiration?: number; condition?: KVCondition }): Promise<boolean | undefined> {
        const exists = await this.hasKey(key);
        if (info?.condition === 'NX' && exists) {
            return false;
        }
        if (info?.condition === 'XX' && !exists) {
            return false;
        }
        this.store.set(key, {
            expiresAt: normalizeExpiration(info),
            value,
        });
        await this.afterMutation();
        if (info?.condition) {
            return true;
        }
        return undefined;
    }

    async delete(key: string | string[]): Promise<void> {
        const keys = Array.isArray(key) ? key : [key];
        let changed = false;
        for (const item of keys) {
            changed = this.store.delete(item) || changed;
        }
        if (changed) {
            await this.afterMutation();
        }
    }

    async list(prefix?: string): Promise<string[]> {
        await this.pruneExpired();
        return [...this.store.keys()].filter(key => matchesPrefix(key, prefix));
    }
}

class FileKV extends MemoryKV {
    private writeQueue = Promise.resolve();

    constructor(private readonly filePath: string, seed: Record<string, KVEntry> = {}) {
        super(seed);
    }

    static async create(filePath: string): Promise<FileKV> {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            return new FileKV(filePath, JSON.parse(raw) as Record<string, KVEntry>);
        } catch (error) {
            const typedError = error as NodeJS.ErrnoException;
            if (typedError.code !== 'ENOENT') {
                console.error(`Failed to load local database from ${filePath}:`, error);
            }
            return new FileKV(filePath);
        }
    }

    protected override async afterMutation(): Promise<void> {
        const snapshot = JSON.stringify(Object.fromEntries(this.store.entries()), null, 2);
        this.writeQueue = this.writeQueue.then(async () => {
            await fs.mkdir(path.dirname(this.filePath), { recursive: true });
            await fs.writeFile(this.filePath, snapshot, 'utf8');
        });
        await this.writeQueue;
    }
}

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
    config: DatabaseConfig | undefined,
    env: Record<string, any>,
): Promise<{ database: KVNamespace; label: string }> {
    const type = config?.type ?? 'memory';
    switch (type) {
        case 'memory':
            return {
                database: new MemoryKV(),
                label: 'memory',
            };
        case 'local':
            return {
                database: await FileKV.create(config?.path || './data/local-kv.json'),
                label: 'local',
            };
        case 'sqlite':
            return {
                database: await FileKV.create(config?.path || './data/local-kv.json'),
                label: 'sqlite (file-backed compatibility mode)',
            };
        case 'redis':
            if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
                throw new Error('database.type=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
            }
            return {
                database: new UpstashKV(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN),
                label: 'upstash redis',
            };
        default:
            throw new Error(`Unsupported database type: ${type}`);
    }
}
