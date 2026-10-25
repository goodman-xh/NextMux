import type { AgentPermissionMode, AgentRunEvent } from '@nextmux/agent-runtime';
import type { DesktopAgentChildSnapshot, DesktopAgentRunResult, ManagedGatewayRoute } from '../common/nextmux-platform-protocol';
import { AgentQuestionController } from './nextmux-agent-question';

/** One conversation owns its preparation, backend run, event cursor and stop signal. */
export function createConversationAgentRun(sessionId: string) {
    return {
        activeAgentSessionId: sessionId,
        activeAgentRunId: '', activeAgentTurnId: '',
        activeAgentManagedRoute: undefined as ManagedGatewayRoute | undefined,
        agentStage: 'idle' as 'idle' | 'running' | 'complete' | 'paused' | 'cancelled' | 'error',
        agentWorkbench: 'coding' as 'coding' | 'comic',
        agentResult: undefined as DesktopAgentRunResult | undefined,
        agentError: '', agentEventCursor: 0, agentPollGeneration: 0,
        liveAgentEvents: [] as readonly AgentRunEvent[],
        liveAgentChildren: [] as readonly DesktopAgentChildSnapshot[],
        activeAgentChildId: '', agentQuestions: new AgentQuestionController(),
        agentStopping: false, agentCancelRequested: false,
        agentStartController: undefined as AbortController | undefined,
        pendingAgentStartToken: undefined as string | undefined,
        runningMessageSubmitting: false, followUpQueueDraining: false,
        submittedPrompt: '', lastRunPermissionMode: 'read_only' as AgentPermissionMode,
        submitting: false, completion: undefined as Promise<boolean> | undefined
    };
}

export type ConversationAgentRun = ReturnType<typeof createConversationAgentRun>;

export function conversationAgentRunActive(run: ConversationAgentRun | undefined): boolean {
    return Boolean(run && (run.submitting || run.activeAgentRunId || run.agentStage === 'running' || run.agentStartController));
}
