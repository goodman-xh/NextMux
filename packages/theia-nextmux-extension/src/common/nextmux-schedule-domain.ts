import type { DomainMessage } from './nextmux-domain-errors';
const messages = {
    "SCHEDULE_VERSION_CONFLICT": "The schedule changed. Refresh before retrying.",
    "SCHEDULE_FIELDS_REQUIRED": "Enter a schedule name and task instructions.",
    "SCHEDULE_TIME_PERMISSION_INVALID": "Check the schedule time and permissions.",
    "SCHEDULE_ALREADY_RAN": "This schedule already ran. Choose a new run time.",
    "SCHEDULE_RUNNING": "The schedule is running. Wait for it to finish before changing its settings.",
    "SCHEDULE_TIME_INVALID": "The schedule time format is invalid.",
    "SCHEDULE_ONCE_TIME_INVALID": "The one-time schedule date and time are invalid.",
    "SCHEDULE_DELETED": "The schedule was deleted. Refresh before retrying.",
    "SCHEDULE_WORKSPACE_NOT_DIRECTORY": "The selected path is not a project folder. Select it again.",
    "SCHEDULE_WORKSPACE_UNAVAILABLE": "The project folder is missing or inaccessible. Select it again.",
    "SCHEDULE_ROUTE_INVALID": "The model route is unavailable. Select another route."
} as const;
export function scheduleDomainMessage(code: keyof typeof messages): DomainMessage {
    return {code, fallbackEnglish: messages[code]};
}
