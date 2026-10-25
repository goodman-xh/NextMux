import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { AgentToolError, AgentToolRegistry, DelegatedWorkspaceManager, type DelegatedWorkspaceReview } from '@nextmux/agent-runtime';

interface DelegatedWorkspaceToolOptions {
    readonly workspaceRoot: string;
    readonly conversationId: string;
    readonly manager: DelegatedWorkspaceManager;
}

function argumentsFor(input: unknown): { childRunId: string; reviewId?: string; action?: 'merge' | 'rollback_interrupted' } {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    if (typeof value.childRunId !== 'string' || !/^child-[a-f0-9-]{36}$/.test(value.childRunId)
        || value.reviewId !== undefined && (typeof value.reviewId !== 'string' || !/^[a-f0-9]{64}$/.test(value.reviewId))
        || value.action !== undefined && !['merge', 'rollback_interrupted'].includes(String(value.action))) {
        throw new AgentToolError('INVALID_CHILD_WORKSPACE', 'Invalid child-task review arguments.');
    }
    return { childRunId: value.childRunId, ...(typeof value.reviewId === 'string' ? { reviewId: value.reviewId } : {}),
        ...(value.action ? { action: value.action as 'merge' | 'rollback_interrupted' } : {}) };
}

/** Immutable review artifact under this project's existing file-preview boundary. */
export async function writeDelegatedWorkspaceReviewArtifact(root: string, review: DelegatedWorkspaceReview): Promise<string> {
    const identifiers = argumentsFor(review);
    if (!identifiers.reviewId) throw new AgentToolError('INVALID_CHILD_REVIEW', 'Review the child task\'s changes first.');
    const source = await realpath(root);
    if (await realpath(review.sourceWorkspaceRoot) !== source) {
        throw new AgentToolError('CHILD_WORKSPACE_OWNER_MISMATCH', 'This child task belongs to another project.');
    }
    let directory = source;
    for (const segment of ['.nextmux', 'reviews', review.childRunId]) {
        directory = join(directory, segment);
        await mkdir(directory, { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const entry = await lstat(directory);
        if (entry.isSymbolicLink() || !entry.isDirectory() || await realpath(directory) !== directory) {
            throw new AgentToolError('INVALID_REVIEW_PATH', 'The review folder must be inside the current project.');
        }
    }
    const path = join(directory, `${review.reviewId}.diff`);
    const output = [
        `# NextMux child change review: ${review.childRunId}`,
        `# Review: ${review.reviewId}`,
        `# Source: ${review.sourceWorkspaceRoot}`,
        `# Child: ${review.workspaceRoot}`,
        '# Parent conflicts are checked again immediately before merging.',
        '# Child checks do not validate the integrated parent project. Re-run checks after merging.',
        '', ...review.changes.map(change => change.binary ? `Binary ${change.kind}: ${change.path}`
            : `${change.patch}${change.truncated ? '\n[Display truncated; inspect the child file before merging.]\n' : ''}`),
    ].join('\n');
    if (Buffer.byteLength(output) > 16 * 1024 * 1024) throw new AgentToolError('REVIEW_TOO_LARGE', 'The diff is too large; review the child task\'s files in smaller batches.');
    try { await writeFile(path, output, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const entry = await lstat(path);
        if (!entry.isFile() || entry.isSymbolicLink() || await readFile(path, 'utf8') !== output) {
            throw new AgentToolError('REVIEW_ARTIFACT_CONFLICT', 'The review file was changed by something else; it was not overwritten.');
        }
    }
    return relative(source, path).split(sep).join('/');
}

export function registerDelegatedWorkspaceTools(tools: AgentToolRegistry, options: DelegatedWorkspaceToolOptions): void {
    const owned = async (childRunId: string): Promise<void> => {
        await options.manager.ownedWorkspace(childRunId, { conversationId: options.conversationId, workspaceRoot: options.workspaceRoot });
    };
    tools.register({
        name: 'agent.review_changes',
        description: 'Review an isolated child task result. Returns actual diffs, conflicts, workspace root and reviewId. Does not apply changes. Open the generated diff in the existing file panel before a separate merge action.',
        requiredPermission: 'read_only', source: 'builtin', executionKind: 'read',
        inputSchema: { type: 'object', additionalProperties: false, required: ['childRunId'], properties: { childRunId: { type: 'string' } } },
    }, async input => {
        const { childRunId } = argumentsFor(input); await owned(childRunId);
        const review = await options.manager.review(childRunId);
        const reviewPath = await writeDelegatedWorkspaceReviewArtifact(options.workspaceRoot, review);
        return { modelOutput: { ...review, reviewPath }, summary: {
            kind: 'agent.review_changes', title: 'Child task changes await review', details: [review.workspaceRoot, review.reviewId, ...review.changes.map(change => `${change.kind}: ${change.path}`)],
            resource: { kind: 'file', action: 'read', path: reviewPath },
        } };
    });
    tools.register({
        name: 'agent.merge_changes',
        description: 'Explicitly integrate an already reviewed child result into its owning project. Requires the reviewId returned by agent.review_changes; refuses changed parent files. Invoke only within the user-authorized task scope. Prior child checks become stale: run checks on the merged project. To recover an interrupted merge, set action=rollback_interrupted with interruptedMerge.reviewId from review; changed user files are never overwritten.',
        requiredPermission: 'workspace_write', source: 'builtin', executionKind: 'side_effect',
        inputSchema: { type: 'object', additionalProperties: false, required: ['childRunId', 'reviewId'], properties: { childRunId: { type: 'string' }, reviewId: { type: 'string' }, action: { type: 'string', enum: ['merge', 'rollback_interrupted'] } } },
    }, async input => {
        const { childRunId, reviewId, action } = argumentsFor(input);
        if (!reviewId) throw new AgentToolError('INVALID_CHILD_REVIEW', 'Review the child task\'s changes first.');
        await owned(childRunId);
        if (action === 'rollback_interrupted') {
            const result = await options.manager.recoverInterruptedMerge(childRunId, reviewId);
            return { modelOutput: result, summary: { kind: 'agent.recover_merge', title: 'Recovered interrupted merge', changedPaths: result.changedPaths,
                details: [childRunId, ...result.changedPaths], outcome: 'succeeded' } };
        }
        const source = await realpath(options.workspaceRoot);
        const artifact = join(source, '.nextmux', 'reviews', childRunId, `${reviewId}.diff`);
        try {
            const entry = await lstat(artifact);
            if (!entry.isFile() || entry.isSymbolicLink() || await realpath(artifact) !== artifact) throw new Error('Invalid review path');
        } catch { throw new AgentToolError('CHILD_REVIEW_REQUIRED', 'Review the child task\'s changes (open its diff) before merging.'); }
        const result = await options.manager.merge(childRunId, reviewId);
        return { modelOutput: result, summary: { kind: 'agent.merge_changes', title: 'Merged child task; run validation again', changedPaths: result.changedPaths,
            checkpointIds: result.checkpointIds, details: [childRunId, ...result.changedPaths], outcome: 'succeeded' } };
    });
}
