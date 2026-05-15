import { log } from '../../log';
import { abortWithReason, isUserCancelledSignal, USER_CANCELLED_REASON } from '../../utils/abort';

interface ActiveRequestRecord {
    id: string;
    controller: AbortController;
}

export interface ActiveRequestHandle {
    signal: AbortSignal;
    done: () => void;
    isUserCancelled: () => boolean;
}

export type ScopedExecutionPolicy = 'queue' | 'cancel_previous' | 'drop_if_busy' | 'parallel';

const activeRequests = new Map<string, Map<string, ActiveRequestRecord>>();
const scopedExecutions = new Map<string, {
    pendingCount: number;
    tail: Promise<void>;
    latestToken: number;
}>();

export class ScopeBusyError extends Error {
    constructor(scopeKey: string) {
        super(`Another request is already running for scope ${scopeKey}`);
        this.name = 'ScopeBusyError';
    }
}

export class ScopeSupersededError extends Error {
    constructor(scopeKey: string) {
        super(`Request was superseded for scope ${scopeKey}`);
        this.name = 'ScopeSupersededError';
    }
}

function getScope(scopeKey: string): Map<string, ActiveRequestRecord> {
    let scope = activeRequests.get(scopeKey);
    if (!scope) {
        scope = new Map<string, ActiveRequestRecord>();
        activeRequests.set(scopeKey, scope);
    }
    return scope;
}

function cleanupScope(scopeKey: string): void {
    const scope = activeRequests.get(scopeKey);
    if (scope && scope.size === 0) {
        activeRequests.delete(scopeKey);
    }
}

function getExecutionState(scopeKey: string) {
    let state = scopedExecutions.get(scopeKey);
    if (!state) {
        state = {
            pendingCount: 0,
            tail: Promise.resolve(),
            latestToken: 0,
        };
        scopedExecutions.set(scopeKey, state);
    }
    return state;
}

function cleanupExecutionState(scopeKey: string, state: { pendingCount: number }) {
    if (state.pendingCount <= 0) {
        scopedExecutions.delete(scopeKey);
    }
}

export function registerActiveRequest(scopeKey: string): ActiveRequestHandle {
    const scope = getScope(scopeKey);
    const record: ActiveRequestRecord = {
        id: `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
        controller: new AbortController(),
    };
    scope.set(record.id, record);
    log.info(`[ACTIVE REQUEST] registered scope=${scopeKey} requestId=${record.id} active=${scope.size}`);

    return {
        signal: record.controller.signal,
        done: () => {
            scope.delete(record.id);
            log.info(`[ACTIVE REQUEST] completed scope=${scopeKey} requestId=${record.id} active=${scope.size}`);
            cleanupScope(scopeKey);
        },
        isUserCancelled: () => isUserCancelledSignal(record.controller.signal),
    };
}

export function getPendingScopedExecutionCount(scopeKey: string): number {
    return scopedExecutions.get(scopeKey)?.pendingCount ?? 0;
}

export async function runScopedExecution<T>(scopeKey: string, policy: ScopedExecutionPolicy, task: () => Promise<T>): Promise<T> {
    if (policy === 'parallel') {
        log.info(`[SCOPED EXECUTION] scope=${scopeKey} policy=${policy} action=run-immediately`);
        return task();
    }

    const state = getExecutionState(scopeKey);
    if (policy === 'drop_if_busy' && state.pendingCount > 0) {
        log.warn(`[SCOPED EXECUTION] scope=${scopeKey} policy=${policy} action=drop pending=${state.pendingCount}`);
        throw new ScopeBusyError(scopeKey);
    }

    const token = policy === 'cancel_previous' ? state.latestToken + 1 : state.latestToken;
    if (policy === 'cancel_previous') {
        state.latestToken = token;
        if (state.pendingCount > 0) {
            log.info(`[SCOPED EXECUTION] scope=${scopeKey} policy=${policy} action=cancel-previous pending=${state.pendingCount}`);
            cancelActiveRequests(scopeKey);
        }
    }

    const pendingBefore = state.pendingCount;
    state.pendingCount++;
    log.info(`[SCOPED EXECUTION] scope=${scopeKey} policy=${policy} action=queued pendingBefore=${pendingBefore} pendingAfter=${state.pendingCount}`);
    let finalized = false;
    const finalize = () => {
        if (finalized) {
            return;
        }
        finalized = true;
        state.pendingCount--;
        log.info(`[SCOPED EXECUTION] scope=${scopeKey} policy=${policy} action=finalized pending=${state.pendingCount}`);
        cleanupExecutionState(scopeKey, state);
    };

    const waitForTurn = state.tail.catch(() => undefined);
    const taskPromise = waitForTurn.then(async () => {
        if (policy === 'cancel_previous' && token !== state.latestToken) {
            log.info(`[SCOPED EXECUTION] scope=${scopeKey} policy=${policy} action=superseded token=${token} latest=${state.latestToken}`);
            throw new ScopeSupersededError(scopeKey);
        }
        log.info(`[SCOPED EXECUTION] scope=${scopeKey} policy=${policy} action=start pending=${state.pendingCount}`);
        return task();
    });
    state.tail = taskPromise.then(() => undefined, () => undefined).finally(finalize);
    return taskPromise;
}

export function cancelActiveRequests(scopeKey: string): number {
    const scope = activeRequests.get(scopeKey);
    if (!scope) {
        log.info(`[ACTIVE REQUEST] cancel scope=${scopeKey} cancelled=0`);
        return 0;
    }

    let cancelled = 0;
    for (const record of scope.values()) {
        if (record.controller.signal.aborted) {
            continue;
        }
        abortWithReason(record.controller, USER_CANCELLED_REASON);
        cancelled++;
    }
    log.info(`[ACTIVE REQUEST] cancel scope=${scopeKey} cancelled=${cancelled}`);
    return cancelled;
}

export function getActiveRequestCount(scopeKey: string): number {
    return activeRequests.get(scopeKey)?.size ?? 0;
}
