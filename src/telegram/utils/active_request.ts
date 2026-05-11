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

const activeRequests = new Map<string, Map<string, ActiveRequestRecord>>();

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
