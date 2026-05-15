export interface RedisStorage {
    get: (key: string | string[]) => Promise<string | any>;
    put: (key: string, value: string, info?: { expirationTtl?: number; expiration?: number; condition?: 'NX' | 'XX' }) => Promise<any>;
    delete: (key: string | string[]) => Promise<any>;
}

export interface CommandConfig {
    value: string;
    description?: string | null;
    scope?: string[] | null;
}

type FlowType = 'text' | 'image' | 'audio';

export type FlowStruct = {
    [key in FlowType]?: {
        disableHistory?: boolean;
        disableTool?: boolean;
        workflow?: {
            agent?: string;
            prompt?: string;
            model?: string;
            type?: FlowType;
            text?: string;
        }[];
    };
};

export type MCPTransport = {
    type: 'sse';
    url: string;
    headers?: Record<string, string>;
} | {
    type: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
} | {
    type: 'http';
    url: string;
    headers?: Record<string, string>;
};

export type LogLevelType = 'debug' | 'info' | 'warn' | 'error';

export type { WorkerContext } from './context';

export type { AgentUserConfig } from './env';
