import type { AgentUserConfig } from './env';

export class ConfigMerger {
    static parseArray(raw: string): string[] {
        raw = raw.trim();
        if (raw === '') {
            return [];
        }
        if (raw.startsWith('[') && raw.endsWith(']')) {
            try {
                return JSON.parse(raw);
            } catch (e) {
                console.error(e);
            }
        }
        return raw.split(',');
    }

    static trim(source: AgentUserConfig, exclude: string[] = []): Record<string, any> {
        const config: Record<string, any> = { ...source };
        const keysSet = new Set<string>(source?.DEFINE_KEYS || []);
        for (const key of exclude) {
            keysSet.delete(key);
        }
        keysSet.add('DEFINE_KEYS');
        for (const key of Object.keys(config)) {
            if (!keysSet.has(key)) {
                delete config[key];
            }
        }
        return config;
    };

    static merge(target: Record<string, any>, source: Record<string, any>, exclude?: string[]) {
        const sourceKeys = new Set(Object.keys(source));
        const numberKeys = ['CHAT_TEMPERATURE', 'FUNCTION_CALL_TEMPERATURE', 'MAX_TOKENS'];
        for (const key of Object.keys(target)) {
            // Skip keys that do not exist in the source.
            if (!sourceKeys.has(key)) {
                continue;
            }
            if (exclude?.includes(key)) {
                continue;
            }
            if (numberKeys.includes(key)) {
                target[key] = source[key] && +source[key];
                continue;
            }
            // Default to string type.
            const t = (target[key] !== null && target[key] !== undefined) ? typeof target[key] : 'string';
            // Assign directly when the source value is not a string.
            if (typeof source[key] !== 'string') {
                target[key] = source[key];
                continue;
            }
            switch (t) {
                case 'number': {
                    const parsed = Number.parseInt(source[key], 10);
                    target[key] = Number.isNaN(parsed) ? target[key] : parsed;
                    break;
                }
                case 'boolean':
                    target[key] = (source[key] || 'false') === 'true';
                    break;
                case 'string':
                    target[key] = source[key];
                    break;
                case 'object':
                    if (Array.isArray(target[key])) {
                        target[key] = ConfigMerger.parseArray(source[key]);
                    } else {
                        try {
                            target[key] = { ...target[key], ...JSON.parse(source[key]) };
                        } catch (e) {
                            console.error(e);
                        }
                    }
                    break;
                default:
                    target[key] = source[key];
                    break;
            }
        }
    }
}

export const parseArray = ConfigMerger.parseArray;
