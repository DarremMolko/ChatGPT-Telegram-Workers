# Cloudflare Workers Deployment

This project still deploys cleanly to Cloudflare Workers, but the supported AI provider configuration is now limited to:

- `openai`
- `oailike`

## 1. Prepare Secrets

Required:

- Telegram bot token in `TELEGRAM_AVAILABLE_TOKENS`
- one of:
  - `OPENAI_API_KEY`
  - `OAILIKE_API_KEY` plus `OAILIKE_API_BASE`

## 2. Install Dependencies

```bash
npm install
```

## 3. Configure `wrangler.toml`

Minimal example:

```toml
name = "chatgpt-telegram-workers"
main = "src/index.ts"
compatibility_date = "2026-05-10"

[vars]
LANGUAGE = "en"
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
OPENAI_API_KEY = "sk-..."
```

OpenAI-compatible example:

```toml
[vars]
LANGUAGE = "en"
TELEGRAM_AVAILABLE_TOKENS = "123456:telegram-bot-token"
AI_CHAT_PROVIDER = "oailike"
AI_IMAGE_PROVIDER = "oailike"
AI_ASR_PROVIDER = "oailike"
AI_TTS_PROVIDER = "oailike"
OAILIKE_API_KEY = "your-key"
OAILIKE_API_BASE = "https://your-api.example.com/v1"
```

## 4. Create KV If You Use Worker Storage

Create and bind the KV namespace used by the app if your deployment target expects it.

## 5. Build And Deploy

```bash
npm run build
npm run deploy:dist
```

## 6. Initialize Telegram Webhook

Open:

```text
https://your-worker-name.your-subdomain.workers.dev/init
```

## Notes

- `LANGUAGE` is effectively English-only in this build.
- Removed provider envs such as `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `AZURE_*`, and `VERTEX_*` are no longer used.
- `OPENAI_API_BASE` and `OAILIKE_API_BASE` may point at `/v1`, `/v1/responses`, or `/v1/chat/completions`.
- `CHAT_WHITE_LIST` users can fully manage runtime bot settings, including API base URLs, through commands or `/settings`.
