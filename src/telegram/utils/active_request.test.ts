import { describe, expect, it } from 'vitest';
import { getPendingScopedExecutionCount, registerActiveRequest, runScopedExecution, ScopeBusyError, ScopeSupersededError } from './active_request';

describe('runScopedExecution', () => {
    it('serializes requests in queue mode', async () => {
        const scopeKey = 'queue:test';
        const events: string[] = [];
        let releaseFirst = () => {};

        const first = runScopedExecution(scopeKey, 'queue', async () => {
            events.push('first:start');
            await new Promise<void>((resolve) => {
                releaseFirst = resolve;
            });
            events.push('first:end');
            return 'first';
        });

        await Promise.resolve();

        const second = runScopedExecution(scopeKey, 'queue', async () => {
            events.push('second:start');
            return 'second';
        });

        await Promise.resolve();
        expect(events).toEqual(['first:start']);

        releaseFirst();

        await expect(first).resolves.toBe('first');
        await expect(second).resolves.toBe('second');
        await Promise.resolve();
        expect(events).toEqual(['first:start', 'first:end', 'second:start']);
        expect(getPendingScopedExecutionCount(scopeKey)).toBe(0);
    });

    it('rejects new requests in drop_if_busy mode', async () => {
        const scopeKey = 'drop:test';
        let releaseFirst = () => {};

        const first = runScopedExecution(scopeKey, 'queue', async () => {
            await new Promise<void>((resolve) => {
                releaseFirst = resolve;
            });
        });

        await Promise.resolve();

        await expect(runScopedExecution(scopeKey, 'drop_if_busy', async () => 'second'))
            .rejects
            .toBeInstanceOf(ScopeBusyError);

        releaseFirst();
        await expect(first).resolves.toBeUndefined();
        await Promise.resolve();
        expect(getPendingScopedExecutionCount(scopeKey)).toBe(0);
    });

    it('keeps only the latest queued request in cancel_previous mode', async () => {
        const scopeKey = 'cancel:test';
        let markStarted = () => {};
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });

        const first = runScopedExecution(scopeKey, 'queue', async () => {
            const active = registerActiveRequest(scopeKey);
            markStarted();
            try {
                await new Promise<void>((resolve) => {
                    active.signal.addEventListener('abort', () => resolve(), { once: true });
                });
                return 'first';
            } finally {
                active.done();
            }
        });

        await started;

        const second = runScopedExecution(scopeKey, 'cancel_previous', async () => 'second');
        const third = runScopedExecution(scopeKey, 'cancel_previous', async () => 'third');

        await expect(second).rejects.toBeInstanceOf(ScopeSupersededError);
        await expect(first).resolves.toBe('first');
        await expect(third).resolves.toBe('third');
        await Promise.resolve();
        expect(getPendingScopedExecutionCount(scopeKey)).toBe(0);
    });
});
