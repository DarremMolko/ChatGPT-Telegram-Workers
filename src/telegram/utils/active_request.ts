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

    return {
        signal: record.controller.signal,
        done: () => {
            scope.delete(record.id);
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
        return task();
    }

    const state = getExecutionState(scopeKey);
    if (policy === 'drop_if_busy' && state.pendingCount > 0) {
        throw new ScopeBusyError(scopeKey);
    }

    const token = policy === 'cancel_previous' ? state.latestToken + 1 : state.latestToken;
    if (policy === 'cancel_previous') {
        state.latestToken = token;
        if (state.pendingCount > 0) {
            cancelActiveRequests(scopeKey);
        }
    }

    state.pendingCount++;
    let finalized = false;
    const finalize = () => {
        if (finalized) {
            return;
        }
        finalized = true;
        state.pendingCount--;
        cleanupExecutionState(scopeKey, state);
    };

    const waitForTurn = state.tail.catch(() => undefined);
    const taskPromise = waitForTurn.then(async () => {
        if (policy === 'cancel_previous' && token !== state.latestToken) {
            throw new ScopeSupersededError(scopeKey);
        }
        return task();
    });
    state.tail = taskPromise.then(() => undefined, () => undefined).finally(finalize);
    return taskPromise;
}

export function cancelActiveRequests(scopeKey: string): number {
    const scope = activeRequests.get(scopeKey);
    if (!scope) {
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
    return cancelled;
}

export function getActiveRequestCount(scopeKey: string): number {
    return activeRequests.get(scopeKey)?.size ?? 0;
}
