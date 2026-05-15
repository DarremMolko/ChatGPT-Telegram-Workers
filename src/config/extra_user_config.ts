export class ExtraUserConfig {
    MAPPING_KEY = '-p:SYSTEM_INIT_MESSAGE|-n:MAX_HISTORY_LENGTH|-a:AI_CHAT_PROVIDER|-ai:AI_IMAGE_PROVIDER|-m:CHAT_MODEL|-im:IMAGE_MODEL|-v:VISION_MODEL|-s:STT_MODEL|-t:TTS_MODEL|-ex:OPENAI_API_EXTRA_PARAMS|-mk:MAPPING_KEY|-mv:MAPPING_VALUE|-tm:TOOL_MODEL|-th:TEXT_HANDLE_TYPE|-to:TEXT_OUTPUT|-ah:AUDIO_HANDLE_TYPE|-ao:AUDIO_OUTPUT|-act:AUDIO_CONTAINS_TEXT|-as:AI_ASR_PROVIDER|-at:AI_TTS_PROVIDER|-tp:CHAT_TEMPERATURE';
    // /set command mapping value, separated by |, : separates multiple relationships
    MAPPING_VALUE = '';
    // MAPPING_VALUE = "fast:gpt-5.4-mini|full:gpt-5.4|compat:oailike";
    // Whether to show model and time information in the message
    ENABLE_SHOWINFO = false;
    // enable Show info, which parts to show, support model, model_time, token, tool, tool_time, first_chunk_time
    SHOW_PARTS = ['model', 'model_time', 'token', 'tool', 'tool_time'];
    // Max serialized tool-args length in the info footer. Set to -1 to show full args.
    SHOW_TOOL_ARGS_MAX_LENGTH = 80;
    USE_MCP: string[] = [];
    // if starts with '{agent}:' prefix, the specified agent corresponds to the chat model,
    // otherwise use the current agent and the specified model.
    // Keep empty to use the current agent chat model as function call model.
    TOOL_MODEL = '';
    PROMPT: Record<string, string> = {};

    // chat agent temperature
    CHAT_TEMPERATURE: number | undefined = undefined;
    // function call temperature
    FUNCTION_CALL_TEMPERATURE: number | undefined = undefined;
    // chat max tokens
    MAX_TOKENS: number | undefined = undefined;
    // chat agent max steps
    MAX_STEPS = 5;
    // chat agent max retries
    MAX_RETRIES = 0;
    // text handle type, to 'tts' or 'text' to chat with llm, or 'chat' by using direct multimodal chat (default: text)
    TEXT_HANDLE_TYPE: 'tts' | 'text' | 'chat' = 'text';
    // Text output type, 'audio' or 'text' (default: text)
    TEXT_OUTPUT: 'audio' | 'text' = 'text';
    // Audio handle type, 'stt' or 'audio' to chat with llm, or 'chat' by using direct multimodal chat (default: stt)
    AUDIO_HANDLE_TYPE: 'stt' | 'audio' | 'chat' = 'stt';
    // Audio output type, 'audio' or 'text' (default: text)
    AUDIO_OUTPUT: 'audio' | 'text' = 'text';
    // Audio contains text
    AUDIO_CONTAINS_TEXT = true;
    // max history length, default is 10
    MAX_HISTORY_LENGTH = 10;
    // whether to generate long text (limited by MAX_STEPS)
    CONTINUE_STEP = false;
    // message replacer, you can use it to replace message text in the middle of the message, multiple words can be replaced at the same time
    MESSAGE_REPLACER: Record<string, string> = {};
    // Parameter modifier; string array; separated by colons, the key is the model name, separated by commas;
    // the value is the parameter modification value, modification values starting with '+' indicates addition, with the value after '=' and separated by '|'; starting with '-' indicates addition indicate deletion.
    // note: not support stream option
    // for example: PARAMS_MODIFIER = ['gpt-5.4:+reasoning_effort="high"'];
    // priority is higher than EXTRA_PARAMS
    PARAMS_MODIFIER: string[] = [];
    // whether to enable model alias of mapping value
    ENABLE_ALIAS = false;
    // Audio prompt
    AUDIO_PROMPT = 'Please listen to the audio file. Identify and understand the question being asked in the audio. Then, provide a detailed explanation and answer to this question. Ensure your answer is helpful and explains the solution or information clearly.';
    // use blocklist to block someone
    BLOCKLIST: string[] = [];
}
