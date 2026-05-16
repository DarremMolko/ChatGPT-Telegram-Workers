import type { AgentUserConfig } from '../config/env';

export type ToolModelMode = 'override' | 'specialist';

export function resolveToolModelMode(config: Pick<AgentUserConfig, 'TOOL_MODEL_MODE'>): ToolModelMode {
    const mode = `${config.TOOL_MODEL_MODE || 'override'}`.trim().toLowerCase();
    return mode === 'specialist' ? 'specialist' : 'override';
}

export function shouldOverrideToolModel(config: Pick<AgentUserConfig, 'TOOL_MODEL' | 'TOOL_MODEL_MODE'>, activeToolCount: number, hasPendingToolRequest = false): boolean {
    return (activeToolCount > 0 || hasPendingToolRequest)
        && `${config.TOOL_MODEL || ''}`.trim().length > 0
        && resolveToolModelMode(config) === 'override';
}

export function shouldEnableSpecialistTool(config: Pick<AgentUserConfig, 'TOOL_MODEL' | 'TOOL_MODEL_MODE'>, activeToolCount: number): boolean {
    return activeToolCount > 0
        && `${config.TOOL_MODEL || ''}`.trim().length > 0
        && resolveToolModelMode(config) === 'specialist';
}
