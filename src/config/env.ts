import type { APIGuard, CommandConfig, MCPTransport, RedisStorage } from './types';
import { execSync } from 'node:child_process';
import loadI18n from '../i18n';
import { initializeMcp } from '../mcp';
import {
    AgentShareConfig,
    DefineKeys,
    EnvironmentConfig,
    ExtraUserConfig,
    OpenAIConfig,
    OpenAILikeConfig,
} from './config';
import { ConfigMerger } from './merger';

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
    // -- 版本数据 --
    //
    // 当前版本
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    BUILD_TIMESTAMP = typeof __BUILD_TIMESTAMP__ === 'number' ? __BUILD_TIMESTAMP__ : runtimeBuildInfo.timestamp;
    // 当前版本 commit id
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    BUILD_VERSION = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : runtimeBuildInfo.sha;

    // -- 基础配置 --
    I18N = loadI18n();
    readonly USER_CONFIG: AgentUserConfig = createAgentUserConfig();
    readonly CUSTOM_COMMAND: Record<string, CommandConfig> = {};
    readonly MCP_CONFIG: Record<string, MCPTransport> = {};
    REDIS: RedisStorage = null as any;
    API_GUARD: APIGuard | null = null;

    constructor() {
        super();
        this.merge = this.merge.bind(this);
    }

    merge(source: any) {
        // 全局对象
        this.REDIS = source.REDIS;
        this.API_GUARD = source.API_GUARD;

        // 绑定自定义命令
        this.mergeCommands(
            'CUSTOM_COMMAND_',
            'COMMAND_DESCRIPTION_',
            'COMMAND_SCOPE_',
            source,
            this.CUSTOM_COMMAND,
        );

        // 读取MCP配置
        this.mergeMCP('MCP_', source, this.MCP_CONFIG);

        // 合并环境变量
        ConfigMerger.merge(this, source, [
            'BUILD_TIMESTAMP',
            'BUILD_VERSION',
            'I18N',
            'USER_CONFIG',
            'CUSTOM_COMMAND',
            'REDIS',
            'API_GUARD',
        ]);

        ConfigMerger.merge(this.USER_CONFIG, source);
        this.normalizeConfig();
        this.USER_CONFIG.DEFINE_KEYS = this.USER_CONFIG.DEFINE_KEYS.filter(key => Object.keys(this.USER_CONFIG).includes(key));
        this.I18N = loadI18n('en');

        // 选择对应语言的SYSTEM_INIT_MESSAGE
        if (!this.USER_CONFIG.SYSTEM_INIT_MESSAGE) {
            this.USER_CONFIG.SYSTEM_INIT_MESSAGE = this.I18N?.env?.system_init_message || 'You are a helpful assistant';
        }
        // 清理ENVS_VARIABLES
        if (this.ENVS_VARIABLES.length > 0) {
            this.ENVS_VARIABLES = this.ENVS_VARIABLES.filter((key: string) => Object.keys(this.USER_CONFIG).includes(key));
        }

        // 异步初始化 mcp
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
        this.TELEGRAM_WEBHOOK_SECRET_TOKEN = `${this.TELEGRAM_WEBHOOK_SECRET_TOKEN || ''}`.trim();
        this.LOCAL_INIT_SECRET = `${this.LOCAL_INIT_SECRET || ''}`.trim();
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
