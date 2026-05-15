import { describe, expect, it } from 'vitest';
import { PollingDispatcher, PollingStateTracker } from './polling_runtime';

describe('pollingStateTracker', () => {
    it('reports healthy state after a successful poll', () => {
        const state = new PollingStateTracker();
        state.configureDispatcher(4);
        state.registerToken('123:token', 'demo_bot');
        state.markPollStarted('123:token');
        state.markPollSuccess('123:token');

        const snapshot = state.getHealthSnapshot();

        expect(snapshot.ok).toBe(true);
        expect(snapshot.tokens['123']?.username).toBe('demo_bot');
        expect(snapshot.tokens['123']?.fatal).toBe(false);
    });

    it('reports unhealthy state after a fatal polling error', () => {
        const state = new PollingStateTracker();
        state.configureDispatcher(4);
        state.registerToken('123:token', 'demo_bot');
        state.markPollError('123:token', 'Unauthorized', null, true);
        state.markLoopStopped('123:token');

        const snapshot = state.getHealthSnapshot();

        expect(snapshot.ok).toBe(false);
        expect(snapshot.tokens['123']?.fatal).toBe(true);
        expect(snapshot.tokens['123']?.lastError).toContain('Unauthorized');
    });
});

describe('pollingDispatcher', () => {
    it('bounds concurrent update execution', async () => {
        const state = new PollingStateTracker();
        const dispatcher = new PollingDispatcher(2, state);
        state.registerToken('123:token', 'demo_bot');

        let running = 0;
        let maxRunning = 0;
        const runTask = async () => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            await new Promise(resolve => setTimeout(resolve, 10));
            running -= 1;
        };

        dispatcher.enqueue('123:token', 1, runTask);
        dispatcher.enqueue('123:token', 2, runTask);
        dispatcher.enqueue('123:token', 3, runTask);
        const drained = await dispatcher.stopAndDrain(1000);

        expect(drained).toBe(true);
        expect(maxRunning).toBe(2);
        expect(state.getHealthSnapshot().dispatcher.queued).toBe(0);
        expect(state.getHealthSnapshot().dispatcher.inFlight).toBe(0);
    });
});
