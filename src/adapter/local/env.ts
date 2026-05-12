import * as fs from 'node:fs/promises';
import TOML from 'toml';

export interface LocalConfig {
    server?: {
        hostname?: string;
        port?: number;
        baseURL?: string;
    };
    proxy?: string;
    mode: 'webhook' | 'polling';
}

const DEFAULT_TOML_PATHS = ['./config.toml', '/app/config.toml'];

function extractTomlEnv(source: Record<string, any>): Record<string, any> {
    if (source.vars && typeof source.vars === 'object' && !Array.isArray(source.vars)) {
        return source.vars as Record<string, any>;
    }
    return source;
}

async function resolveOptionalPath(filePath: string | undefined, defaults: string[]): Promise<string | null> {
    const candidates = filePath ? [filePath] : defaults;
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            continue;
        }
    }
    return null;
}

function parseMode(value: unknown): LocalConfig['mode'] | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'webhook' || normalized === 'polling') {
        return normalized;
    }
    return undefined;
}

function parsePort(value: unknown): number | undefined {
    const raw = typeof value === 'number' ? `${value}` : `${value || ''}`.trim();
    if (!raw) {
        return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return undefined;
    }
    return parsed;
}

function readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
}

export function resolveLocalConfig(source: Record<string, any>, runtimeEnv: Record<string, any> = {}): LocalConfig {
    const mode = parseMode(runtimeEnv.LOCAL_MODE)
        || parseMode(source.LOCAL_MODE)
        || (runtimeEnv.LOCAL_HOSTNAME || runtimeEnv.LOCAL_PORT || runtimeEnv.PORT || runtimeEnv.LOCAL_BASE_URL || runtimeEnv.BASE_URL || source.LOCAL_HOSTNAME || source.LOCAL_PORT || source.PORT || source.LOCAL_BASE_URL || source.BASE_URL ? 'webhook' : 'polling');
    const hostname = readString(runtimeEnv.LOCAL_HOSTNAME) || readString(source.LOCAL_HOSTNAME);
    const port = parsePort(runtimeEnv.LOCAL_PORT) || parsePort(runtimeEnv.PORT) || parsePort(source.LOCAL_PORT) || parsePort(source.PORT);
    const baseURL = readString(runtimeEnv.LOCAL_BASE_URL) || readString(runtimeEnv.BASE_URL) || readString(source.LOCAL_BASE_URL) || readString(source.BASE_URL);
    const proxy = readString(runtimeEnv.LOCAL_PROXY) || readString(source.LOCAL_PROXY);
    const server = {
        ...(hostname ? { hostname } : {}),
        ...(port ? { port } : {}),
        ...(baseURL ? { baseURL } : {}),
    };
    return {
        mode,
        ...(proxy ? { proxy } : {}),
        ...(mode === 'webhook' || Object.keys(server).length > 0
            ? {
                    server: {
                        hostname: server.hostname || '0.0.0.0',
                        port: server.port || 8787,
                        ...(server.baseURL ? { baseURL: server.baseURL } : {}),
                    },
                }
            : {}),
    };
}

export async function loadLocalEnv(filePath?: string): Promise<Record<string, any>> {
    const resolvedPath = await resolveOptionalPath(filePath, DEFAULT_TOML_PATHS);
    if (!resolvedPath) {
        return { ...process.env };
    }
    const raw = await fs.readFile(resolvedPath, 'utf8');
    const parsed = TOML.parse(raw) as Record<string, any>;
    return {
        ...extractTomlEnv(parsed),
        ...process.env,
    };
}

export function applyProxy(proxy: string) {
    process.env.NODE_USE_ENV_PROXY = '1';
    process.env.HTTP_PROXY = proxy;
    process.env.HTTPS_PROXY = proxy;
}
