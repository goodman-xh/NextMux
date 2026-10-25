import { createHash, randomUUID } from 'crypto';
import { resolve } from 'path';
import { realpath } from 'fs/promises';
import { AgentToolError, narrowAgentPermission } from '@nextmux/agent-runtime';
import type { AgentToolRegistry, AgentPermissionMode } from '@nextmux/agent-runtime';
import { SCHEDULE_PROMPT_MAX_CHARACTERS, scheduleWeekday, type ScheduledTaskRecord } from '../common/nextmux-schedule';

/** Weekly plans name their day in the model's words; stored as Date.getDay() (0 = Sunday). */
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export interface ScheduleToolHost {
    readonly workspaceRoot: string;
    readonly conversationId?: string;
    readonly defaults: Pick<ScheduledTaskRecord, 'modelRoute' | 'modelLabel' | 'routeId' | 'relayKey' | 'modelId' | 'keyPriceQuoteId'
        | 'switchPolicy' | 'permissionMode' | 'reasoningEffort' | 'reasoningSettings' | 'contextWindowTokens'>;
    load(): Promise<readonly ScheduledTaskRecord[]>;
    save(task: ScheduledTaskRecord, expectedRevision: number): Promise<ScheduledTaskRecord>;
    remove(id: string): Promise<void>;
}

/** Models and the plan editor use the same durable plan service; never synthesize OS scripts. */
export function registerScheduleTools(registry: AgentToolRegistry, host: ScheduleToolHost): void {
    const normalizePath = (path: string): string => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    const workspaceRoot = realpath(host.workspaceRoot).catch(() => resolve(host.workspaceRoot));
    const owns = async (task: ScheduledTaskRecord): Promise<boolean> => {
        const root = normalizePath(await workspaceRoot);
        return normalizePath(task.workspacePath) === root || normalizePath(task.workspacePath) === normalizePath(host.workspaceRoot)
            || normalizePath(await realpath(task.workspacePath).catch(() => task.workspacePath)) === root;
    };
    // lastMessage is renderer prose (including old localized errors); model state uses the stable status only.
    const summary = (task: ScheduledTaskRecord) => ({ id: task.id, title: task.title, prompt: task.prompt,
        workspacePath: task.workspacePath, cadence: task.cadence, runAt: task.runAt,
        ...(task.cadence === 'weekly' ? { weekday: WEEKDAY_NAMES[scheduleWeekday(task)] } : {}), enabled: task.enabled,
        model: task.modelLabel, permissionMode: task.permissionMode, reasoningEffort: task.reasoningEffort,
        contextWindowTokens: task.contextWindowTokens,
        sessionId: task.sessionId,
        lastStatus: task.lastStatus, definitionRevision: task.definitionRevision });
    registry.register({ name: 'nextmux.list_schedules', source: 'builtin', requiredPermission: 'read_only',
        executionKind: 'read', concurrencySafe: true,
        description: 'List this project’s saved NextMux scheduled tasks. Plans are local, use the saved model and run when this computer is available.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', maxLength: 36 }, limit: { type: 'integer', minimum: 1, maximum: 50 }
        } }
    }, async input => {
        const args = input as { id?: string; limit?: number };
        const saved = await host.load();
        const ownership = await Promise.all(saved.map(owns));
        const tasks = saved.filter((_task, index) => ownership[index]);
        const selected = args.id ? tasks.filter(task => task.id === args.id) : tasks.slice(0, Math.max(1, Math.min(50, Number(args.limit) || 20)));
        return { modelOutput: JSON.stringify({ tasks: selected.map(task => ({ ...summary(task), prompt: args.id ? task.prompt : task.prompt.slice(0, 400) })),
            count: tasks.length, hasMore: !args.id && selected.length < tasks.length }), summary: { kind: 'nextmux.list_schedules', params: { count: tasks.length }, title: 'Read project schedules' } };
    });
    registry.register({ name: 'nextmux.update_schedule', source: 'builtin', requiredPermission: 'workspace_write',
        executionKind: 'side_effect', concurrencySafe: false,
        description: 'Create or update a scheduled AI task only when requested by the user. Uses the current project and model/merchant settings; never changes the active conversation. Times use this computer’s local timezone; a weekly plan runs on its weekday (today’s weekday unless given). Return the saved ID. Use idempotencyKey when creating. Existing plans may be enabled, paused or removed. No secret credentials are accepted.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['action'], properties: {
            action: { type: 'string', enum: ['create', 'update', 'remove'] },
            id: { type: 'string', maxLength: 36 }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
            title: { type: 'string', minLength: 1, maxLength: 80 }, prompt: { type: 'string', minLength: 1, maxLength: SCHEDULE_PROMPT_MAX_CHARACTERS },
            cadence: { type: 'string', enum: ['once', 'daily', 'weekly'] },
            runAt: { type: 'string', description: 'Local YYYY-MM-DDTHH:mm for once; HH:mm for daily or weekly.', maxLength: 20 },
            weekday: { type: 'string', enum: [...WEEKDAY_NAMES], description: 'Weekly plans: the day of the week it runs.' },
            enabled: { type: 'boolean' }, useCurrentModel: { type: 'boolean' },
            permissionMode: { type: 'string', enum: ['read_only', 'workspace_write', 'full_access'] }
        } }
    }, async input => {
        const args = input as Record<string, unknown>;
        if (!['create', 'update', 'remove'].includes(String(args.action))) throw new AgentToolError('INVALID_SCHEDULE_ACTION', 'Unknown schedule action; use create, update or remove.');
        const requestedWeekday = args.weekday === undefined ? undefined : WEEKDAY_NAMES.indexOf(String(args.weekday).toLowerCase() as typeof WEEKDAY_NAMES[number]);
        if (requestedWeekday === -1) throw new AgentToolError('INVALID_SCHEDULE_WEEKDAY', 'Use a weekday name: sunday, monday, tuesday, wednesday, thursday, friday or saturday.');
        if (!host.workspaceRoot) throw new AgentToolError('SCHEDULE_WORKSPACE_REQUIRED', 'Open a project folder first.');
        const tasks = await host.load();
        const prior = args.id ? tasks.find(task => task.id === args.id) : undefined;
        if (args.action !== 'create' && (!prior || !await owns(prior))) {
            throw new AgentToolError('SCHEDULE_NOT_FOUND', 'No such schedule in this project.');
        }
        if (args.action === 'remove') {
            await host.remove(prior!.id);
            return { modelOutput: JSON.stringify({ id: prior!.id, removed: true }), summary: { kind: 'nextmux.schedule.remove', title: 'Delete project schedule', details: [prior!.title] } };
        }
        const key = typeof args.idempotencyKey === 'string' ? args.idempotencyKey : '';
        const hash = createHash('sha256').update(`${normalizePath(await workspaceRoot)}\0${host.conversationId || ''}\0${key}`).digest('hex');
        const id = args.action === 'create' ? key
            ? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
            : randomUUID() : prior!.id;
        const duplicate = args.action === 'create' ? tasks.find(task => task.id === id) : undefined;
        if (duplicate) {
            // A retry is the same creation only if everything that decides what runs and what it may cost matches:
            // a changed enabled flag, permission or model is a different schedule (audit C35-07).
            const requestedEnabled = typeof args.enabled === 'boolean' ? args.enabled : true;
            const requestedPermission = narrowAgentPermission(
                (args.permissionMode || host.defaults.permissionMode || 'read_only') as AgentPermissionMode, host.defaults.permissionMode || 'read_only');
            const sameModel = JSON.stringify(duplicate.modelRoute ?? null) === JSON.stringify(host.defaults.modelRoute ?? null);
            if (!await owns(duplicate) || duplicate.title !== String(args.title || '').trim() || duplicate.prompt !== String(args.prompt || '').trim()
                || duplicate.cadence !== (args.cadence || 'once') || duplicate.runAt !== args.runAt
                || duplicate.cadence === 'weekly' && requestedWeekday !== undefined && scheduleWeekday(duplicate) !== requestedWeekday
                || duplicate.enabled !== requestedEnabled || duplicate.permissionMode !== requestedPermission || !sameModel) {
                throw new AgentToolError('SCHEDULE_IDEMPOTENCY_CONFLICT', 'This creation id was already used for a different schedule.');
            }
            return { modelOutput: JSON.stringify({ ...summary(duplicate), idempotent: true }), summary: { kind: 'nextmux.schedule.exists', title: 'Schedule already exists', details: [duplicate.title] } };
        }
        const defaults = !prior || args.useCurrentModel === true ? host.defaults : {};
        const permissionMode = narrowAgentPermission(
            (args.permissionMode || prior?.permissionMode || host.defaults.permissionMode || 'read_only') as AgentPermissionMode,
            host.defaults.permissionMode || 'read_only');
        const task: ScheduledTaskRecord = {
            ...prior, ...defaults, id, workspacePath: host.workspaceRoot, originConversationId: host.conversationId,
            title: typeof args.title === 'string' ? args.title : prior?.title || '',
            prompt: typeof args.prompt === 'string' ? args.prompt : prior?.prompt || '',
            cadence: (args.cadence || prior?.cadence || 'once') as ScheduledTaskRecord['cadence'],
            runAt: typeof args.runAt === 'string' ? args.runAt : prior?.runAt || '',
            // Only weekly plans have a day: an explicit one, else the plan's own, else today's.
            weekday: (args.cadence || prior?.cadence) === 'weekly'
                ? requestedWeekday ?? (prior?.cadence === 'weekly' ? scheduleWeekday(prior) : new Date().getDay()) : undefined,
            enabled: typeof args.enabled === 'boolean' ? args.enabled : prior?.enabled ?? true,
            // Keep the selected route's advertised context capacity with the
            // plan. It is a model capability snapshot, not a user-defined cap.
            contextWindowTokens: defaults.contextWindowTokens ?? prior?.contextWindowTokens,
            createdAt: prior?.createdAt || Date.now(), permissionMode,
            lastStatus: prior?.lastStatus || 'idle'
        };
        const saved = await host.save(task, prior?.definitionRevision || 0);
        return { modelOutput: JSON.stringify(summary(saved)), summary: { kind: prior ? 'nextmux.schedule.update' : 'nextmux.schedule.create', title: prior ? 'Update project schedule' : 'Create project schedule', details: [saved.title, saved.runAt] } };
    });
}
