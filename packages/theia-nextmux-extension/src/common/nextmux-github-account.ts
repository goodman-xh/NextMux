/**
 * The GitHub account a user links in Settings → Account so the AI can push commits, open pull
 * requests and work with issues for them. The token stays in the OS keychain on this computer;
 * the interface only ever sees the account name.
 */

export type GitHubTokenKind = 'classic' | 'fine-grained' | 'oauth';

export interface GitHubAccountState {
    readonly connected: boolean;
    readonly login?: string;
    readonly name?: string;
    readonly avatarUrl?: string;
    readonly profileUrl?: string;
    readonly tokenKind?: GitHubTokenKind;
    /** Classic tokens report their scopes; fine-grained tokens are limited per repository instead. */
    readonly scopes?: readonly string[];
    readonly connectedAt?: string;
    /** AI tasks may use the account: github.* tools always, git push and gh only in full access. */
    readonly allowAgent: boolean;
}

export const GITHUB_TOKEN_PATTERN = /^(?:gh[pousr]_[A-Za-z0-9]{30,251}|github_pat_[A-Za-z0-9_]{40,251})$/;
/** Fine-grained token page; the user picks repositories and permissions there. */
export const GITHUB_FINE_GRAINED_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
/** Classic token page with the scopes git push, pull requests and Actions need already ticked. */
export const GITHUB_CLASSIC_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,workflow,read:org&description=NextMux';

export function githubTokenKind(token: string): GitHubTokenKind | undefined {
    const value = token.trim();
    if (!GITHUB_TOKEN_PATTERN.test(value)) return undefined;
    return value.startsWith('github_pat_') ? 'fine-grained' : value.startsWith('ghp_') ? 'classic' : 'oauth';
}
