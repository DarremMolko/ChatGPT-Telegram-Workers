import type { APIGuard, CommandConfig, MCPTransport, RedisStorage } from './types';
import { blockAgent } from '../agent';
import loadI18n from '../i18n';
import { initializeMcp } from '../mcp';
import { blockCommand } from '../telegram/command';
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
const SUPPORTED_RERANK_AGENTS = new Set(['openai', 'oailikeV1', 'oailikeV2']);

class Environment extends EnvironmentConfig {
    // -- 版本数据 --
    //
    // 当前版本
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    BUILD_TIMESTAMP = typeof __BUILD_TIMESTAMP__ === 'number' ? __BUILD_TIMESTAMP__ : 0;
    // 当前版本 commit id
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    BUILD_VERSION = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'unknown';

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

        // block agents
        blockAgent();
        // block commands
        blockCommand();
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
        if (!SUPPORTED_RERANK_AGENTS.has(this.USER_CONFIG.RERANK_AGENT)) {
            this.USER_CONFIG.RERANK_AGENT = 'openai';
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
