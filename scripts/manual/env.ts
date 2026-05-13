import { readFileSync } from 'node:fs';
import { parse } from 'toml';
import { ENV } from '../../src/config/env';

// Manual smoke script for inspecting merged env config outside Vitest.
{
    const toml = readFileSync('./config.example.toml', 'utf8');
    const config = parse(toml);
    ENV.merge({
        ...config.vars,
        REDIS: {},
    });
    console.log(JSON.stringify(ENV, null, 2));
}
