import type { CommandConfig, MCPTransport, RedisStorage } from './types';
import { execSync } from 'node:child_process';
import loadI18n from '../i18n';
import { initializeMcp } from '../mcp';
import { AgentShareConfig } from './agent_share_config';
import { DefineKeys } from './define_keys';
import { EnvironmentConfig } from './environment_config';
import { ExtraUserConfig } from './extra_user_config';
import { ConfigMerger } from './merger';
import { OpenAIConfig } from './openai_config';
import { OpenAILikeConfig } from './openailike_config';

export type AgentUserConfig = Record<string, any>
    & DefineKeys
    & AgentShareConfig
    & OpenAIConfig
    & OpenAILikeConfig
    & ExtraUserConfig;

function createAgentUserConfig(): AgentUserConfig {
    return Object.assign(
        {},
        new DefineKeys(),
        new AgentShareConfig(),
        new OpenAIConfig(),
        new OpenAILikeConfig(),
        new ExtraUserConfig(),
    );
}

const SUPPORTED_CHAT_PROVIDERS = new Set(['openai', 'oailike']);
const SUPPORTED_IMAGE_PROVIDERS = new Set(['openai', 'oailike']);
const SUPPORTED_ASR_PROVIDERS = new Set(['openai', 'oailike']);
const SUPPORTED_TTS_PROVIDERS = new Set(['openai', 'oailike']);
const SUPPORTED_CHAT_CONCURRENCY_POLICIES = new Set(['queue', 'cancel_previous', 'drop_if_busy', 'parallel']);

function resolveRuntimeBuildInfo(): { sha: string; timestamp: number } {
    const envSha = process.env.BUILD_VERSION?.trim();
    const envTimestamp = Number.parseInt(process.env.BUILD_TIMESTAMP || '', 10);
    if (envSha && Number.isFinite(envTimestamp) && envTimestamp > 0) {
        return {
            sha: envSha,
            timestamp: envTimestamp,
        };
    }

    try {
        const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        const timestamp = Number.parseInt(
            execSync('git log -1 --format=%ct', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(),
            10,
        );
        return {
            sha: sha || 'unknown',
            timestamp: Number.isFinite(timestamp) ? timestamp : 0,
        };
    } catch {
        return {
            sha: 'unknown',
            timestamp: 0,
        };
    }
}

const runtimeBuildInfo = resolveRuntimeBuildInfo();

class Environment extends EnvironmentConfig {
    // -- Build metadata --
    //
    // Current build timestamp
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    BUILD_TIMESTAMP = typeof __BUILD_TIMESTAMP__ === 'number' ? __BUILD_TIMESTAMP__ : runtimeBuildInfo.timestamp;
    // Current build commit id
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    BUILD_VERSION = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : runtimeBuildInfo.sha;

    // -- Base configuration --
    I18N = loadI18n();
    readonly USER_CONFIG: AgentUserConfig = createAgentUserConfig();
    readonly CUSTOM_COMMAND: Record<string, CommandConfig> = {};
    readonly MCP_CONFIG: Record<string, MCPTransport> = {};
    REDIS: RedisStorage = null as any;

    constructor() {
        super();
        this.merge = this.merge.bind(this);
    }

    merge(source: any) {
        // Global objects
        this.REDIS = source.REDIS;
        // Bind custom commands
        this.mergeCommands(
            'CUSTOM_COMMAND_',
            'COMMAND_DESCRIPTION_',
            'COMMAND_SCOPE_',
            source,
            this.CUSTOM_COMMAND,
        );

        // Load MCP configuration
        this.mergeMCP('MCP_', source, this.MCP_CONFIG);

        // Merge environment variables
        ConfigMerger.merge(this, source, [
            'BUILD_TIMESTAMP',
            'BUILD_VERSION',
            'I18N',
            'USER_CONFIG',
            'CUSTOM_COMMAND',
            'REDIS',
        ]);

        ConfigMerger.merge(this.USER_CONFIG, source);
        this.normalizeConfig();
        this.USER_CONFIG.DEFINE_KEYS = this.USER_CONFIG.DEFINE_KEYS.filter(key => Object.keys(this.USER_CONFIG).includes(key));
        this.I18N = loadI18n('en');

        // Select the language-appropriate SYSTEM_INIT_MESSAGE
        if (!this.USER_CONFIG.SYSTEM_INIT_MESSAGE) {
            this.USER_CONFIG.SYSTEM_INIT_MESSAGE = this.I18N?.env?.system_init_message || 'You are a helpful assistant';
        }
        // Prune ENVS_VARIABLES
        if (this.ENVS_VARIABLES.length > 0) {
            this.ENVS_VARIABLES = this.ENVS_VARIABLES.filter((key: string) => Object.keys(this.USER_CONFIG).includes(key));
        }

        // Initialize MCP asynchronously
        this.asyncInit();
    }

    private mergeCommands(prefix: string, descriptionPrefix: string, scopePrefix: string, source: any, target: Record<string, CommandConfig>) {
        for (const key of Object.keys(source)) {
            if (key.startsWith(prefix)) {
                const cmd = key.substring(prefix.length);
                target[`/${cmd}`] = {
                    value: source[key],
                    description: source[`${descriptionPrefix}${cmd}`],
                    scope: source[`${scopePrefix}${cmd}`]?.split(',').map((s: string) => s.trim()),
                };
            }
        }
    }

    private normalizeConfig() {
        this.OWNER_ID = `${this.OWNER_ID || ''}`.trim();
        this.ADMIN_WHITE_LIST = Array.from(new Set(this.ADMIN_WHITE_LIST.map((id: string) => `${id}`.trim()).filter(Boolean)));
        this.TELEGRAM_ALLOWED_UPDATES = Array.from(new Set(this.TELEGRAM_ALLOWED_UPDATES.map((type: string) => `${type}`.trim()).filter(Boolean)));
        if (!SUPPORTED_CHAT_CONCURRENCY_POLICIES.has(this.CHAT_CONCURRENCY_POLICY)) {
            this.CHAT_CONCURRENCY_POLICY = 'queue';
        }
        if (!SUPPORTED_CHAT_PROVIDERS.has(this.USER_CONFIG.AI_CHAT_PROVIDER)) {
            this.USER_CONFIG.AI_CHAT_PROVIDER = 'openai';
        }
        if (!SUPPORTED_IMAGE_PROVIDERS.has(this.USER_CONFIG.AI_IMAGE_PROVIDER)) {
            this.USER_CONFIG.AI_IMAGE_PROVIDER = 'openai';
        }
        if (!SUPPORTED_ASR_PROVIDERS.has(this.USER_CONFIG.AI_ASR_PROVIDER)) {
            this.USER_CONFIG.AI_ASR_PROVIDER = 'openai';
        }
        if (!SUPPORTED_TTS_PROVIDERS.has(this.USER_CONFIG.AI_TTS_PROVIDER)) {
            this.USER_CONFIG.AI_TTS_PROVIDER = 'openai';
        }
        if (this.USER_CONFIG.OPENAI_API_KEY.length === 0 && this.USER_CONFIG.OAILIKE_API_KEY) {
            this.USER_CONFIG.AI_CHAT_PROVIDER = 'oailike';
            this.USER_CONFIG.AI_IMAGE_PROVIDER = 'oailike';
            this.USER_CONFIG.AI_ASR_PROVIDER = 'oailike';
            this.USER_CONFIG.AI_TTS_PROVIDER = 'oailike';
        }
    }

    private mergeMCP(prefix: string, source: any, target: Record<string, MCPTransport>) {
        for (const key of Object.keys(source)) {
            if (key.startsWith(prefix)) {
                const mcp = key.substring(prefix.length);
                try {
                    target[mcp] = JSON.parse(source[key]);
                } catch (error) {
                    console.error(`[ERROR] Failed to parse MCP config for ${mcp}:`, error);
                }
            }
        }
    }

    private asyncInit() {
        initializeMcp().catch((error) => {
            console.error('[ERROR] Failed to initialize MCP:', error);
        });
    }
}

export const ENV = new Environment();
