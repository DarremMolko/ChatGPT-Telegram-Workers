import type * as Telegram from 'telegram-bot-api-types';
import type { ImageResult } from '../../agent/types';
import type { WorkerContext } from '../../config/context';
import type { UnionData } from '../utils/tg_utils';
import type { CommandHandler } from './types';
import { ENV } from '../../config/env';
import { log } from '../../log/logger';
import { describeCommandAccess, hasCommandAccess, resolveCommandAccess } from '../access';
import { MessageSender } from '../utils/send';
import { sendCommandError } from './error';
import {
    BlocklistCommandHandler,
    BlockUserCommandHandler,
    CancelCommandHandler,
    ClearEnvCommandHandler,
    DelEnvCommandHandler,
    DemoteCommandHandler,
    EchoCommandHandler,
    HelpCommandHandler,
    HistoryCommandHandler,
    ImgCommandHandler,
    InlineCommandHandler,
    MapCommandHandler,
    NewCommandHandler,
    PromoteCommandHandler,
    RedoCommandHandler,
    SetCommandHandler,
    SetEnvCommandHandler,
    SetEnvsCommandHandler,
    StartCommandHandler,
    StopCommandHandler,
    STTCommandHandler,
    SystemCommandHandler,
    TTSCommandHandler,
    UnblockUserCommandHandler,
    VersionCommandHandler,
} from './system';

const SYSTEM_COMMANDS: CommandHandler[] = [
    new StartCommandHandler(),
    new NewCommandHandler(),
    new RedoCommandHandler(),
    new StopCommandHandler(),
    new CancelCommandHandler(),
    new ImgCommandHandler(),
    new SetEnvCommandHandler(),
    new SetEnvsCommandHandler(),
    new DelEnvCommandHandler(),
    new ClearEnvCommandHandler(),
    new VersionCommandHandler(),
    new SystemCommandHandler(),
    new HelpCommandHandler(),
    new SetCommandHandler(),
    new InlineCommandHandler(),
    new HistoryCommandHandler(),
    new MapCommandHandler(),
    new STTCommandHandler(),
    new TTSCommandHandler(),
    new PromoteCommandHandler(),
    new DemoteCommandHandler(),
    new BlockUserCommandHandler(),
    new UnblockUserCommandHandler(),
    new BlocklistCommandHandler(),
];

async function handleSystemCommand(message: Telegram.Message, raw: string, command: CommandHandler, context: WorkerContext): Promise<Response | UnionData | ImageResult | null> {
    const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
    try {
        if (!command.relaxAuth) {
            await authChecker(command, message, context);
        }
        const subcommand = raw.substring(command.command.length).trim();
        return await command.handle(message, subcommand, context, sender);
    } catch (e) {
        return sendCommandError(sender, e, { redactions: [context.SHARE_CONTEXT.botToken] });
    }
}

function resolveCommandText(rawText: string): string {
    const normalized = rawText.trim();
    if (ENV.CUSTOM_COMMAND[normalized]) {
        return ENV.CUSTOM_COMMAND[normalized].value;
    }
    return normalized;
}

export function resolveMatchedCommand(rawText: string): CommandHandler | null {
    const text = resolveCommandText(rawText);
    for (const cmd of SYSTEM_COMMANDS) {
        if (text === cmd.command || text.startsWith(`${cmd.command} `) || text.startsWith(`${cmd.command}\n`)) {
            return cmd;
        }
    }
    return null;
}

export async function handleCommandMessage(message: Telegram.Message, context: WorkerContext): Promise<Response | UnionData | ImageResult | null> {
    let text = (message.text || message.caption || '').trim();

    text = resolveCommandText(text);

    if (ENV.DEV_MODE) {
        if (!SYSTEM_COMMANDS.some(cmd => cmd.command === '/echo')) {
            SYSTEM_COMMANDS.push(new EchoCommandHandler());
        }
    }
    const command = resolveMatchedCommand(text);
    if (command) {
        log.info(`[SYSTEM COMMAND] handle system command: ${command.command}`);
        return handleSystemCommand(message, text, command, context);
    }
    return null;
}

export function commandsBindScope(): Record<string, Telegram.SetMyCommandsParams> {
    const scopeCommandMap: Record<string, Telegram.BotCommand[]> = {
        all_private_chats: [],
        all_group_chats: [],
        all_chat_administrators: [],
    };
    for (const cmd of SYSTEM_COMMANDS) {
        if (cmd.scopes) {
            for (const scope of cmd.scopes) {
                if (!scopeCommandMap[scope]) {
                    scopeCommandMap[scope] = [];
                }
                scopeCommandMap[scope].push({
                    command: cmd.command,
                    description: ENV.I18N.command.help[cmd.command.substring(1)] || '',
                });
            }
        }
    }
    for (const [cmd, config] of Object.entries(ENV.CUSTOM_COMMAND)) {
        if (config.scope) {
            for (const scope of config.scope) {
                if (!scopeCommandMap[scope]) {
                    scopeCommandMap[scope] = [];
                }
                scopeCommandMap[scope].push({
                    command: cmd,
                    description: config.description || '',
                });
            }
        }
    }
    const result: Record<string, Telegram.SetMyCommandsParams> = {};
    for (const scope in scopeCommandMap) {
        result[scope] = {
            commands: scopeCommandMap[scope].filter(cmd => cmd.description !== ''),
            scope: {
                type: scope,
            },
        };
    }
    return result;
}

export function commandsDocument(): { description: string; command: string }[] {
    return SYSTEM_COMMANDS.map((command) => {
        return {
            command: command.command,
            description: ENV.I18N.command.help[command.command.substring(1)] || '',
        };
    }).filter(item => item.description !== '');
}

export async function authChecker(command: CommandHandler, message: Telegram.Message, _context: WorkerContext) {
    const userId = message.from?.id ?? message.chat?.id;
    const accessLevel = resolveCommandAccess(command.needAuth?.(message.chat?.type ?? 'private'));
    if (await hasCommandAccess(userId, accessLevel, _context.SHARE_CONTEXT.botId)) {
        return;
    }
    throw new Error(`Permission denied, need ${describeCommandAccess(accessLevel)}`);
}
