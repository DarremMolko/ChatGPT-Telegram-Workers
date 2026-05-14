# ChatGPT Telegram Workers

[![Build and Push Docker Image](https://github.com/DarremMolko/ChatGPT-Telegram-Workers/actions/workflows/build-docker.yml/badge.svg)](https://github.com/DarremMolko/ChatGPT-Telegram-Workers/actions/workflows/build-docker.yml)

Telegram bot for local and Docker deployment with OpenAI and OpenAI-compatible APIs.

This repository now intentionally focuses on a narrow runtime surface:

- English only
- `openai` and `oailike` providers only
- local process and Docker deployment only
- Redis only
- generic MCP plus OpenAI Responses built-in tools only

## Capability Overview

| Area | What remains |
| --- | --- |
| Chat | `openai` and `oailike`, with configurable `v1/responses` or `v1/chat/completions` routing and Telegram text/image/audio/PDF inputs |
| Streaming | Telegram replies stream through the normal message edit/send path |
| Images | `/img` generation for both provider families; reply-to-image editing through the OpenAI-compatible image path |
| Speech | Telegram voice/audio input via STT, explicit `/stt` transcription, text-to-speech output via `/tts`, and configurable text/audio workflows |
| Tools | Generic MCP groups and OpenAI Responses built-in tools |
| Persistence | Redis-backed chat history, stored user config, scheduled deletions, and transient Telegram state |
| Runtime control | Inline `/settings`, `/set`, `/setenv`, `/setenvs`, `/map`, `/stop`, per-chat blocklists, and history export |
| Deployment | Local webhook mode, local polling mode, Docker, and Docker Compose |

Telegram still does not natively render GitHub-style pipe tables. The current bot rewrites detected pipe tables into boxed monospace tables as a compatibility layer. Treat that behavior as a stopgap rather than a permanent rendering model, and revisit it if Telegram adds first-class table support. You can disable the rewrite with `TELEGRAM_RENDER_PIPE_TABLES=false`.

## How Configuration Works

There are two configuration layers:

1. Deployment and environment settings
   - Loaded from process environment variables
   - Optionally loaded from `config.toml` under `[vars]`
   - Real process environment variables override TOML values when both are present
   - Covers Telegram tokens, Redis credentials, group policy, streaming/rendering defaults, and other runtime-wide behavior

2. Stored per-chat user configuration
   - Persisted in Redis
   - Modified through `/set`, `/setenv`, `/setenvs`, `/delenv`, `/clearenv`, and `/settings`
   - Covers provider choice, model choice, MCP selection, tool model, temperatures, output modes, and similar chat-level behavior

`OWNER_ID` has full control over sensitive commands and runtime settings. `ADMIN_WHITE_LIST` is the static bootstrap admin list, and the owner can add or remove extra runtime admins with `/promote` and `/demote`. Admins can use commands and manage non-sensitive per-chat runtime settings. Users outside both lists can only chat with the bot in allowlisted groups and cannot use commands or private chats.

## Quick Start

Environment variables are now the primary configuration path. `config.toml` is an optional convenience file for defining the same keys under `[vars]`.

### Minimal Environment-Only Webhook Example

```bash
export LOCAL_MODE=webhook
export PORT=8787
export LOCAL_INIT_SECRET=replace-with-a-random-secret
export TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
export OWNER_ID=123456789
export REDIS_URL=rediss://default:your-password@your-redis-host:6379
export OPENAI_API_KEY=sk-...
export OPENAI_CHAT_MODEL=gpt-5.4-mini
export OPENAI_VISION_MODEL=gpt-5.4-mini
```

### Minimal Environment-Only Polling Example

```bash
export LOCAL_MODE=polling
export TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
export OWNER_ID=123456789
export REDIS_URL=rediss://default:your-password@your-redis-host:6379
export OPENAI_API_KEY=sk-...
```

### Optional `config.toml` Setup

```bash
cp config.example.toml config.toml
```

Set `LOCAL_MODE` and any other values you need under `[vars]`.

### Minimal OpenAI Example

```toml
[vars]
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
OWNER_ID = "123456789"
REDIS_URL = "rediss://default:your-password@your-redis-host:6379"
# Optional Telegram update filtering and webhook verification.
# TELEGRAM_ALLOWED_UPDATES = ["message", "inline_query", "callback_query", "chosen_inline_result"]
# TELEGRAM_WEBHOOK_SECRET_TOKEN = "replace-with-a-random-secret"
# TELEGRAM_DROP_PENDING_UPDATES = false
# LOCAL_INIT_SECRET = "replace-with-a-random-secret"
OPENAI_API_KEY = "sk-..."
OPENAI_CHAT_MODEL = "gpt-5.4-mini"
OPENAI_VISION_MODEL = "gpt-5.4-mini"
```

### Minimal OpenAI-Compatible Example

```toml
[vars]
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
OWNER_ID = "123456789"
REDIS_URL = "rediss://default:your-password@your-redis-host:6379"
# Optional Telegram update filtering and webhook verification.
# TELEGRAM_ALLOWED_UPDATES = ["message", "inline_query", "callback_query", "chosen_inline_result"]
# TELEGRAM_WEBHOOK_SECRET_TOKEN = "replace-with-a-random-secret"
# TELEGRAM_DROP_PENDING_UPDATES = false
# LOCAL_INIT_SECRET = "replace-with-a-random-secret"

AI_CHAT_PROVIDER = "oailike"
AI_IMAGE_PROVIDER = "oailike"
AI_ASR_PROVIDER = "oailike"
AI_TTS_PROVIDER = "oailike"

OAILIKE_API_KEY = "your-key"
OAILIKE_API_BASE = "https://your-api.example.com/v1"
OAILIKE_CHAT_MODEL = "gpt-5.4-mini"
OAILIKE_VISION_MODEL = "gpt-5.4-mini"
```

You can also put the local adapter mode in `config.toml`:

```toml
[vars]
LOCAL_MODE = "webhook"
LOCAL_PORT = 8787
LOCAL_BASE_URL = "https://your-domain.example.com"
LOCAL_INIT_SECRET = "replace-with-a-random-secret"
```

Polling example:

```toml
[vars]
LOCAL_MODE = "polling"
```

Start locally:

```bash
npm install
npm run start:local
```

If you use `webhook` mode:

1. Expose the server publicly
2. Set `LOCAL_INIT_SECRET`, then open `http://localhost:8787/init?secret=...` or your deployed `/init?secret=...`
3. Let the bot bind Telegram webhooks and command menus automatically

For PaaS deployments such as Render and Koyeb, `LOCAL_MODE=webhook` plus normal platform env vars is usually enough. The app can derive the public host from forwarded request headers, so `LOCAL_BASE_URL` is optional unless you need to force an override.

To avoid overlapping replies in the same chat, the runtime now defaults to `CHAT_CONCURRENCY_POLICY=queue`. Other supported values are `cancel_previous`, `drop_if_busy`, and `parallel`.

`queue` waits for the active reply to finish and notifies the user that their message was queued. `cancel_previous` cancels or supersedes older in-flight work so the newest message wins. `drop_if_busy` refuses new work while a reply is active and asks the user to wait or send `/stop`. `parallel` keeps the older overlapping behavior and does not try to serialize same-chat requests.

If you use `polling` mode:

- no `/init` step is needed
- the process reads updates directly from Telegram

## Scheduled Cleanup Examples

Scheduled deletion only runs in the local adapter when all of these are true:

- `EXPIRED_TIME` is greater than `0`
- `CRON_CHECK_TIME` is set to a valid cron expression
- the sent message type is enabled in `SCHEDULE_GROUP_DELETE_TYPE` or `SCHEDULE_PRIVATE_DELETE_TYPE`

Allowed scheduled message types are:

- `tip` for status and helper messages such as wait notices
- `chat` for normal bot replies

Example: delete only helper messages after 1 hour.

```toml
[vars]
EXPIRED_TIME = 60
CRON_CHECK_TIME = "*/5 * * * *"
SCHEDULE_GROUP_DELETE_TYPE = ["tip"]
SCHEDULE_PRIVATE_DELETE_TYPE = ["tip"]
```

Example: delete all bot output after 24 hours.

```toml
[vars]
EXPIRED_TIME = 1440
CRON_CHECK_TIME = "0 * * * *"
SCHEDULE_GROUP_DELETE_TYPE = ["tip", "chat"]
SCHEDULE_PRIVATE_DELETE_TYPE = ["tip", "chat"]
```

Example: keep group replies, but clean private chats after 30 minutes.

```toml
[vars]
EXPIRED_TIME = 30
CRON_CHECK_TIME = "*/10 * * * *"
SCHEDULE_GROUP_DELETE_TYPE = []
SCHEDULE_PRIVATE_DELETE_TYPE = ["tip", "chat"]
```

The cron expression follows the local process timezone. In Docker, that means the container timezone unless you set `TZ` yourself.

## Command Reference

| Command | Purpose | Notes |
| --- | --- | --- |
| `/help` | Show command help | Good first check after deployment |
| `/start` | Show your chat ID and start a new chat | Useful for owner/admin setup |
| `/new` | Clear the current chat history | Resets the active conversation |
| `/redo [text]` | Re-run the previous user turn | Optional replacement text |
| `/stop` | Stop the active response in the current chat scope | Cancels the current streamed reply |
| `/img [-n count] [-s size] [-m model] <prompt>` | Generate an image | Also supports `-q`, `-f`, `-c`, `-bg`, `-mod`, and `-if`; reply to an image to edit it through the active OpenAI-compatible image provider |
| `/vision <image_url> -p "question"` | Send image URLs to the vision model | You can include multiple `http(s)` image URLs, but the prompt must be supplied with `-p` |
| `/stt` | Transcribe an audio or voice message | Use it as the audio caption or reply to an audio message |
| `/tts [-v voice] [-i instructions] <text>` | Generate speech from text | Also works when you reply to a text message; `-i` sends TTS instructions on compatible models |
| `/set ...` | Apply stored runtime config changes | Supports inline message continuation when followed by normal chat text |
| `/setenv KEY=VALUE` | Store one user-config key | Works on the stored user-config surface |
| `/setenvs {...}` | Store multiple user-config keys | JSON input |
| `/delenv KEY` | Delete one stored user-config key | Removes the override |
| `/clearenv` | Clear all stored user-config overrides | Current chat scope only |
| `/settings` | Open the inline settings UI | Best way to browse supported runtime-adjustable settings |
| `/map` | Manage `/set` shortcut aliases | Edits `MAPPING_KEY` and `MAPPING_VALUE` |
| `/system` | Show runtime, provider, and usage info | Good for debugging active models |
| `/version` | Show build timestamp and git SHA | Useful in bug reports |
| `/history [n]` | Export stored history as JSON | Owner-only |
| `/promote [user_id]` | Grant runtime admin access | Owner-only; also works by replying to a user's message |
| `/demote [user_id]` | Remove runtime admin access | Owner-only; cannot remove IDs pinned in `ADMIN_WHITE_LIST` |
| `/block [user_id]` | Add a blocked user ID | Owner-only; also works by replying to a user's message |
| `/unblock [user_id]` | Remove a blocked user ID | Owner-only; also works by replying to a user's message |
| `/blocklist` | Show the blocklist | Owner-only |

## Tooling

Two tool layers remain:

1. Generic MCP
   - Define servers with `MCP_*`
   - Enable them per chat with `USE_MCP`
   - Works in local and Docker deployments

2. OpenAI Responses built-in tools
   - Enabled through `USE_OPENAI_BUILDIN` or `OPENAI_ENABLE_*`
   - Available for `openai` and `oailike` when the effective path uses the Responses API
   - Includes web search, code interpreter, file search, image generation, hosted shell, and provider-side MCP

`TOOL_MODEL` can keep tool-calling steps on a separate model. It accepts either:

- a plain model ID, such as `gpt-5.4-mini`
- an explicit provider-prefixed target, such as `oailike:deepseek-chat`

## Endpoint Routing

`OPENAI_API_BASE` and `OAILIKE_API_BASE` can point to:

- a root `/v1` base
- `/v1/responses`
- `/v1/chat/completions`

Defaults when you keep the root `/v1` base:

- `openai` -> `v1/responses`
- `oailike` -> `v1/chat/completions`

Set `OAILIKE_API_BASE` to `/v1/responses` when you want the `oailike` provider to use OpenAI Responses features such as built-in tools.

Non-chat endpoints such as `/models`, `/images`, and `/audio` still resolve against the stripped root API base automatically.

## Persistence And State

Redis stores:

- chat history
- runtime admin list
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

- English is the only supported interface language.
- The repository no longer contains Cloudflare, Vercel, or multi-provider deployment paths.
- The local runtime requires Redis through `REDIS_URL`. File-backed, SQLite, and in-memory storage paths were removed.
- Unsupported legacy provider selections are normalized back to supported ones at runtime.

## License

MIT
