import type * as Telegram from 'telegram-bot-api-types';
import type { ImageResult } from '../../agent/types';
import type { WorkerContext } from '../../config/context';
import type { UnionData } from '../utils/tg_utils';
import type { CommandHandler } from './types';
import { ENV } from '../../config/env';
import { log } from '../../log/logger';
import { MessageSender } from '../utils/send';
import { loadChatRoleWithContext } from './auth';
import {
    BlocklistCommandHandler,
    BlockUserCommandHandler,
    CancelCommandHandler,
    ClearEnvCommandHandler,
    DelEnvCommandHandler,
    EchoCommandHandler,
    HelpCommandHandler,
    HistoryCommandHandler,
    ImgCommandHandler,
    InlineCommandHandler,
    MapCommandHandler,
    NewCommandHandler,
    RedoCommandHandler,
    SetCommandHandler,
    SetEnvCommandHandler,
    SetEnvsCommandHandler,
    StartCommandHandler,
    StopCommandHandler,
    SystemCommandHandler,
    TTSCommandHandler,
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
    new TTSCommandHandler(),
    new BlockUserCommandHandler(),
    new BlocklistCommandHandler(),
];

// const commandHanders: any[] = [
//     StartCommandHandler,
//     NewCommandHandler,
//     RedoCommandHandler,
//     ImgCommandHandler,
//     SetEnvCommandHandler,
//     SetEnvsCommandHandler,
//     DelEnvCommandHandler,
//     ClearEnvCommandHandler,
//     VersionCommandHandler,
//     SystemCommandHandler,
//     HelpCommandHandler,
//     SetCommandHandler,
// ];

// function* SystemCommandGen(): Generator<CommandHandler, void, unknown> {
//     for (const Command of commandHanders) {
//         yield new Command();
//     }
// };

async function handleSystemCommand(message: Telegram.Message, raw: string, command: CommandHandler, context: WorkerContext): Promise<Response | UnionData | ImageResult | null> {
    const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
    try {
        // 如果存在权限条件
        if (command.needAuth && !command.relaxAuth) {
            await authChecker(command, message, context);
        }
        const subcommand = raw.substring(command.command.length).trim();
        return command.handle(message, subcommand, context, sender);
    } catch (e) {
        return sender.sendRichText(`<pre><code class="language-error">${(e as Error).message}</code></pre>`, 'HTML', 'tip');
    }
}

export async function handleCommandMessage(message: Telegram.Message, context: WorkerContext): Promise<Response | UnionData | ImageResult | null> {
    let text = (message.text || message.caption || '').trim();

    if (ENV.CUSTOM_COMMAND[text]) {
        // 替换自定义命令为系统命令
        text = ENV.CUSTOM_COMMAND[text].value;
    }

    if (ENV.DEV_MODE) {
        // 插入调试命令
        if (!SYSTEM_COMMANDS.some(cmd => cmd.command === '/echo')) {
            SYSTEM_COMMANDS.push(new EchoCommandHandler());
        }
    }

    // const SYSTEM_COMMANDS = SystemCommandGen();

    // 查找系统命令
    for (const cmd of SYSTEM_COMMANDS) {
        if (text === cmd.command || text.startsWith(`${cmd.command} `) || text.startsWith(`${cmd.command}\n`)) {
            log.info(`[SYSTEM COMMAND] handle system command: ${cmd.command}`);
            return handleSystemCommand(message, text, cmd, context);
        }
    }
    return null;
}

export function commandsBindScope(): Record<string, Telegram.SetMyCommandsParams> {
    // const SYSTEM_COMMANDS = SystemCommandGen();
    const scopeCommandMap: Record<string, Telegram.BotCommand[]> = {
        all_private_chats: [],
        all_group_chats: [],
        all_chat_administrators: [],
    };
    for (const cmd of SYSTEM_COMMANDS) {
        if (ENV.HIDE_COMMAND_BUTTONS.includes(cmd.command)) {
            continue;
        }
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

export async function authChecker(command: CommandHandler, message: Telegram.Message, context: WorkerContext) {
    if (command.needAuth && command.needAuth(message.chat?.type ?? 'private')?.includes('whitelist')) {
        if (ENV.CHAT_WHITE_LIST.includes(message.from?.id?.toString() ?? '')) {
            return;
        }
        throw new Error('Permission denied, need whitelist');
    }
    if (ENV.CHAT_WHITE_LIST.includes(message.from?.id?.toString() ?? '')) {
        return;
    }
    const roleList = command.needAuth!(message.chat?.type ?? 'private');
    if (roleList) {
        // 获取身份并判断
        const chatRole = await loadChatRoleWithContext(message, context);
        if (chatRole === null) {
            throw new Error('Get chat role failed');
        }
        if (!roleList.includes(chatRole)) {
            throw new Error(`Permission denied, need ${roleList.join(' or ')}`);
        }
    }
}

export function blockCommand() {
    const commands = SYSTEM_COMMANDS.filter(item => !ENV.BLOCK_COMMANDS.includes(item.command));
    SYSTEM_COMMANDS.length = 0;
    SYSTEM_COMMANDS.push(...commands);
}
