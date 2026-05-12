import type { TelegramBotAPI } from '../../telegram/api';
import * as fs from 'node:fs';
import { schedule } from 'node-cron';
import worker from '../../';
import { ENV } from '../../config/env';
import { createRouter } from '../../route/index';
import { createTelegramBotAPI } from '../../telegram/api';
import { resolveTelegramAllowedUpdates } from '../../telegram/api/options';
import { handleUpdate } from '../../telegram/handler';
import { createRedisStorage } from '../../utils/cache/redis_store';
import { applyProxy, loadLocalEnv } from './env';
import { normalizeGetUpdatesPayload, parseTelegramResponseBody } from './polling';
import { startLocalServer } from './server';

const {
    CONFIG_PATH = '/app/config.json',
    TOML_PATH = '/app/config.toml',
} = process.env;

interface Config {
    server?: {
        hostname?: string;
        port?: number;
        baseURL: string;
    };
    proxy?: string;
    mode: 'webhook' | 'polling';
}

// 读取配置文件
const config: Config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

// long polling 模式
async function runPolling() {
    const clients: Record<string, TelegramBotAPI> = {};
    const offset: Record<string, number> = {};
    const allowedUpdates = resolveTelegramAllowedUpdates();
    for (const token of ENV.TELEGRAM_AVAILABLE_TOKENS) {
        offset[token] = 0;
        const api = createTelegramBotAPI(token);
        clients[token] = api;
        const name = await api.getMeWithReturns();
        await api.deleteWebhook({
            ...(ENV.TELEGRAM_DROP_PENDING_UPDATES ? { drop_pending_updates: true } : {}),
        });
        console.log(`@${name.result.username} Webhook deleted, If you want to use webhook, please set it up again.`);
    }

    ENV.TELEGRAM_AVAILABLE_TOKENS.forEach(async (token) => {
        while (true) {
            try {
                const resp = await clients[token].getUpdates({
                    offset: offset[token],
                    timeout: 30,
                    ...(allowedUpdates ? { allowed_updates: allowedUpdates } : {}),
                });
                if (resp.status === 429) {
                    const retryAfter = Number.parseInt(resp.headers.get('Retry-After') || '');
                    if (retryAfter) {
                        console.log(`Rate limited, retry after ${retryAfter} seconds`);
                        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                        continue;
                    }
                }
                const payload = await parseTelegramResponseBody(resp);
                const { updates, error } = normalizeGetUpdatesPayload(payload);
                if (error) {
                    console.error(`[POLLING] ${error}`);
                    continue;
                }
                for (const update of updates) {
                    if (update.update_id >= offset[token]) {
                        offset[token] = update.update_id + 1;
                    }
                    setImmediate(async () => {
                        await handleUpdate(token, update).catch(console.error);
                    });
                }
            } catch (e) {
                console.error(e);
            }
        }
    });
}

async function main() {
    if (config.proxy) {
        applyProxy(config.proxy);
    }

    const env = await loadLocalEnv(TOML_PATH);
    const { redis, label } = createRedisStorage(env);
    console.log(`redis: ${label} is ready`);
    ENV.merge({
        ...env,
        REDIS: redis,
    });

    try {
        if (env.EXPIRED_TIME > 0 && env.CRON_CHECK_TIME) {
            try {
                schedule(env.CRON_CHECK_TIME, async () => await worker.scheduled({} as Event, {
                    ...env,
                    REDIS: redis,
                }, null));
            } catch (e) {
                console.error('Failed to schedule cron job:', e);
            }
        }
    } catch (e) {
        console.log(e);
    }

    if (config.mode === 'webhook' && config.server !== undefined) {
        const router = createRouter();
        startLocalServer(
            config.server.port || 8787,
            config.server.hostname || '0.0.0.0',
            config.server.baseURL,
            router,
        );
        return;
    }

    runPolling().catch(console.error);
}

main().catch(console.error);
