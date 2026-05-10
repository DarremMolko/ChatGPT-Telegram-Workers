# Local Development And Docker

This simplified build supports:

- `openai`
- `oailike`

## Local Development

Install dependencies:

```bash
npm install
```

Run the local adapter:

```bash
npm run start:local
```

Minimal local config:

```env
LANGUAGE=en
TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
OPENAI_API_KEY=sk-...
```

OpenAI-compatible local config:

```env
LANGUAGE=en
TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token
AI_CHAT_PROVIDER=oailike
AI_IMAGE_PROVIDER=oailike
AI_ASR_PROVIDER=oailike
AI_TTS_PROVIDER=oailike
OAILIKE_API_KEY=your-key
OAILIKE_API_BASE=https://your-api.example.com/v1
```

## Build

```bash
npm run lint
npm run build
```

## Docker

Build the image:

```bash
npm run build:docker
```

Or build locally:

```bash
docker build -t chatgpt-telegram-workers:latest dist
```

Run the container:

```bash
docker run -d \
  --name chatgpt-telegram-workers \
  -p 8787:8787 \
  -e TELEGRAM_AVAILABLE_TOKENS=123456:telegram-bot-token \
  -e OPENAI_API_KEY=sk-... \
  chatgpt-telegram-workers:latest
```

## Notes

- `LANGUAGE` is English-only.
- Unsupported provider envs from older versions are ignored by the runtime config normalizer and should be removed from your deployment config.
- Locked user config keys are now:

```env
LOCK_USER_CONFIG_KEYS=OPENAI_API_BASE,OAILIKE_API_BASE
```

