# Local Development And Docker

This repository only ships local and Docker deployment paths.

Supported runtime choices:

- local webhook server
- local long-polling process
- Docker / Docker Compose

## Files And Precedence

The local adapter reads two files:

- `config.json`
- `config.toml`

Example starter files:

- `config.example.json` for webhook mode
- `config.example.polling.json` for polling mode
- `config.example.toml` for runtime env vars

At startup:

1. `config.toml` is parsed
2. keys under `[vars]` are loaded
3. process environment variables override the TOML values

This means Docker `environment:` values or shell exports win over file values.

## `config.json`

`config.json` controls the local adapter itself, not the bot’s provider settings.

### Webhook Mode Example

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

### Polling Mode Example

```json
{
  "mode": "polling"
}
```

Ready-to-copy file:

```bash
cp config.example.polling.json config.json
```

### Optional Proxy Example

```json
{
  "mode": "polling",
  "proxy": "http://127.0.0.1:7890"
}
```

### `config.json` Fields

| Field | Required | Description |
| --- | --- | --- |
| `mode` | yes | `webhook` or `polling` |
| `server.hostname` | webhook only | Host to bind the local HTTP server to |
| `server.port` | webhook only | Port to listen on |
| `server.baseURL` | webhook only | Public base URL used to construct Telegram webhook URLs |
| `proxy` | no | HTTP/HTTPS proxy for outbound requests |

## `config.toml`

`config.toml` contains the bot environment variables.

Minimal example:

```toml
[vars]
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
CHAT_WHITE_LIST = "123456789"
REDIS_URL = "rediss://default:your-password@your-redis-host:6379"
OPENAI_API_KEY = "sk-..."
OPENAI_CHAT_MODEL = "gpt-5.4-mini"
OPENAI_VISION_MODEL = "gpt-5.4-mini"
```

OpenAI-compatible example:

```toml
[vars]
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
CHAT_WHITE_LIST = "123456789"
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
- deployment-only settings stay in `config.toml` or process env
- runtime chat-level settings are persisted in Redis and can be changed later through commands
- `TELEGRAM_STREAM_MODE = "message"` is the safest default for local/Docker use across different Telegram clients

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

1. open `/init` on the running server
2. the bot will register Telegram webhooks for every token in `TELEGRAM_AVAILABLE_TOKENS`
3. the bot will also push Telegram command menus for the supported chat scopes

### Local HTTP Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Status page and setup hints |
| `GET` | `/init` | Bind Telegram webhooks and command menus |
| `POST` | `/telegram/:token/webhook` | Telegram webhook endpoint |
| `POST` | `/telegram/:token/safehook` | Guarded webhook path when an API guard is present |

Notes:

- the public webhook URL is built from `server.baseURL`
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
  -v "$(pwd)/config.json:/app/config.json:ro" \
  -v "$(pwd)/config.toml:/app/config.toml:ro" \
  chatgpt-telegram-workers:latest
```

Use Compose:

```bash
docker compose up --build
```

## Docker Compose Notes

The provided `docker-compose.yaml` mounts only:

- `config.json`
- `config.toml`

No plugin or custom tool directory mount is required in the simplified build.

## Operational Notes

- Redis is the only supported backing store
- webhook and polling modes both use the same Redis-backed history/config state
- `OPENAI_API_BASE` and `OAILIKE_API_BASE` may point at `/v1`, `/v1/responses`, or `/v1/chat/completions`
- `CHAT_WHITE_LIST` admins can fully manage the stored per-chat user config surface through commands and `/settings`
- generic MCP is the only remaining repo-level custom tool integration

For the full runtime setting reference, see [CONFIG.md](./CONFIG.md).
