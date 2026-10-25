/** File name of the open AGENTS.md convention for standing agent instructions. */
export const AGENT_INSTRUCTIONS_FILE_NAME = 'AGENTS.md';
/** Editable size of one instruction file; longer files are edited in the full editor. */
export const AGENT_INSTRUCTIONS_MAX_CHARACTERS = 12_000;

/**
 * The text an editor shows for a saved instruction file: CRLF as LF and without the one trailing newline the writer adds
 * (writeAgentInstructionFile). Putting that newline back into a textarea after an auto-save moved the caret to a new line.
 */
export function agentInstructionEditorText(content: string | undefined): string {
    return (content || '').replace(/\r\n/g, '\n').replace(/\n$/, '');
}

/** Whether two instruction texts are the same document, apart from line endings and the writer's trailing newline. */
export function sameInstructionText(a: string | undefined, b: string | undefined): boolean {
    return agentInstructionEditorText(a) === agentInstructionEditorText(b);
}

export interface AgentInstructionFile {
    readonly scope: 'personal' | 'project';
    readonly path: string;
    readonly exists: boolean;
    readonly content: string;
    /** SHA-256 of the full file on disk; saves compare against it. */
    readonly sha256: string;
    readonly updatedAt: number | null;
    readonly truncated?: boolean;
}

/** Another tool's instruction file in the project (e.g. CLAUDE.md), offered for import when AGENTS.md is missing. */
export interface AgentInstructionAlternative {
    readonly name: string;
    readonly path: string;
    readonly content: string;
}

export interface AgentInstructionSnapshot {
    readonly personal: AgentInstructionFile;
    readonly project?: AgentInstructionFile;
    readonly projectAlternatives?: readonly AgentInstructionAlternative[];
}

export interface AgentInstructionSaveRequest {
    readonly scope: 'personal' | 'project';
    readonly workspaceRoot?: string;
    readonly content: string;
    readonly expectedSha256: string;
}
