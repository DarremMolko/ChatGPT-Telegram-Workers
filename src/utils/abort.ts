export const USER_CANCELLED_REASON = 'user-cancelled';

export function abortWithReason(controller: AbortController, reason: unknown): void {
    controller.abort(reason);
}

function isAbortSignalWithReason(signal: AbortSignal | undefined, reason: unknown): boolean {
    return !!signal?.aborted && signal.reason === reason;
}

export function isUserCancelledSignal(signal: AbortSignal | undefined): boolean {
    return isAbortSignalWithReason(signal, USER_CANCELLED_REASON);
}
