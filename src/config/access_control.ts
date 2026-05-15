export const ADMIN_UTILITY_TYPES = [
    'chat',
    'image',
    'audio',
    'document',
    'settings',
    'inline',
] as const;

export type AdminUtility = typeof ADMIN_UTILITY_TYPES[number];
