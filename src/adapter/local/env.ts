import * as fs from 'node:fs/promises';
import TOML from 'toml';

function extractTomlEnv(source: Record<string, any>): Record<string, any> {
    if (source.vars && typeof source.vars === 'object' && !Array.isArray(source.vars)) {
        return source.vars as Record<string, any>;
    }
    return source;
}

export async function loadLocalEnv(filePath: string): Promise<Record<string, any>> {
    const raw = await fs.readFile(filePath, 'utf8');
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
