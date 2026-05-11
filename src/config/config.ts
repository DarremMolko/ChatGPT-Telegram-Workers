import type { LogLevelType } from './types';
import prompts_default from '../utils/others/prompt';

// -- 只能通过环境变量覆盖的配置 --
export class EnvironmentConfig {
    // Chat Complete API Timeout, scale: seconds
    CHAT_COMPLETE_API_TIMEOUT = 0;
    // Total Duration Limit, scale: seconds, default 30 minutes
    CHAT_TOTAL_DURATION_LIMIT = 60 * 30;
    // -- Telegram 相关 --
    //
    // Telegram API Domain
    TELEGRAM_API_DOMAIN = 'https://api.telegram.org';
    // 允许访问的Telegram Token， 设置时以逗号分隔
    TELEGRAM_AVAILABLE_TOKENS: string[] = [];
    // 默认消息模式
    DEFAULT_PARSE_MODE = 'MarkdownV2';
    // 最小stream模式消息间隔，小于等于0则不限制 单位：ms
    TELEGRAM_MIN_STREAM_INTERVAL = 0;
    // 图片尺寸偏移 0为第一位，-1为最后一位, 越靠后的图片越大。PS: 图片过大可能导致token消耗过多，或者workers超时或内存不足
    // 默认选择次高质量的图片
    TELEGRAM_PHOTO_SIZE_OFFSET = -2;
    // 向LLM优先传递图片方式：url, base64
    TELEGRAM_IMAGE_TRANSFER_MODE = 'url';

    // --  权限相关 --
    //
    // 允许所有人使用
    I_AM_A_GENEROUS_PERSON = false;
    // 白名单
    CHAT_WHITE_LIST: string[] = [];

    // -- 群组相关 --
    //
    // 允许访问的Telegram Token 对应的Bot Name， 设置时以逗号分隔
    TELEGRAM_BOT_NAME: string[] = [];
    // 群组白名单
    CHAT_GROUP_WHITE_LIST: string[] = [];
    // 群组机器人开关
    GROUP_CHAT_BOT_ENABLE = true;
    // 群组机器人共享模式，开启后，一个群组只有一个会话和配置。关闭的话群组的每个人都有自己的会话上下文
    GROUP_CHAT_BOT_SHARE_MODE = true;
    // 在群聊消息中包含用户名，帮助AI识别不同发言者
    GROUP_INCLUDE_USERNAME = false;
    // -- 历史记录相关 --
    //
    // 是否自动裁剪历史记录
    AUTO_TRIM_HISTORY = true;
    // Image占位符: 当此环境变量存在时，则历史记录中的图片将被替换为此占位符
    HISTORY_IMAGE_PLACEHOLDER: string | null = '[A IMAGE]';

    // -- 特性开关 --
    //
    // 隐藏部分命令按钮
    HIDE_COMMAND_BUTTONS: string[] = [];
    // 禁用部分命令
    BLOCK_COMMANDS: string[] = [];
    // 显示快捷回复按钮
    SHOW_REPLY_BUTTON = false;
    // 额外引用消息开关
    EXTRA_MESSAGE_CONTEXT = false;
    // 禁用Agent
    BLOCK_AGENTS: string[] = [];

    // -------------

    // Whether to read files
    // Supported file formats: text, photo, voice, audio, video(based on model support), document(send pdf/image/audio/text as file), sticker(gif, jpg, png, webp, webm as video)
    SUPPORT_FORMAT: string[] = ['text', 'photo', 'voice', 'audio', 'image', 'document'];
    // In group chats, the reply object is the trigger object by default, and when enabled, it is prioritized as the object to be replied to
    ENABLE_REPLY_TO_MENTION = false;
    // Ignore messages starting with specified text
    IGNORE_TEXT_PREFIX = '';
    // When multiple processes, whether to hide intermediate step information
    HIDE_MIDDLE_MESSAGE = false;
    // Chat trigger prefix, it will trigger group message and be deleted
    CHAT_TRIGGER_PREFIX = '';
    // When the length reaches the set value, the group will send a telegraph article. If less than 0, it will not be sent
    TELEGRAPH_NUM_LIMIT = -1;
    // Telegraph scope
    TELEGRAPH_SCOPE: string[] = ['group', 'supergroup'];
    // Telegraph author link; The author of the article is currently the robot ID, and if not set, it is anonymous
    TELEGRAPH_AUTHOR_URL = '';
    // Disable link preview
    DISABLE_WEB_PREVIEW = false;
    // Native Redis connection URL. Prefer rediss:// for hosted Redis with TLS.
    REDIS_URL = '';
    // Message expired time, scale: minute
    EXPIRED_TIME = -1;
    // Schedule check time use cron expression, for example '*/10 0-2,6-23 * * *' means every ten minutes from 0 to 2 and from 6 to 23
    CRON_CHECK_TIME = '';
    // Schedule group delete type tip dialog:tip and chat dialog:chat
    SCHEDULE_GROUP_DELETE_TYPE = ['tip'];
    // Schedule private delete type command dialog:command and chat dialog:chat
    SCHEDULE_PRIVATE_DELETE_TYPE = ['tip'];

    // Send pictures via files format
    SEND_IMAGE_AS_FILE: boolean = false;
    // Log level
    LOG_LEVEL: LogLevelType = 'info';
    // Optional NDJSON file path for detailed runtime, reasoning, and tool-call traces.
    // When empty and DEBUG_MODE=true, the default path is
    // ./logs/chatgpt-telegram-workers.debug.ndjson
    DEBUG_LOG_FILE = '';
    // Max string length written to the debug log before truncation.
    DEBUG_LOG_MAX_STRING_LENGTH = 8000;

    // -------------

    // -- 模式开关 --
    //
    // 使用流模式
    STREAM_MODE = true;
    // 安全模式 异步模式（polling, 异步webhook）下可关闭
    SAFE_MODE = true;
    // 调试模式
    DEBUG_MODE = false;
    // 开发模式
    DEV_MODE = false;

    // Only relax /set command temporarily modifies permissions
    RELAX_AUTH_KEYS: string[] = [];
    // inline query send interval
    INLINE_QUERY_SEND_INTERVAL = 2000;
    // inline query show info
    INLINE_QUERY_SHOW_INFO = false;
    // If true, will store media group file id
    STORE_MEDIA_MESSAGE: boolean = false;
    // If true, will store text chunk when message separated to multiple chunks
    STORE_TEXT_CHUNK_MESSAGE: boolean = false;
    // Audio text format
    AUDIO_TEXT_FORMAT: undefined | 'spoiler' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'pre' = undefined;
    // when message length exceeds this value, the message will be set as quotation, with QUOTE_EXPANDABLE set to true to expand the message, set -1 to disable
    ADD_QUOTE_LIMIT = -1;
    // Fold message scope, support group supergroup private
    ADD_QUOTE_SCOPE: string[] = ['group', 'supergroup'];

    // If true, will expand the quote message; log always be expandable
    QUOTE_EXPANDABLE = false;
    // whether log position on top, default is true
    LOG_POSITION_ON_TOP = true;

    // Store history message length
    STORE_HISTORY_LENGTH = 64;
    // File size limit, when enabled folding, the file size limit is effective
    FILE_SIZE_LIMIT = -1;
    // inline keyboard callback row count x column count
    CALLBACK_QUERY_RC = '7x2';
    // envs variables, in the callback query, if it is empty, all variables will be displayed;
    // otherwise, only the set variables will be shown.
    ENVS_VARIABLES = [];
    // callback menu, if it is empty, all options will be displayed.
    // options: 'AI_CHAT_PROVIDER', 'AI_IMAGE_PROVIDER', 'AI_TTS_PROVIDER', 'AI_ASR_PROVIDER', 'USE_MCP', 'CHAT_MODEL', 'IMAGE_MODEL', 'VISION_MODEL', 'TOOL_MODEL', 'ENVS'
    CALLBACK_MENU = [];

    // Whether to transform  tool_call/tool_result message to user message
    MESSAGE_COMPATIBLE = true;
    // whether to display search source
    ENABLE_SEARCH_SOURCE = true;
    // Whether to show thinking text
    SHOW_THINKING_TEXT = true;

    // TODO: override command auth, key is command, value is auth role, support: 'creator', 'administrator', null
    // COMMAND_AUTH_OVERRIDE: Record<string, string[]> = {
    //     '/tts': ['creator', 'administrator'],
    // };
}

// -- 通用配置 --
export class AgentShareConfig {
    // AI provider: openai, oailike
    AI_CHAT_PROVIDER = 'openai';
    // Image provider: openai, oailike
    AI_IMAGE_PROVIDER = 'openai';
    // AI ASR 提供商: openai, oailike
    AI_ASR_PROVIDER = 'openai';
    // AI TTS 提供商: openai, oailike
    AI_TTS_PROVIDER = 'openai';
    // 全局默认初始化消息
    SYSTEM_INIT_MESSAGE: string | null = null;
}

// -- Open AI 配置 --
export class OpenAIConfig {
    // OpenAI API Key
    OPENAI_API_KEY: string[] = [];
    // OpenAI Model
    OPENAI_CHAT_MODEL = 'gpt-5.4-mini';
    // OpenAI API base. Accepts either the root `/v1` base or a full LLM endpoint such as `/v1/responses` or `/v1/chat/completions`.
    OPENAI_API_BASE = 'https://api.openai.com/v1';
    // OpenAI API Extra Params, key is model name prefix, separated by commas; value is extra Params, support path(camelCase), split by '.'
    // for example: OPENAI_API_EXTRA_PARAMS = { 'gpt-5.4,gpt-5.4-mini': { 'reasoningEffort': 'high' } };
    OPENAI_API_EXTRA_PARAMS: Record<string, Record<string, any>> = {};
    // OpenAI STT Model
    OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe';
    OPENAI_STT_EXTRA_PARAMS: Record<string, string> = {};
    // OpenAI Vision Model
    OPENAI_VISION_MODEL = 'gpt-5.4-mini';
    // OpenAI TTS Model
    OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
    // OpenAI TTS Extra Params
    OPENAI_TTS_EXTRA_PARAMS: Record<string, Record<string, any>> = {};

    OPENAI_TTS_VOICE = 'alloy';
    OPENAI_MODELS = [];
    OPENAI_MODELS_API = '/models';
    OPENAI_TTS_PROMPT = '';
    // The API_EXTRA_PARAMS variable will override this option.
    OPENAI_PROVIDER_OPTIONS = {
        // metadata: {},
        parallelToolCalls: true,
        // previousResponseId: '',
        // store: false,
        // user: 'user1',
        // reasoningEffort: 'medium', // 'low' | 'medium' | 'high', default is 'medium'
        // strictJsonSchema: true,
        // instructions: '',
        reasoningSummary: 'auto', // auto, concise, or detailed
        // serviceTier: 'auto',
        // include: ['reasoning.encrypted_content'],
    };

    // OpenAI Server-Side Tools (Responses API only)
    // 可用工具列表：webSearch, codeInterpreter, fileSearch, imageGeneration, mcp
    OPENAI_BUILDIN = ['webSearch', 'codeInterpreter', 'fileSearch', 'imageGeneration', 'mcp'];
    // 启用的工具列表（为保持向后兼容，也支持使用 OPENAI_ENABLE_* 开关）
    USE_OPENAI_BUILDIN: string[] = [];

    // Web Search - 网页搜索工具
    OPENAI_ENABLE_WEB_SEARCH = false;
    OPENAI_WEB_SEARCH_EXTERNAL_ACCESS = true; // true=实时抓取，false=使用缓存
    OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: string[] = []; // 允许的域名列表
    OPENAI_WEB_SEARCH_CONTEXT_SIZE: 'low' | 'medium' | 'high' = 'medium'; // 搜索上下文大小
    OPENAI_WEB_SEARCH_USER_LOCATION = ''; // 用户位置，格式: "City, Country" 或 "latitude,longitude"

    // Code Interpreter - Python 代码执行工具
    OPENAI_ENABLE_CODE_INTERPRETER = false;
    OPENAI_CODE_INTERPRETER_CONTAINER = ''; // 容器ID（可选）

    // File Search - 文件向量搜索工具
    OPENAI_ENABLE_FILE_SEARCH = false;
    OPENAI_FILE_SEARCH_VECTOR_STORES: string[] = []; // 向量存储ID列表（必需）
    OPENAI_FILE_SEARCH_MAX_RESULTS = 10; // 最大返回结果数
    OPENAI_FILE_SEARCH_SCORE_THRESHOLD = 0.0; // 相关性阈值（0-1），越高越严格

    // Image Generation - 图片生成工具 (GPT-5.1+)
    OPENAI_ENABLE_IMAGE_GENERATION = false;
    OPENAI_IMAGE_BACKGROUND: 'auto' | 'opaque' | 'transparent' = 'auto'; // 背景类型
    OPENAI_IMAGE_INPUT_FIDELITY: 'low' | 'high' = 'low'; // 输入保真度
    OPENAI_IMAGE_MODEL = 'gpt-image-1.5'; // 图片生成模型
    OPENAI_IMAGE_OUTPUT_COMPRESSION = 100; // 输出压缩等级 (0-100)
    OPENAI_IMAGE_OUTPUT_FORMAT: 'png' | 'jpeg' | 'webp' = 'png'; // 输出格式
    OPENAI_IMAGE_PARTIAL_IMAGES = 0; // 流式模式下生成的部分图片数量 (0-3)
    OPENAI_IMAGE_QUALITY: 'auto' | 'low' | 'medium' | 'high' = 'auto'; // 图片质量
    OPENAI_IMAGE_SIZE: 'auto' | '1024x1024' | '1024x1536' | '1536x1024' = 'auto'; // 图片尺寸

    // MCP - Model Context Protocol
    OPENAI_ENABLE_MCP = false;
    OPENAI_MCP_SERVER_LABEL = ''; // MCP服务器标签（必需）
    OPENAI_MCP_SERVER_URL = ''; // MCP服务器URL（与connectorId二选一）
    OPENAI_MCP_CONNECTOR_ID = ''; // 服务连接器ID（与serverUrl二选一）
    OPENAI_MCP_SERVER_DESCRIPTION = ''; // 服务器描述（可选）
    OPENAI_MCP_ALLOWED_TOOLS: string[] = []; // 允许的工具名称列表
    OPENAI_MCP_ALLOWED_TOOLS_READ_ONLY = false; // 仅允许只读工具
    OPENAI_MCP_AUTHORIZATION = ''; // OAuth访问令牌
    OPENAI_MCP_HEADERS: Record<string, string> = {}; // 自定义HTTP头
    OPENAI_MCP_REQUIRE_APPROVAL: 'always' | 'never' = 'never'; // 工具执行审批策略
    OPENAI_MCP_APPROVAL_TOOL_NAMES: string[] = []; // 需要审批的工具名称（当requireApproval非always时）
}

export class OpenAILikeConfig {
    // oailike api key
    OAILIKE_API_KEY: string | null = null;
    // oailike api base. Accepts either the root `/v1` base or a full LLM endpoint such as `/v1/responses` or `/v1/chat/completions`.
    OAILIKE_API_BASE = 'https://api.openai.com/v1';
    // oailike api model
    OAILIKE_CHAT_MODEL = 'gpt-5.4-mini';
    // oailike image model
    OAILIKE_IMAGE_MODEL = 'gpt-image-1.5';
    // oailike vision model
    OAILIKE_VISION_MODEL = 'gpt-5.4-mini';
    // oailike image size
    OAILIKE_IMAGE_SIZE = '1024x1024';
    // oailike asr model
    OAILIKE_STT_MODEL = 'FunAudioLLM/SenseVoiceSmall';
    OAILIKE_STT_EXTRA_PARAMS: Record<string, string> = {};
    // oailike tts model
    OAILIKE_TTS_MODEL = 'gpt-4o-mini-tts';
    // oailike tts extra params
    OAILIKE_TTS_EXTRA_PARAMS: Record<string, Record<string, any>> = {};
    // oailike tts voice
    OAILIKE_TTS_VOICE = 'alloy';
    // OAILIKE API Extra Params, key is model name prefix, separated by commas; value is extra Params, support path(camelCase), split by '.'
    // for example: OAILIKE_API_EXTRA_PARAMS = { 'gpt-5.4,gpt-5.4-mini': { 'reasoningEffort': 'high' } };
    OAILIKE_API_EXTRA_PARAMS: Record<string, Record<string, any>> = {};
    OAILIKE_MODELS = [];
    OAILIKE_MODELS_API = '/models';
    // OAILIKE Provider Options
    OAILIKE_PROVIDER_OPTIONS = {};
}

export class DefineKeys {
    DEFINE_KEYS: string[] = [];
}

export class ExtraUserConfig {
    MAPPING_KEY = '-p:SYSTEM_INIT_MESSAGE|-n:MAX_HISTORY_LENGTH|-a:AI_CHAT_PROVIDER|-ai:AI_IMAGE_PROVIDER|-m:CHAT_MODEL|-im:IMAGE_MODEL|-v:VISION_MODEL|-s:STT_MODEL|-t:TTS_MODEL|-ex:OPENAI_API_EXTRA_PARAMS|-mk:MAPPING_KEY|-mv:MAPPING_VALUE|-tm:TOOL_MODEL|-th:TEXT_HANDLE_TYPE|-to:TEXT_OUTPUT|-ah:AUDIO_HANDLE_TYPE|-ao:AUDIO_OUTPUT|-act:AUDIO_CONTAINS_TEXT|-as:AI_ASR_PROVIDER|-at:AI_TTS_PROVIDER|-tp:CHAT_TEMPERATURE';
    // /set command mapping value, separated by |, : separates multiple relationships
    MAPPING_VALUE = '';
    // MAPPING_VALUE = "fast:gpt-5.4-mini|full:gpt-5.4|compat:oailike";
    // Whether to show model and time information in the message
    ENABLE_SHOWINFO = false;
    // enable Show info, which parts to show, support model, model_time, token, tool, tool_time, first_chunk_time
    SHOW_PARTS = ['model', 'model_time', 'token', 'tool', 'tool_time'];
    USE_MCP: string[] = [];
    // if starts with '{agent}:' prefix, the specified agent corresponds to the chat model,
    // otherwise use the current agent and the specified model.
    // Keep empty to use the current agent chat model as function call model.
    TOOL_MODEL = '';
    PROMPT: Record<string, string> = prompts_default;

    // chat agent temperature
    CHAT_TEMPERATURE: number | undefined = undefined;
    // function call temperature
    FUNCTION_CALL_TEMPERATURE: number | undefined = undefined;
    // chat max tokens
    MAX_TOKENS: number | undefined = undefined;
    // chat agent max steps
    MAX_STEPS = 5;
    // chat agent max retries
    MAX_RETRIES = 0;
    // text handle type, to 'tts' or 'text' to chat with llm, or 'chat' by using direct multimodal chat (default: text)
    TEXT_HANDLE_TYPE: 'tts' | 'text' | 'chat' = 'text';
    // Text output type, 'audio' or 'text' (default: text)
    TEXT_OUTPUT: 'audio' | 'text' = 'text';
    // Audio handle type, 'stt' or 'audio' to chat with llm, or 'chat' by using direct multimodal chat (default: stt)
    AUDIO_HANDLE_TYPE: 'stt' | 'audio' | 'chat' = 'stt';
    // Audio output type, 'audio' or 'text' (default: text)
    AUDIO_OUTPUT: 'audio' | 'text' = 'text';
    // Audio contains text
    AUDIO_CONTAINS_TEXT = true;
    // max history length, default is 10
    MAX_HISTORY_LENGTH = 10;
    // whether to generate long text (limited by MAX_STEPS)
    CONTINUE_STEP = false;
    // message replacer, you can use it to replace message text in the middle of the message, multiple words can be replaced at the same time
    MESSAGE_REPLACER: Record<string, string> = {};
    // Parameter modifier; string array; separated by colons, the key is the model name, separated by commas;
    // the value is the parameter modification value, modification values starting with '+' indicates addition, with the value after '=' and separated by '|'; starting with '-' indicates addition indicate deletion.
    // note: not support stream option
    // for example: PARAMS_MODIFIER = ['gpt-5.4:+reasoning_effort="high"'];
    // priority is higher than EXTRA_PARAMS
    PARAMS_MODIFIER: string[] = [];
    // whether to enable model alias of mapping value
    ENABLE_ALIAS = false;
    // 音频提示词
    AUDIO_PROMPT = 'Please listen to the audio file. Identify and understand the question being asked in the audio. Then, provide a detailed explanation and answer to this question. Ensure your answer is helpful and explains the solution or information clearly.';
    // use blocklist to block someone
    BLOCKLIST: string[] = [];
}
