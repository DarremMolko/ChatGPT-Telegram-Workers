# Manual Smoke Scripts

These scripts are for ad hoc debugging and integration checks. They are not part of the production build, test suite, or CI verification path.

Run them from the repository root after installing dependencies:

```bash
npm ci
```

## Available scripts

### `env.ts`

Loads `config.example.toml`, merges it into `ENV`, and prints the resulting config object.

```bash
npx tsx scripts/manual/env.ts
```

Use this when you want to inspect how config values are merged outside Vitest.

### `agent.ts`

Loads the chat agent with the current environment, forces `AI_CHAT_PROVIDER` to `openai`, sends a single prompt, and prints streamed output plus the final result.

```bash
npx tsx scripts/manual/agent.ts
```

This script imports `scripts/manual/env.ts`, so it also loads `config.example.toml` before creating the agent. You still need any runtime credentials required by your chosen provider in the shell environment.

### `mcp.ts`

Exercises the MCP integration against live services using the AMap MCP server over stdio.

```bash
BASE_URL=... API_KEY=... AMAP_MAPS_API_KEY=... npx tsx scripts/manual/mcp.ts
```

Required environment variables:

- `BASE_URL`: OpenAI-compatible API base URL
- `API_KEY`: API key for that model provider
- `AMAP_MAPS_API_KEY`: API key for the AMap MCP server

## Notes

- These scripts are intentionally kept under `scripts/manual/` so they do not affect `vite build` test discovery or production code paths.
- Keep them small and disposable. If a workflow needs automated coverage, move that behavior into proper tests instead of expanding these scripts.
