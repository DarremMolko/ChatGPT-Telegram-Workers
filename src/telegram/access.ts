import type { AdminUtility } from '../config/access_control';
import { ADMIN_UTILITY_TYPES } from '../config/access_control';
import { ENV } from '../config/env';

export type CommandAccessLevel = 'admin' | 'owner';
export interface UserAccessState {
    userId: string;
    isOwner: boolean;
    isAdmin: boolean;
}

const RUNTIME_ADMIN_STORE_KEY_PREFIX = 'admin_whitelist';

const OWNER_ONLY_RUNTIME_CONFIG_KEYS = new Set([
    'BLOCKLIST',
    'CALLBACK_MENU',
    'ENVS_VARIABLES',
    'MAPPING_KEY',
    'MAPPING_VALUE',
    'MESSAGE_REPLACER',
    'OAILIKE_MODELS',
    'OAILIKE_MODELS_API',
    'OAILIKE_PROVIDER_OPTIONS',
    'OAILIKE_TTS_PROMPT',
    'OPENAI_MODELS',
    'OPENAI_MODELS_API',
    'OPENAI_PROVIDER_OPTIONS',
    'OPENAI_TTS_PROMPT',
    'PARAMS_MODIFIER',
    'PROMPT',
    'SYSTEM_INIT_MESSAGE',
    'USE_MCP',
    'USE_OPENAI_BUILDIN',
]);

const OWNER_ONLY_RUNTIME_CONFIG_SUFFIXES = [
    'API',
    'BASE',
    'COOKIE',
    'CREDENTIALS',
    'ID',
    'KEY',
    'SECRET',
    'TOKEN',
    'URL',
];

const DEFAULT_ADMIN_AVAILABLE_UTILITIES = [...ADMIN_UTILITY_TYPES];

function normalizeId(id: number | string | null | undefined): string {
    if (id === null || id === undefined) {
        return '';
    }
    return `${id}`.trim();
}

export function getOwnerId(): string {
    return normalizeId(ENV.OWNER_ID);
}

function normalizeBotId(botIdOrToken: number | string | null | undefined): string {
    const normalizedBotId = normalizeId(botIdOrToken);
    if (normalizedBotId.includes(':')) {
        return normalizedBotId.split(':')[0] || '';
    }
    return normalizedBotId;
}

function normalizeWhitelist(values: Array<number | string | null | undefined>): string[] {
    const ownerId = getOwnerId();
    return Array.from(new Set(values.map(id => normalizeId(id)).filter(Boolean))).filter(id => id !== ownerId);
}

export function getConfiguredAdminWhitelist(): string[] {
    return normalizeWhitelist(ENV.ADMIN_WHITE_LIST);
}

export function getRuntimeAdminStoreKey(botIdOrToken: number | string | null | undefined): string {
    const botId = normalizeBotId(botIdOrToken);
    return `${RUNTIME_ADMIN_STORE_KEY_PREFIX}:${botId}`;
}

export async function getRuntimeAdminWhitelist(botIdOrToken: number | string | null | undefined): Promise<string[]> {
    const botId = normalizeBotId(botIdOrToken);
    if (!botId || !ENV.REDIS) {
        return [];
    }
    try {
        const raw = await ENV.REDIS.get(getRuntimeAdminStoreKey(botId));
        const parsed = JSON.parse(raw || '[]');
        if (!Array.isArray(parsed)) {
            return [];
        }
        return normalizeWhitelist(parsed);
    } catch {
        return [];
    }
}

async function storeRuntimeAdminWhitelist(botIdOrToken: number | string | null | undefined, adminIds: string[]): Promise<string[]> {
    const botId = normalizeBotId(botIdOrToken);
    if (!botId || !ENV.REDIS) {
        return [];
    }
    const configuredAdmins = getConfiguredAdminWhitelist();
    const nextRuntimeAdmins = normalizeWhitelist(adminIds).filter(id => !configuredAdmins.includes(id));
    const storeKey = getRuntimeAdminStoreKey(botId);
    if (nextRuntimeAdmins.length === 0) {
        await ENV.REDIS.delete(storeKey);
        return [];
    }
    await ENV.REDIS.put(storeKey, JSON.stringify(nextRuntimeAdmins));
    return nextRuntimeAdmins;
}

export async function getAdminWhitelist(botIdOrToken?: number | string | null): Promise<string[]> {
    return normalizeWhitelist([
        ...getConfiguredAdminWhitelist(),
        ...(await getRuntimeAdminWhitelist(botIdOrToken)),
    ]);
}

export function isOwner(userId?: number | string | null): boolean {
    const normalizedUserId = normalizeId(userId);
    return normalizedUserId !== '' && normalizedUserId === getOwnerId();
}

export async function resolveUserAccess(userId: number | string | null | undefined, botIdOrToken?: number | string | null): Promise<UserAccessState> {
    const normalizedUserId = normalizeId(userId);
    const owner = normalizedUserId !== '' && normalizedUserId === getOwnerId();
    if (owner) {
        return {
            userId: normalizedUserId,
            isOwner: true,
            isAdmin: true,
        };
    }
    return {
        userId: normalizedUserId,
        isOwner: false,
        isAdmin: normalizedUserId !== '' && (await getAdminWhitelist(botIdOrToken)).includes(normalizedUserId),
    };
}

export async function isAdmin(userId?: number | string | null, botIdOrToken?: number | string | null): Promise<boolean> {
    return (await resolveUserAccess(userId, botIdOrToken)).isAdmin;
}

export async function isPrivilegedUser(userId?: number | string | null, botIdOrToken?: number | string | null): Promise<boolean> {
    return (await resolveUserAccess(userId, botIdOrToken)).isAdmin;
}

export function getAdminAvailableUtilities(): AdminUtility[] {
    const configured = Array.isArray(ENV.ADMIN_AVAILABLE_UTILITIES) ? ENV.ADMIN_AVAILABLE_UTILITIES : DEFAULT_ADMIN_AVAILABLE_UTILITIES;
    return configured.filter((utility): utility is AdminUtility => ADMIN_UTILITY_TYPES.includes(utility as AdminUtility));
}

export function isAdminUtilityEnabled(utility: AdminUtility): boolean {
    return getAdminAvailableUtilities().includes(utility);
}

export function canUseAdminUtilityForAccess(access: Pick<UserAccessState, 'isOwner' | 'isAdmin'>, utility: AdminUtility): boolean {
    if (access.isOwner) {
        return true;
    }
    return access.isAdmin && isAdminUtilityEnabled(utility);
}

export async function canUseAdminUtility(userId: number | string | null | undefined, utility: AdminUtility, botIdOrToken?: number | string | null): Promise<boolean> {
    return canUseAdminUtilityForAccess(await resolveUserAccess(userId, botIdOrToken), utility);
}

export function describeAdminUtilityDisabled(utility: AdminUtility): string {
    return `Permission denied, admin utility ${utility} is disabled`;
}

export function canUsePrivateChatForAccess(access: UserAccessState): boolean {
    return access.isAdmin;
}

export async function canUsePrivateChat(userId?: number | string | null, botIdOrToken?: number | string | null): Promise<boolean> {
    return canUsePrivateChatForAccess(await resolveUserAccess(userId, botIdOrToken));
}

export function canUseCommandsForAccess(access: UserAccessState): boolean {
    return access.isAdmin;
}

export async function canUseCommands(userId?: number | string | null, botIdOrToken?: number | string | null): Promise<boolean> {
    return canUseCommandsForAccess(await resolveUserAccess(userId, botIdOrToken));
}

export function canUseInlineQueryForAccess(access: UserAccessState): boolean {
    return canUseAdminUtilityForAccess(access, 'inline');
}

export async function canUseInlineQuery(userId?: number | string | null, botIdOrToken?: number | string | null): Promise<boolean> {
    return canUseInlineQueryForAccess(await resolveUserAccess(userId, botIdOrToken));
}

export function resolveCommandAccess(access?: string[] | null): CommandAccessLevel {
    return access?.includes('owner') ? 'owner' : 'admin';
}

export async function hasCommandAccess(userId: number | string | null | undefined, accessLevel: CommandAccessLevel, botIdOrToken?: number | string | null): Promise<boolean> {
    const access = await resolveUserAccess(userId, botIdOrToken);
    return accessLevel === 'owner' ? access.isOwner : access.isAdmin;
}

export function describeCommandAccess(accessLevel: CommandAccessLevel): string {
    return accessLevel;
}

export function canAccessGroupChat(chatId?: number | string | null): boolean {
    const normalizedChatId = normalizeId(chatId);
    return normalizedChatId !== '' && ENV.CHAT_GROUP_WHITE_LIST.includes(normalizedChatId);
}

export function canViewSensitiveConfig(userId?: number | string | null): boolean {
    return isOwner(userId);
}

export function canViewSensitiveConfigForAccess(access: Pick<UserAccessState, 'isOwner'>): boolean {
    return access.isOwner;
}

export function isSensitiveRuntimeConfigKey(key: string): boolean {
    return OWNER_ONLY_RUNTIME_CONFIG_KEYS.has(key)
        || OWNER_ONLY_RUNTIME_CONFIG_SUFFIXES.some(suffix => key.endsWith(suffix));
}

export function canManageRuntimeConfigForAccess(access: Pick<UserAccessState, 'isOwner' | 'isAdmin'>, key: string): boolean {
    if (access.isOwner) {
        return true;
    }
    return canUseAdminUtilityForAccess(access, 'settings') && !isSensitiveRuntimeConfigKey(key);
}

export async function canManageRuntimeConfig(userId: number | string | null | undefined, key: string, botIdOrToken?: number | string | null): Promise<boolean> {
    return canManageRuntimeConfigForAccess(await resolveUserAccess(userId, botIdOrToken), key);
}

export function resolveRuntimeConfigAccessLevel(keys: string[]): CommandAccessLevel {
    return keys.some(isSensitiveRuntimeConfigKey) ? 'owner' : 'admin';
}

export async function addRuntimeAdmin(userId: number | string | null | undefined, botIdOrToken?: number | string | null): Promise<string[]> {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId || isOwner(normalizedUserId) || getConfiguredAdminWhitelist().includes(normalizedUserId)) {
        return getRuntimeAdminWhitelist(botIdOrToken);
    }
    const runtimeAdmins = await getRuntimeAdminWhitelist(botIdOrToken);
    if (runtimeAdmins.includes(normalizedUserId)) {
        return runtimeAdmins;
    }
    return storeRuntimeAdminWhitelist(botIdOrToken, [...runtimeAdmins, normalizedUserId]);
}

export async function removeRuntimeAdmin(userId: number | string | null | undefined, botIdOrToken?: number | string | null): Promise<{ runtimeAdmins: string[]; removed: boolean; blockedByConfig: boolean }> {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
        return {
            runtimeAdmins: await getRuntimeAdminWhitelist(botIdOrToken),
            removed: false,
            blockedByConfig: false,
        };
    }
    if (getConfiguredAdminWhitelist().includes(normalizedUserId)) {
        return {
            runtimeAdmins: await getRuntimeAdminWhitelist(botIdOrToken),
            removed: false,
            blockedByConfig: true,
        };
    }
    const runtimeAdmins = await getRuntimeAdminWhitelist(botIdOrToken);
    if (!runtimeAdmins.includes(normalizedUserId)) {
        return {
            runtimeAdmins,
            removed: false,
            blockedByConfig: false,
        };
    }
    return {
        runtimeAdmins: await storeRuntimeAdminWhitelist(botIdOrToken, runtimeAdmins.filter(id => id !== normalizedUserId)),
        removed: true,
        blockedByConfig: false,
    };
}
