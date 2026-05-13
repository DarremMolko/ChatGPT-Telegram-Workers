# Local Development And Docker

This repository only ships local and Docker deployment paths.

Supported runtime choices:

- local webhook server
- local long-polling process
- Docker / Docker Compose

## Files And Precedence

The local adapter is controlled through environment-style keys.

You can provide those keys in either place:

- the real server environment
- `config.toml` under `[vars]`

Example starter file:

- `config.example.toml`

At startup:

1. if present, `config.toml` is parsed and keys under `[vars]` are loaded
2. process environment variables override TOML values
3. the local adapter mode is resolved from `LOCAL_*`, `PORT`, and `BASE_URL`

This means Docker `environment:` values or shell exports win over file values.

## Environment-Only Setup

Minimal webhook setup:

```bash
export LOCAL_MODE=webhook
export PORT=8787
export LOCAL_INIT_SECRET=replace-with-a-random-secret
export TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
export OWNER_ID=123456789
export REDIS_URL=rediss://default:your-password@your-redis-host:6379
export OPENAI_API_KEY=sk-...
```

Minimal polling setup:

```bash
export LOCAL_MODE=polling
export TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
export OWNER_ID=123456789
export REDIS_URL=rediss://default:your-password@your-redis-host:6379
export OPENAI_API_KEY=sk-...
```

### Local Adapter Environment Keys

| Variable | Required | Description |
| --- | --- | --- |
| `LOCAL_MODE` | no | `webhook` or `polling`. If unset, webhook is inferred when server settings such as `PORT` are present, otherwise polling is used. |
| `LOCAL_HOSTNAME` | no | Host to bind the local HTTP server to. Defaults to `0.0.0.0` in webhook mode. |
| `LOCAL_PORT` | no | Port to listen on. `PORT` is also accepted and is useful on PaaS platforms. |
| `LOCAL_BASE_URL` | no | Optional explicit base URL override for webhook URL generation. `BASE_URL` is also accepted. |
| `LOCAL_INIT_SECRET` | no | Secret for authorizing `GET /init`. When empty, `/init` is disabled. Accept it with `?secret=...` or the `X-Init-Secret` header. |
| `LOCAL_PROXY` | no | HTTP/HTTPS proxy for outbound requests. |
| `TOML_PATH` | no | Optional path to `config.toml`. |

For Render, Koyeb, and similar platforms, `PORT` plus `LOCAL_MODE=webhook` is usually enough. The app can derive the public host from forwarded request headers when you open `/init`.

## `config.toml`

`config.toml` is optional and contains the bot environment variables.

Minimal example:

```toml
[vars]
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
OWNER_ID = "123456789"
REDIS_URL = "rediss://default:your-password@your-redis-host:6379"
OPENAI_API_KEY = "sk-..."
OPENAI_CHAT_MODEL = "gpt-5.4-mini"
OPENAI_VISION_MODEL = "gpt-5.4-mini"
```

Webhook example:

```toml
[vars]
LOCAL_MODE = "webhook"
LOCAL_PORT = 8787
LOCAL_HOSTNAME = "0.0.0.0"
LOCAL_BASE_URL = "https://your-domain.example.com"
LOCAL_INIT_SECRET = "replace-with-a-random-secret"
```

Polling example:

```toml
[vars]
LOCAL_MODE = "polling"
```

OpenAI-compatible example:

```toml
[vars]
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
OWNER_ID = "123456789"
ADMIN_WHITE_LIST = "234567890,345678901"
REDIS_URL = "rediss://default:your-password@your-redis-host:6379"

AI_CHAT_PROVIDER = "oailike"
AI_IMAGE_PROVIDER = "oailike"
AI_ASR_PROVIDER = "oailike"
AI_TTS_PROVIDER = "oailike"

OAILIKE_API_KEY = "your-key"
OAILIKE_API_BASE = "https://your-api.example.com/v1"
OAILIKE_CHAT_MODEL = "gpt-5.4-mini"
OAILIKE_VISION_MODEL = "gpt-5.4-mini"
```

Generic MCP example:

```toml
[vars]
USE_MCP = ["demo"]
MCP_demo = "{\"type\":\"http\",\"url\":\"http://127.0.0.1:3001/mcp\"}"
```

Important:

- `REDIS_URL` is required
- `MCP_*` values must be JSON strings, not TOML inline tables
- deployment-only settings stay in process env or optional `config.toml`
- runtime chat-level settings are persisted in Redis and can be changed later through commands
- Telegram streaming uses the normal message edit/send path in local and Docker deployments

## Local Startup

Install dependencies:

```bash
npm install
```

Start the local adapter:

```bash
npm run start:local
```

## Webhook Mode

Use `webhook` mode when your process is reachable through a public URL.

After the server starts:

1. set `LOCAL_INIT_SECRET`
2. open `/init` on the running server
3. the bot will register Telegram webhooks for every token in `TELEGRAM_AVAILABLE_TOKENS`
4. the bot will also push Telegram command menus for the supported chat scopes

### Local HTTP Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Status page and setup hints |
| `GET` | `/init` | Bind Telegram webhooks and command menus |
| `POST` | `/telegram/:token/webhook` | Telegram webhook endpoint |
| `POST` | `/telegram/:token/safehook` | Guarded webhook path when an API guard is present |

Notes:

- the public webhook URL is built from the incoming request host by default
- `LOCAL_BASE_URL` or `BASE_URL` can still override that when needed
- `/init` is disabled until `LOCAL_INIT_SECRET` is configured
- `/init` must be re-run if you change domains or tokens
- the local landing page is documentation only; it does not expose a `/telegram/:token/bot` route

## Polling Mode

Use `polling` mode when you do not want to expose a public webhook endpoint.

Behavior:

- the process calls Telegram `getUpdates`
- existing webhooks are removed automatically on startup
- no `/init` step is required
- this is often the easiest mode for private development or single-instance self-hosting

## Scheduled Cleanup

The local adapter can run scheduled message cleanup when both of these are set:

- `EXPIRED_TIME > 0`
- `CRON_CHECK_TIME` contains a valid cron expression

Messages are only scheduled for deletion when their type is enabled in the matching list:

- `SCHEDULE_GROUP_DELETE_TYPE` for group and supergroup chats
- `SCHEDULE_PRIVATE_DELETE_TYPE` for private chats

Allowed values in those arrays:

- `tip` for helper/status messages such as "Please wait a moment..."
- `chat` for normal bot replies

Example:

```toml
[vars]
EXPIRED_TIME = 60
CRON_CHECK_TIME = "*/5 * * * *"
```

This means:

- tagged bot messages expire after 60 minutes
- the scheduler checks every 5 minutes for messages to delete

More examples:

Delete both helper messages and normal replies after 24 hours:

```toml
[vars]
EXPIRED_TIME = 1440
CRON_CHECK_TIME = "0 * * * *"
SCHEDULE_GROUP_DELETE_TYPE = ["tip", "chat"]
SCHEDULE_PRIVATE_DELETE_TYPE = ["tip", "chat"]
```

Keep group replies, but delete private chat output after 30 minutes:

```toml
[vars]
EXPIRED_TIME = 30
CRON_CHECK_TIME = "*/10 * * * *"
SCHEDULE_GROUP_DELETE_TYPE = []
SCHEDULE_PRIVATE_DELETE_TYPE = ["tip", "chat"]
```

Delete only helper messages everywhere, but keep normal replies:

```toml
[vars]
EXPIRED_TIME = 15
CRON_CHECK_TIME = "*/2 * * * *"
SCHEDULE_GROUP_DELETE_TYPE = ["tip"]
SCHEDULE_PRIVATE_DELETE_TYPE = ["tip"]
```

Timezone note:

- the cron expression is evaluated in the local process timezone
- in Docker, that means the container timezone unless you set `TZ`

## Build

Build the runtime bundle and Docker context:

```bash
npm run build
```

Generated artifacts:

- `dist/index.js`
- `dist/Dockerfile`
- `dist/package.json`

## Docker

Build the image directly from the repository root:

```bash
docker build -t chatgpt-telegram-workers:latest .
```

Or build from the generated runtime bundle:

```bash
npm run build:docker
```

Run the container:

```bash
docker run -d \
  --name chatgpt-telegram-workers \
  -p 8787:8787 \
  -e LOCAL_MODE=webhook \
  -e PORT=8787 \
  -e TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token \
  -e OWNER_ID=123456789 \
  -e REDIS_URL=rediss://default:your-password@your-redis-host:6379 \
  -e OPENAI_API_KEY=sk-... \
  chatgpt-telegram-workers:latest
```

Use Compose:

```bash
docker compose up --build
```

## Docker Compose Notes

The provided `docker-compose.yaml` uses normal environment variables by default. Optional `config.toml` support remains available through `TOML_PATH`, but no separate `config.json` is needed.

## Operational Notes

- Redis is the only supported backing store
- webhook and polling modes both use the same Redis-backed history/config state
- `OPENAI_API_BASE` and `OAILIKE_API_BASE` may point at `/v1`, `/v1/responses`, or `/v1/chat/completions`
- `OWNER_ID` has full control over sensitive commands and settings, while `ADMIN_WHITE_LIST` seeds static admins and `/promote` or `/demote` manage extra runtime admins
- generic MCP is the only remaining repo-level custom tool integration

For the full runtime setting reference, see [CONFIG.md](./CONFIG.md).
