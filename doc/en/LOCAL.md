# Local Development And Docker

This simplified build only supports:

- local process deployment
- Docker deployment
- `openai`
- `oailike`

## Config Files

Copy the included examples:

```bash
cp config.example.json config.json
cp config.example.toml config.toml
```

`config.json` controls the local runtime:

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

`config.toml` contains the bot environment variables:

```toml
[vars]
LANGUAGE = "en"
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
CHAT_WHITE_LIST = "123456789"
UPSTASH_REDIS_REST_URL = "https://your-redis.upstash.io"
UPSTASH_REDIS_REST_TOKEN = "your-upstash-rest-token"
OPENAI_API_KEY = "sk-..."
# USE_MCP = ["demo"]
# MCP_demo = "{\"type\":\"http\",\"url\":\"http://127.0.0.1:3001/mcp\"}"
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the local adapter:

```bash
npm run start:local
```

The server reads:

- `./config.json`
- `./config.toml`

## Build

Build the local runtime bundle and Docker context:

```bash
npm run build
```

This generates:

- `dist/index.js`
- `dist/Dockerfile`
- `dist/package.json`

## Docker

Build the image from the generated runtime bundle:

```bash
npm run build:docker
```

Or use the root Dockerfile directly:

```bash
docker build -t chatgpt-telegram-workers:latest .
```

Run the container:

```bash
docker run -d \
  --name chatgpt-telegram-workers \
  -p 8787:8787 \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/config.toml:/app/config.toml:ro \
  chatgpt-telegram-workers:latest
```

Or use Compose:

```bash
docker compose up --build
```

## Notes

- `LANGUAGE` is English-only.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are required. Redis is the only supported database backend in this simplified build.
- Generic MCP servers use `MCP_*` JSON-string env vars plus `USE_MCP`. This is the only repo-level custom tool integration now.
- `OPENAI_API_BASE` and `OAILIKE_API_BASE` may point at `/v1`, `/v1/responses`, or `/v1/chat/completions`.
- `CHAT_WHITE_LIST` users can fully manage runtime bot settings, including API base URLs, through commands or `/settings`.
- Unsupported provider envs from older versions are ignored by the runtime config normalizer and should be removed from your local config.
