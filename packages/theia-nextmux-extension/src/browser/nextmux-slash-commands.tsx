import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { localizeDesktopSurface } from './nextmux-surface-locale';

export type ComposerSlashGroupId = 'context' | 'workflow' | 'shortcut' | 'skills';

export type ComposerSlashCommandKind =
    | 'compact'
    | 'new'
    | 'undo'
    | 'review'
    | 'init'
    | 'commit'
    | 'plan'
    | 'goal'
    | 'council'
    | 'app'
    | 'model'
    | 'relay'
    | 'permissions'
    | 'mcp'
    | 'skill';

export interface ComposerSlashSkillInfo {
    readonly name: string;
    readonly description?: string;
    readonly location?: string;
}

export interface ComposerSlashContextState {
    readonly locale: NextMuxDesktopLocale;
    readonly hasActiveSession: boolean;
    readonly completedTurnCount: number;
    readonly isCompacting: boolean;
    readonly agentRunning: boolean;
    readonly hasRestorableTurn: boolean;
    readonly appControlAvailable: boolean;
    readonly composerAppPicking?: boolean;
    readonly councilActiveOrPending: boolean;
    readonly councilDisabledNotice?: string;
    readonly skills: readonly ComposerSlashSkillInfo[];
}

export interface ComposerSlashCommandItem {
    readonly id: string;
    readonly kind: ComposerSlashCommandKind;
    readonly group: ComposerSlashGroupId;
    /** Slash slug without leading `/`, e.g. `compact`, `review`, `my-skill`. */
    readonly slug: string;
    readonly title: string;
    readonly description: string;
    readonly icon: string;
    readonly argHint?: string;
    readonly badge?: string;
    /** True when selecting with empty trailing draft inserts `/<slug> ` for user input instead of firing immediately. */
    readonly requiresTaskInput?: boolean;
    /** True when `Tab` inserts `/<slug> ` so user can append optional arguments before submitting. */
    readonly acceptsArgs?: boolean;
    readonly disabled?: boolean;
    readonly disabledReason?: string;
    readonly keywords: readonly string[];
    readonly skillName?: string;
}

export interface ComposerSlashMatch {
    readonly slashIndex: number;
    readonly endIndex: number;
    readonly query: string;
    readonly token: string;
}

export interface CompetingComposerSurfaces {
    readonly codingPopover?: string;
    readonly appControlPickerOpen?: boolean;
    readonly accountMenuOpen?: boolean;
    readonly goalDrawer?: boolean;
    readonly goalCloseConfirmation?: boolean;
    readonly walletTopupSheetOpen?: boolean;
    readonly officialProviderSheet?: boolean;
    readonly officialModelListOpenId?: string;
    readonly myApisOpen?: boolean;
    readonly councilConfigModalOpen?: boolean;
    readonly scheduleDialogOpen?: boolean;
    readonly fullAccessConfirmationOpen?: boolean;
    readonly pendingDurableRetry?: boolean;
    readonly pendingRestoreConfirmation?: boolean;
    readonly pendingIncognitoMode?: boolean;
    readonly pendingRelaySwitch?: boolean;
    readonly selectedOffering?: boolean;
    readonly activeCheckpointDiff?: boolean;
    readonly appPluginChatPicker?: boolean;
    readonly appPluginStart?: boolean;
    readonly appPluginHub?: boolean;
    readonly codingSearchOpen?: boolean;
    readonly pendingTurnEdit?: boolean;
}

const BUILTIN_SLASH_SLUGS = new Set([
    'compact', 'new', 'undo',
    'review', 'init', 'commit', 'plan',
    'goal', 'council', 'app', 'model', 'relay', 'permissions',
    'mcp'
]);

const SLASH_TRIGGER_BEFORE_CARET = /(?:^|\s)\/([\p{L}\p{N}_.:-]*)$/u;

function pickLocaleCopy(locale: NextMuxDesktopLocale, zhCN: string, zhTW: string, en: string): string {
    if (locale === 'zh-CN') return zhCN;
    if (locale === 'zh-TW') return zhTW;
    if (locale === 'en') return en;
    const translated = localizeDesktopSurface(locale, zhCN);
    return translated && translated !== zhCN ? translated : en;
}

export function slashGroupLabel(locale: NextMuxDesktopLocale, group: ComposerSlashGroupId): string {
    switch (group) {
        case 'context':
            return pickLocaleCopy(locale, '上下文与会话', '上下文與會話', 'Context & Session');
        case 'workflow':
            return pickLocaleCopy(locale, '研发高频动作', '研發高頻動作', 'Engineering Workflows');
        case 'shortcut':
            return pickLocaleCopy(locale, 'NextMux 快捷入口', 'NextMux 快捷入口', 'NextMux Shortcuts');
        case 'skills':
            return pickLocaleCopy(locale, '技能与扩展', '技能與擴充', 'Skills & MCP');
    }
}

export function slashFooterHint(locale: NextMuxDesktopLocale): string {
    return pickLocaleCopy(
        locale,
        '↑↓ 选择 · Tab 补全 · ↵ 执行 · Esc 关闭',
        '↑↓ 選擇 · Tab 補全 · ↵ 執行 · Esc 關閉',
        '↑↓ Navigate · Tab Complete · ↵ Run · Esc Dismiss'
    );
}

export function normalizeSkillSlashSlug(rawName: string): string {
    const cleaned = String(rawName || '')
        .trim()
        .replace(/^\/+/, '')
        .replace(/\s+/gu, '-')
        .replace(/[^\p{L}\p{N}_.:-]/gu, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!cleaned) return '';
    const lower = cleaned.toLowerCase();
    return BUILTIN_SLASH_SLUGS.has(lower) ? `${cleaned}-skill` : cleaned;
}

export interface ResolvedComposerSlashSkill {
    readonly slug: string;
    readonly skill: ComposerSlashSkillInfo;
}

/**
 * Shared skill-to-slash-slug resolver used by BOTH `buildComposerSlashCommands` and
 * `expandComposerSlashSubmission` so built-in commands (`/review`, `/mcp`, etc.) can
 * never be hijacked by same-named skills (`-> /review-skill`) and duplicate skill names
 * deterministically receive `-2`, `-3` suffixes across both menu rendering and execution.
 */
export function resolveComposerSlashSkills(
    skills: readonly ComposerSlashSkillInfo[] = []
): readonly ResolvedComposerSlashSkill[] {
    const seenSlugs = new Set<string>(BUILTIN_SLASH_SLUGS);
    const resolved: ResolvedComposerSlashSkill[] = [];
    for (const skill of skills || []) {
        const baseSlug = normalizeSkillSlashSlug(skill.name);
        if (!baseSlug) continue;
        let slug = baseSlug;
        let suffix = 2;
        while (seenSlugs.has(slug.toLowerCase())) {
            slug = `${baseSlug}-${suffix++}`;
        }
        seenSlugs.add(slug.toLowerCase());
        resolved.push({ slug, skill });
    }
    return resolved;
}

/**
 * Matches `/` at the collapsed caret ONLY when:
 * 1. Not IME-composing (`composing === false`).
 * 2. Selection is collapsed (`selectionStart === selectionEnd`).
 * 3. `/` is at index `0` or immediately preceded by whitespace.
 * 4. The contiguous non-whitespace word containing `/` has NO additional `/` or `\`
 *    (so file paths like `/Users/xuhao/a.ts` or URLs like `https://nextmux.app` never trigger).
 */
export function matchComposerSlashTrigger(
    text: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
    composing: boolean
): ComposerSlashMatch | undefined {
    if (composing || typeof text !== 'string') return undefined;
    const start = selectionStart ?? text.length;
    const end = selectionEnd ?? start;
    if (start !== end || start < 0 || start > text.length) return undefined;

    const beforeCaret = text.slice(0, start);
    const match = SLASH_TRIGGER_BEFORE_CARET.exec(beforeCaret);
    if (!match) return undefined;

    const query = match[1] || '';
    const slashIndex = start - query.length - 1;
    if (slashIndex < 0 || text[slashIndex] !== '/') return undefined;

    let wordEnd = start;
    while (wordEnd < text.length && !/\s/u.test(text[wordEnd])) {
        wordEnd++;
    }
    const afterSlashWord = text.slice(slashIndex + 1, wordEnd);
    if (afterSlashWord.includes('/') || afterSlashWord.includes('\\') || !/^[\p{L}\p{N}_.:-]*$/u.test(afterSlashWord)) {
        return undefined;
    }
    if (wordEnd > start) {
        return undefined;
    }

    return {
        slashIndex,
        endIndex: start,
        query,
        token: text.slice(slashIndex, start)
    };
}

/** Removes the matched `/command` token cleanly while preserving surrounding user text and caret position. */
export function removeComposerSlashToken(
    text: string,
    match: Pick<ComposerSlashMatch, 'slashIndex' | 'endIndex'>
): { readonly value: string; readonly caret: number } {
    const before = text.slice(0, match.slashIndex);
    const after = text.slice(match.endIndex);
    if (!before) {
        const trimmedAfter = after.replace(/^[ \t]+/, '');
        return { value: trimmedAfter, caret: 0 };
    }
    if (/[ \t]$/u.test(before) && /^[ \t]/u.test(after)) {
        const nextAfter = after.replace(/^[ \t]+/, '');
        return { value: before + nextAfter, caret: before.length };
    }
    if (!after && /[ \t]$/u.test(before)) {
        const trimmedBefore = before.replace(/[ \t]+$/u, '');
        return { value: trimmedBefore, caret: trimmedBefore.length };
    }
    return { value: before + after, caret: before.length };
}

/** Replaces the matched `/query` token with `/<slug> ` for Tab completion or task-input commands. */
export function replaceComposerSlashToken(
    text: string,
    match: Pick<ComposerSlashMatch, 'slashIndex' | 'endIndex'>,
    slug: string,
    trailingSpace = true
): { readonly value: string; readonly caret: number } {
    const before = text.slice(0, match.slashIndex);
    const after = text.slice(match.endIndex);
    const needsSpace = trailingSpace && (!after || !/^\s/u.test(after));
    const inserted = `/${slug}${needsSpace ? ' ' : ''}`;
    const nextCaret = before.length + inserted.length + (!needsSpace && trailingSpace && after.startsWith(' ') ? 1 : 0);
    return {
        value: before + inserted + after,
        caret: Math.min((before + inserted + after).length, nextCaret)
    };
}

export function isSlashDrawerSuppressedByCompetingSurface(surfaces: CompetingComposerSurfaces): boolean {
    return Boolean(
        surfaces.codingPopover
        || surfaces.appControlPickerOpen
        || surfaces.accountMenuOpen
        || surfaces.goalDrawer
        || surfaces.goalCloseConfirmation
        || surfaces.walletTopupSheetOpen
        || surfaces.officialProviderSheet
        || surfaces.officialModelListOpenId
        || surfaces.myApisOpen
        || surfaces.councilConfigModalOpen
        || surfaces.scheduleDialogOpen
        || surfaces.fullAccessConfirmationOpen
        || surfaces.pendingDurableRetry
        || surfaces.pendingRestoreConfirmation
        || surfaces.pendingIncognitoMode
        || surfaces.pendingRelaySwitch
        || surfaces.selectedOffering
        || surfaces.activeCheckpointDiff
        || surfaces.appPluginChatPicker
        || surfaces.appPluginStart
        || surfaces.appPluginHub
        || surfaces.codingSearchOpen
        || surfaces.pendingTurnEdit
    );
}

export function buildComposerSlashCommands(state: ComposerSlashContextState): readonly ComposerSlashCommandItem[] {
    const { locale } = state;
    const compactDisabledReason = state.agentRunning
        ? pickLocaleCopy(locale, '对话运行中，完成后再压缩', '對話運行中，完成後再壓縮', 'Wait for current run to finish')
        : state.isCompacting
            ? pickLocaleCopy(locale, '正在压缩上下文…', '正在壓縮上下文…', 'Compacting context…')
            : (!state.hasActiveSession || state.completedTurnCount < 2)
                ? pickLocaleCopy(locale, '至少完成 2 轮对话后可压缩', '至少完成 2 輪對話後可壓縮', 'Requires at least 2 completed turns')
                : undefined;

    const undoDisabledReason = state.agentRunning
        ? pickLocaleCopy(locale, '对话运行中暂不可撤回', '對話運行中暫不可撤回', 'Cannot undo while agent is running')
        : !state.hasRestorableTurn
            ? pickLocaleCopy(locale, '暂无可撤回的文件改动', '暫無可撤回的檔案改動', 'No restorable file changes yet')
            : undefined;

    const councilLockedReason = state.councilActiveOrPending
        ? (state.councilDisabledNotice || pickLocaleCopy(locale, '议会模式启用中，请在议会配置中调整', '議會模式啟用中，請在議會配置中調整', 'Locked while Council Mode is active'))
        : undefined;

    const items: ComposerSlashCommandItem[] = [
        // Group 1 — Context & Session
        {
            id: 'cmd:compact',
            kind: 'compact',
            group: 'context',
            slug: 'compact',
            title: pickLocaleCopy(locale, '压缩上下文', '壓縮上下文', 'Compact Context'),
            description: pickLocaleCopy(
                locale,
                '精炼早期对话历史，保留核心目标、文件改动与关键决策以释放上下文窗口',
                '精煉早期對話歷史，保留核心目標、檔案改動與關鍵決策以釋放上下文視窗',
                'Summarize older turns while keeping goals, file changes, and key decisions'
            ),
            icon: 'fold',
            disabled: Boolean(compactDisabledReason),
            disabledReason: compactDisabledReason,
            keywords: ['compact', 'compress', 'context', 'summary', '压缩', '精简', '上下文', '总结', '壓縮']
        },
        {
            id: 'cmd:new',
            kind: 'new',
            group: 'context',
            slug: 'new',
            title: pickLocaleCopy(locale, '新建对话', '新建對話', 'New Conversation'),
            description: pickLocaleCopy(
                locale,
                '在当前项目工作区立即创建并切换到全新对话',
                '在當前專案工作區立即建立並切換到全新對話',
                'Create and switch to a clean new conversation in the current workspace'
            ),
            icon: 'comment-discussion',
            keywords: ['new', 'clear', 'fresh', 'session', 'chat', '新建', '新对话', '清空', '開啟新對話']
        },
        {
            id: 'cmd:undo',
            kind: 'undo',
            group: 'context',
            slug: 'undo',
            title: pickLocaleCopy(locale, '撤回上轮改动', '撤回上輪改動', 'Undo Last Turn Changes'),
            description: pickLocaleCopy(
                locale,
                '打开最近一轮代码检查点恢复确认，安全回滚本轮修改的文件',
                '開啟最近一輪程式碼檢查點恢復確認，安全回滾本輪修改的檔案',
                'Open checkpoint restore confirmation for the latest restorable turn'
            ),
            icon: 'discard',
            disabled: Boolean(undoDisabledReason),
            disabledReason: undoDisabledReason,
            keywords: ['undo', 'revert', 'restore', 'rollback', 'checkpoint', '撤回', '撤销', '回滚', '恢复', '還原']
        },

        // Group 2 — Engineering Workflows
        {
            id: 'cmd:review',
            kind: 'review',
            group: 'workflow',
            slug: 'review',
            title: pickLocaleCopy(locale, '代码审查', '程式碼審查', 'Code Review'),
            description: pickLocaleCopy(
                locale,
                '只读检查未提交的 git status 与 git diff，排查缺陷、回归与安全隐患',
                '唯讀檢查未提交的 git status 與 git diff，排查缺陷、回歸與安全隱患',
                'Read-only inspection of uncommitted git status & diff for bugs, regressions, and risks'
            ),
            icon: 'eye',
            argHint: pickLocaleCopy(locale, '[审查重点]', '[審查重點]', '[focus]'),
            acceptsArgs: true,
            keywords: ['review', 'diff', 'audit', 'bug', 'security', '审查', '代码审查', '检视', '走查', '審查']
        },
        {
            id: 'cmd:init',
            kind: 'init',
            group: 'workflow',
            slug: 'init',
            title: pickLocaleCopy(locale, '生成 AGENTS.md', '生成 AGENTS.md', 'Generate AGENTS.md'),
            description: pickLocaleCopy(
                locale,
                '分析仓库目录、构建测试命令与架构约定，创建或更新 AGENTS.md',
                '分析倉庫目錄、建置測試命令與架構約定，建立或更新 AGENTS.md',
                'Inspect repository layout, build/test scripts, and conventions to create or update AGENTS.md'
            ),
            icon: 'book',
            argHint: pickLocaleCopy(locale, '[补充说明]', '[補充說明]', '[notes]'),
            acceptsArgs: true,
            keywords: ['init', 'agents', 'agents.md', 'onboarding', 'guide', '初始化', '生成', '规范', '文档']
        },
        {
            id: 'cmd:commit',
            kind: 'commit',
            group: 'workflow',
            slug: 'commit',
            title: pickLocaleCopy(locale, '提交代码', '提交程式碼', 'Commit Changes'),
            description: pickLocaleCopy(
                locale,
                '核查 git status 与 diff，确认无密钥泄漏后生成规范提交信息并执行 git commit',
                '核查 git status 與 diff，確認無金鑰洩漏後生成規範提交訊息並執行 git commit',
                'Verify git status & diff for safety, craft a conventional message, and run git commit'
            ),
            icon: 'git-commit',
            argHint: pickLocaleCopy(locale, '[提交备注]', '[提交備註]', '[message]'),
            acceptsArgs: true,
            keywords: ['commit', 'git', 'save', '提交', '提交代码', '版本']
        },
        {
            id: 'cmd:plan',
            kind: 'plan',
            group: 'workflow',
            slug: 'plan',
            title: pickLocaleCopy(locale, '先出方案', '先出方案', 'Plan First'),
            description: pickLocaleCopy(
                locale,
                '先深入调研代码并输出分步架构与改动计划，未经您确认绝不修改文件',
                '先深入調研程式碼並輸出分步架構與改動計劃，未經您確認絕不修改檔案',
                'Inspect codebase and output a concrete step-by-step plan first before editing any files'
            ),
            icon: 'list-tree',
            argHint: pickLocaleCopy(locale, '<任务描述>', '<任務描述>', '<task>'),
            acceptsArgs: true,
            requiresTaskInput: true,
            keywords: ['plan', 'design', 'architect', 'spec', '方案', '计划', '规划', '设计', '先出方案', '規劃']
        },

        // Group 3 — NextMux Shortcuts
        {
            id: 'cmd:goal',
            kind: 'goal',
            group: 'shortcut',
            slug: 'goal',
            title: pickLocaleCopy(locale, '持续目标', '持續目標', 'Persistent Goal'),
            description: pickLocaleCopy(
                locale,
                '打开持续目标输入栏，让智能体围绕目标多轮推进直至达成',
                '開啟持續目標輸入欄，讓智慧體圍繞目標多輪推進直至達成',
                'Open the Persistent Goal bar for autonomous multi-turn execution'
            ),
            icon: 'target',
            keywords: ['goal', 'autonomous', 'target', 'loop', '目标', '持续目标', '长期任务', '目標']
        },
        {
            id: 'cmd:council',
            kind: 'council',
            group: 'shortcut',
            slug: 'council',
            title: pickLocaleCopy(locale, '议会模式', '議會模式', 'Council Mode'),
            description: pickLocaleCopy(
                locale,
                '配置多模型专家角色协作（臭皮匠模式）',
                '配置多模型專家角色協作（臭皮匠模式）',
                'Configure multi-model specialist collaboration (Council Mode)'
            ),
            icon: 'organization',
            keywords: ['council', 'team', 'multi-agent', 'specialists', '议会', '臭皮匠', '多模型', '团队', '議會']
        },
        ...(state.appControlAvailable ? [{
            id: 'cmd:app',
            kind: 'app' as const,
            group: 'shortcut' as const,
            slug: 'app',
            title: pickLocaleCopy(locale, '操控电脑应用', '操控電腦應用', 'Control Desktop App'),
            description: pickLocaleCopy(
                locale,
                '选择本机运行中的应用窗口，授权当前对话协同查看与操控',
                '選擇本機運行中的應用視窗，授權當前對話協同查看與操控',
                'Pick a desktop application window for live inspection and control'
            ),
            icon: 'window',
            disabled: Boolean(state.composerAppPicking),
            disabledReason: state.composerAppPicking
                ? pickLocaleCopy(locale, '正在读取窗口列表…', '正在讀取視窗列表…', 'Loading application windows…')
                : undefined,
            keywords: ['app', 'window', 'desktop', 'control', '应用', '窗口', '操控', '电脑应用', '應用']
        }] : []),
        {
            id: 'cmd:model',
            kind: 'model',
            group: 'shortcut',
            slug: 'model',
            title: pickLocaleCopy(locale, '切换模型', '切換模型', 'Switch Model'),
            description: pickLocaleCopy(
                locale,
                '打开主输入框模型选择抽屉',
                '開啟主輸入框模型選擇抽屜',
                'Open the main composer Model Picker drawer'
            ),
            icon: 'zap',
            disabled: Boolean(councilLockedReason),
            disabledReason: councilLockedReason,
            keywords: ['model', 'llm', 'switch', 'route', '模型', '切换模型', '选模型', '切換模型']
        },
        {
            id: 'cmd:relay',
            kind: 'relay',
            group: 'shortcut',
            slug: 'relay',
            title: pickLocaleCopy(locale, '切换中转商', '切換中轉商', 'Switch Relay / Own API'),
            description: pickLocaleCopy(
                locale,
                '打开中转商与自有 API 选择抽屉',
                '開啟中轉商與自有 API 選擇抽屜',
                'Open the Relay Merchant & Own-API selector drawer'
            ),
            icon: 'server-environment',
            disabled: Boolean(councilLockedReason),
            disabledReason: councilLockedReason,
            keywords: ['relay', 'provider', 'merchant', 'api', 'byok', '中转', '中转商', '自有api', '渠道', '切換中轉商']
        },
        {
            id: 'cmd:permissions',
            kind: 'permissions',
            group: 'shortcut',
            slug: 'permissions',
            title: pickLocaleCopy(locale, '切换权限', '切換權限', 'Tool Permissions'),
            description: pickLocaleCopy(
                locale,
                '调整当前对话的只读、工作区写入或完全访问权限档位',
                '調整當前對話的唯讀、工作區寫入或完全存取權限檔位',
                'Switch between read-only, workspace-write, and full-access permissions'
            ),
            icon: 'shield',
            keywords: ['permissions', 'permission', 'access', 'sandbox', 'security', '权限', '切换权限', '沙盒', '完全访问', '權限']
        },

        // Group 4 — Skills & MCP
        {
            id: 'cmd:mcp',
            kind: 'mcp',
            group: 'skills',
            slug: 'mcp',
            title: pickLocaleCopy(locale, '管理 MCP 服务', '管理 MCP 服務', 'Manage MCP Servers'),
            description: pickLocaleCopy(
                locale,
                '前往设置中心查看、添加或配置 MCP 工具服务',
                '前往設定中心查看、新增或配置 MCP 工具服務',
                'Open Settings → MCP to configure and inspect MCP servers'
            ),
            icon: 'plug',
            keywords: ['mcp', 'tools', 'server', 'extension', '服务', '工具', '扩展', '管理mcp']
        }
    ];

    for (const { slug, skill } of resolveComposerSlashSkills(state.skills)) {
        const summary = (skill.description || '').replace(/\s+/g, ' ').trim()
            || pickLocaleCopy(locale, `启用已安装技能 ${skill.name}`, `啟用已安裝技能 ${skill.name}`, `Apply installed skill ${skill.name}`);
        items.push({
            id: `skill:${skill.location || `${skill.name}:${slug}`}`,
            kind: 'skill',
            group: 'skills',
            slug,
            title: skill.name,
            description: summary,
            icon: 'sparkle',
            argHint: pickLocaleCopy(locale, '[任务说明]', '[任務說明]', '[task]'),
            badge: 'SKILL',
            acceptsArgs: true,
            requiresTaskInput: true,
            skillName: skill.name,
            keywords: [slug, skill.name, summary, 'skill', '技能']
        });
    }

    return items;
}

export function filterComposerSlashCommands(
    commands: readonly ComposerSlashCommandItem[],
    rawQuery: string
): readonly ComposerSlashCommandItem[] {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return commands;

    const scored: { readonly item: ComposerSlashCommandItem; readonly score: number; readonly index: number }[] = [];
    commands.forEach((item, index) => {
        const slugLower = item.slug.toLowerCase();
        const titleLower = item.title.toLowerCase();
        const descLower = item.description.toLowerCase();
        const kwMatch = item.keywords.some(kw => kw.toLowerCase().includes(query));
        const kwStarts = item.keywords.some(kw => kw.toLowerCase().startsWith(query));

        let score = 0;
        if (slugLower === query || titleLower === query) score = 100;
        else if (slugLower.startsWith(query)) score = 90;
        else if (titleLower.startsWith(query) || kwStarts) score = 80;
        else if (slugLower.includes(query)) score = 70;
        else if (titleLower.includes(query) || kwMatch) score = 60;
        else if (descLower.includes(query)) score = 40;

        if (score > 0) {
            scored.push({ item, score, index });
        }
    });

    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.map(entry => entry.item);
}

export interface ExpandSlashSubmissionOptions {
    readonly hasAttachments?: boolean;
}

export interface ExpandedSlashSubmission {
    readonly matchedCommand?: 'review' | 'init' | 'commit' | 'plan' | 'skill';
    readonly needsTaskInput?: boolean;
    readonly displayPrompt: string;
    readonly modelPrompt: string;
    readonly prioritizedSkillNames: readonly string[];
    readonly prioritizedSkillLocations: readonly string[];
}

const LEADING_APP_CONTROL_MARKERS = /^(?:\[(?:App|NextMux\s*应用操控):[^\n\]]*\](?:\r?\n|$))+/u;

/**
 * Expands workflow slash commands (`/review`, `/init`, `/commit`, `/plan`) and `/<skill>` invocations
 * into crisp, structured engineering directives while keeping `displayPrompt` clean for the chat bubble.
 * Transparently preserves any leading `[App: ...]\n` markers prepended for queued/steered app-control messages.
 */
export function expandComposerSlashSubmission(
    rawPrompt: string,
    skills: readonly ComposerSlashSkillInfo[] = [],
    options?: ExpandSlashSubmissionOptions
): ExpandedSlashSubmission {
    const fullTrimmed = rawPrompt.trim();
    if (!fullTrimmed) {
        return { displayPrompt: '', modelPrompt: '', prioritizedSkillNames: [], prioritizedSkillLocations: [] };
    }

    const markerMatch = LEADING_APP_CONTROL_MARKERS.exec(fullTrimmed);
    const rawMarkerBlock = markerMatch ? markerMatch[0].replace(/\s+$/u, '') : '';
    const trimmed = markerMatch ? fullTrimmed.slice(markerMatch[0].length).trim() : fullTrimmed;
    const withMarkers = (body: string): string => (rawMarkerBlock ? (body ? `${rawMarkerBlock}\n${body}` : rawMarkerBlock) : body);

    if (!trimmed) {
        return {
            displayPrompt: fullTrimmed,
            modelPrompt: fullTrimmed,
            prioritizedSkillNames: [],
            prioritizedSkillLocations: []
        };
    }

    // Map ONLY canonical resolved slugs (`BUILTIN_SLASH_SLUGS`-safe + `-2`/`-3` deduplicated).
    const skillBySlug = new Map<string, ComposerSlashSkillInfo>();
    for (const { slug, skill } of resolveComposerSlashSkills(skills)) {
        skillBySlug.set(slug.toLowerCase(), skill);
    }

    const prioritizedSkillNames: string[] = [];
    const prioritizedSkillLocations: string[] = [];
    const tokenRegex = /(?:^|\s)\/([\p{L}\p{N}_.:-]+)(?=\s|$)/gu;
    let tok: RegExpExecArray | null;
    while ((tok = tokenRegex.exec(trimmed)) !== null) {
        const candidate = skillBySlug.get(tok[1].toLowerCase());
        if (candidate) {
            if (!prioritizedSkillNames.includes(candidate.name)) {
                prioritizedSkillNames.push(candidate.name);
            }
            if (candidate.location && !prioritizedSkillLocations.includes(candidate.location)) {
                prioritizedSkillLocations.push(candidate.location);
            }
        }
    }

    const leadingCmd = /^\/(review|init|commit|plan)(?:\s+([\s\S]*))?$/iu.exec(trimmed);
    const trailingCmd = !leadingCmd ? /^([\s\S]+?)\s+\/(review|init|commit|plan)$/iu.exec(trimmed) : null;
    const effectiveCmd = leadingCmd
        ? { cmd: leadingCmd[1].toLowerCase() as 'review' | 'init' | 'commit' | 'plan', rest: (leadingCmd[2] || '').trim() }
        : trailingCmd
            ? { cmd: trailingCmd[2].toLowerCase() as 'review' | 'init' | 'commit' | 'plan', rest: trailingCmd[1].trim() }
            : undefined;

    if (effectiveCmd) {
        const { cmd, rest } = effectiveCmd;
        if (cmd === 'review') {
            const focusLine = rest ? `\nAdditional review focus from user: ${rest}` : '';
            return {
                matchedCommand: 'review',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers([
                    'Perform a thorough, read-only code review of the uncommitted changes in the current workspace (`git status` and `git diff`, including staged and unstaged changes).',
                    'STRICT RULE: Do NOT modify, create, or delete any files during this review.',
                    'Report only concrete, actionable findings prioritized by severity: correctness bugs, regressions, security/credential risks, race conditions, and missing edge cases, citing exact file paths and line numbers.' + focusLine
                ].join('\n')),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
        if (cmd === 'init') {
            const notesLine = rest ? `\nAdditional instructions from user: ${rest}` : '';
            return {
                matchedCommand: 'init',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers([
                    'Inspect this repository\'s directory layout, package manifests, build/lint/test scripts, and existing architectural conventions, then create or update `AGENTS.md` at the workspace root.',
                    'Keep `AGENTS.md` concise, accurate, and actionable for coding agents: cover workspace structure, exact build & targeted test commands, code style/architecture boundaries, and safety rules. Preserve any critical existing user rules.' + notesLine
                ].join('\n')),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
        if (cmd === 'commit') {
            const msgLine = rest ? `\nUser commit message / note to incorporate: ${rest}` : '';
            return {
                matchedCommand: 'commit',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers([
                    'Inspect `git status` and `git diff` in the current workspace.',
                    'Verify that no secrets, credentials, `.env` files, or broken debug artifacts are included, stage the intended changes cleanly, craft a clear conventional commit message summarizing the why and what, and execute `git commit` (do NOT `git push` unless explicitly requested).' + msgLine
                ].join('\n')),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
        if (cmd === 'plan') {
            if (!rest) {
                if (options?.hasAttachments) {
                    return {
                        matchedCommand: 'plan',
                        displayPrompt: fullTrimmed,
                        modelPrompt: withMarkers([
                            'PLAN-FIRST MODE (STRICT READ-ONLY PHASE):',
                            'Inspect the attached files/images and the relevant files, types, call sites, and architecture in the workspace thoroughly, then present a concrete, step-by-step implementation & verification plan (exact files to change, data flow, edge cases, and test strategy).',
                            'CRITICAL: Do NOT create, edit, or delete any files and do NOT run mutating commands yet — wait for the user to review and confirm the plan first.'
                        ].join('\n')),
                        prioritizedSkillNames,
                        prioritizedSkillLocations
                    };
                }
                return {
                    matchedCommand: 'plan',
                    needsTaskInput: true,
                    displayPrompt: fullTrimmed,
                    modelPrompt: fullTrimmed,
                    prioritizedSkillNames,
                    prioritizedSkillLocations
                };
            }
            return {
                matchedCommand: 'plan',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers([
                    'PLAN-FIRST MODE (STRICT READ-ONLY PHASE):',
                    'Inspect the relevant files, types, call sites, and architecture in the workspace thoroughly, then present a concrete, step-by-step implementation & verification plan (exact files to change, data flow, edge cases, and test strategy).',
                    'CRITICAL: Do NOT create, edit, or delete any files and do NOT run mutating commands yet — wait for the user to review and confirm the plan first.',
                    '',
                    `Task to plan:\n${rest}`
                ].join('\n')),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
    }

    if (prioritizedSkillNames.length > 0) {
        const leadingSkill = /^\/([\p{L}\p{N}_.:-]+)(?:\s+([\s\S]*))?$/u.exec(trimmed);
        if (leadingSkill && skillBySlug.has(leadingSkill[1].toLowerCase()) && !(leadingSkill[2] || '').trim()) {
            const matchedSkill = skillBySlug.get(leadingSkill[1].toLowerCase())!;
            return {
                matchedCommand: 'skill',
                displayPrompt: fullTrimmed,
                modelPrompt: withMarkers(`Apply the installed skill "${matchedSkill.name}" (follow its SKILL.md instructions carefully) in the current workspace.`),
                prioritizedSkillNames,
                prioritizedSkillLocations
            };
        }
        const cleanedBody = leadingSkill && skillBySlug.has(leadingSkill[1].toLowerCase())
            ? (leadingSkill[2] || '').trim()
            : trimmed;
        return {
            matchedCommand: 'skill',
            displayPrompt: fullTrimmed,
            modelPrompt: withMarkers([
                `<explicit-skill-directive>Prioritize and strictly follow the installed SKILL.md instructions for: ${prioritizedSkillNames.map(name => `"${name}"`).join(', ')}.</explicit-skill-directive>`,
                cleanedBody
            ].filter(Boolean).join('\n\n')),
            prioritizedSkillNames,
            prioritizedSkillLocations
        };
    }

    return {
        displayPrompt: fullTrimmed,
        modelPrompt: fullTrimmed,
        prioritizedSkillNames: [],
        prioritizedSkillLocations: []
    };
}

export interface ComposerSlashCommandDrawerPortalProps {
    readonly locale: NextMuxDesktopLocale;
    readonly theme: 'dark' | 'light';
    readonly commands: readonly ComposerSlashCommandItem[];
    readonly activeIndex: number;
    readonly anchorElement?: HTMLElement | null;
    readonly onHoverIndex: (index: number) => void;
    readonly onSelectCommand: (command: ComposerSlashCommandItem) => void;
    readonly onDismiss: () => void;
}

export const ComposerSlashCommandDrawerPortal: React.FC<ComposerSlashCommandDrawerPortalProps> = ({
    locale,
    theme,
    commands,
    activeIndex,
    anchorElement,
    onHoverIndex,
    onSelectCommand,
    onDismiss
}) => {
    const listRef = React.useRef<HTMLDivElement | null>(null);
    const [tick, setTick] = React.useState(0);

    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const refresh = (): void => setTick(value => (value + 1) % 10_000);
        window.addEventListener('resize', refresh);
        window.addEventListener('scroll', refresh, true);
        return () => {
            window.removeEventListener('resize', refresh);
            window.removeEventListener('scroll', refresh, true);
        };
    }, []);

    React.useEffect(() => {
        const container = listRef.current;
        if (!container) return;
        const activeOption = container.querySelector<HTMLElement>(`[data-slash-index="${activeIndex}"]`);
        activeOption?.scrollIntoView?.({ block: 'nearest' });
    }, [activeIndex, commands.length]);

    if (!commands.length || typeof document === 'undefined' || !document.body) return null;

    void tick;
    const viewportWidth = typeof window !== 'undefined' ? Math.max(320, window.innerWidth) : 1024;
    const viewportHeight = typeof window !== 'undefined' ? Math.max(320, window.innerHeight) : 768;
    const resolvedAnchor = anchorElement
        || document.querySelector<HTMLElement>('.nmx-composer')
        || document.querySelector<HTMLElement>('.nmx-composer-wrap');
    const rect = resolvedAnchor?.getBoundingClientRect();

    const margin = 12;
    const gap = 8;
    const desiredWidth = rect ? Math.min(Math.max(340, rect.width), 560) : 440;
    const width = Math.max(260, Math.min(desiredWidth, viewportWidth - margin * 2));
    const left = rect
        ? Math.max(margin, Math.min(rect.left, viewportWidth - width - margin))
        : margin;
    const availableAbove = rect ? Math.max(140, rect.top - margin - gap) : 340;
    const maxHeight = Math.min(360, availableAbove, viewportHeight - margin * 2);
    const bottom = rect
        ? Math.max(margin, viewportHeight - rect.top + gap)
        : margin + 88;

    const groups: { readonly group: ComposerSlashGroupId; readonly entries: { readonly item: ComposerSlashCommandItem; readonly flatIndex: number }[] }[] = [];
    commands.forEach((item, flatIndex) => {
        const last = groups[groups.length - 1];
        if (last && last.group === item.group) {
            (last.entries as { item: ComposerSlashCommandItem; flatIndex: number }[]).push({ item, flatIndex });
        } else {
            groups.push({ group: item.group, entries: [{ item, flatIndex }] });
        }
    });

    const safeActive = Math.max(0, Math.min(activeIndex, commands.length - 1));
    const activeItem = commands[safeActive];

    return createPortal(
        <div
            className='nmx-slash-command-portal nmx-model-picker-portal nmx-desktop-widget'
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            lang={locale}
            onKeyDown={event => {
                if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    onDismiss();
                }
            }}
        >
            <div className={`nmx-model-picker-surface nmx-shell nmx-theme-${theme}`}>
                <section
                    className='nmx-composer-popover nmx-slash-command-popover'
                    aria-label={pickLocaleCopy(locale, '斜杠快捷命令', '斜槓快捷命令', 'Slash Commands')}
                    onMouseDown={event => {
                        // Prevent blurring composer <textarea> when clicking group headers, disabled items, scrollbar padding, or footer.
                        event.preventDefault();
                    }}
                    style={{
                        left: `${Math.round(left)}px`,
                        bottom: `${Math.round(bottom)}px`,
                        top: 'auto',
                        width: `${Math.round(width)}px`,
                        maxHeight: `${Math.round(maxHeight)}px`
                    }}
                >
                    <div
                        ref={listRef}
                        className='nmx-slash-command-list'
                        role='listbox'
                        aria-activedescendant={activeItem ? `nmx-slash-opt-${activeItem.id}` : undefined}
                    >
                        {groups.map(section => (
                            <div key={section.group} className='nmx-slash-command-group' role='group' aria-label={slashGroupLabel(locale, section.group)}>
                                <div className='nmx-slash-command-group-title'>{slashGroupLabel(locale, section.group)}</div>
                                {section.entries.map(({ item, flatIndex }) => {
                                    const isSelected = flatIndex === safeActive;
                                    return (
                                        <button
                                            key={item.id}
                                            id={`nmx-slash-opt-${item.id}`}
                                            type='button'
                                            role='option'
                                            data-slash-index={flatIndex}
                                            data-slash-command={item.slug}
                                            aria-selected={isSelected}
                                            aria-disabled={item.disabled || undefined}
                                            disabled={item.disabled}
                                            className={`nmx-slash-command-item${isSelected ? ' is-active' : ''}${item.disabled ? ' is-disabled' : ''}`}
                                            title={item.disabled && item.disabledReason ? `${item.title} — ${item.disabledReason}` : `${item.title} — ${item.description}`}
                                            onMouseDown={event => {
                                                // Preserve composer textarea focus & selection caret!
                                                event.preventDefault();
                                            }}
                                            onMouseEnter={() => onHoverIndex(flatIndex)}
                                            onClick={() => {
                                                if (item.disabled) return;
                                                onSelectCommand(item);
                                            }}
                                        >
                                            <span className='nmx-slash-command-icon' aria-hidden='true'>
                                                <i className={`codicon codicon-${item.icon}`}></i>
                                            </span>
                                            <span className='nmx-slash-command-body'>
                                                <span className='nmx-slash-command-head'>
                                                    <code className='nmx-slash-command-token' data-nmx-literal>/{item.slug}</code>
                                                    {item.argHint && <span className='nmx-slash-command-arg' data-nmx-literal>{item.argHint}</span>}
                                                    <strong className='nmx-slash-command-title'>{item.title}</strong>
                                                    {item.badge && <span className='nmx-slash-command-badge' data-nmx-literal>{item.badge}</span>}
                                                </span>
                                                <span className='nmx-slash-command-desc'>
                                                    {item.disabled && item.disabledReason ? item.disabledReason : item.description}
                                                </span>
                                            </span>
                                            <span className='nmx-slash-command-enter' aria-hidden='true'>
                                                {item.requiresTaskInput ? 'Tab' : '↵'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                    <footer className='nmx-slash-command-footer' aria-hidden='true'>
                        <span>{slashFooterHint(locale)}</span>
                    </footer>
                </section>
            </div>
        </div>,
        document.body
    );
};
