/**
 * Statistics module (in-memory version)
 * Records bot usage data.
 * Stats reset after Docker/container restarts.
 */

import type { WorkerContextBase } from '../config/context';
import { getLocalDateKey } from './others/time';

export interface StatsData {
    totalUsers: number;
    totalGroups: number;
    totalMessages: number;
    todayMessages: number;
}

// In-memory storage
class StatsStore {
    private users: Set<string> = new Set();
    private groups: Set<string> = new Set();
    private totalMessages = 0;
    private dailyMessages: Map<string, number> = new Map();

    addUser(userId: string): void {
        this.users.add(userId);
    }

    addGroup(groupId: string): void {
        this.groups.add(groupId);
    }

    incrementMessage(): void {
        this.totalMessages++;
    }

    incrementDailyMessage(): void {
        const today = getLocalDateKey();
        const current = this.dailyMessages.get(today) || 0;
        this.dailyMessages.set(today, current + 1);
    }

    getStats(): StatsData {
        const today = getLocalDateKey();
        return {
            totalUsers: this.users.size,
            totalGroups: this.groups.size,
            totalMessages: this.totalMessages,
            todayMessages: this.dailyMessages.get(today) || 0,
        };
    }

    // Clean expired daily stats (keep the most recent 7 days).
    cleanOldDailyStats(): void {
        const today = new Date();
        const keepDays = 7;
        const oldestDate = new Date(today.getTime() - keepDays * 24 * 60 * 60 * 1000);
        const oldestDateStr = getLocalDateKey(oldestDate);

        for (const [date] of this.dailyMessages) {
            if (date < oldestDateStr) {
                this.dailyMessages.delete(date);
            }
        }
    }
}

// Global stats storage instances grouped by botId.
const statsStores: Map<string, StatsStore> = new Map();

function getStatsStore(botId: string): StatsStore {
    if (!statsStores.has(botId)) {
        statsStores.set(botId, new StatsStore());
    }
    return statsStores.get(botId)!;
}

/**
 * Record user activity.
 * @param context - Context object
 */
export async function recordUserActivity(context: WorkerContextBase, message: any): Promise<void> {
    try {
        const chatId = message?.chat?.id;
        const speakerId = message?.from?.id;
        const chatType = message?.chat?.type;
        const botId = context.SHARE_CONTEXT.botId;

        if (!chatId || !botId) {
            return;
        }

        const store = getStatsStore(String(botId));

        // 1. Record the user.
        if (speakerId) {
            store.addUser(String(speakerId));
        }

        // 2. Record the group.
        if (chatType === 'group' || chatType === 'supergroup') {
            store.addGroup(String(chatId));
        }

        // 3. Increase total message count.
        store.incrementMessage();

        // 4. Increase today's message count.
        store.incrementDailyMessage();

        // Periodically clean old data (once every 100 messages).
        if (store.getStats().totalMessages % 100 === 0) {
            store.cleanOldDailyStats();
        }
    } catch (e) {
        // Stats failures should not affect the main flow.
        console.error('Stats recording error:', e);
    }
}

/**
 * Get statistics.
 * @param botId - Bot ID
 * @returns Statistics data
 */
export function getStats(botId: string): StatsData {
    try {
        const store = getStatsStore(botId);
        return store.getStats();
    } catch (e) {
        console.error('Stats retrieval error:', e);
        return {
            totalUsers: 0,
            totalGroups: 0,
            totalMessages: 0,
            todayMessages: 0,
        };
    }
}
