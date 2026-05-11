import type { LogLevelType } from '../config/types';
import { ENV } from '../config/env';
import { formatLocalDateTime } from '../utils/others/time';
import { redactSensitiveText, sanitizeForDebugLog, writeDebugLog } from './trace_file';

const LOG_LEVEL_PRIORITY: Record<LogLevelType, number> = {
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
};

function LogLevel(level: LogLevelType, ...args: any[]) {
    const timestamp = formatLocalDateTime();
    const logParts = args.map((e) => {
        if (typeof e === 'object') {
            return JSON.stringify(sanitizeForDebugLog(e), null, 2);
        }
        if (typeof e === 'string') {
            return redactSensitiveText(e);
        }
        return String(e);
    });
    const logStr = logParts.join('\n');

    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${logStr}`;

    switch (level) {
        case 'error':
            console.error(formattedMessage);
            break;
        case 'warn':
            console.warn(formattedMessage);
            break;
        case 'info':
            console.info(formattedMessage);
            break;
        case 'debug':
            console.debug(formattedMessage);
            break;
        default:
            console.log(formattedMessage);
    }

    writeDebugLog({
        source: 'logger',
        event: 'runtime-log',
        level,
        data: {
            message: logStr,
            args,
        },
    });
}

type Logger = Record<LogLevelType, (...args: any[]) => void>;

export const log: Logger = new Proxy({}, {
    get(_target, prop: string) {
        const level = prop as LogLevelType;
        const currentLogLevel: LogLevelType = ENV.LOG_LEVEL || 'info';
        if (LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel]) {
            return (...args: any[]) => LogLevel(level, ...args);
        }
        return () => { };
    },
}) as Logger;
