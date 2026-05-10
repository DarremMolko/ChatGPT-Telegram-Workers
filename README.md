# ChatGPT Telegram Workers

[![Build and Push Docker Image](https://github.com/SzeMeng76/ChatGPT-Telegram-Workers/actions/workflows/build-docker.yml/badge.svg)](https://github.com/SzeMeng76/ChatGPT-Telegram-Workers/actions/workflows/build-docker.yml)

Telegram bot for OpenAI and OpenAI-compatible APIs.

This repository has been simplified to:

- English only
- `openai` and `oailike` providers only
- local and Docker deployment only
- OpenAI built-in tools only
- native Telegram draft streaming when Telegram supports it

## Features

- Chat with `openai` or any OpenAI-compatible endpoint through `oailike`
- Native Telegram streaming in private chats, with fallback to edit-based streaming
- Image generation through OpenAI image APIs or OpenAI-compatible endpoints
- Speech-to-text and text-to-speech through OpenAI or OpenAI-compatible endpoints
- Internal tools, MCP integration, and per-user settings
- local process and Docker deployment paths

## Supported Providers

- `openai`
- `oailike`

Unsupported provider-specific settings from older versions were removed, including Google, Anthropic, xAI, Azure, Vertex, Workers AI, Mistral, Cohere, Kling, and Fish Audio.

## Quick Start

Copy the local config templates and set the required Telegram token plus one provider.

```bash
cp config.example.json config.json
cp config.example.toml config.toml
```

### OpenAI

```env
TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
OPENAI_API_KEY=sk-...
```

### OpenAI-compatible

```env
TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
AI_CHAT_PROVIDER=oailike
AI_IMAGE_PROVIDER=oailike
AI_ASR_PROVIDER=oailike
AI_TTS_PROVIDER=oailike
OAILIKE_API_KEY=your-key
OAILIKE_API_BASE=https://your-api.example.com/v1
```

## Common Commands

- `/new` starts a new conversation
- `/redo` retries the last request
- `/img <prompt>` generates an image
- `/tts <text>` generates speech
- `/set ...` applies temporary or stored config overrides
- `/settings` opens inline settings
- `/system` shows current runtime and provider info
- `/history [n]` exports stored history

## Main Configuration

Important variables:

- `OPENAI_API_KEY`
- `OPENAI_API_BASE`
- `OPENAI_CHAT_MODEL`
- `OPENAI_VISION_MODEL`
- `OPENAI_TTS_MODEL`
- `OPENAI_STT_MODEL`
- `OAILIKE_API_KEY`
- `OAILIKE_API_BASE`
- `OAILIKE_CHAT_MODEL`
- `OAILIKE_VISION_MODEL`
- `OAILIKE_IMAGE_MODEL`
- `OAILIKE_TTS_MODEL`
- `OAILIKE_STT_MODEL`
- `AI_CHAT_PROVIDER`
- `AI_IMAGE_PROVIDER`
- `AI_ASR_PROVIDER`
- `AI_TTS_PROVIDER`

OpenAI Responses API tools remain supported through:

- `USE_OPENAI_BUILDIN`
- `OPENAI_ENABLE_WEB_SEARCH`
- `OPENAI_ENABLE_CODE_INTERPRETER`
- `OPENAI_ENABLE_FILE_SEARCH`
- `OPENAI_ENABLE_IMAGE_GENERATION`
- `OPENAI_ENABLE_MCP`

Endpoint selection is configurable for both provider families:

- `OPENAI_API_BASE=https://.../v1/responses` uses the Responses API
- `OPENAI_API_BASE=https://.../v1/chat/completions` uses Chat Completions
- `OAILIKE_API_BASE=https://.../v1/responses` uses the Responses API
- `OAILIKE_API_BASE=https://.../v1/chat/completions` uses Chat Completions

If you keep the root `/v1` base instead of a full endpoint path, the defaults are:

- `openai` -> `/v1/responses`
- `oailike` -> `/v1/chat/completions`

See:

- [Configuration](./doc/en/CONFIG.md)
- [Local Development and Docker](./doc/en/LOCAL.md)

## Development

```bash
npm install
npm run lint
npm run build
```

Local dev:

```bash
npm run start:local
```

## Structure

```text
src/
├── agent/        # OpenAI and OpenAI-compatible integrations
├── config/       # Environment and user configuration
├── telegram/     # Telegram command, handler, and send logic
├── tools/        # Internal, external, MCP, and local tools
└── utils/        # Shared helpers
```

## Notes

- `LANGUAGE` is fixed to English in this simplified build.
- The repository only keeps the local process and Docker deployment paths.
- Native Telegram draft streaming is used when available in private chats; unsupported chats fall back automatically.
- Older configs that selected removed providers are normalized back to supported providers at runtime.

## License

MIT
