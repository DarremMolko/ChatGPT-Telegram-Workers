# ChatGPT Telegram Workers

[![Build and Push Docker Image](https://github.com/SzeMeng76/ChatGPT-Telegram-Workers/actions/workflows/build-docker.yml/badge.svg)](https://github.com/SzeMeng76/ChatGPT-Telegram-Workers/actions/workflows/build-docker.yml)

Telegram bot for local and Docker deployment with OpenAI and OpenAI-compatible APIs.

This repository now intentionally focuses on a narrow runtime surface:

- English only
- `openai` and `oailike` providers only
- local process and Docker deployment only
- Upstash Redis only
- generic MCP plus OpenAI Responses built-in tools only

## Capability Overview

| Area | What remains |
| --- | --- |
| Chat | `openai` and `oailike`, with configurable `v1/responses` or `v1/chat/completions` routing |
| Streaming | Native Telegram draft streaming in supported private chats, with automatic fallback to message edits |
| Images | `/img` generation for both provider families; reply-to-image editing through the OpenAI image path |
| Speech | Telegram voice/audio input via STT, text-to-speech output via `/tts`, and configurable text/audio workflows |
| Tools | Generic MCP groups through `MCP_*` and OpenAI Responses built-in tools through `USE_OPENAI_BUILDIN` |
| Persistence | Redis-backed chat history, stored user config, scheduled deletions, and transient Telegram state |
| Runtime control | Inline `/settings`, `/set`, `/setenv`, `/setenvs`, `/map`, per-chat blocklists, and history export |
| Deployment | Local webhook mode, local polling mode, Docker, and Docker Compose |

## How Configuration Works

There are two configuration layers:

1. Deployment and environment settings
   - Loaded from `config.toml` under `[vars]`
   - Overridden by real process environment variables
   - Covers Telegram tokens, Redis credentials, group policy, streaming/rendering defaults, and other runtime-wide behavior

2. Stored per-chat user configuration
   - Persisted in Redis
   - Modified through `/set`, `/setenv`, `/setenvs`, `/delenv`, `/clearenv`, and `/settings`
   - Covers provider choice, model choice, MCP selection, tool model, temperatures, workflow, output modes, and similar chat-level behavior

`CHAT_WHITE_LIST` users are runtime admins for the stored per-chat config surface. Deployment-only environment settings still come from `config.toml` or process env.

## Quick Start

Copy the example files:

```bash
cp config.example.json config.json
cp config.example.toml config.toml
```

### Minimal OpenAI Example

```toml
[vars]
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
CHAT_WHITE_LIST = "123456789"
UPSTASH_REDIS_REST_URL = "https://your-redis.upstash.io"
UPSTASH_REDIS_REST_TOKEN = "your-upstash-rest-token"
OPENAI_API_KEY = "sk-..."
```

### Minimal OpenAI-Compatible Example

```toml
[vars]
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
CHAT_WHITE_LIST = "123456789"
UPSTASH_REDIS_REST_URL = "https://your-redis.upstash.io"
UPSTASH_REDIS_REST_TOKEN = "your-upstash-rest-token"

AI_CHAT_PROVIDER = "oailike"
AI_IMAGE_PROVIDER = "oailike"
AI_ASR_PROVIDER = "oailike"
AI_TTS_PROVIDER = "oailike"

OAILIKE_API_KEY = "your-key"
OAILIKE_API_BASE = "https://your-api.example.com/v1"
```

Choose a startup mode in `config.json`:

```json
{
  "mode": "webhook",
  "server": {
    "hostname": "0.0.0.0",
    "port": 8787,
    "baseURL": "https://your-domain.example.com"
  }
}
```

Start locally:

```bash
npm install
npm run start:local
```

If you use `webhook` mode:

1. Expose the server publicly
2. Open `http://localhost:8787/init` or your deployed `/init`
3. Let the bot bind Telegram webhooks and command menus automatically

If you use `polling` mode:

- no `/init` step is needed
- the process reads updates directly from Telegram

## Command Reference

| Command | Purpose | Notes |
| --- | --- | --- |
| `/help` | Show command help | Good first check after deployment |
| `/start` | Show your chat ID and start a new chat | Useful for whitelist setup |
| `/new` | Clear the current chat history | Resets the active conversation |
| `/redo [text]` | Re-run the previous user turn | Optional replacement text |
| `/img <prompt>` | Generate an image | Reply to an image to edit it through OpenAI image editing |
| `/tts [-v voice] <text>` | Generate speech from text | Uses the active TTS provider |
| `/pplx [mode] <query>` | Ask Perplexity directly | Optional, local/Docker only, requires `PPLX_COOKIE` |
| `/set ...` | Apply shortcut-based stored or temporary config changes | Supports inline message continuation |
| `/setenv KEY=VALUE` | Store one user-config key | Works on the stored user-config surface |
| `/setenvs {...}` | Store multiple user-config keys | JSON input |
| `/delenv KEY` | Delete one stored user-config key | Removes the override |
| `/clearenv` | Clear all stored user-config overrides | Current chat scope only |
| `/settings` | Open the inline settings UI | Best way to browse supported runtime-adjustable settings |
| `/map` | Manage `/set` shortcut aliases | Edits `MAPPING_KEY` and `MAPPING_VALUE` |
| `/system` | Show runtime, provider, and usage info | Good for debugging active models |
| `/version` | Show build timestamp and git SHA | Useful in bug reports |
| `/history [n]` | Export stored history as JSON | Whitelist-only |
| `/block` | Add or remove a blocked user ID | Whitelist-only |
| `/blocklist` | Show or clear the blocklist | Whitelist-only |

## Tooling

Two tool layers remain:

1. Generic MCP
   - Define servers with `MCP_*`
   - Enable them per chat with `USE_MCP`
   - Works in local and Docker deployments

2. OpenAI Responses built-in tools
   - Enabled through `USE_OPENAI_BUILDIN` or `OPENAI_ENABLE_*`
   - Only available when the effective OpenAI path uses the Responses API
   - Includes web search, code interpreter, file search, image generation, and provider-side MCP

`TOOL_MODEL` can keep tool-calling steps on a separate model. It accepts either:

- a plain model ID, such as `gpt-4.1-mini`
- an explicit provider-prefixed target, such as `oailike:deepseek-chat`

## Endpoint Routing

`OPENAI_API_BASE` and `OAILIKE_API_BASE` can point to:

- a root `/v1` base
- `/v1/responses`
- `/v1/chat/completions`

Defaults when you keep the root `/v1` base:

- `openai` -> `v1/responses`
- `oailike` -> `v1/chat/completions`

Non-chat endpoints such as `/models`, `/images`, `/audio`, embeddings, and rerank still resolve against the stripped root API base automatically.

## Persistence And State

Upstash Redis stores:

- chat history
- stored per-chat user configuration
- blocklists
- scheduled deletion state
- inline/media helper state
- telegraph access tokens and message deduplication locks

Redis is required in both local and Docker mode.

## Project Structure

```text
src/
├── agent/        # OpenAI and OpenAI-compatible integrations
├── config/       # Environment config, stored user config, and context building
├── mcp/          # Generic MCP client integration
├── route/        # HTTP entrypoints such as / and /init
├── schedule/     # Scheduled cleanup tasks
├── telegram/     # Telegram command, handler, query, and send logic
└── utils/        # Shared helpers
```

## Documentation

- [Configuration Reference](./doc/en/CONFIG.md)
- [Local Development And Docker](./doc/en/LOCAL.md)
- [Changelog](./doc/en/CHANGELOG.md)

## Notes

- `LANGUAGE` is fixed to English.
- The repository no longer contains Cloudflare, Vercel, or multi-provider deployment paths.
- The local runtime requires Upstash Redis. File-backed, SQLite, and in-memory storage paths were removed.
- Unsupported legacy provider selections are normalized back to supported ones at runtime.

## License

MIT
