import type { LogLevelType } from './types';
import { ADMIN_UTILITY_TYPES } from './access_control';

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
    // Update types to subscribe to in polling.
    TELEGRAM_ALLOWED_UPDATES: string[] = ['message', 'inline_query', 'callback_query', 'chosen_inline_result'];
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
    // Utility categories available to admins. The owner always keeps full access.
    ADMIN_AVAILABLE_UTILITIES: string[] = [...ADMIN_UTILITY_TYPES];

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
    // Optional PDF OCR preprocessing provider. Empty disables OCR and keeps the native PDF file flow.
    DOCUMENT_OCR_PROVIDER: '' | 'mistral' = '';
    // OCR request timeout in seconds.
    DOCUMENT_OCR_TIMEOUT = 120;
    // Mistral OCR credentials and request defaults. Used only when DOCUMENT_OCR_PROVIDER is `mistral`.
    MISTRAL_OCR_API_KEY = '';
    MISTRAL_OCR_API_BASE = 'https://api.mistral.ai/v1';
    MISTRAL_OCR_MODEL = 'mistral-ocr-latest';
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
    // Safe mode. Can be disabled for asynchronous delivery modes.
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
    // If true, the info banner quote is rendered as expandable.
    EXPANDABLE_BANNER = false;
    // If true, streamed thinking quotes are rendered as expandable.
    EXPANDABLE_THINKING = false;
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
