import type { LogLevelType } from './types';

// -- Configuration that can only be overridden via environment variables --
export class EnvironmentConfig {
    // Chat Complete API Timeout, scale: seconds
    CHAT_COMPLETE_API_TIMEOUT = 0;
    // Total Duration Limit, scale: seconds, default 30 minutes
    CHAT_TOTAL_DURATION_LIMIT = 60 * 30;
    // -- Telegram settings --
    //
    // Telegram API Domain
    TELEGRAM_API_DOMAIN = 'https://api.telegram.org';
    // Allowed Telegram tokens, separated by commas when configured.
    TELEGRAM_AVAILABLE_TOKENS: string[] = [];
    // Update types to subscribe to in webhooks and polling. Keep this aligned with the update kinds handled by the app.
    TELEGRAM_ALLOWED_UPDATES: string[] = ['message', 'inline_query', 'callback_query', 'chosen_inline_result'];
    // Optional Telegram webhook secret token. When set, incoming webhooks must present the matching header.
    TELEGRAM_WEBHOOK_SECRET_TOKEN = '';
    // Whether to drop pending Telegram updates when binding webhooks or switching to polling.
    TELEGRAM_DROP_PENDING_UPDATES = false;
    // Secret required to use the local `/init` webhook bootstrap endpoint. When empty, `/init` is disabled.
    LOCAL_INIT_SECRET = '';
    // Default message parse mode
    DEFAULT_PARSE_MODE = 'MarkdownV2';
    // Minimum interval for stream-mode message updates. Values <= 0 disable the limit. Unit: ms.
    TELEGRAM_MIN_STREAM_INTERVAL = 0;
    // Photo size offset: 0 selects the first size, -1 selects the last. Later entries are larger.
    // By default, use the second-highest quality image to avoid excessive token usage or worker limits.
    TELEGRAM_PHOTO_SIZE_OFFSET = -2;
    // Max Telegram file size to download and ingest, in bytes. Set <= 0 to disable the limit.
    TELEGRAM_FILE_DOWNLOAD_MAX_SIZE = 20 * 1024 * 1024;

    // -- Access control --
    //
    // Bot owner. Has full access to sensitive commands and settings.
    OWNER_ID = '';
    // Additional runtime admins. They can chat in private and use non-sensitive runtime controls.
    ADMIN_WHITE_LIST: string[] = [];

    // -- Group chat settings --
    //
    // Bot names corresponding to allowed Telegram tokens, separated by commas when configured.
    TELEGRAM_BOT_NAME: string[] = [];
    // Group allowlist
    CHAT_GROUP_WHITE_LIST: string[] = [];
    // Enable the bot in group chats
    GROUP_CHAT_BOT_ENABLE = true;
    // Group shared-session mode. When enabled, one group shares one conversation and config.
    // When disabled, each group member gets their own session context.
    GROUP_CHAT_BOT_SHARE_MODE = true;
    // Include usernames in group chat messages so the model can distinguish speakers.
    GROUP_INCLUDE_USERNAME = false;
    // -- History settings --
    //
    // Whether to automatically trim history
    AUTO_TRIM_HISTORY = true;
    // Image placeholder: when set, images in stored history are replaced by this placeholder.
    HISTORY_IMAGE_PLACEHOLDER: string | null = '[A IMAGE]';

    // -- Feature flags --
    //
    // Enable extra quoted-message context
    EXTRA_MESSAGE_CONTEXT = false;

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
    // Whether to rewrite GitHub-style pipe tables into Telegram-friendly card text.
    // This is a compatibility stopgap until Telegram supports native table rendering.
    TELEGRAM_RENDER_PIPE_TABLES = true;
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

    // -- Mode switches --
    //
    // Use streaming mode
    STREAM_MODE = true;
    // Safe mode. Can be disabled for async modes such as polling or async webhook handling.
    SAFE_MODE = true;
    // Debug mode
    DEBUG_MODE = false;
    // Development mode
    DEV_MODE = false;

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
    // Same-chat execution policy. `queue` serializes requests, `cancel_previous` keeps only the latest queued request after cancelling the active one,
    // `drop_if_busy` rejects new requests while one is running, and `parallel` keeps the legacy behavior.
    CHAT_CONCURRENCY_POLICY: 'queue' | 'cancel_previous' | 'drop_if_busy' | 'parallel' = 'queue';
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
}

// -- Shared agent configuration --
export class AgentShareConfig {
    // AI provider: openai, oailike
    AI_CHAT_PROVIDER = 'openai';
    // Image provider: openai, oailike
    AI_IMAGE_PROVIDER = 'openai';
    // AI ASR provider: openai, oailike
    AI_ASR_PROVIDER = 'openai';
    // AI TTS provider: openai, oailike
    AI_TTS_PROVIDER = 'openai';
    // Global default system/init message
    SYSTEM_INIT_MESSAGE: string | null = null;
}

// -- OpenAI configuration --
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
    OPENAI_TTS_EXTRA_PARAMS: Record<string, any> = {};

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
    // Available tools: webSearch, codeInterpreter, fileSearch, imageGeneration, shell, mcp
    OPENAI_BUILDIN = ['webSearch', 'codeInterpreter', 'fileSearch', 'imageGeneration', 'shell', 'mcp'];
    // Enabled tools. For backward compatibility, OPENAI_ENABLE_* flags are also supported.
    USE_OPENAI_BUILDIN: string[] = [];

    // Web Search tool
    OPENAI_ENABLE_WEB_SEARCH = false;
    OPENAI_WEB_SEARCH_EXTERNAL_ACCESS = true; // true = live fetch, false = cached results
    OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: string[] = []; // Allowed domain list
    OPENAI_WEB_SEARCH_CONTEXT_SIZE: 'low' | 'medium' | 'high' = 'medium'; // Search context size
    OPENAI_WEB_SEARCH_USER_LOCATION = ''; // User location, format: "City, Country" or "latitude,longitude"

    // Code Interpreter - Python execution tool
    OPENAI_ENABLE_CODE_INTERPRETER = false;
    OPENAI_CODE_INTERPRETER_CONTAINER = ''; // Container ID (optional)

    // File Search - vector search tool
    OPENAI_ENABLE_FILE_SEARCH = false;
    OPENAI_FILE_SEARCH_VECTOR_STORES: string[] = []; // Vector store ID list (required)
    OPENAI_FILE_SEARCH_MAX_RESULTS = 10; // Maximum number of returned results
    OPENAI_FILE_SEARCH_SCORE_THRESHOLD = 0.0; // Relevance threshold (0-1); higher is stricter

    // Image Generation tool (GPT-5.1+)
    OPENAI_ENABLE_IMAGE_GENERATION = false;
    OPENAI_IMAGE_BACKGROUND: 'auto' | 'opaque' | 'transparent' = 'auto'; // Background type
    OPENAI_IMAGE_INPUT_FIDELITY: 'low' | 'high' = 'low'; // Input fidelity
    OPENAI_IMAGE_MODEL = 'gpt-image-2'; // Image generation model
    OPENAI_IMAGE_OUTPUT_COMPRESSION = 100; // Output compression level (0-100)
    OPENAI_IMAGE_OUTPUT_FORMAT: 'png' | 'jpeg' | 'webp' = 'png'; // Output format
    OPENAI_IMAGE_PARTIAL_IMAGES = 0; // Number of partial images in streaming mode (0-3)
    OPENAI_IMAGE_MODERATION: 'auto' | 'low' = 'auto'; // Safety moderation level
    OPENAI_IMAGE_QUALITY: 'auto' | 'low' | 'medium' | 'high' = 'auto'; // Image quality
    OPENAI_IMAGE_SIZE: 'auto' | '1024x1024' | '1024x1536' | '1536x1024' = 'auto'; // Image size

    // Hosted Shell - OpenAI shell tool
    OPENAI_ENABLE_SHELL = false;
    OPENAI_SHELL_ENVIRONMENT: 'containerAuto' | 'containerReference' = 'containerAuto';
    OPENAI_SHELL_CONTAINER_ID = '';
    OPENAI_SHELL_FILE_IDS: string[] = [];
    OPENAI_SHELL_MEMORY_LIMIT: '1g' | '4g' | '16g' | '64g' = '4g';
    OPENAI_SHELL_NETWORK_POLICY: 'default' | 'disabled' | 'allowlist' = 'default';
    OPENAI_SHELL_ALLOWED_DOMAINS: string[] = [];

    // MCP - Model Context Protocol
    OPENAI_ENABLE_MCP = false;
    OPENAI_MCP_SERVER_LABEL = ''; // MCP server label (required)
    OPENAI_MCP_SERVER_URL = ''; // MCP server URL (choose either this or connectorId)
    OPENAI_MCP_CONNECTOR_ID = ''; // Service connector ID (choose either this or serverUrl)
    OPENAI_MCP_SERVER_DESCRIPTION = ''; // Server description (optional)
    OPENAI_MCP_ALLOWED_TOOLS: string[] = []; // Allowed tool names
    OPENAI_MCP_ALLOWED_TOOLS_READ_ONLY = false; // Allow read-only tools only
    OPENAI_MCP_AUTHORIZATION = ''; // OAuth access token
    OPENAI_MCP_HEADERS: Record<string, string> = {}; // Custom HTTP headers
    OPENAI_MCP_REQUIRE_APPROVAL: 'always' | 'never' = 'never'; // Tool execution approval policy
    OPENAI_MCP_APPROVAL_TOOL_NAMES: string[] = []; // Tool names that require approval when requireApproval != always
}

export class OpenAILikeConfig {
    // oailike api key
    OAILIKE_API_KEY: string | null = null;
    // oailike api base. Accepts either the root `/v1` base or a full LLM endpoint such as `/v1/responses` or `/v1/chat/completions`.
    OAILIKE_API_BASE = 'https://api.openai.com/v1';
    // oailike api model
    OAILIKE_CHAT_MODEL = 'gpt-5.4-mini';
    // oailike image model
    OAILIKE_IMAGE_MODEL = 'gpt-image-2';
    // oailike vision model
    OAILIKE_VISION_MODEL = 'gpt-5.4-mini';
    // oailike image background
    OAILIKE_IMAGE_BACKGROUND: 'auto' | 'opaque' | 'transparent' = 'auto';
    // oailike image input fidelity
    OAILIKE_IMAGE_INPUT_FIDELITY: 'low' | 'high' = 'low';
    // oailike image moderation
    OAILIKE_IMAGE_MODERATION: 'auto' | 'low' = 'auto';
    // oailike image output compression
    OAILIKE_IMAGE_OUTPUT_COMPRESSION = 100;
    // oailike image output format
    OAILIKE_IMAGE_OUTPUT_FORMAT: 'png' | 'jpeg' | 'webp' = 'png';
    // oailike image quality
    OAILIKE_IMAGE_QUALITY: 'auto' | 'low' | 'medium' | 'high' = 'auto';
    // oailike image size
    OAILIKE_IMAGE_SIZE: 'auto' | '1024x1024' | '1024x1536' | '1536x1024' = '1024x1024';
    // oailike asr model
    OAILIKE_STT_MODEL = 'gpt-4o-mini-transcribe';
    OAILIKE_STT_EXTRA_PARAMS: Record<string, string> = {};
    // oailike tts model
    OAILIKE_TTS_MODEL = 'gpt-4o-mini-tts';
    // oailike tts extra params
    OAILIKE_TTS_EXTRA_PARAMS: Record<string, any> = {};
    // oailike tts voice
    OAILIKE_TTS_VOICE = 'alloy';
    OAILIKE_TTS_PROMPT = '';
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
    // Max serialized tool-args length in the info footer. Set to -1 to show full args.
    SHOW_TOOL_ARGS_MAX_LENGTH = 80;
    USE_MCP: string[] = [];
    // if starts with '{agent}:' prefix, the specified agent corresponds to the chat model,
    // otherwise use the current agent and the specified model.
    // Keep empty to use the current agent chat model as function call model.
    TOOL_MODEL = '';
    PROMPT: Record<string, string> = {};

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
    // Audio prompt
    AUDIO_PROMPT = 'Please listen to the audio file. Identify and understand the question being asked in the audio. Then, provide a detailed explanation and answer to this question. Ensure your answer is helpful and explains the solution or information clearly.';
    // use blocklist to block someone
    BLOCKLIST: string[] = [];
}
