import { localScheduleDateTime, scheduleWeekday, validScheduleTime } from '../common/nextmux-schedule';
import type { DesktopScheduledTaskRegistrationRequest } from '../common/nextmux-platform-protocol';

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The backend runs in an Electron Helper; launch the containing application, never that helper. */
export function macScheduledAppBundle(executable: string): string | undefined {
    const marker = executable.indexOf('.app/Contents/');
    if (marker < 0) return undefined;
    const bundle = executable.slice(0, marker + 4);
    const inside = executable.slice(marker + '.app/Contents/'.length);
    if (!/^(?:MacOS\/[^/]+|Frameworks\/[^/]+\.app\/Contents\/MacOS\/[^/]+)$/.test(inside)
        || /(?:^|\/)Electron\.app$/i.test(bundle)) return undefined;
    return bundle;
}

/** Task Scheduler's DaysOfWeek element names, indexed like Date.getDay(). */
const WINDOWS_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Task Scheduler XML avoids locale-dependent /SD dates and resumes missed triggers after sleep. */
export function windowsScheduledTaskXml(request: DesktopScheduledTaskRegistrationRequest, executable: string, now = Date.now(), account?: string): string {
    if (!validScheduleTime(request.cadence, request.runAt)) throw new Error('INVALID_SCHEDULE');
    const at = request.cadence === 'once' ? request.runAt : `${localScheduleDateTime(now).slice(0, 10)}T${request.runAt}`;
    const trigger = request.cadence === 'once'
        ? `<TimeTrigger><Enabled>true</Enabled><StartBoundary>${at}:00</StartBoundary><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></TimeTrigger>`
        : `<CalendarTrigger><Enabled>true</Enabled><StartBoundary>${at}:00</StartBoundary><ExecutionTimeLimit>PT0S</ExecutionTimeLimit>${request.cadence === 'daily'
            ? '<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>'
            : `<ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><${WINDOWS_WEEKDAYS[scheduleWeekday(request)]}/></DaysOfWeek></ScheduleByWeek>`}</CalendarTrigger>`;
    return `<?xml version="1.0" encoding="UTF-16"?><Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers>${trigger}</Triggers><Principals><Principal id="Author">${account ? `<UserId>${xml(account)}</UserId>` : ''}<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings><Actions Context="Author"><Exec><Command>${xml(executable)}</Command><Arguments>--nextmux-scheduled</Arguments></Exec></Actions></Task>`;
}
