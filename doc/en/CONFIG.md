# Configuration

This repository now documents only the simplified local/Docker build.

Supported provider families:

- `openai`
- `oailike` for OpenAI-compatible APIs

Removed from the supported config surface:

- Google
- Anthropic
- xAI
- Azure / Vertex / Workers AI
- Mistral / Cohere
- Kling / Fish Audio
- plugin-based or internal/external repo-level tools

## Configuration Model

The runtime has two layers of configuration.

### 1. Deployment And Environment Settings

These come from:

- `config.toml` under `[vars]`
- process environment variables, which override TOML values in local and Docker mode

These settings define:

- Telegram tokens and access rules
- Redis credentials
- group-policy behavior
- streaming, rendering, and runtime defaults
- custom command aliases

### 2. Stored User Configuration

These live in Redis and are loaded per chat context.

They are changed through:

- `/set`
- `/setenv`
- `/setenvs`
- `/delenv`
- `/clearenv`
- `/settings`

These settings define:

- provider and model selection
- MCP group selection
- OpenAI built-in tool selection
- temperatures, token limits, step limits, and workflows
- text/audio handling modes

Important:

- `CHAT_WHITE_LIST` users are admins for the stored user-config surface
- deployment-only settings still come from `config.toml` or process env
- not every environment key is editable at runtime

### Value Parsing Notes

- TOML arrays such as `["a", "b"]` are supported directly
- string array env values can also be provided as comma-separated strings
- object-like values such as `OPENAI_API_EXTRA_PARAMS` and `MCP_demo` must be JSON strings when provided through env text

## Capability Summary

| Capability | Main settings |
| --- | --- |
| Chat provider routing | `AI_CHAT_PROVIDER`, `OPENAI_API_BASE`, `OAILIKE_API_BASE` |
| Image generation | `AI_IMAGE_PROVIDER`, `OPENAI_IMAGE_MODEL`, `OAILIKE_IMAGE_MODEL` |
| Image editing | OpenAI `/img` reply-to-image flow |
| Audio input/output | `AI_ASR_PROVIDER`, `AI_TTS_PROVIDER`, `TEXT_HANDLE_TYPE`, `AUDIO_HANDLE_TYPE`, `TEXT_OUTPUT`, `AUDIO_OUTPUT` |
| Generic tools | `MCP_*`, `USE_MCP`, `TOOL_MODEL` |
| OpenAI built-in tools | `USE_OPENAI_BUILDIN`, `OPENAI_ENABLE_*` |
| Group behavior | `CHAT_GROUP_WHITE_LIST`, `GROUP_CHAT_BOT_ENABLE`, `GROUP_CHAT_BOT_SHARE_MODE` |
| Persistence and cleanup | `REDIS_URL`, `MAX_HISTORY_LENGTH`, `EXPIRED_TIME`, `CRON_CHECK_TIME` |
| Inline settings and shortcuts | `MAPPING_KEY`, `MAPPING_VALUE`, `ENVS_VARIABLES`, `CALLBACK_MENU` |

## Required Settings

| Variable | Description | Default |
| --- | --- | --- |
| `TELEGRAM_AVAILABLE_TOKENS` | Comma-separated or array-form Telegram bot tokens. | `[]` |
| `CHAT_WHITE_LIST` | User IDs allowed to use private chats and admin the stored user-config surface. | `[]` |
| `REDIS_URL` | Required native Redis connection URL. Prefer `rediss://` for hosted Redis with TLS. | `''` |
| `OPENAI_API_KEY` | OpenAI API key list. Required when any OpenAI capability is used. | `[]` |
| `OAILIKE_API_KEY` | OpenAI-compatible API key. Required when `oailike` is used. | `null` |

## Telegram And Access Control

| Variable | Description | Default |
| --- | --- | --- |
| `TELEGRAM_API_DOMAIN` | Telegram API base URL. | `https://api.telegram.org` |
| `TELEGRAM_STREAM_MODE` | Streaming transport for Telegram replies: `message`, `draft`, or `auto`. | `message` |
| `TELEGRAM_BOT_NAME` | Bot usernames aligned by position with `TELEGRAM_AVAILABLE_TOKENS`. Helpful when using multiple bots. | `[]` |
| `I_AM_A_GENEROUS_PERSON` | If `true`, bypasses user whitelist checks. | `false` |
| `CHAT_GROUP_WHITE_LIST` | Group IDs allowed to use the bot. | `[]` |
| `GROUP_CHAT_BOT_ENABLE` | Master group-chat enable switch. | `true` |
| `GROUP_CHAT_BOT_SHARE_MODE` | If `true`, a group shares one history/config scope. If `false`, each user in the group gets an individual scope. | `true` |
| `GROUP_INCLUDE_USERNAME` | Prefix group messages with a user identifier before sending them to the LLM. | `false` |
| `BLOCK_COMMANDS` | Disable specific built-in commands, for example `["/history"]`. | `[]` |
| `HIDE_COMMAND_BUTTONS` | Remove specific commands from Telegram command menus without disabling the command itself. | `[]` |
| `BLOCK_AGENTS` | Disable specific provider agents, for example `["oailike"]`. | `[]` |
| `SHOW_REPLY_BUTTON` | Show `/new` and `/redo` reply keyboard buttons in private chats. | `false` |

### Custom Commands

Custom commands still exist and are configured through environment keys:

- `CUSTOM_COMMAND_<name>`
- `COMMAND_DESCRIPTION_<name>`
- `COMMAND_SCOPE_<name>`

Example:

```toml
[vars]
CUSTOM_COMMAND_fast = "/set -m gpt-5.4-mini"
COMMAND_DESCRIPTION_fast = "Switch to the fast chat model"
COMMAND_SCOPE_fast = "all_private_chats,all_chat_administrators"
```

This creates `/fast`.

## Message Input And Media Handling

| Variable | Description | Default |
| --- | --- | --- |
| `SUPPORT_FORMAT` | Allowed incoming content types. Default covers text, images, voice, and audio. | `['text', 'photo', 'voice', 'audio', 'image']` |
| `TELEGRAM_IMAGE_TRANSFER_MODE` | Send Telegram images to the model as `url` or `base64`. | `url` |
| `TELEGRAM_PHOTO_SIZE_OFFSET` | Chooses which Telegram photo size to use. `-1` means largest. | `-2` |
| `ENABLE_REPLY_TO_MENTION` | In group chats, prefer the replied message as the trigger target when available. | `false` |
| `EXTRA_MESSAGE_CONTEXT` | Include replied or quoted message context in the prompt. | `false` |
| `IGNORE_TEXT_PREFIX` | Ignore any message starting with this prefix. | `''` |
| `CHAT_TRIGGER_PREFIX` | Group-chat prefix that forces the bot to treat the message as addressed to it. | `''` |
| `STORE_MEDIA_MESSAGE` | Persist media-group file IDs for multi-part Telegram media handling. | `false` |
| `STORE_TEXT_CHUNK_MESSAGE` | Persist split text chunks for long-message reassembly. | `false` |
| `HISTORY_IMAGE_PLACEHOLDER` | Placeholder used when trimming history image content. | `'[A IMAGE]'` |
| `AUTO_TRIM_HISTORY` | Trim older history automatically. | `true` |

### Image Generation And Editing Notes

- `/img` works with both provider families
- reply-to-image editing is currently wired through the OpenAI image flow
- `oailike` image support is generation-focused

## Streaming, Rendering, And Output

| Variable | Description | Default |
| --- | --- | --- |
| `STREAM_MODE` | Stream chat output when possible. | `true` |
| `TELEGRAM_MIN_STREAM_INTERVAL` | Minimum delay between streamed Telegram updates, in milliseconds. | `0` |
| `DEFAULT_PARSE_MODE` | Telegram parse mode for rich messages. | `MarkdownV2` |
| `DISABLE_WEB_PREVIEW` | Disable Telegram link previews. | `false` |
| `SHOW_THINKING_TEXT` | Show streamed reasoning text when the underlying model/provider returns it. | `true` |
| `ENABLE_SEARCH_SOURCE` | Show provider search/source metadata when available. | `true` |
| `QUOTE_EXPANDABLE` | Make quoted long replies expandable. | `false` |
| `ADD_QUOTE_LIMIT` | Quote replies longer than this length. Set `-1` to disable. | `-1` |
| `ADD_QUOTE_SCOPE` | Chat scopes where quoting is allowed. | `['group', 'supergroup']` |
| `LOG_POSITION_ON_TOP` | Put the model/debug summary above the answer instead of below it. | `true` |
| `FILE_SIZE_LIMIT` | When positive and quoting is enabled, send oversized responses as a document after this limit. | `-1` |
| `SEND_IMAGE_AS_FILE` | Send generated images as Telegram documents instead of photos. | `false` |
| `AUDIO_TEXT_FORMAT` | Optional Telegram entity style applied to text attached to generated voice messages. | `undefined` |
| `AUDIO_CONTAINS_TEXT` | Include the generated text as a caption when sending audio answers. | `true` |
| `TELEGRAPH_NUM_LIMIT` | Send very long responses as Telegraph pages above this length. Set `-1` to disable. | `-1` |
| `TELEGRAPH_SCOPE` | Chat scopes eligible for Telegraph conversion. | `['group', 'supergroup']` |
| `TELEGRAPH_AUTHOR_URL` | Optional Telegraph author link. | `''` |

## Persistence, Cleanup, And Safety

| Variable | Description | Default |
| --- | --- | --- |
| `MAX_HISTORY_LENGTH` | Stored chat history window used by the model. | `10` |
| `STORE_HISTORY_LENGTH` | Number of stored history items loaded from Redis on each request. | `64` |
| `EXPIRED_TIME` | Minutes after which sent messages become eligible for deletion. `-1` disables expiration. | `-1` |
| `CRON_CHECK_TIME` | Cron expression used by the local adapter to run scheduled cleanup. | `''` |
| `SCHEDULE_GROUP_DELETE_TYPE` | Group message categories eligible for scheduled deletion. | `['tip']` |
| `SCHEDULE_PRIVATE_DELETE_TYPE` | Private message categories eligible for scheduled deletion. | `['tip']` |
| `SAFE_MODE` | Ignore duplicate/old Telegram updates by tracking recent message IDs in Redis. | `true` |
| `CHAT_COMPLETE_API_TIMEOUT` | Per-request timeout in seconds for direct chat completion calls. | `0` |
| `CHAT_TOTAL_DURATION_LIMIT` | Total conversation request timeout in seconds. | `1800` |
| `LOG_LEVEL` | Runtime logger level. | `info` |
| `DEBUG_MODE` | Store more debugging data and keep extra diagnostics. | `false` |
| `DEV_MODE` | Expose additional debug output in commands such as `/system`. | `false` |
| `HIDE_MIDDLE_MESSAGE` | Hide intermediate transcription/tool status messages where possible. | `false` |
| `RELAX_AUTH_KEYS` | Allow some `/set` keys to skip the stronger auth path when used temporarily. | `[]` |
| `INLINE_QUERY_SEND_INTERVAL` | Stream update interval used for inline query answers. | `2000` |
| `INLINE_QUERY_SHOW_INFO` | Show response info blocks in inline-query mode. | `false` |
| `CALLBACK_QUERY_RC` | `/settings` inline keyboard layout in `rows x columns` form. | `'7x2'` |

Scheduled deletion notes:

- `EXPIRED_TIME` is in minutes
- `CRON_CHECK_TIME` controls how often the cleanup task runs, not how long messages live
- `SCHEDULE_GROUP_DELETE_TYPE` and `SCHEDULE_PRIVATE_DELETE_TYPE` accept `tip` and `chat`
- use `[]` to disable scheduled deletion tagging for that chat scope

Examples:

```toml
[vars]
# Delete only helper messages after 1 hour.
EXPIRED_TIME = 60
CRON_CHECK_TIME = "*/5 * * * *"
SCHEDULE_GROUP_DELETE_TYPE = ["tip"]
SCHEDULE_PRIVATE_DELETE_TYPE = ["tip"]
```

```toml
[vars]
# Delete all bot output after 24 hours.
EXPIRED_TIME = 1440
CRON_CHECK_TIME = "0 * * * *"
SCHEDULE_GROUP_DELETE_TYPE = ["tip", "chat"]
SCHEDULE_PRIVATE_DELETE_TYPE = ["tip", "chat"]
```

```toml
[vars]
# Delete private-chat output only.
EXPIRED_TIME = 30
CRON_CHECK_TIME = "*/10 * * * *"
SCHEDULE_GROUP_DELETE_TYPE = []
SCHEDULE_PRIVATE_DELETE_TYPE = ["tip", "chat"]
```

## Provider Family Selection

| Variable | Values | Default |
| --- | --- | --- |
| `AI_CHAT_PROVIDER` | `openai`, `oailike` | `openai` |
| `AI_IMAGE_PROVIDER` | `openai`, `oailike` | `openai` |
| `AI_ASR_PROVIDER` | `openai`, `oailike` | `openai` |
| `AI_TTS_PROVIDER` | `openai`, `oailike` | `openai` |

If an unsupported legacy provider is loaded from stored config, the runtime normalizes it back to a supported provider.

## LLM Endpoint Routing

The effective LLM endpoint comes from `OPENAI_API_BASE` or `OAILIKE_API_BASE`.

Accepted forms:

- root base such as `https://api.openai.com/v1`
- full endpoint such as `https://api.openai.com/v1/responses`
- full endpoint such as `https://api.openai.com/v1/chat/completions`

Defaults when a root `/v1` base is used:

- `openai` -> `v1/responses`
- `oailike` -> `v1/chat/completions`

Non-chat APIs such as `/models`, `/images`, `/audio`, embeddings, and rerank continue to use the stripped root base.

## OpenAI Provider Settings

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | API key list. A random key is picked per request. | `[]` |
| `OPENAI_API_BASE` | Base URL or explicit LLM endpoint. | `https://api.openai.com/v1` |
| `OPENAI_CHAT_MODEL` | Main text chat model. | `gpt-5.4-mini` |
| `OPENAI_VISION_MODEL` | Chat model used when the latest user message includes images/files. | `gpt-5.4-mini` |
| `OPENAI_STT_MODEL` | Speech-to-text model. | `gpt-4o-mini-transcribe` |
| `OPENAI_TTS_MODEL` | Text-to-speech model. | `gpt-4o-mini-tts` |
| `OPENAI_TTS_VOICE` | TTS voice name. | `alloy` |
| `OPENAI_EMBEDDING_MODEL` | Embedding model for rerank mode `openai`. | `text-embedding-3-small` |
| `OPENAI_IMAGE_MODEL` | Model used by `/img` and the OpenAI built-in image tool. | `gpt-image-1.5` |
| `OPENAI_API_EXTRA_PARAMS` | Per-model request overrides merged into outgoing OpenAI requests. | `{}` |
| `OPENAI_STT_EXTRA_PARAMS` | Extra multipart STT fields. | `{}` |
| `OPENAI_TTS_EXTRA_PARAMS` | Extra TTS request fields. | `{}` |
| `OPENAI_PROVIDER_OPTIONS` | AI SDK provider options for OpenAI Responses-mode requests. | `reasoningSummary: 'auto'`, `parallelToolCalls: true` |
| `OPENAI_MODELS_API` | Models discovery endpoint used by `/settings` refresh. | `/models` |
| `OPENAI_MODELS` | Cached or manually defined model list exposed in `/settings`. | `[]` |

## OpenAI-Compatible Provider Settings

| Variable | Description | Default |
| --- | --- | --- |
| `OAILIKE_API_KEY` | API key. | `null` |
| `OAILIKE_API_BASE` | Base URL or explicit LLM endpoint. | `https://api.openai.com/v1` |
| `OAILIKE_CHAT_MODEL` | Main text chat model. | `gpt-5.4-mini` |
| `OAILIKE_VISION_MODEL` | Vision-capable chat model. | `gpt-5.4-mini` |
| `OAILIKE_IMAGE_MODEL` | `/img` image generation model. | `gpt-image-1.5` |
| `OAILIKE_IMAGE_SIZE` | Default image size for the compatible image endpoint. | `1024x1024` |
| `OAILIKE_STT_MODEL` | Speech-to-text model. | `FunAudioLLM/SenseVoiceSmall` |
| `OAILIKE_TTS_MODEL` | Text-to-speech model. | `gpt-4o-mini-tts` |
| `OAILIKE_TTS_VOICE` | TTS voice name. | `alloy` |
| `OAILIKE_EMBEDDING_MODEL` | Embedding model for rerank mode `oailikeV1`. | `text-embedding-3-small` |
| `OAILIKE_RERANK_MODEL` | Compatible rerank model for rerank mode `oailikeV2`. | `''` |
| `OAILIKE_API_EXTRA_PARAMS` | Per-model request overrides merged into outgoing compatible requests. | `{}` |
| `OAILIKE_STT_EXTRA_PARAMS` | Extra multipart STT fields. | `{}` |
| `OAILIKE_TTS_EXTRA_PARAMS` | Extra TTS request fields. | `{}` |
| `OAILIKE_PROVIDER_OPTIONS` | AI SDK provider options used in compatible mode. | `{}` |
| `OAILIKE_MODELS_API` | Models discovery endpoint used by `/settings` refresh. | `/models` |
| `OAILIKE_MODELS` | Cached or manually defined model list exposed in `/settings`. | `[]` |

## Model Selection, Tuning, And Output Modes

| Variable | Description | Default |
| --- | --- | --- |
| `TOOL_MODEL` | Optional dedicated model for MCP or OpenAI built-in tool steps. Accepts plain model IDs or `provider:model` form. | `''` |
| `CHAT_TEMPERATURE` | Temperature for regular chat turns. | `undefined` |
| `FUNCTION_CALL_TEMPERATURE` | Temperature for tool-calling steps. | `undefined` |
| `MAX_TOKENS` | Max output tokens. | `undefined` |
| `MAX_STEPS` | Max chained tool-call / response steps. | `5` |
| `MAX_RETRIES` | AI SDK retry count. | `0` |
| `RERANK_AGENT` | `openai`, `oailikeV1`, or `oailikeV2`. | `openai` |
| `TEXT_HANDLE_TYPE` | How text input is processed: `text`, `tts`, or `chat`. | `text` |
| `TEXT_OUTPUT` | Output type for text input: `text` or `audio`. | `text` |
| `AUDIO_HANDLE_TYPE` | How audio input is processed: `stt`, `audio`, or `chat`. | `stt` |
| `AUDIO_OUTPUT` | Output type for audio input: `text` or `audio`. | `text` |
| `AUDIO_PROMPT` | Default prompt used when audio arrives without text. | long default prompt |
| `ENABLE_SHOWINFO` | Include the model/log footer in normal replies. | `false` |
| `SHOW_PARTS` | Which metadata pieces to show when info footer is enabled. | `['model', 'model_time', 'token', 'tool', 'tool_time']` |

Telegram streaming transport notes:

- `TELEGRAM_STREAM_MODE = "message"` uses the edit/send path and is the most compatible choice across Telegram clients
- `TELEGRAM_STREAM_MODE = "draft"` uses native `sendMessageDraft` when possible in private chats
- `TELEGRAM_STREAM_MODE = "auto"` keeps the draft path available while still falling back to message edits
| `MESSAGE_COMPATIBLE` | Convert tool-call/tool-result history into user-visible message form for compatibility. | `true` |
| `ENABLE_SEARCH_SOURCE` | Attach provider citations/source links when available. | `true` |
| `SHOW_THINKING_TEXT` | Show reasoning output when available. | `true` |

### Input/Output Mode Behavior

- `text:text`
  - regular text chat
- `text:audio`
  - chat first, then read the answer aloud
- `tts:audio` or `tts:text`
  - read the original user text directly instead of chatting first
- `stt:text`
  - transcribe audio and stop
- `audio:text`
  - transcribe audio, then ask the LLM with that transcript
- `audio:audio`
  - transcribe audio, ask the LLM, then synthesize the answer back to speech
- `chat` handle modes
  - pass file/audio content directly to a compatible multimodal chat model

### Rerank And Embedding Usage

The embedding-model settings are not used for ordinary chat generation.

They are only used by the rerank/intelligent-model path:

- `ENABLE_INTELLIGENT_MODEL = true`
- message prefixes such as `//c`, `//v`, `//t`, and `//s`
- `RERANK_AGENT = "openai"` or `RERANK_AGENT = "oailikeV1"`

In those modes, the bot embeds your input text plus the available model list and selects the closest match by similarity.

Practical mapping:

- `OPENAI_EMBEDDING_MODEL`
  - used when `RERANK_AGENT = "openai"`
- `OAILIKE_EMBEDDING_MODEL`
  - used when `RERANK_AGENT = "oailikeV1"`
- `OAILIKE_RERANK_MODEL`
  - used instead when `RERANK_AGENT = "oailikeV2"` and the compatible backend exposes a `/rerank` endpoint

If you do not use intelligent model selection or reranking, the embedding-model settings are effectively unused.

## Prompting, Aliases, And Workflow

| Variable | Description | Default |
| --- | --- | --- |
| `SYSTEM_INIT_MESSAGE` | Base system prompt. | English helper prompt |
| `PROMPT` | Named prompt presets used by `/set -p ...`. | bundled defaults |
| `MAPPING_KEY` | `/set` shortcut-to-key mapping string. | built-in mapping |
| `MAPPING_VALUE` | `/set` alias-to-value mapping string. | `''` |
| `ENABLE_ALIAS` | Show alias name instead of raw model ID in output logs when possible. | `false` |
| `MESSAGE_REPLACER` | Map of text replacements applied before sending content to the model. | `{}` |
| `PARAMS_MODIFIER` | Low-level per-model parameter add/remove rules. | `[]` |
| `CONTINUE_STEP` | Allow the AI SDK to continue multi-step outputs. | `false` |
| `ENABLE_WORKFLOW` | Enable named prompt workflows triggered by `@key` prefixes. | `false` |
| `WORKFLOW` | Workflow map keyed by trigger name. | `{}` |
| `ENABLE_INTELLIGENT_MODEL` | Enable simple inline model selection hints such as `//c model`. | `false` |
| `BLOCKLIST` | Stored per-chat blocked user IDs. | `[]` |

### `PARAMS_MODIFIER` Format

Example:

```toml
PARAMS_MODIFIER = [
  "gpt-5.4:+reasoning_effort=\"high\"",
  "gpt-5.4-mini:+reasoning_effort=\"medium\""
]
```

- `model1,model2:` selects exact model IDs
- `-param` removes or undefines a request parameter
- `+param=value` adds or overrides a request parameter

### `WORKFLOW` Format

When enabled, a user message starting with `@key` can run one or more chained model steps.

Example:

```toml
ENABLE_WORKFLOW = true
WORKFLOW = {
  think = [
    { agent = "oailike", model = "deepseek-reasoner", temperature = 0.3, max_tokens = 1024, next = "Use this reasoning to answer the original question:\n{{result}}\n\nQuestion:\n{{question}}" }
  ]
}
```

## Generic MCP

Generic MCP servers are configured with env vars whose names start with `MCP_`.

Rules:

- the suffix after `MCP_` becomes the MCP group name
- the value must be a JSON string
- the same group name must appear in `USE_MCP`
- this repository only supports MCP in local/Docker mode

Example:

```toml
[vars]
USE_MCP = ["demo"]
MCP_demo = "{\"type\":\"http\",\"url\":\"http://127.0.0.1:3001/mcp\"}"
```

Supported transport payloads:

```toml
MCP_demo = "{\"type\":\"http\",\"url\":\"http://127.0.0.1:3001/mcp\"}"
MCP_demo = "{\"type\":\"sse\",\"url\":\"http://127.0.0.1:3001/sse\"}"
MCP_demo = "{\"type\":\"stdio\",\"command\":\"npx\",\"args\":[\"-y\",\"@modelcontextprotocol/server-filesystem\",\"/tmp\"]}"
```

With headers:

```toml
MCP_demo = "{\"type\":\"http\",\"url\":\"https://example.com/mcp\",\"headers\":{\"Authorization\":\"Bearer token\"}}"
```

## OpenAI Built-In Tools

OpenAI Responses API built-in tools are still supported.

Important:

- they only work when the effective OpenAI request path uses the Responses API
- if you point `OPENAI_API_BASE` at `/v1/chat/completions`, provider-side built-in tools are not available

### Global Tool Switches

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_BUILDIN` | Available built-in tool names. | `['webSearch', 'codeInterpreter', 'fileSearch', 'imageGeneration', 'mcp']` |
| `USE_OPENAI_BUILDIN` | Enabled built-in tool names for the current stored user config. | `[]` |

### Web Search

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_WEB_SEARCH` | Enable web search. | `false` |
| `OPENAI_WEB_SEARCH_EXTERNAL_ACCESS` | Live web access instead of cache-only behavior. | `true` |
| `OPENAI_WEB_SEARCH_ALLOWED_DOMAINS` | Domain allowlist. | `[]` |
| `OPENAI_WEB_SEARCH_CONTEXT_SIZE` | `low`, `medium`, or `high`. | `medium` |
| `OPENAI_WEB_SEARCH_USER_LOCATION` | Approximate user location such as `San Francisco, USA`. | `''` |

### Code Interpreter

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_CODE_INTERPRETER` | Enable provider-side code execution. | `false` |
| `OPENAI_CODE_INTERPRETER_CONTAINER` | Optional container ID to reuse. | `''` |

### File Search

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_FILE_SEARCH` | Enable file search. | `false` |
| `OPENAI_FILE_SEARCH_VECTOR_STORES` | Vector store IDs. Required when enabled. | `[]` |
| `OPENAI_FILE_SEARCH_MAX_RESULTS` | Maximum file-search result count. | `10` |
| `OPENAI_FILE_SEARCH_SCORE_THRESHOLD` | Result score threshold. | `0` |

### Image Generation

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_IMAGE_GENERATION` | Enable OpenAI provider-side image generation tool. | `false` |
| `OPENAI_IMAGE_BACKGROUND` | `auto`, `opaque`, or `transparent`. | `auto` |
| `OPENAI_IMAGE_INPUT_FIDELITY` | `low` or `high`. | `low` |
| `OPENAI_IMAGE_MODEL` | Provider-side image model. | `gpt-image-1.5` |
| `OPENAI_IMAGE_OUTPUT_COMPRESSION` | Compression level. | `100` |
| `OPENAI_IMAGE_OUTPUT_FORMAT` | `png`, `jpeg`, or `webp`. | `png` |
| `OPENAI_IMAGE_PARTIAL_IMAGES` | Partial image count for streaming mode. | `0` |
| `OPENAI_IMAGE_QUALITY` | `auto`, `low`, `medium`, or `high`. | `auto` |
| `OPENAI_IMAGE_SIZE` | `auto`, `1024x1024`, `1024x1536`, or `1536x1024`. | `auto` |

### Provider-Side MCP

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_MCP` | Enable provider-side MCP support. | `false` |
| `OPENAI_MCP_SERVER_LABEL` | Required server label. | `''` |
| `OPENAI_MCP_SERVER_URL` | MCP server URL. | `''` |
| `OPENAI_MCP_CONNECTOR_ID` | OpenAI connector ID. | `''` |
| `OPENAI_MCP_SERVER_DESCRIPTION` | Optional description. | `''` |
| `OPENAI_MCP_ALLOWED_TOOLS` | Explicit tool allowlist. | `[]` |
| `OPENAI_MCP_ALLOWED_TOOLS_READ_ONLY` | Restrict allowed tools to read-only mode. | `false` |
| `OPENAI_MCP_AUTHORIZATION` | OAuth bearer token. | `''` |
| `OPENAI_MCP_HEADERS` | Extra headers. | `{}` |
| `OPENAI_MCP_REQUIRE_APPROVAL` | `always` or `never`. | `never` |
| `OPENAI_MCP_APPROVAL_TOOL_NAMES` | Tool names used in the mixed approval mode. | `[]` |

Generic `MCP_*` and provider-side `OPENAI_MCP_*` are separate systems:

- `MCP_*` configures this bot’s own generic MCP clients
- `OPENAI_MCP_*` configures OpenAI’s provider-side MCP tool

## Inline Settings UI

The inline `/settings` UI can expose:

- chat, image, ASR, and TTS provider family
- chat/image/vision/tool models
- enabled MCP groups
- text/audio handle modes
- enabled OpenAI built-in tools
- stored user-config keys listed through the `Envs` picker

Two environment keys shape that UI:

| Variable | Description | Default |
| --- | --- | --- |
| `ENVS_VARIABLES` | If empty, show all non-sensitive stored user-config keys. Otherwise show only the listed keys. | `[]` |
| `CALLBACK_MENU` | Restrict which top-level setting groups appear in `/settings`. | `[]` |

Whitelist admins can browse the full stored user-config key list through the `Envs` picker.

## `/set` Shortcuts

Default shortcut mapping:

```text
-p:SYSTEM_INIT_MESSAGE
-n:MAX_HISTORY_LENGTH
-a:AI_CHAT_PROVIDER
-ai:AI_IMAGE_PROVIDER
-m:CHAT_MODEL
-im:IMAGE_MODEL
-v:VISION_MODEL
-s:STT_MODEL
-t:TTS_MODEL
-tm:TOOL_MODEL
-as:AI_ASR_PROVIDER
-at:AI_TTS_PROVIDER
-ra:RERANK_AGENT
-ew:ENABLE_WORKFLOW
-tp:CHAT_TEMPERATURE
```

These shortcuts live in `MAPPING_KEY` and can be changed with `/map`.

## Examples

### OpenAI With Responses API Defaults

```toml
[vars]
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
CHAT_WHITE_LIST = "123456789"
REDIS_URL = "rediss://default:your-password@your-redis-host:6379"
OPENAI_API_KEY = "sk-..."
OPENAI_API_BASE = "https://api.openai.com/v1"
OPENAI_CHAT_MODEL = "gpt-5.4-mini"
OPENAI_VISION_MODEL = "gpt-5.4-mini"
```

### OpenAI-Compatible Chat Completions

```toml
[vars]
AI_CHAT_PROVIDER = "oailike"
AI_IMAGE_PROVIDER = "oailike"
AI_ASR_PROVIDER = "oailike"
AI_TTS_PROVIDER = "oailike"

OAILIKE_API_KEY = "your-key"
OAILIKE_API_BASE = "https://your-api.example.com/v1/chat/completions"
OAILIKE_CHAT_MODEL = "gpt-5.4-mini"
OAILIKE_VISION_MODEL = "gpt-5.4-mini"
OAILIKE_IMAGE_MODEL = "gpt-image-1.5"
```

### OpenAI With Generic MCP

```toml
[vars]
OPENAI_API_KEY = "sk-..."
USE_MCP = ["filesystem"]
MCP_filesystem = "{\"type\":\"stdio\",\"command\":\"npx\",\"args\":[\"-y\",\"@modelcontextprotocol/server-filesystem\",\"/data\"]}"
TOOL_MODEL = "gpt-5.4"
```

### OpenAI With Provider-Side Web Search

```toml
[vars]
OPENAI_API_KEY = "sk-..."
OPENAI_API_BASE = "https://api.openai.com/v1/responses"
USE_OPENAI_BUILDIN = ["webSearch"]
OPENAI_WEB_SEARCH_CONTEXT_SIZE = "high"
OPENAI_WEB_SEARCH_USER_LOCATION = "San Francisco, USA"
```
