import type { ModelMessage } from 'ai';
import type { WorkerContext } from '../config/context';
import { tool } from 'ai';
import { z } from 'zod';
import { ENV } from '../config/env';
import { createTelegramBotAPI } from '../telegram/api';

const GROUP_MANAGEMENT_TOOL_NAMES = ['user_profile', 'recent_history', 'search_history'] as const;
type GroupManagementToolName = typeof GROUP_MANAGEMENT_TOOL_NAMES[number];
interface SessionUserRef {
    userId: string;
    username: string | null;
    label: string;
}

function normalizeGroupManagementToolNames(input: string[]): GroupManagementToolName[] {
    return input
        .filter((name): name is GroupManagementToolName => GROUP_MANAGEMENT_TOOL_NAMES.includes(name as GroupManagementToolName));
}

function extractMessageText(message: ModelMessage): string {
    if (typeof message.content === 'string') {
        return message.content;
    }
    if (!Array.isArray(message.content)) {
        return '';
    }
    return message.content.map((part: any) => {
        switch (part.type) {
            case 'text':
            case 'reasoning':
                return part.text || '';
            case 'tool-call':
                return `tool-call:${part.toolName} ${JSON.stringify(part.input)}`;
            default:
                return `[${part.type}]`;
        }
    }).join('\n').trim();
}

function matchUser(user: SessionUserRef, {
    userId,
    username,
    nameQuery,
}: {
    userId?: string;
    username?: string;
    nameQuery?: string;
}) {
    if (userId && user.userId !== userId) {
        return false;
    }
    if (username) {
        const normalized = username.replace(/^@/, '').toLowerCase();
        if ((user.username || '').toLowerCase() !== normalized) {
            return false;
        }
    }
    if (nameQuery) {
        const haystack = `${user.label} ${user.username || ''} ${user.userId}`.toLowerCase();
        if (!haystack.includes(nameQuery.toLowerCase())) {
            return false;
        }
    }
    return true;
}

function extractSessionUsers(messages: ModelMessage[]): SessionUserRef[] {
    const users = new Map<string, SessionUserRef>();
    const regex = /(@\w+|[^()\n>]{1,80})\s*\(ID:(\d+)\)/g;

    for (const message of messages) {
        const text = extractMessageText(message);
        for (const match of text.matchAll(regex)) {
            const label = match[1].trim();
            const userId = match[2];
            const username = label.startsWith('@') ? label.slice(1) : null;
            if (!users.has(userId)) {
                users.set(userId, {
                    userId,
                    username,
                    label,
                });
            }
        }
    }

    return [...users.values()];
}

function toChatMemberSummary(member: any, sessionUser?: SessionUserRef, profilePhotoCount?: number) {
    const user = member?.user || {};
    return {
        userId: String(user.id || sessionUser?.userId || ''),
        username: user.username ?? sessionUser?.username ?? null,
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
        languageCode: user.language_code ?? null,
        isBot: Boolean(user.is_bot),
        status: member?.status ?? 'unknown',
        customTitle: member?.custom_title ?? null,
        sessionLabel: sessionUser?.label ?? null,
        profilePhotoCount: profilePhotoCount ?? null,
    };
}

function normalizeSessionMessages(messages: ModelMessage[], {
    roles,
    includeToolMessages = false,
}: {
    roles?: string[];
    includeToolMessages?: boolean;
}) {
    return messages
        .filter(item => (roles?.length ? roles.includes(item.role) : true))
        .filter(item => includeToolMessages || item.role !== 'tool')
        .map((item, index) => ({
            index,
            role: item.role,
            text: extractMessageText(item),
        }));
}

export function resolveGroupManagementTools(runtimeContext?: WorkerContext) {
    const enabledTools = normalizeGroupManagementToolNames(ENV.GROUP_MANAGEMENT);
    if (!runtimeContext || enabledTools.length === 0 || !runtimeContext.SHARE_CONTEXT.groupAdminsKey) {
        return {
            tools: {},
            activeToolNames: [],
        };
    }

    const chatId = runtimeContext.SHARE_CONTEXT.chatId;
    const api = createTelegramBotAPI(runtimeContext.SHARE_CONTEXT.botToken);
    const tools: Record<string, any> = {};

    if (enabledTools.includes('user_profile')) {
        tools.group_management_get_user_profile = tool({
            description: 'Use the Telegram API to inspect current group chat metadata, administrators, and specific members referenced in the current session.',
            inputSchema: z.object({
                userId: z.string().optional().describe('Exact Telegram user ID to match.'),
                username: z.string().optional().describe('Exact Telegram username to match, with or without @. Resolved from the current session messages.'),
                nameQuery: z.string().optional().describe('Partial display-name match resolved from the current session messages.'),
                includeAllKnownUsers: z.boolean().default(false).describe('When true, fetch member details for all user IDs referenced in the current session messages.'),
                includeAdministrators: z.boolean().default(true).describe('Whether to include current chat administrators from the Telegram API.'),
                includeProfilePhotos: z.boolean().default(false).describe('Whether to fetch profile photo counts for returned users.'),
                limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of users to return.'),
            }).refine(
                value => value.includeAllKnownUsers || Boolean(value.userId || value.username || value.nameQuery),
                'Provide at least one matcher unless includeAllKnownUsers is true.',
            ),
            execute: async ({ userId, username, nameQuery, includeAllKnownUsers, includeAdministrators, includeProfilePhotos, limit }, { messages }) => {
                const sessionUsers = extractSessionUsers(messages as ModelMessage[]);
                const matchedUsers = includeAllKnownUsers
                    ? sessionUsers
                    : sessionUsers.filter(user => matchUser(user, { userId, username, nameQuery }));
                const selectedUsers = userId && matchedUsers.length === 0
                    ? [{ userId, username: username?.replace(/^@/, '') || null, label: userId }]
                    : matchedUsers.slice(0, limit);

                const chat = await api.getChatWithReturns({ chat_id: chatId });
                const memberCount = await api.getChatMemberCountWithReturns({ chat_id: chatId });
                const administrators = includeAdministrators
                    ? await api.getChatAdministratorsWithReturns({ chat_id: chatId })
                    : null;

                const users = await Promise.all(selectedUsers.map(async (sessionUser) => {
                    const member = await api.getChatMemberWithReturns({
                        chat_id: chatId,
                        user_id: Number(sessionUser.userId),
                    });
                    const profilePhotos = includeProfilePhotos
                        ? await api.getUserProfilePhotosWithReturns({
                                user_id: Number(sessionUser.userId),
                                limit: 1,
                            })
                        : null;
                    return toChatMemberSummary(member?.result, sessionUser, profilePhotos?.result?.total_count);
                }));

                return {
                    scope: ENV.GROUP_CHAT_BOT_SHARE_MODE ? 'shared-group-session' : 'per-user-group-session',
                    note: 'History-based name resolution comes from the current session only and resets after /new.',
                    chat: {
                        id: String(chat.result?.id ?? chatId),
                        type: chat.result?.type ?? 'unknown',
                        title: (chat.result as any)?.title ?? null,
                        username: (chat.result as any)?.username ?? null,
                        description: (chat.result as any)?.description ?? null,
                        inviteLink: (chat.result as any)?.invite_link ?? null,
                        memberCount: memberCount.result ?? null,
                    },
                    administrators: (administrators?.result || []).map((admin: any) => toChatMemberSummary(admin, undefined)),
                    users,
                    sessionCandidates: sessionUsers.slice(0, limit),
                };
            },
        });
    }

    if (enabledTools.includes('recent_history')) {
        tools.group_management_get_recent_history = tool({
            description: 'Read the current session message history already attached to the model context.',
            inputSchema: z.object({
                limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of history items to return.'),
                roles: z.array(z.enum(['system', 'user', 'assistant', 'tool'])).default([]).describe('Optional role filter. Empty means all roles.'),
                includeToolMessages: z.boolean().default(false).describe('Whether to include raw tool result messages.'),
            }),
            execute: async ({ limit, roles, includeToolMessages }, { messages }) => {
                const history = normalizeSessionMessages(messages as ModelMessage[], {
                    roles: roles.length > 0 ? roles : undefined,
                    includeToolMessages,
                });
                return {
                    scope: ENV.GROUP_CHAT_BOT_SHARE_MODE ? 'shared-group-session' : 'per-user-group-session',
                    note: 'This is the current in-session model history. It resets after /new.',
                    count: history.length,
                    items: history.slice(-limit),
                };
            },
        });
    }

    if (enabledTools.includes('search_history')) {
        tools.group_management_search_history = tool({
            description: 'Search the current session message history by keyword, phrase, username, or user identifier.',
            inputSchema: z.object({
                query: z.string().min(1).describe('Search string to match against stored history text.'),
                limit: z.number().int().min(1).max(20).default(5).describe('Maximum number of matches to return.'),
                roles: z.array(z.enum(['system', 'user', 'assistant', 'tool'])).default([]).describe('Optional role filter. Empty means all roles.'),
                includeToolMessages: z.boolean().default(false).describe('Whether to search raw tool result messages too.'),
            }),
            execute: async ({ query, limit, roles, includeToolMessages }, { messages }) => {
                const normalized = normalizeSessionMessages(messages as ModelMessage[], {
                    roles: roles.length > 0 ? roles : undefined,
                    includeToolMessages,
                });
                const lowerQuery = query.toLowerCase();
                const matches = normalized
                    .filter(item => item.text.toLowerCase().includes(lowerQuery))
                    .slice(-limit);
                return {
                    scope: ENV.GROUP_CHAT_BOT_SHARE_MODE ? 'shared-group-session' : 'per-user-group-session',
                    note: 'Search runs only over the current in-session model history. It resets after /new.',
                    query,
                    count: matches.length,
                    items: matches,
                };
            },
        });
    }

    return {
        tools,
        activeToolNames: Object.keys(tools),
    };
}
