import type { Server } from 'node:http';
import type { TelegramBotAPI } from '../../telegram/api';
import { schedule } from 'node-cron';
import worker from '../../';
import { ENV } from '../../config/env';
import { createRouter } from '../../route/index';
import { createTelegramBotAPI } from '../../telegram/api';
import { resolveTelegramAllowedUpdates } from '../../telegram/api/options';
import { commandsBindScope } from '../../telegram/command';
import { handleUpdate } from '../../telegram/handler';
import { createRedisStorage } from '../../utils/cache/redis_store';
import { applyProxy, loadLocalEnv, resolveLocalConfig } from './env';
import { computePollingBackoffMs, formatPollingError, normalizeGetUpdatesPayload, normalizePollingException, parseTelegramResponseBody } from './polling';
import { LOCAL_POLLING_STATE, PollingDispatcher } from './polling_runtime';
import { startLocalServer } from './server';

const POLLING_TIMEOUT_SECONDS = 30;
const POLLING_MAX_CONCURRENT_UPDATES = 16;
const POLLING_SHUTDOWN_TIMEOUT_MS = 30_000;

function waitForDelayOrStop(stopPromise: Promise<void>, delayMs: number): Promise<void> {
    if (delayMs <= 0) {
        return Promise.resolve();
    }
    return Promise.race([
        new Promise<void>(resolve => setTimeout(resolve, delayMs)),
        stopPromise,
    ]);
}

async function stopServer(server: Server | undefined): Promise<void> {
    if (!server) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

async function registerTelegramCommands(api: TelegramBotAPI, username: string): Promise<void> {
    const scopedCommands = Object.values(commandsBindScope());
    for (const params of scopedCommands) {
        if ((params.commands || []).length === 0) {
            continue;
        }
        const scopeType = params.scope?.type || 'default';
        try {
            const result = await api.requestJSON('setMyCommands', params) as { ok?: boolean };
            if (!result?.ok) {
                console.warn(`[COMMANDS] Failed to register commands for @${username} scope ${scopeType}.`);
            }
        } catch (error) {
            console.warn(`[COMMANDS] Failed to register commands for @${username} scope ${scopeType}:`, error);
        }
    }
}

async function startPolling() {
    const clients: Record<string, TelegramBotAPI> = {};
    const offset: Record<string, number> = {};
    const allowedUpdates = resolveTelegramAllowedUpdates();
    let stopRequested = false;
    let resolveStop!: () => void;
    const stopPromise = new Promise<void>((resolve) => {
        resolveStop = resolve;
    });
    LOCAL_POLLING_STATE.reset();
    LOCAL_POLLING_STATE.configureDispatcher(POLLING_MAX_CONCURRENT_UPDATES);
    const dispatcher = new PollingDispatcher(POLLING_MAX_CONCURRENT_UPDATES, LOCAL_POLLING_STATE);

    for (const token of ENV.TELEGRAM_AVAILABLE_TOKENS) {
        offset[token] = 0;
        const api = createTelegramBotAPI(token);
        clients[token] = api;
        const name = await api.getMeWithReturns();
        const username = name.result.username || token.split(':')[0] || 'unknown_bot';
        LOCAL_POLLING_STATE.registerToken(token, username);
        await api.deleteWebhook();
        await registerTelegramCommands(api, username);
        console.log(`@${username} existing webhook deleted, polling started.`);
    }

    const loopPromises = ENV.TELEGRAM_AVAILABLE_TOKENS.map(async (token) => {
        let consecutiveErrors = 0;
        while (true) {
            if (stopRequested) {
                break;
            }
            LOCAL_POLLING_STATE.markPollStarted(token);
            try {
                const resp = await clients[token].getUpdates({
                    offset: offset[token],
                    timeout: POLLING_TIMEOUT_SECONDS,
                    ...(allowedUpdates ? { allowed_updates: allowedUpdates } : {}),
                });
                const payload = await parseTelegramResponseBody(resp);
                const { updates, error } = normalizeGetUpdatesPayload(payload, resp.headers);
                if (stopRequested) {
                    break;
                }
                if (error) {
                    const delayMs = error.retryable
                        ? computePollingBackoffMs(consecutiveErrors + 1, error.retryAfterSeconds)
                        : 0;
                    consecutiveErrors += 1;
                    LOCAL_POLLING_STATE.markPollError(token, formatPollingError(error), error.retryable ? delayMs : null, !error.retryable);
                    if (!error.retryable) {
                        console.error(`[POLLING] ${formatPollingError(error)}`);
                        break;
                    }
                    console.error(`[POLLING] ${formatPollingError(error)}. Retrying in ${delayMs}ms.`);
                    await waitForDelayOrStop(stopPromise, delayMs);
                    continue;
                }

                consecutiveErrors = 0;
                LOCAL_POLLING_STATE.markPollSuccess(token);
                for (const update of updates) {
                    if (update.update_id >= offset[token]) {
                        offset[token] = update.update_id + 1;
                    }
                    if (!dispatcher.enqueue(token, update.update_id, async () => {
                        await handleUpdate(token, update).catch(console.error);
                    })) {
                        break;
                    }
                }
            } catch (error) {
                if (stopRequested) {
                    break;
                }
                consecutiveErrors += 1;
                const normalized = normalizePollingException(error);
                const delayMs = computePollingBackoffMs(consecutiveErrors, normalized.retryAfterSeconds);
                LOCAL_POLLING_STATE.markPollError(token, formatPollingError(normalized), delayMs, false);
                console.error(`[POLLING] ${formatPollingError(normalized)}. Retrying in ${delayMs}ms.`);
                await waitForDelayOrStop(stopPromise, delayMs);
            }
        }
        LOCAL_POLLING_STATE.markLoopStopped(token);
    });

    return {
        stop: async () => {
            if (stopRequested) {
                return;
            }
            stopRequested = true;
            LOCAL_POLLING_STATE.setShuttingDown(true);
            resolveStop();
            const [, drained] = await Promise.all([
                Promise.allSettled(loopPromises),
                dispatcher.stopAndDrain(POLLING_SHUTDOWN_TIMEOUT_MS),
            ]);
            if (!drained) {
                console.error(`[POLLING] Dispatcher did not drain within ${POLLING_SHUTDOWN_TIMEOUT_MS}ms.`);
            }
        },
    };
}

async function main() {
    const { TOML_PATH } = process.env;
    const env = await loadLocalEnv(TOML_PATH);
    const config = resolveLocalConfig(env, process.env);
    if (config.proxy) {
        applyProxy(config.proxy);
    }
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
            } catch (error) {
                console.error('Failed to schedule cron job:', error);
            }
        }
    } catch (error) {
        console.log(error);
    }

    const server = config.server !== undefined
        ? startLocalServer(
                config.server.port || 8787,
                config.server.hostname || '0.0.0.0',
                createRouter(),
            )
        : undefined;

    const polling = await startPolling();
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        console.log(`Received ${signal}, shutting down...`);
        const forceTimer = setTimeout(() => {
            console.error('Forced shutdown after timeout.');
            process.exit(1);
        }, POLLING_SHUTDOWN_TIMEOUT_MS + POLLING_TIMEOUT_SECONDS * 1000);
        forceTimer.unref();

        try {
            await Promise.allSettled([
                polling.stop(),
                stopServer(server),
            ]);
            await redis.close?.();
            clearTimeout(forceTimer);
            process.exit(0);
        } catch (error) {
            clearTimeout(forceTimer);
            console.error('Shutdown failed:', error);
            process.exit(1);
        }
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(console.error);
