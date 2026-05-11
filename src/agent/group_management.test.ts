import { beforeEach, describe, expect, it, vi } from 'vitest';

const getChatWithReturns = vi.fn();
const getChatMemberCountWithReturns = vi.fn();
const getChatAdministratorsWithReturns = vi.fn();
const getChatMemberWithReturns = vi.fn();
const getUserProfilePhotosWithReturns = vi.fn();

vi.mock('../config/env', () => ({
    ENV: {
        GROUP_MANAGEMENT: ['user_profile', 'recent_history', 'search_history'],
        GROUP_CHAT_BOT_SHARE_MODE: true,
    },
}));

vi.mock('../telegram/api', () => ({
    createTelegramBotAPI: vi.fn(() => ({
        getChatWithReturns,
        getChatMemberCountWithReturns,
        getChatAdministratorsWithReturns,
        getChatMemberWithReturns,
        getUserProfilePhotosWithReturns,
    })),
}));

const { resolveGroupManagementTools } = await import('./group_management');

describe('resolveGroupManagementTools', () => {
    beforeEach(() => {
        getChatWithReturns.mockReset();
        getChatMemberCountWithReturns.mockReset();
        getChatAdministratorsWithReturns.mockReset();
        getChatMemberWithReturns.mockReset();
        getUserProfilePhotosWithReturns.mockReset();
    });

    it('returns no tools outside group contexts', () => {
        const resolved = resolveGroupManagementTools({
            SHARE_CONTEXT: {},
        } as any);

        expect(resolved.activeToolNames).toEqual([]);
        expect(resolved.tools).toEqual({});
    });

    it('uses Telegram API data for the current group chat', async () => {
        getChatWithReturns.mockResolvedValue({
            result: {
                id: 10001,
                type: 'supergroup',
                title: 'Moderation Room',
                username: 'mod_room',
                description: 'discussion',
            },
        });
        getChatMemberCountWithReturns.mockResolvedValue({ result: 128 });
        getChatAdministratorsWithReturns.mockResolvedValue({
            result: [{
                status: 'administrator',
                user: {
                    id: 7,
                    is_bot: false,
                    first_name: 'Admin',
                    username: 'groupadmin',
                },
            }],
        });
        getChatMemberWithReturns.mockResolvedValue({
            result: {
                status: 'member',
                user: {
                    id: 42,
                    is_bot: false,
                    first_name: 'Alice',
                    username: 'alice',
                    language_code: 'en',
                },
            },
        });
        getUserProfilePhotosWithReturns.mockResolvedValue({
            result: {
                total_count: 3,
            },
        });

        const resolved = resolveGroupManagementTools({
            SHARE_CONTEXT: {
                botToken: '123456:token',
                chatId: 10001,
                groupAdminsKey: 'group_admin:10001',
            },
        } as any);

        const result = await resolved.tools.group_management_get_user_profile.execute({
            username: '@alice',
            limit: 10,
            includeAllKnownUsers: false,
            includeProfilePhotos: true,
            includeAdministrators: true,
        }, {
            messages: [{
                role: 'user',
                content: '@alice (ID:42) asked about the rules',
            }],
        });

        expect(result).toEqual(expect.objectContaining({
            scope: 'shared-group-session',
            note: expect.stringContaining('/new'),
            chat: expect.objectContaining({
                id: '10001',
                memberCount: 128,
            }),
        }));
        expect(result.users).toEqual([expect.objectContaining({
            userId: '42',
            username: 'alice',
            firstName: 'Alice',
            profilePhotoCount: 3,
        })]);
        expect(result.administrators).toEqual([expect.objectContaining({
            userId: '7',
            username: 'groupadmin',
        })]);
    });

    it('returns recent session history and search matches', async () => {
        const resolved = resolveGroupManagementTools({
            SHARE_CONTEXT: {
                botToken: '123456:token',
                chatId: 10001,
                groupAdminsKey: 'group_admin:10001',
            },
        } as any);
        const messages = [
            { role: 'user', content: 'Alice asked about spam reports' },
            { role: 'assistant', content: 'I summarized the spam reports.' },
        ];

        const history = await resolved.tools.group_management_get_recent_history.execute({
            limit: 10,
            roles: [],
            includeToolMessages: false,
        }, {
            messages,
        });
        const search = await resolved.tools.group_management_search_history.execute({
            query: 'spam',
            limit: 5,
            roles: [],
            includeToolMessages: false,
        }, {
            messages,
        });

        expect(history.items).toHaveLength(2);
        expect(history.note).toContain('/new');
        expect(search.items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                text: expect.stringContaining('spam'),
            }),
        ]));
    });
});
