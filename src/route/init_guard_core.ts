import type { RouterRequest } from '../utils/router';

export const INIT_SECRET_HEADER = 'X-Init-Secret';

export function resolveInitRequestSecret(request: RouterRequest): string {
    const url = new URL(request.url);
    const querySecret = url.searchParams.get('secret');
    if (querySecret) {
        return querySecret;
    }
    const headerSecret = request.headers.get(INIT_SECRET_HEADER);
    if (headerSecret) {
        return headerSecret;
    }
    const authorization = request.headers.get('authorization') || '';
    const bearerPrefix = 'Bearer ';
    if (authorization.startsWith(bearerPrefix)) {
        return authorization.slice(bearerPrefix.length).trim();
    }
    return '';
}

export function canUseInitRouteForSecret(request: RouterRequest, initSecret: string): boolean {
    return !!initSecret && resolveInitRequestSecret(request) === initSecret;
}

export function initForbiddenMessageForSecret(initSecret: string): string {
    return initSecret
        ? `Forbidden. /init requires the configured secret via ?secret=... or the ${INIT_SECRET_HEADER} header.`
        : 'Forbidden. /init is disabled until LOCAL_INIT_SECRET is configured.';
}
