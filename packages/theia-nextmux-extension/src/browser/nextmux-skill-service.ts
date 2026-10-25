import { injectable } from '@theia/core/shared/inversify';
import { URI } from '@theia/core/lib/common/uri';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileChangeType } from '@theia/filesystem/lib/common/files';
import { DefaultSkillService } from '@theia/ai-core/lib/browser/skill-service';
import { SkillPromptCoordinator } from '@theia/ai-core/lib/browser/skill-prompt-coordinator';
import { PREFERENCE_NAME_SKILL_DIRECTORIES } from '@theia/ai-core/lib/common/ai-core-preferences';
import { SKILL_FILE_NAME, type Skill } from '@theia/ai-core/lib/common/skill';
import { decodeSkillBytes, parseNextMuxSkill, SKILL_LIMITS, SkillFormatError } from '../common/nextmux-skill-format';

export interface SkillLoadIssue {
    readonly name: string;
    readonly location: string;
    readonly code: string;
}

function skillFileLocation(uri: URI): string {
    const fsPath = uri.path.fsPath();
    if (uri.scheme === 'file' && uri.authority) {
        const normalized = fsPath.replace(/\//g, '\\');
        return `\\\\${uri.authority}${normalized.startsWith('\\') ? normalized : `\\${normalized}`}`;
    }
    return fsPath;
}

/** Keep Theia's discovery/parser, but settle every initialization attempt, including failures. */
@injectable()
export class NextMuxSkillService extends DefaultSkillService {
    protected readonly listeners = new DisposableCollection();
    protected scan: Promise<void> | undefined;
    protected initialized = false;
    state: 'loading' | 'ready' | 'error' = 'loading';
    protected readonly issues = new Map<string, SkillLoadIssue>();

    getSkillErrors(): readonly SkillLoadIssue[] {
        return [...this.issues.values()];
    }

    reportSkillError(name: string, location: string, error: unknown): void {
        this.skills.delete(name);
        this.issues.set(location, { name, location, code: error instanceof SkillFormatError ? error.code : 'SKILL_READ_FAILED' });
        this.onSkillsChangedEmitter.fire();
    }

    protected override async doUpdate(): Promise<void> {
        this.issues.clear();
        await super.doUpdate();
    }

    /** A broken file is a visible per-Skill issue, never a failed discovery scan. */
    protected override async loadSkillFromDirectory(directoryUri: URI, directoryName: string, skills: Map<string, Skill>): Promise<void> {
        if (directoryName.startsWith('.')) return;
        const skillFileUri = directoryUri.resolve(SKILL_FILE_NAME);
        try {
            if (!await this.fileService.exists(skillFileUri)) return;
            const file = await this.fileService.readFile(skillFileUri, { limits: { size: SKILL_LIMITS.fileBytes } });
            const parsed = parseNextMuxSkill(decodeSkillBytes(file.value.buffer), directoryName);
            if (skills.has(parsed.name)) return;
            skills.set(parsed.name, { ...parsed.metadata, name: parsed.name, description: parsed.description,
                ...(parsed.allowedTools === undefined ? {} : { allowedTools: [...parsed.allowedTools] }), location: skillFileLocation(skillFileUri) });
        } catch (error) {
            const location = skillFileLocation(skillFileUri);
            this.issues.set(location, { name: directoryName, location, code: error instanceof SkillFormatError ? error.code : 'SKILL_READ_FAILED' });
        }
    }

    protected override init(): void {
        if (this.initialized) return;
        this.initialized = true;
        this.lastSkillDirectoriesValue = JSON.stringify(this.preferences[PREFERENCE_NAME_SKILL_DIRECTORIES]);
        this.listeners.push(this.fileService.onDidFilesChange(event => {
            if (event.changes.some(change => {
                const uri = change.resource.toString();
                if (change.type === FileChangeType.ADDED
                    && [...this.parentWatchers.values()].some(path => URI.fromFilePath(path).toString() === uri)) return true;
                return [...this.watchedDirectories].some(directory => {
                    if (uri !== directory && !uri.startsWith(`${directory}/`)) return false;
                    const suffix = uri === directory ? '' : uri.slice(directory.length + 1);
                    if (suffix.split('/').some(segment => segment.startsWith('.'))) return false;
                    return change.resource.path.base === SKILL_FILE_NAME
                        || change.type === FileChangeType.ADDED
                        || change.type === FileChangeType.DELETED
                        || change.type === FileChangeType.UPDATED;
                });
            })) this.scheduleUpdate();
        }));
        this.listeners.push(this.preferences.onPreferenceChanged(event => {
            if (event.preferenceName !== PREFERENCE_NAME_SKILL_DIRECTORIES) return;
            const value = JSON.stringify(this.preferences[PREFERENCE_NAME_SKILL_DIRECTORIES]);
            if (value === this.lastSkillDirectoriesValue) return;
            this.lastSkillDirectoriesValue = value;
            this.scheduleUpdate();
        }));
        this.listeners.push(this.workspaceService.onWorkspaceChanged(() => this.scheduleUpdate()));
        void this.refresh().catch(() => undefined);
    }

    /** Explicit retries and concurrent readers share one complete scan. No listener is registered twice. */
    refresh(): Promise<void> {
        if (this.scan) return this.scan;
        if (this.updateDebounceTimeout) clearTimeout(this.updateDebounceTimeout);
        this.updateDebounceTimeout = undefined;
        const completion = new Deferred<void>();
        this._ready = completion;
        this.state = 'loading';
        this.scan = completion.promise;
        // A startup error can arrive before the first UI consumer subscribes.
        void completion.promise.catch(() => undefined);
        void Promise.resolve().then(async () => {
            await this.workspaceService.ready;
            do {
                this.updateRescheduled = false;
                await this.doUpdate();
            } while (this.updateRescheduled);
        }).then(() => {
            this.scan = undefined;
            this.state = 'ready';
            completion.resolve();
            this.onSkillsChangedEmitter.fire();
        }, () => {
            this.scan = undefined;
            this.state = 'error';
            // Do not expose environment RPC payloads or local paths in the user-facing error.
            completion.reject(new Error('SKILLS_NOT_READY'));
            this.onSkillsChangedEmitter.fire();
        });
        return completion.promise;
    }

    protected override update(): Promise<void> {
        return this.refresh();
    }

    protected override scheduleUpdate(): void {
        if (this.scan) {
            this.updateRescheduled = true;
            return;
        }
        if (this.updateDebounceTimeout) clearTimeout(this.updateDebounceTimeout);
        this.updateDebounceTimeout = setTimeout(() => {
            this.updateDebounceTimeout = undefined;
            void this.refresh().catch(() => undefined);
        }, 50);
    }
}

/** Failure must let the shell render a retry, without allowing an unprepared first model request. */
@injectable()
export class NextMuxSkillPromptCoordinator extends SkillPromptCoordinator {
    protected started = false;

    override async onStart(): Promise<void> {
        if (this.started) return;
        this.started = true;
        this.skillService.onSkillsChanged(() => { void this.refreshCommands(); });
        await this.refreshCommands();
    }

    protected async refreshCommands(): Promise<void> {
        try {
            await this.skillService.ready;
            this.updateSkillCommands();
        } catch {
            // Keep commands from a last successful scan. The request barrier blocks dispatch until retry succeeds.
        }
    }
}
