import type { AgentUserQuestion, AgentUserQuestionAnswer } from '@nextmux/agent-runtime';

export interface AgentQuestionDraft {
    readonly optionId: string;
    readonly text: string;
    readonly error: string;
}

const emptyDraft: AgentQuestionDraft = { optionId: '', text: '', error: '' };

export function agentQuestionKey(question: Pick<AgentUserQuestion, 'runId' | 'taskId' | 'questionId'>): string {
    return JSON.stringify([question.runId, question.taskId, question.questionId]);
}

export function questionPausePreservesQueue(stopReason: string | undefined): boolean {
    return stopReason === 'user_input_cancelled' || stopReason === 'user_input_expired';
}

/** Question answers never read or mutate the composer, steering inbox or task queue. */
export class AgentQuestionController {
    question: AgentUserQuestion | undefined;
    draft: AgentQuestionDraft = emptyDraft;
    private binding = '';
    private readonly completed = new Set<string>();
    private readonly submitting = new Set<string>();

    sync(question: AgentUserQuestion | undefined, runId: string, taskId: string, now = Date.now()): boolean {
        const binding = JSON.stringify([runId, taskId]);
        if (binding !== this.binding) {
            this.binding = binding;
            this.completed.clear();
        }
        const next = question?.runId === runId && question.taskId === taskId && question.questionId
            && Number.isFinite(Date.parse(question.expiresAt)) && Date.parse(question.expiresAt) > now
            && !this.completed.has(agentQuestionKey(question)) ? question : undefined;
        if (this.question && next && agentQuestionKey(this.question) === agentQuestionKey(next)) return false;
        if (!this.question && !next) return false;
        this.question = next;
        this.draft = emptyDraft;
        return true;
    }

    visible(runId: string, taskId: string, now = Date.now()): AgentUserQuestion | undefined {
        const question = this.question;
        return question?.runId === runId && question.taskId === taskId && Date.parse(question.expiresAt) > now
            ? question : undefined;
    }

    isSubmitting(question: AgentUserQuestion): boolean {
        return this.submitting.has(agentQuestionKey(question));
    }

    edit(question: AgentUserQuestion, patch: Partial<Pick<AgentQuestionDraft, 'optionId' | 'text'>>): boolean {
        if (!this.question || agentQuestionKey(this.question) !== agentQuestionKey(question) || this.isSubmitting(question)) return false;
        if (patch.optionId && !question.options.some(option => option.id === patch.optionId)) return false;
        this.draft = { ...this.draft, ...patch, text: (patch.text ?? this.draft.text).slice(0, 10_000), error: '' };
        return true;
    }

    begin(question: AgentUserQuestion, runId: string, taskId: string, cancelled = false, now = Date.now()): AgentUserQuestionAnswer | undefined {
        const current = this.visible(runId, taskId, now);
        if (!current || agentQuestionKey(current) !== agentQuestionKey(question) || this.isSubmitting(current)) return undefined;
        const { optionId, text } = this.draft;
        if (!cancelled && !optionId && !text.trim()) return undefined;
        this.submitting.add(agentQuestionKey(current));
        this.draft = { ...this.draft, error: '' };
        return {
            runId: current.runId, taskId: current.taskId, questionId: current.questionId,
            ...(cancelled ? { cancelled: true as const } : {
                ...(optionId ? { optionId } : {}), ...(text.trim() ? { text: text.trim() } : {})
            })
        };
    }

    finish(answer: AgentUserQuestionAnswer, accepted: boolean, error = ''): void {
        const key = agentQuestionKey(answer);
        this.submitting.delete(key);
        if (accepted && JSON.stringify([answer.runId, answer.taskId]) === this.binding) this.completed.add(key);
        if (!this.question || agentQuestionKey(this.question) !== key) return;
        if (accepted) {
            this.question = undefined;
            this.draft = emptyDraft;
        } else this.draft = { ...this.draft, error };
    }
}
