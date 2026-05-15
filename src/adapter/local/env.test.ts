import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLocalEnv, resolveLocalConfig } from './env';

async function writeTempFile(name: string, content: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgtw-local-env-'));
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('loadLocalEnv', () => {
    it('returns process env when toml file is missing', async () => {
        vi.stubEnv('OWNER_ID', 'env-owner');

        const env = await loadLocalEnv('/tmp/definitely-missing-config.toml');

        expect(env.OWNER_ID).toBe('env-owner');
    });

    it('merges toml vars with process env overrides', async () => {
        const filePath = await writeTempFile('config.toml', `
[vars]
OWNER_ID = "file-owner"
REDIS_URL = "redis://file"
`);
        vi.stubEnv('OWNER_ID', 'env-owner');

        const env = await loadLocalEnv(filePath);

        expect(env.OWNER_ID).toBe('env-owner');
        expect(env.REDIS_URL).toBe('redis://file');
    });
});

describe('resolveLocalConfig', () => {
    it('builds health server config from environment variables only', () => {
        const config = resolveLocalConfig({
            LOCAL_HOSTNAME: '127.0.0.1',
            PORT: '9999',
            LOCAL_PROXY: 'http://127.0.0.1:7890',
        });
        expect(config).toEqual({
            proxy: 'http://127.0.0.1:7890',
            server: {
                hostname: '127.0.0.1',
                port: 9999,
            },
        });
    });

    it('reads health server config from config.toml vars', async () => {
        const filePath = await writeTempFile('config.toml', `
[vars]
LOCAL_HOSTNAME = "0.0.0.0"
LOCAL_PORT = 4321
`);
        const env = await loadLocalEnv(filePath);
        const config = resolveLocalConfig(env);

        expect(config.server?.port).toBe(4321);
        expect(config.server?.hostname).toBe('0.0.0.0');
    });

    it('lets real process env override config.toml vars', async () => {
        const filePath = await writeTempFile('config.toml', `
[vars]
LOCAL_PORT = 8787
`);
        vi.stubEnv('PORT', '9999');
        const env = await loadLocalEnv(filePath);
        const config = resolveLocalConfig(env, process.env);

        expect(config.server?.port).toBe(9999);
    });

    it('creates a server config when only server env vars are present', () => {
        const config = resolveLocalConfig({
            PORT: '8787',
        });

        expect(config.server?.port).toBe(8787);
    });

    it('omits the server when no server env vars are present', () => {
        const config = resolveLocalConfig({});

        expect(config.server).toBeUndefined();
    });
});
