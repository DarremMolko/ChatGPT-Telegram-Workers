const DEFAULT_HEALTH_STALE_MS = 90 * 1000;

function toISOString(value: number | null): string | null {
    return value ? new Date(value).toISOString() : null;
}

interface MutableTokenState {
    tokenId: string;
    username: string;
    loopRunning: boolean;
    fatal: boolean;
    lastPollStartedAt: number | null;
    lastActivityAt: number;
    lastSuccessAt: number | null;
    lastErrorAt: number | null;
    lastError: string | null;
    consecutiveErrors: number;
    nextRetryAt: number | null;
    inFlightUpdates: number;
    queuedUpdates: number;
    processedUpdates: number;
    lastUpdateId: number | null;
}

export interface PollingTokenHealthSnapshot {
    tokenId: string;
    username: string;
    loopRunning: boolean;
    fatal: boolean;
    stale: boolean;
    consecutiveErrors: number;
    lastPollStartedAt: string | null;
    lastActivityAt: string;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
    nextRetryAt: string | null;
    inFlightUpdates: number;
    queuedUpdates: number;
    processedUpdates: number;
    lastUpdateId: number | null;
}

export interface PollingHealthSnapshot {
    ok: boolean;
    shuttingDown: boolean;
    startedAt: string;
    staleAfterMs: number;
    dispatcher: {
        maxConcurrent: number;
        queued: number;
        inFlight: number;
    };
    tokens: Record<string, PollingTokenHealthSnapshot>;
}

export class PollingStateTracker {
    private readonly startedAt = Date.now();
    private dispatcherMaxConcurrent = 0;
    private dispatcherQueued = 0;
    private dispatcherInFlight = 0;
    private shuttingDown = false;
    private readonly tokens = new Map<string, MutableTokenState>();

    reset(): void {
        this.dispatcherMaxConcurrent = 0;
        this.dispatcherQueued = 0;
        this.dispatcherInFlight = 0;
        this.shuttingDown = false;
        this.tokens.clear();
    }

    configureDispatcher(maxConcurrent: number): void {
        this.dispatcherMaxConcurrent = maxConcurrent;
    }

    setShuttingDown(value: boolean): void {
        this.shuttingDown = value;
    }

    registerToken(token: string, username: string): void {
        const now = Date.now();
        const tokenId = token.split(':')[0] || token;
        this.tokens.set(token, {
            tokenId,
            username,
            loopRunning: true,
            fatal: false,
            lastPollStartedAt: null,
            lastActivityAt: now,
            lastSuccessAt: null,
            lastErrorAt: null,
            lastError: null,
            consecutiveErrors: 0,
            nextRetryAt: null,
            inFlightUpdates: 0,
            queuedUpdates: 0,
            processedUpdates: 0,
            lastUpdateId: null,
        });
    }

    markPollStarted(token: string): void {
        const state = this.tokens.get(token);
        if (!state) {
            return;
        }
        const now = Date.now();
        state.loopRunning = true;
        state.lastPollStartedAt = now;
        state.lastActivityAt = now;
    }

    markPollSuccess(token: string): void {
        const state = this.tokens.get(token);
        if (!state) {
            return;
        }
        const now = Date.now();
        state.loopRunning = true;
        state.fatal = false;
        state.lastActivityAt = now;
        state.lastSuccessAt = now;
        state.consecutiveErrors = 0;
        state.lastError = null;
        state.lastErrorAt = null;
        state.nextRetryAt = null;
    }

    markPollError(token: string, message: string, nextDelayMs: number | null, fatal: boolean): void {
        const state = this.tokens.get(token);
        if (!state) {
            return;
        }
        const now = Date.now();
        state.lastActivityAt = now;
        state.lastErrorAt = now;
        state.lastError = message;
        state.consecutiveErrors += 1;
        state.nextRetryAt = fatal || nextDelayMs === null ? null : now + nextDelayMs;
        state.fatal = fatal;
    }

    markLoopStopped(token: string): void {
        const state = this.tokens.get(token);
        if (!state) {
            return;
        }
        state.loopRunning = false;
        state.lastPollStartedAt = null;
        state.lastActivityAt = Date.now();
    }

    enqueueUpdate(token: string, updateId: number): void {
        const state = this.tokens.get(token);
        if (!state) {
            return;
        }
        state.queuedUpdates += 1;
        state.lastUpdateId = updateId;
        state.lastActivityAt = Date.now();
        this.dispatcherQueued += 1;
    }

    startUpdate(token: string): void {
        const state = this.tokens.get(token);
        if (!state) {
            return;
        }
        state.queuedUpdates = Math.max(0, state.queuedUpdates - 1);
        state.inFlightUpdates += 1;
        state.lastActivityAt = Date.now();
        this.dispatcherQueued = Math.max(0, this.dispatcherQueued - 1);
        this.dispatcherInFlight += 1;
    }

    finishUpdate(token: string): void {
        const state = this.tokens.get(token);
        if (!state) {
            return;
        }
        state.inFlightUpdates = Math.max(0, state.inFlightUpdates - 1);
        state.processedUpdates += 1;
        state.lastActivityAt = Date.now();
        this.dispatcherInFlight = Math.max(0, this.dispatcherInFlight - 1);
    }

    getHealthSnapshot(now = Date.now(), staleAfterMs = DEFAULT_HEALTH_STALE_MS): PollingHealthSnapshot {
        const tokens = Object.fromEntries(Array.from(this.tokens.values()).map((state) => {
            const staleReference = state.lastPollStartedAt ?? state.lastActivityAt;
            const stale = !this.shuttingDown && now - staleReference > staleAfterMs;
            const snapshot: PollingTokenHealthSnapshot = {
                tokenId: state.tokenId,
                username: state.username,
                loopRunning: state.loopRunning,
                fatal: state.fatal,
                stale,
                consecutiveErrors: state.consecutiveErrors,
                lastPollStartedAt: toISOString(state.lastPollStartedAt),
                lastActivityAt: new Date(state.lastActivityAt).toISOString(),
                lastSuccessAt: toISOString(state.lastSuccessAt),
                lastErrorAt: toISOString(state.lastErrorAt),
                lastError: state.lastError,
                nextRetryAt: toISOString(state.nextRetryAt),
                inFlightUpdates: state.inFlightUpdates,
                queuedUpdates: state.queuedUpdates,
                processedUpdates: state.processedUpdates,
                lastUpdateId: state.lastUpdateId,
            };
            return [state.tokenId, snapshot];
        })) as Record<string, PollingTokenHealthSnapshot>;

        const snapshots = Object.values(tokens);
        const ok = !this.shuttingDown
            && snapshots.length > 0
            && snapshots.every(snapshot => snapshot.loopRunning && !snapshot.fatal && !snapshot.stale);

        return {
            ok,
            shuttingDown: this.shuttingDown,
            startedAt: new Date(this.startedAt).toISOString(),
            staleAfterMs,
            dispatcher: {
                maxConcurrent: this.dispatcherMaxConcurrent,
                queued: this.dispatcherQueued,
                inFlight: this.dispatcherInFlight,
            },
            tokens,
        };
    }
}

interface UpdateTask {
    token: string;
    updateId: number;
    run: () => Promise<void>;
}

export class PollingDispatcher {
    private readonly queue: UpdateTask[] = [];
    private readonly idleWaiters = new Set<() => void>();
    private inFlight = 0;
    private stopping = false;

    constructor(
        private readonly maxConcurrent: number,
        private readonly state: PollingStateTracker,
    ) {
        this.state.configureDispatcher(maxConcurrent);
    }

    enqueue(token: string, updateId: number, run: () => Promise<void>): boolean {
        if (this.stopping) {
            return false;
        }
        this.queue.push({ token, updateId, run });
        this.state.enqueueUpdate(token, updateId);
        this.pump();
        return true;
    }

    async stopAndDrain(timeoutMs: number): Promise<boolean> {
        this.stopping = true;
        if (this.inFlight === 0 && this.queue.length === 0) {
            return true;
        }
        return new Promise<boolean>((resolve) => {
            let timeout: ReturnType<typeof setTimeout>;
            const onIdle = () => {
                clearTimeout(timeout);
                this.idleWaiters.delete(onIdle);
                resolve(true);
            };
            timeout = setTimeout(() => {
                this.idleWaiters.delete(onIdle);
                resolve(false);
            }, timeoutMs);
            this.idleWaiters.add(onIdle);
        });
    }

    private pump(): void {
        while (this.inFlight < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift()!;
            this.inFlight += 1;
            this.state.startUpdate(task.token);
            void Promise.resolve()
                .then(task.run)
                .catch(console.error)
                .finally(() => {
                    this.inFlight = Math.max(0, this.inFlight - 1);
                    this.state.finishUpdate(task.token);
                    this.pump();
                    this.resolveIdle();
                });
        }
        this.resolveIdle();
    }

    private resolveIdle(): void {
        if (this.inFlight !== 0 || this.queue.length !== 0) {
            return;
        }
        for (const waiter of this.idleWaiters) {
            waiter();
        }
        this.idleWaiters.clear();
    }
}

export const LOCAL_POLLING_STATE = new PollingStateTracker();
