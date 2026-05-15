export default {
    env: {
        system_init_message: 'You are a helpful assistant',
    },
    command: {
        help: {
            summary: 'The following commands are supported currently:\n',
            help: 'Get command help',
            new: 'Start a new conversation',
            start: 'Show your chat ID and start a new conversation',
            img: 'Generate an image. Supports per-request flags such as `-n`, `-s`, and `-m`. Reply to an image with `/img ...` to edit it through the OpenAI-compatible image flow.',
            vision: 'Send one or more image URLs to the vision model. Use `/vision <url> -p "question"`.',
            ocr: 'Ingest one or more document URLs through the document OCR/text path. Use `/ocr <url> [-p "question"]`.',
            version: 'Show the current build version',
            setenv: 'Set one stored user-config key. Format: `/setenv KEY=VALUE`',
            setenvs: 'Set multiple stored user-config keys at once. Format: `/setenvs{"KEY":"VALUE"}`',
            delenv: 'Delete one stored user-config key',
            clearenv: 'Clear all stored user-config overrides for the current chat scope',
            system: 'Show runtime, provider, and usage information',
            redo: 'Retry the last conversation, optionally with replacement text',
            stop: 'Stop the active response in the current chat scope',
            echo: 'Echo the raw Telegram message payload',
            set: 'Apply temporary or stored user-config overrides with shortcut flags',
            history: 'Export stored chat history as JSON. Format: `/history [n]`',
            settings: 'Open the inline settings UI',
            stt: 'Transcribe speech to text from an audio or voice message. Use it as an audio caption or reply to an audio message with `/stt`.',
            tts: 'Generate speech from text, or reply to a text message with `/tts`. Use `-v` to override the active TTS voice and `-i` for TTS instructions on compatible models.',
            map: 'Manage `/set` key and value aliases',
            promote: 'Grant admin access to a user by reply or user ID',
            demote: 'Remove runtime admin access from a user by reply or user ID',
            block: 'Add a user to the current chat blocklist',
            unblock: 'Remove a user from the current chat blocklist',
            blocklist: 'Show the current chat blocklist',
        },
        new: {
            new_chat_start: 'A new conversation has started',
        },
        detail: {
            set: `/set The command format is /set option value [option value…] or /set "option" value ["option" value…]
 Pre-set options are as follows:
 -p Adjust SYSTEM_INIT_MESSAGE
 -m Adjust the current chat model
 -im Adjust the current image model
 -n Adjust MAX_HISTORY_LENGTH
 -a Adjust AI_CHAT_PROVIDER
 -ai Adjust AI_IMAGE_PROVIDER
 -v Adjust the current vision model
 -s Adjust the current STT model
 -t Adjust the current TTS model
 -tm Adjust TOOL_MODEL
 -tp Adjust CHAT_TEMPERATURE

 You can set MAPPING_KEY, use half-width | to separate entries, and put the option on the left and the target variable on the right.
 You can set MAPPING_VALUE to create short aliases for commonly used values in the same format.
 For example: MAPPING_VALUE = 'fast:gpt-5.4-mini|full:gpt-5.4|compat:oailike'
 Use /set to quickly adjust parameters: /set -m gpt-5.4 -v gpt-5.4-mini

 The /set command can append a normal message after the temporary overrides, and those temporary changes will not be stored.
 When adjusting SYSTEM_INIT_MESSAGE, if PROMPT is set, you can use a prompt key directly and the matching role prompt will be filled automatically, for example:
 /set -p doctor`,
        },
    },
    whitelist: {
        not_in_user_whitelist: '🔒 Access Denied\n\nUser ID: {ID}\nPrivate chats and commands require OWNER_ID or ADMIN_WHITE_LIST access.',
        not_in_group_whitelist: '🔒 Access Denied\n\nGroup ID: {ID}\nAdd to: CHAT_GROUP_WHITE_LIST',
    },
};
