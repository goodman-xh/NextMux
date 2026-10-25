import { DesktopDomainError, type DomainMessage } from './nextmux-domain-errors';

/** Precise, locale-neutral reasons for Skills, source catalogs, GitHub and stock media. */
export const SKILL_DOMAIN_ENGLISH = {
    "SKILL_TASK_LIMIT": "Load at most {limit} Skills per task.",
    "SKILL_DUPLICATE_NAME": "Duplicate Skill name: {name}.",
    "SKILL_TOTAL_INSTRUCTIONS_LIMIT": "Combined Skill instructions must not exceed {limit} characters.",
    "SKILL_TASK_NOT_FOUND": "The requested Skill is not available for this task.",

    "STOCK_NETWORK_FAILED": "Cannot connect to the stock media service. Check your network and retry.",
    "SKILL_URL_INVALID": "Invalid Skill link.",
    "SKILL_URL_HTTPS_REQUIRED": "Skill links must use HTTPS.",
    "SKILL_URL_UNSUPPORTED": "Enter a catalogued GitHub Skill folder or SKILL.md link.",
    "SKILL_URL_TARGET_INVALID": "The link must point to a Skill folder or SKILL.md.",
    "SKILL_LINK_NOT_CATALOGUED": "This link is not in the verified Skills catalog. Refresh the catalog.",
    "SKILL_ID_INVALID": "Invalid Skill identifier.",
    "SKILL_NOT_FOUND": "This Skill is not in the community catalog.",
    "SKILL_SOURCE_NOT_FOUND": "The Skill source is unavailable.",
    "SKILL_SOURCE_UNPINNED": "The Skill has no verifiable pinned source. Refresh the catalog.",
    "SKILL_TREE_INCOMPLETE": "The Skill directory is incomplete.",
    "SKILL_TREE_MISMATCH": "The Skill directory revision does not match its pinned source.",
    "SKILL_ENTRY_MISSING": "The Skill source is missing SKILL.md.",
    "SKILL_FILE_COUNT_EXCEEDED": "The Skill has too many files.",
    "SKILL_PACKAGE_FILE_TOO_LARGE": "A Skill package file exceeds 10 MB.",
    "SKILL_PACKAGE_TOO_LARGE": "The Skill package exceeds 25 MB.",
    "SKILL_INSTALL_PATH_UNSAFE": "The Skill install location must be a real directory, not a symbolic link.",
    "SKILL_NAME_INVALID": "Skill names use up to 64 lowercase letters, digits and hyphens.",
    "SKILL_METADATA_MISMATCH": "The SKILL.md name or description does not match the directory.",
    "SKILL_UPDATE_REVIEW_REQUIRED": "The Skill permissions changed or could not be verified. Review the pinned revision before installing.",
    "SKILL_UPDATE_REVIEW_STALE": "The Skill source or installed contents changed. Refresh and review again.",
    "SKILL_REMOVE_PATH_UNSAFE": "A symbolic-link Skill directory cannot be removed.",
    "SKILL_MANIFEST_MISMATCH": "The Skill installation record does not match.",
    "SKILL_INSTALL_OCCUPIED": "The Skill installation directory contains unrelated content.",
    "SKILL_PATH_ESCAPE": "The Skill path leaves its permitted directory.",
    "SKILL_REVISION_INVALID": "Invalid Skill source revision.",
    "SKILL_CATALOG_INVALID": "Invalid community Skills catalog format.",
    "SKILL_OPERATION_BUSY": "Wait for the current Skill operation to finish.",
    "SKILL_PATH_UNSAFE": "The Skill contains an unsafe or incompatible file path.",
    "SKILL_FILE_IDENTITY_INVALID": "The Skill contains a symbolic link, submodule or invalid file identity.",
    "SKILL_FILE_COLLISION": "Skill file names collide by case or Unicode normalization.",
    "SKILL_DIRECTORY_COLLISION": "Skill directory names collide by case or Unicode normalization.",
    "SKILL_FILE_DIRECTORY_COLLISION": "A Skill file name conflicts with a directory name.",
    "SKILL_HASH_MISMATCH": "The Skill file hash does not match its pinned source.",
    "SKILL_BODY_TOO_LARGE": "The Skill file exceeds {limitBytes} bytes.",
    "SKILL_DESCRIPTION_INVALID": "Skill description must contain 1–1024 characters without NUL.",
    "SKILL_INSTRUCTIONS_INVALID": "Skill instructions must contain 1–60000 characters without NUL.",
    "SKILL_SOURCE_TOO_LARGE": "Skill source must be at most 64 KiB.",
    "SKILL_UTF8_INVALID": "Skill source must be valid UTF-8.",
    "SKILL_NUL_INVALID": "Skill source must not contain NUL.",
    "SKILL_YAML_INVALID": "Skill requires a valid YAML name and description.",
    "SKILL_NAME_MISMATCH": "The Skill name must match its directory and selected name.",
    "SKILL_TOOL_DECLARATIONS_CONFLICT": "Conflicting Skill tool declarations.",
    "SKILL_TOOLS_INVALID": "Skill tools must be an array of up to 64 exact NextMux tool IDs.",
    "SKILL_REFERENCE_INVALID": "Select a Skill with a current file path and SHA-256 snapshot.",
    "SKILL_SOURCE_UNAPPROVED": "The Skill source is outside the workspace and approved global Skill directories.",
    "SKILL_SOURCE_NOT_FILE": "The Skill source must be a regular file.",
    "SKILL_SOURCE_CHANGED": "The Skill source changed. Select the refreshed Skill before running.",
    "GITHUB_TOKEN_FORMAT": "That is not a GitHub token. It should start with github_pat_ or ghp_.",
    "GITHUB_UNREACHABLE": "Can’t reach GitHub. Check your network and try again.",
    "GITHUB_TOKEN_INVALID": "The token is invalid or expired. Create a new one on GitHub.",
    "GITHUB_RATE_LIMITED": "GitHub is limiting requests right now. Try again later.",
    "GITHUB_UNAVAILABLE": "GitHub is unavailable right now. Try again later.",
    "GITHUB_ACCOUNT_INVALID": "GitHub returned invalid account information.",
    "SKILL_DIRECTORY_UNREACHABLE": "The Skills directory could not be reached. Check your network or proxy and refresh.",
    "SKILL_REVISION_MISSING": "GitHub did not return a pinned revision.",
    "SKILL_DIRECTORY_VERSION_MISSING": "The Skill has no directory revision.",
    "SKILL_CATALOG_UNAVAILABLE": "Community Skills are temporarily unavailable.",
    "SKILL_CATALOG_CACHED": "Showing the cached community Skills catalog.",
    "SKILL_CATALOG_SYNCED": "Synced {count} community Skills.",
    "SKILL_CATALOG_PARTIAL": "Could not refresh {count} sources.",
    "SKILL_DEFAULT_DESCRIPTION": "{name} Skill from the community catalog.",
    "SKILL_DOWNLOAD_HTTP": "Skill file download failed (HTTP {status}).",
    "MCP_CATALOG_HTTP": "MCP catalog is unavailable (HTTP {status}).",
    "MCP_CATALOG_TIMEOUT": "MCP catalog connection timed out.",
    "MCP_CATALOG_UNAVAILABLE": "The MCP catalog is temporarily unavailable.",
    "STOCK_KEY_REJECTED": "{provider} API key is invalid.",
    "STOCK_RATE_LIMITED": "{provider} rate limit reached. Try again later.",
    "STOCK_HTTP_UNAVAILABLE": "{provider} is unavailable (HTTP {status}).",
    "STOCK_RESPONSE_INVALID": "The stock media service returned invalid data.",
    "STOCK_DOWNLOAD_URL_INVALID": "The stock media service returned an unrecognized download URL.",
    "STOCK_DOWNLOAD_FAILED": "Stock media download failed (HTTP {status}).",
    "STOCK_FILE_TOO_LARGE": "The stock media file exceeds 300 MB."
} as const;
export type SkillDomainCode = keyof typeof SKILL_DOMAIN_ENGLISH;
export type SkillDomainParams = NonNullable<DomainMessage['params']>;

export function skillDomainDescriptor(code: SkillDomainCode, params?: SkillDomainParams, technicalDetails?: string): DomainMessage {
    const fallbackEnglish = SKILL_DOMAIN_ENGLISH[code].replace(/\{(\w+)\}/g, (placeholder, key: string) =>
        params?.[key] === undefined ? placeholder : String(params[key]));
    return { code, fallbackEnglish, ...(params ? { params } : {}), ...(technicalDetails ? { technicalDetails } : {}) };
}

export class SkillDomainError extends DesktopDomainError {
    constructor(code: SkillDomainCode, params?: SkillDomainParams, technicalDetails?: string) {
        const message = skillDomainDescriptor(code, params, technicalDetails);
        super(code, message.fallbackEnglish, params, technicalDetails);
    }
}
