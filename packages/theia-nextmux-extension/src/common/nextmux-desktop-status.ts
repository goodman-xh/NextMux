import type { DomainMessage } from './nextmux-domain-errors';

export const desktopStatusEnglish = {
    "DESKTOP_OPERATION_FAILED": "The operation could not be completed. Please try again.",
    "DESKTOP_DETAILS": "Details",
    "GIT_UNAVAILABLE": "Git is currently unavailable.",
    "GIT_NOT_FOUND": "Git was not found. Install it and check again.",
    "GIT_NOT_REPOSITORY": "This project is not a Git repository.",
    "GIT_CLEAN": "Working tree is clean.",
    "GIT_CHANGES": "Local changes: {count}",
    "SITE_SCRIPTS": "Runnable scripts: {count}",
    "SITE_NO_SCRIPTS": "No runnable web scripts were detected.",
    "CREDENTIAL_LOCAL": "Local service · no key required",
    "CREDENTIAL_ENVIRONMENT": "System environment credentials",
    "CREDENTIAL_SAVED": "Securely saved",
    "API_KEY_LABEL": "API key",
    "SCHEDULE_INTERRUPTED": "The last run was interrupted. Open its conversation to recover.",
    "SCHEDULE_ALREADY_CLAIMED": "This occurrence already started or was interrupted. Check its history; it will not be sent again.",
    "SCHEDULE_RUNNING_STATUS": "Running",
    "SCHEDULE_COMPLETE": "The last run completed.",
    "SCHEDULE_FAILED": "The scheduled task could not be completed. Open its conversation for details.",
    "SCHEDULE_RETRY": "The task has not started yet and will retry automatically.",
    "SCHEDULE_STOPPED": "Task stopped",
    "SCHEDULE_WAITING": "Waiting to run",
    "SCHEDULE_PAUSED": "Paused",
    "INVALID_SITE_SCRIPT": "The site script name is invalid.",
    "SITE_SCRIPT_NOT_FOUND": "The project does not contain this site script.",
    "SITE_START_FAILED": "The site script could not be started.",
    "INVALID_SITE_PROCESS": "The site process identifier is invalid.",
    "SITE_PROCESS_NOT_FOUND": "The site process no longer exists."
} as const;
export type DesktopStatusCode = keyof typeof desktopStatusEnglish;
export function desktopStatus(code: DesktopStatusCode, params?: DomainMessage['params']): DomainMessage {
    return { code, fallbackEnglish: desktopStatusEnglish[code], ...(params ? { params } : {}) };
}
