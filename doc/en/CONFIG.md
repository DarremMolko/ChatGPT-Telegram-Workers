# Configuration

This build only supports two provider families:

- `openai`
- `oailike` for OpenAI-compatible APIs

Older provider-specific settings for Google, Anthropic, xAI, Azure, Vertex, Workers AI, Mistral, Cohere, Kling, and Fish Audio were removed from the supported config surface.

## Basics

| Variable | Description | Default |
| --- | --- | --- |
| `LANGUAGE` | Interface language. Fixed to English in this simplified build. | `en` |
| `TELEGRAM_AVAILABLE_TOKENS` | Comma-separated Telegram bot tokens. | `[]` |
| `OPENAI_API_KEY` | OpenAI API key list. Comma-separated in env form. | `[]` |
| `OAILIKE_API_KEY` | OpenAI-compatible API key. | `null` |
| `AI_CHAT_PROVIDER` | Chat provider. | `openai` |
| `AI_IMAGE_PROVIDER` | Image provider. | `openai` |
| `AI_ASR_PROVIDER` | Speech-to-text provider. | `openai` |
| `AI_TTS_PROVIDER` | Text-to-speech provider. | `openai` |

## OpenAI

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_API_BASE` | OpenAI base URL. | `https://api.openai.com/v1` |
| `OPENAI_CHAT_MODEL` | Default chat model. | `gpt-4o-mini` |
| `OPENAI_VISION_MODEL` | Model used when the last user message contains an image. | `gpt-4o-mini` |
| `OPENAI_IMAGE_MODEL` | Model for OpenAI image generation tool. | `gpt-image-1` |
| `DALL_E_MODEL` | Model for `/img` image generation. | `dall-e-3` |
| `OPENAI_STT_MODEL` | Speech-to-text model. | `whisper-1` |
| `OPENAI_TTS_MODEL` | Text-to-speech model. | `tts-1` |
| `OPENAI_TTS_VOICE` | TTS voice. | `alloy` |
| `OPENAI_EMBEDDING_MODEL` | Embedding model for reranking. | `text-embedding-3-small` |
| `OPENAI_API_EXTRA_PARAMS` | Per-model request overrides. | `{}` |
| `OPENAI_STT_EXTRA_PARAMS` | Extra multipart STT params. | `{}` |
| `OPENAI_TTS_EXTRA_PARAMS` | Extra TTS params. | `{}` |
| `OPENAI_RESPONSE_MODELS` | Models that should use the Responses API. `*` means always. | `['*']` |

## OpenAI-compatible

| Variable | Description | Default |
| --- | --- | --- |
| `OAILIKE_API_BASE` | Base URL for the compatible endpoint. | `https://api.openai.com/v1` |
| `OAILIKE_CHAT_MODEL` | Default chat model. | `gpt-4o-mini` |
| `OAILIKE_VISION_MODEL` | Vision-capable chat model. | `gpt-4o-mini` |
| `OAILIKE_IMAGE_MODEL` | Image model for `/img`. | `dall-e-3` |
| `OAILIKE_IMAGE_SIZE` | Default image size. | `1024x1024` |
| `OAILIKE_STT_MODEL` | Speech-to-text model. | `FunAudioLLM/SenseVoiceSmall` |
| `OAILIKE_TTS_MODEL` | Text-to-speech model. | `tts-1` |
| `OAILIKE_TTS_VOICE` | TTS voice. | `alloy` |
| `OAILIKE_EMBEDDING_MODEL` | Embedding model for reranking. | `text-embedding-3-small` |
| `OAILIKE_RERANK_MODEL` | Compatible rerank model for `oailikeV2`. | `''` |
| `OAILIKE_API_EXTRA_PARAMS` | Per-model request overrides. | `{}` |
| `OAILIKE_STT_EXTRA_PARAMS` | Extra multipart STT params. | `{}` |
| `OAILIKE_TTS_EXTRA_PARAMS` | Extra TTS params. | `{}` |

## Provider Selection

These settings control which provider family is used by each capability:

| Variable | Values |
| --- | --- |
| `AI_CHAT_PROVIDER` | `openai`, `oailike` |
| `AI_IMAGE_PROVIDER` | `openai`, `oailike` |
| `AI_ASR_PROVIDER` | `openai`, `oailike` |
| `AI_TTS_PROVIDER` | `openai`, `oailike` |

If an unsupported legacy provider is loaded from stored config, the runtime normalizes it back to a supported provider.

## User Runtime Settings

| Variable | Description | Default |
| --- | --- | --- |
| `USE_TOOLS` | Enabled internal or plugin tools. | `[]` |
| `USE_MCP` | Enabled MCP tool groups. | `[]` |
| `TOOL_MODEL` | Dedicated model for tool calls. Empty means use the chat model. | `''` |
| `MAX_HISTORY_LENGTH` | Stored history window. | `10` |
| `MAX_STEPS` | Maximum step count for chained tool use. | `5` |
| `MAX_RETRIES` | AI SDK retry count. | `0` |
| `CHAT_TEMPERATURE` | Temperature for normal chat responses. | `undefined` |
| `FUNCTION_CALL_TEMPERATURE` | Temperature for tool-call steps. | `undefined` |
| `MAX_TOKENS` | Output token cap. | `undefined` |
| `TEXT_HANDLE_TYPE` | `tts`, `text`, or `chat`. | `text` |
| `TEXT_OUTPUT` | `audio` or `text`. | `text` |
| `AUDIO_HANDLE_TYPE` | `stt`, `audio`, or `chat`. | `stt` |
| `AUDIO_OUTPUT` | `audio` or `text`. | `text` |
| `RERANK_AGENT` | `openai`, `oailikeV1`, `oailikeV2` | `openai` |

## OpenAI Built-in Tools

OpenAI Responses API tools are still supported.

### Global Switches

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_BUILDIN` | Available tool list. | `['webSearch', 'codeInterpreter', 'fileSearch', 'imageGeneration', 'mcp']` |
| `USE_OPENAI_BUILDIN` | Enabled built-in tools. | `[]` |

### Web Search

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_WEB_SEARCH` | Enable web search. | `false` |
| `OPENAI_WEB_SEARCH_EXTERNAL_ACCESS` | Live fetch instead of cached-only access. | `true` |
| `OPENAI_WEB_SEARCH_ALLOWED_DOMAINS` | Domain allowlist. | `[]` |
| `OPENAI_WEB_SEARCH_CONTEXT_SIZE` | `low`, `medium`, or `high`. | `medium` |
| `OPENAI_WEB_SEARCH_USER_LOCATION` | Approximate user location string. | `''` |

### Code Interpreter

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_CODE_INTERPRETER` | Enable code interpreter. | `false` |
| `OPENAI_CODE_INTERPRETER_CONTAINER` | Existing container ID, if required. | `''` |

### File Search

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_FILE_SEARCH` | Enable file search. | `false` |
| `OPENAI_FILE_SEARCH_VECTOR_STORES` | Vector store IDs. | `[]` |
| `OPENAI_FILE_SEARCH_MAX_RESULTS` | Maximum result count. | `10` |
| `OPENAI_FILE_SEARCH_SCORE_THRESHOLD` | Ranking threshold. | `0` |

### Image Generation

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_IMAGE_GENERATION` | Enable image generation tool. | `false` |
| `OPENAI_IMAGE_BACKGROUND` | `auto`, `opaque`, or `transparent`. | `auto` |
| `OPENAI_IMAGE_INPUT_FIDELITY` | `low` or `high`. | `low` |
| `OPENAI_IMAGE_OUTPUT_COMPRESSION` | Compression level. | `100` |
| `OPENAI_IMAGE_OUTPUT_FORMAT` | `png`, `jpeg`, or `webp`. | `png` |
| `OPENAI_IMAGE_PARTIAL_IMAGES` | Partial image count for streaming. | `0` |
| `OPENAI_IMAGE_QUALITY` | `auto`, `low`, `medium`, or `high`. | `auto` |
| `OPENAI_IMAGE_SIZE` | `auto`, `1024x1024`, `1024x1536`, or `1536x1024`. | `auto` |

### MCP

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_ENABLE_MCP` | Enable OpenAI MCP tool support. | `false` |
| `OPENAI_MCP_SERVER_LABEL` | Required server label. | `''` |
| `OPENAI_MCP_SERVER_URL` | MCP server URL. | `''` |
| `OPENAI_MCP_CONNECTOR_ID` | OpenAI connector ID. | `''` |
| `OPENAI_MCP_SERVER_DESCRIPTION` | Optional description. | `''` |
| `OPENAI_MCP_ALLOWED_TOOLS` | Explicit tool allowlist. | `[]` |
| `OPENAI_MCP_ALLOWED_TOOLS_READ_ONLY` | Restrict allowed tools to read-only mode. | `false` |
| `OPENAI_MCP_AUTHORIZATION` | OAuth bearer token. | `''` |
| `OPENAI_MCP_HEADERS` | Extra headers. | `{}` |
| `OPENAI_MCP_REQUIRE_APPROVAL` | `always` or `never`. | `never` |
| `OPENAI_MCP_APPROVAL_TOOL_NAMES` | Tool names that bypass default approval behavior. | `[]` |

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
-tool:USE_TOOLS
-as:AI_ASR_PROVIDER
-at:AI_TTS_PROVIDER
-ra:RERANK_AGENT
-tp:CHAT_TEMPERATURE
```

These shortcuts are stored in `MAPPING_KEY` and can be customized.

## Locked Keys

These keys are intentionally locked from user-level overrides:

```env
LOCK_USER_CONFIG_KEYS=OPENAI_API_BASE,OAILIKE_API_BASE
```

## Example: OpenAI-only

```env
TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
OPENAI_API_KEY=sk-...
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_VISION_MODEL=gpt-4o-mini
OPENAI_TTS_MODEL=tts-1
OPENAI_STT_MODEL=whisper-1
```

## Example: OpenAI-compatible

```env
TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
AI_CHAT_PROVIDER=oailike
AI_IMAGE_PROVIDER=oailike
AI_ASR_PROVIDER=oailike
AI_TTS_PROVIDER=oailike
OAILIKE_API_KEY=your-key
OAILIKE_API_BASE=https://your-api.example.com/v1
OAILIKE_CHAT_MODEL=your-chat-model
OAILIKE_VISION_MODEL=your-vision-model
OAILIKE_IMAGE_MODEL=your-image-model
OAILIKE_STT_MODEL=your-stt-model
OAILIKE_TTS_MODEL=your-tts-model
```

