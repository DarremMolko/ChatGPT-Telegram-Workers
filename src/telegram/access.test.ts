import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redisMock, runtimeAdminStore } = vi.hoisted(() => {
    const store = new Map<string, string>();
    return {
        redisMock: {
            delete: vi.fn(async (key: string) => store.delete(key)),
            get: vi.fn(async (key: string) => store.get(key) ?? null),
            put: vi.fn(async (key: string, value: string) => {
                store.set(key, value);
                return true;
            }),
        },
        runtimeAdminStore: store,
    };
});

vi.mock('../config/env', () => ({
    ENV: {
        ADMIN_AVAILABLE_UTILITIES: ['chat', 'image', 'audio', 'document', 'settings', 'inline'],
        ADMIN_WHITE_LIST: ['2'],
        CHAT_GROUP_WHITE_LIST: ['100'],
        OWNER_ID: '1',
        REDIS: redisMock,
    },
}));

const { ENV } = await import('../config/env');
const {
    addRuntimeAdmin,
    canAccessGroupChat,
    canUseAdminUtility,
    canManageRuntimeConfig,
    canUseCommands,
    canUseInlineQuery,
    canUsePrivateChat,
    canViewSensitiveConfig,
    getAdminAvailableUtilities,
    getAdminWhitelist,
    getRuntimeAdminStoreKey,
    getRuntimeAdminWhitelist,
    isAdmin,
    isOwner,
    isSensitiveRuntimeConfigKey,
    removeRuntimeAdmin,
    resolveRuntimeConfigAccessLevel,
} = await import('./access');

describe('telegram access', () => {
    beforeEach(() => {
        ENV.ADMIN_AVAILABLE_UTILITIES = ['chat', 'image', 'audio', 'document', 'settings', 'inline'];
        ENV.OWNER_ID = '1';
        ENV.ADMIN_WHITE_LIST = ['2'];
        ENV.CHAT_GROUP_WHITE_LIST = ['100'];
        runtimeAdminStore.clear();
        redisMock.delete.mockClear();
        redisMock.get.mockClear();
        redisMock.put.mockClear();
    });

    it('recognizes the owner and configured admins', async () => {
        expect(isOwner(1)).toBe(true);
        await expect(isAdmin(1, '999:token')).resolves.toBe(true);
        await expect(isAdmin(2, '999:token')).resolves.toBe(true);
        await expect(isAdmin(3, '999:token')).resolves.toBe(false);
    });

    it('merges configured and runtime admins without repeating the owner', async () => {
        ENV.ADMIN_WHITE_LIST = ['2', '1', '2'];
        runtimeAdminStore.set(getRuntimeAdminStoreKey('999:token'), JSON.stringify(['3', '2', '1']));

        await expect(getRuntimeAdminWhitelist('999:token')).resolves.toEqual(['3', '2']);
        await expect(getAdminWhitelist('999:token')).resolves.toEqual(['2', '3']);
    });

    it('allows runtime-promoted admins in private chats and commands', async () => {
        await addRuntimeAdmin('3', '999:token');

        await expect(canUsePrivateChat(1, '999:token')).resolves.toBe(true);
        await expect(canUsePrivateChat(2, '999:token')).resolves.toBe(true);
        await expect(canUsePrivateChat(3, '999:token')).resolves.toBe(true);
        await expect(canUseCommands(3, '999:token')).resolves.toBe(true);
        await expect(canUseInlineQuery(3, '999:token')).resolves.toBe(true);
        await expect(canUseCommands(4, '999:token')).resolves.toBe(false);
    });

    it('allows any user in allowlisted groups', () => {
        expect(canAccessGroupChat(100)).toBe(true);
        expect(canAccessGroupChat(101)).toBe(false);
    });

    it('treats secrets, prompt surfaces, and MCP as sensitive config', () => {
        expect(isSensitiveRuntimeConfigKey('OPENAI_API_KEY')).toBe(true);
        expect(isSensitiveRuntimeConfigKey('SYSTEM_INIT_MESSAGE')).toBe(true);
        expect(isSensitiveRuntimeConfigKey('USE_MCP')).toBe(true);
        expect(isSensitiveRuntimeConfigKey('OPENAI_CHAT_MODEL')).toBe(false);
    });

    it('restricts sensitive config edits to admins and the owner based on the effective admin list', async () => {
        await addRuntimeAdmin('3', '999:token');

        await expect(canManageRuntimeConfig(1, 'OPENAI_API_KEY', '999:token')).resolves.toBe(true);
        await expect(canManageRuntimeConfig(2, 'OPENAI_API_KEY', '999:token')).resolves.toBe(false);
        await expect(canManageRuntimeConfig(3, 'OPENAI_CHAT_MODEL', '999:token')).resolves.toBe(true);
    });

    it('filters and enforces the configured admin utility list', async () => {
        ENV.ADMIN_AVAILABLE_UTILITIES = ['chat', 'document', 'settings', 'invalid'];
        await addRuntimeAdmin('3', '999:token');

        expect(getAdminAvailableUtilities()).toEqual(['chat', 'document', 'settings']);
        await expect(canUseAdminUtility(1, 'inline', '999:token')).resolves.toBe(true);
        await expect(canUseAdminUtility(3, 'chat', '999:token')).resolves.toBe(true);
        await expect(canUseAdminUtility(3, 'document', '999:token')).resolves.toBe(true);
        await expect(canUseAdminUtility(3, 'image', '999:token')).resolves.toBe(false);
        await expect(canUseInlineQuery(3, '999:token')).resolves.toBe(false);
        await expect(canManageRuntimeConfig(3, 'OPENAI_CHAT_MODEL', '999:token')).resolves.toBe(true);
        await expect(canManageRuntimeConfig(3, 'OPENAI_API_KEY', '999:token')).resolves.toBe(false);
    });

    it('shows sensitive config values only to the owner', () => {
        expect(canViewSensitiveConfig(1)).toBe(true);
        expect(canViewSensitiveConfig(2)).toBe(false);
    });

    it('escalates sensitive key changes to owner access', () => {
        expect(resolveRuntimeConfigAccessLevel(['OPENAI_CHAT_MODEL'])).toBe('admin');
        expect(resolveRuntimeConfigAccessLevel(['OPENAI_CHAT_MODEL', 'OPENAI_API_KEY'])).toBe('owner');
    });

    it('can remove runtime admins but not env-pinned admins', async () => {
        await addRuntimeAdmin('3', '999:token');

        await expect(removeRuntimeAdmin('2', '999:token')).resolves.toEqual({
            blockedByConfig: true,
            removed: false,
            runtimeAdmins: ['3'],
        });
        await expect(removeRuntimeAdmin('3', '999:token')).resolves.toEqual({
            blockedByConfig: false,
            removed: true,
            runtimeAdmins: [],
        });
        expect(redisMock.delete).toHaveBeenCalledWith('admin_whitelist:999');
    });

    it('does not grant access outside the owner/admin and group allowlists', async () => {
        await expect(canUsePrivateChat(999, '999:token')).resolves.toBe(false);
        await expect(canUseCommands(999, '999:token')).resolves.toBe(false);
        expect(canAccessGroupChat(999)).toBe(false);
        await expect(canManageRuntimeConfig(999, 'OPENAI_API_KEY', '999:token')).resolves.toBe(false);
    });
});
