import type { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

type WorkspaceConfigurationService = Pick<WorkspaceService,
    'workspace' | 'roots' | 'isUntitledWorkspace' | 'save'>;

/** Serializes root mutations and untitled-workspace promotion. */
export class WorkspaceConfigurationSaveCoordinator {
    private state: 'clean' | 'dirty' | 'failed' = 'clean';
    private flushPromise: Promise<void> | undefined;
    private mutationPromise: Promise<void> | undefined;
    private pendingMutations = 0;

    constructor(private readonly workspaceService: WorkspaceConfigurationService) { }

    get hasPendingChanges(): boolean {
        return this.state !== 'clean' || Boolean(this.flushPromise) || this.pendingMutations > 0;
    }

    runWorkspaceMutation<T>(mutation: () => Promise<T>): Promise<T> {
        const previousMutation = this.mutationPromise;
        const activeSave = this.flushPromise;
        this.pendingMutations++;
        const result = (async () => {
            await previousMutation;
            await activeSave;
            return mutation();
        })().finally(() => {
            this.pendingMutations--;
            if (!this.pendingMutations) this.mutationPromise = undefined;
            // Theia emits location/root changes inside spliceRoots, before its
            // final write. Promote only after that complete mutation, including
            // any partial changes left by an operation that rejected.
            this.schedule();
        });
        // A rejected root operation still reaches its caller, but cannot stall
        // the next root operation or the application's final save.
        this.mutationPromise = result.then(() => undefined, () => undefined);
        return result;
    }

    schedule(): void {
        this.state = 'dirty';
        if (!this.pendingMutations) void this.flush();
    }

    flush(): Promise<void> {
        if (this.mutationPromise) return this.mutationPromise.then(() => this.flush());
        if (this.state === 'clean') return this.flushPromise || Promise.resolve();
        if (!this.flushPromise) {
            this.flushPromise = this.drain().finally(() => {
                this.flushPromise = undefined;
                // A schedule can land after drain completes but before this
                // continuation runs. Preserve that trailing write, but leave a
                // failed write parked until another schedule or explicit flush.
                if (this.state === 'dirty' && !this.pendingMutations) return this.flush();
            });
        }
        return this.flushPromise;
    }

    dispose(): void {
        void this.flush();
    }

    private async drain(): Promise<void> {
        while (this.state !== 'clean' && !this.pendingMutations) {
            this.state = 'clean';
            if (!await this.persistOnce()) {
                if (this.state === 'clean') {
                    this.state = 'failed';
                    return;
                }
            }
        }
    }

    private async persistOnce(): Promise<boolean> {
        try {
            const workspace = this.workspaceService.workspace;
            if (!workspace || !this.workspaceService.isUntitledWorkspace(workspace.resource)) return true;
            const roots = await this.workspaceService.roots;
            if (roots.length === 0) return true;
            const stableWorkspace = workspace.resource.parent.resolve('NextMux.auto.theia-workspace');
            if (stableWorkspace.isEqual(workspace.resource)) return true;
            await this.workspaceService.save(stableWorkspace);
            return true;
        } catch {
            // Saving an app-owned convenience file must never block project use.
            return false;
        }
    }
}
