import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduledOccurrenceDue, scheduleWeekday } from '../lib/common/nextmux-schedule.js';
import { windowsScheduledTaskXml } from '../lib/node/nextmux-schedule-system.js';
import { nextScheduledWakeAt } from '../lib/browser/nextmux-turn-wakeup-status.js';
import { registerScheduleTools } from '../lib/node/nextmux-schedule-tools.js';

// Weekly plans run on the day the user chose (audit APP-01: every weekly plan used to run on Monday).
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// 21 October 2026 is a Wednesday.
const wednesday = at(2026, 10, 21);

test('a weekly plan is due on its own weekday, and old plans without a day stay on Monday', () => {
    const base = { cadence: 'weekly', runAt: '09:00', createdAt: at(2026, 10, 1), enabled: true };
    assert.equal(new Date(wednesday).getDay(), 3);
    assert.equal(scheduledOccurrenceDue({ ...base, weekday: 3 }, at(2026, 10, 21, 9, 30)), at(2026, 10, 21, 9, 0), 'Wednesday 09:00 is due on Wednesday');
    assert.equal(scheduledOccurrenceDue({ ...base, weekday: 3 }, at(2026, 10, 23, 12)), at(2026, 10, 21, 9, 0), 'a missed Wednesday is caught up once on Friday');
    assert.equal(scheduledOccurrenceDue({ ...base, weekday: 3, lastOccurrenceAt: at(2026, 10, 21, 9) }, at(2026, 10, 23, 12)), undefined, 'and only once');
    assert.equal(scheduledOccurrenceDue({ ...base, weekday: 3 }, at(2026, 10, 21, 8, 59)), at(2026, 10, 14, 9, 0), 'before 09:00 the previous Wednesday is the latest occurrence');
    assert.equal(scheduledOccurrenceDue({ ...base, weekday: 0 }, at(2026, 10, 25, 10)), at(2026, 10, 25, 9, 0), 'Sunday plans run on Sunday');
    assert.equal(scheduledOccurrenceDue(base, at(2026, 10, 21, 10)), at(2026, 10, 19, 9, 0), 'no stored day: Monday, as before');
    assert.equal(scheduleWeekday({ weekday: 7 }), 1);
    assert.equal(scheduleWeekday({ weekday: 2.5 }), 1);
    assert.equal(scheduleWeekday({ weekday: 6 }), 6);
});

test('the next wake-up time uses the chosen weekday', () => {
    const task = { cadence: 'weekly', runAt: '09:00', weekday: 5, enabled: true };
    assert.equal(nextScheduledWakeAt(task, at(2026, 10, 21, 12)), at(2026, 10, 23, 9, 0), 'Wednesday noon: this Friday');
    assert.equal(nextScheduledWakeAt(task, at(2026, 10, 23, 9, 30)), at(2026, 10, 30, 9, 0), 'after Friday 09:00: next Friday');
    assert.equal(nextScheduledWakeAt({ ...task, weekday: undefined }, at(2026, 10, 21, 12)), at(2026, 10, 26, 9, 0), 'legacy plans: next Monday');
});

test('Windows Task Scheduler and launchd register the same weekday', async () => {
    const xml = day => windowsScheduledTaskXml({ taskId: '11111111-1111-4111-8111-111111111111', cadence: 'weekly', runAt: '09:00', enabled: true, ...(day === undefined ? {} : { weekday: day }) },
        'C:\\NextMux\\NextMux.exe', at(2026, 10, 21), 'PC\\user');
    assert.match(xml(3), /<DaysOfWeek><Wednesday\/><\/DaysOfWeek>/);
    assert.match(xml(0), /<DaysOfWeek><Sunday\/><\/DaysOfWeek>/);
    assert.match(xml(undefined), /<DaysOfWeek><Monday\/><\/DaysOfWeek>/);
    const { readFileSync } = await import('node:fs');
    const service = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    assert.match(service, /<key>Weekday<\/key><integer>\$\{scheduleWeekday\(request\)\}<\/integer>/, 'launchd uses the same 0 = Sunday numbering');
});

test('the model names the day; retries must match it and unknown days are refused', async () => {
    const saved = [];
    const tools = new Map();
    registerScheduleTools({ register: (descriptor, handler) => tools.set(descriptor.name, { descriptor, handler }) }, {
        workspaceRoot: process.cwd(), conversationId: 'conversation-1', defaults: { permissionMode: 'read_only' },
        load: async () => saved, save: async task => { const stored = { ...task, definitionRevision: 1 }; saved.push(stored); return stored; }, remove: async () => {}
    });
    const update = tools.get('nextmux.update_schedule');
    assert.deepEqual(update.descriptor.inputSchema.properties.weekday.enum, ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
    const created = JSON.parse((await update.handler({ action: 'create', idempotencyKey: 'weekly-review', title: 'Review', prompt: 'Review the week', cadence: 'weekly', runAt: '17:00', weekday: 'Friday' })).modelOutput);
    assert.equal(created.weekday, 'friday');
    assert.equal(saved[0].weekday, 5);
    await assert.rejects(() => update.handler({ action: 'create', idempotencyKey: 'weekly-review', title: 'Review', prompt: 'Review the week', cadence: 'weekly', runAt: '17:00', weekday: 'monday' }),
        /different schedule/);
    await assert.rejects(() => update.handler({ action: 'create', title: 'X', prompt: 'Y', cadence: 'weekly', runAt: '17:00', weekday: 'someday' }), /weekday name/);
    const daily = JSON.parse((await update.handler({ action: 'create', title: 'Daily', prompt: 'Daily check', cadence: 'daily', runAt: '08:00', weekday: 'monday' })).modelOutput);
    assert.equal(daily.weekday, undefined, 'only weekly plans keep a day');
});
