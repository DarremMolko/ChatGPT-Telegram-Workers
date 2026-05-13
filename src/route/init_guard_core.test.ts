import { describe, expect, it } from 'vitest';
import { canUseInitRouteForSecret, INIT_SECRET_HEADER } from './init_guard_core';

function createRequest(url: string, headers: Record<string, string> = {}) {
    return new Request(url, { headers }) as any;
}

describe('canUseInitRouteForSecret', () => {
    it('rejects all requests when no init secret is configured', () => {
        const request = createRequest('https://example.com/init');
        expect(canUseInitRouteForSecret(request, '')).toBe(false);
    });

    it('requires the configured secret', () => {
        const noSecretRequest = createRequest('https://example.com/init');
        const querySecretRequest = createRequest('https://example.com/init?secret=secret-token', {
        });
        const headerSecretRequest = createRequest('https://example.com/init', {
            [INIT_SECRET_HEADER]: 'secret-token',
        });
        const bearerSecretRequest = createRequest('https://example.com/init', {
            authorization: 'Bearer secret-token',
        });

        expect(canUseInitRouteForSecret(noSecretRequest, 'secret-token')).toBe(false);
        expect(canUseInitRouteForSecret(querySecretRequest, 'secret-token')).toBe(true);
        expect(canUseInitRouteForSecret(headerSecretRequest, 'secret-token')).toBe(true);
        expect(canUseInitRouteForSecret(bearerSecretRequest, 'secret-token')).toBe(true);
    });
});
