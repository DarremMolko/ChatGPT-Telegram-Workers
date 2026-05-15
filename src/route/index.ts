import { ENV } from '../config/env';
import { commandsDocument } from '../telegram/command';
import { Router } from '../utils/router';
import { renderHTML } from './utils';

function healthAction(): Response {
    return new Response(JSON.stringify({
        ok: true,
        build: {
            sha: ENV.BUILD_VERSION,
            timestamp: ENV.BUILD_TIMESTAMP,
        },
    }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

function defaultIndexAction(): Response {
    const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <br/>
    <p>Polling mode is active.</p>
    <p>Version (ts:${ENV.BUILD_TIMESTAMP}, sha:${ENV.BUILD_VERSION})</p>
    <br/>
    <p><strong>/health</strong> - Optional health check endpoint</p>
    <p>Bot commands:</p>
    ${
        commandsDocument().map(item => `<p><strong>${item.command}</strong> - ${item.description}</p>`).join('')
    }
  `);
    return new Response(HTML, {
        status: 200,
        headers: {
            'Content-Type': 'text/html',
        },
    });
}

export function createRouter(): Router {
    const router = new Router();
    router.get('/', defaultIndexAction);
    router.get('/health', healthAction);
    router.all('*', () => new Response('Not Found', { status: 404 }));
    return router;
}
