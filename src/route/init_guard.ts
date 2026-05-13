import type { RouterRequest } from '../utils/router';
import { ENV } from '../config/env';
import { canUseInitRouteForSecret, INIT_SECRET_HEADER, initForbiddenMessageForSecret, resolveInitRequestSecret } from './init_guard_core';

export { INIT_SECRET_HEADER, resolveInitRequestSecret };

export function canUseInitRoute(request: RouterRequest): boolean {
    return canUseInitRouteForSecret(request, ENV.LOCAL_INIT_SECRET);
}

export function initForbiddenMessage(): string {
    return initForbiddenMessageForSecret(ENV.LOCAL_INIT_SECRET);
}
