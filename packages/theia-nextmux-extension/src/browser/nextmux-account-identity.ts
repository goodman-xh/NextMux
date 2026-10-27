export interface DesktopAccountIdentity {
    readonly displayName?: string;
    readonly email?: string;
}

const PLACEHOLDER_IDENTITIES = new Set([
    'account',
    'account connected',
    'status',
    'status label',
    'user',
    '账户',
    '账户已连接',
    '状态',
    '状态标签'
]);

function normalizedIdentity(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function emailIdentity(value: string): string {
    const email = value.trim();
    if (!email) return '';
    const local = email.split('@', 1)[0]?.trim();
    return local || email;
}

/**
 * Produces the single identity shown in the compact account dock.
 *
 * Older QA accounts could persist presentation placeholders such as
 * "status label" as the profile name. Those strings are not identities and
 * should never leak into the consumer UI; use the stable email local part
 * until the user chooses a real display name.
 */
export function desktopAccountIdentity(
    linked: boolean,
    user: DesktopAccountIdentity | undefined,
    signedOutLabel: string
): string {
    if (!linked) return signedOutLabel;
    const displayName = user?.displayName?.trim() || '';
    if (displayName && !PLACEHOLDER_IDENTITIES.has(normalizedIdentity(displayName))) return displayName;
    return emailIdentity(user?.email || '') || signedOutLabel;
}
