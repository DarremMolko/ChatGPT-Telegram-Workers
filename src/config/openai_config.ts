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
