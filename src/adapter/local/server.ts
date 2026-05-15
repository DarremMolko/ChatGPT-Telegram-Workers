import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Router } from '../../utils/router';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';

function readForwardedHeader(value: string | string[] | undefined): string | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(',')[0]?.trim() || undefined;
}

function resolveBaseURL(req: IncomingMessage): string {
    const protocol = readForwardedHeader(req.headers['x-forwarded-proto']) || 'http';
    const host = readForwardedHeader(req.headers['x-forwarded-host'])
        || readForwardedHeader(req.headers.host)
        || '127.0.0.1';
    return `${protocol}://${host}`;
}

function buildRequest(req: IncomingMessage): Request {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                headers.append(key, item);
            }
        } else if (value !== undefined) {
            headers.set(key, String(value));
        }
    }
    const init: RequestInit = {
        method: req.method,
        headers,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        init.body = Readable.toWeb(req) as unknown as BodyInit;
        (init as RequestInit & { duplex: 'half' }).duplex = 'half';
    }
    return new Request(new URL(req.url || '/', resolveBaseURL(req)), init);
}

async function writeResponse(
    response: Response,
    res: ServerResponse<IncomingMessage>,
): Promise<void> {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
        res.setHeader(key, value);
    });
    if (!response.body) {
        res.end();
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const stream = Readable.fromWeb(response.body as unknown as NodeReadableStream<any>);
        stream.once('error', reject);
        res.once('finish', resolve);
        stream.pipe(res);
    });
}

export function startLocalServer(
    port: number,
    hostname: string,
    router: Router,
) {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
        try {
            const request = buildRequest(req);
            const response = await router.fetch(request as any);
            await writeResponse(response, res);
        } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.end(JSON.stringify({
                message: (error as Error).message,
                stack: (error as Error).stack,
            }));
        }
    });

    server.listen(port, hostname, () => {
        console.log(`Server listening on ${hostname}:${port}`);
    });

    return server;
}
