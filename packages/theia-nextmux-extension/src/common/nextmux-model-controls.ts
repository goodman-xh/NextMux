import type { AgentReasoningEffort } from '@nextmux/agent-runtime';
import type { ModelContract, ModelReasoningControl, ReasoningEvidenceState } from '@nextmux/model-runtime';
import { reasoningOptionKey } from '@nextmux/model-runtime/reasoning-evidence';

export interface ModelReasoningSettings {
    readonly reasoningBudgetTokens?: number;
    readonly reasoningEnabled?: boolean;
    readonly reasoningExclude?: boolean;
    readonly reasoningMode?: 'adaptive' | 'enabled' | 'disabled';
}
export const desktopReasoningEfforts: readonly AgentReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const effortParameters = new Set(['reasoning.effort', 'reasoning_effort', 'output_config.effort', 'generationConfig.thinkingConfig.thinkingLevel', 'additionalModelRequestFields.reasoningConfig.maxReasoningEffort', 'think']);
const budgetParameters = new Set(['reasoning.max_tokens', 'thinking.budget_tokens', 'thinking.token_budget', 'thinking_budget', 'generationConfig.thinkingConfig.thinkingBudget']);
const toggleParameters = new Set(['reasoning.enabled', 'reasoning.exclude', 'enable_thinking', 'generationConfig.thinkingConfig.includeThoughts', 'think']);
const declaredControl = (control: ModelReasoningControl): boolean => control.support === 'supported' && control.scope !== 'transport' && control.source !== 'model_heuristic';
/** Declared values only. Legacy effort lists are route declarations, never family guesses. */
export function declaredReasoningEfforts(model: ModelContract & { readonly reasoningEfforts?: readonly AgentReasoningEffort[] } | undefined): readonly AgentReasoningEffort[] {
    if (model?.capabilityDeclarations?.reasoning?.support === 'unsupported') return [];
    const controls = model?.reasoningControls;
    const fallbackEfforts = model?.reasoningEfforts?.filter(value => desktopReasoningEfforts.includes(value)) || [];
    // Only a model that declares no effort control at all falls back to its published effort list. A declared effort
    // control that is unsupported, inferred, transport-level or has no wire mapping means no effort picker: the API
    // said it does not take one, so sending reasoning_effort would be rejected.
    const effortControls = controls?.filter(control => control.type === 'effort') ?? [];
    if (!effortControls.length) return fallbackEfforts;
    const effort = effortControls.find(control => declaredControl(control)
        && (effortParameters.has(control.parameter) || control.parameter === 'thinking.token_budget' && Boolean(control.mapping)));
    if (!effort) return [];
    return effort.values?.filter((value): value is AgentReasoningEffort => typeof value === 'string' && desktopReasoningEfforts.includes(value as AgentReasoningEffort)
        && (!effort.mandatory || value !== 'none')) || fallbackEfforts;
}
export function reasoningControlField(control: ModelReasoningControl): keyof ModelReasoningSettings | undefined {
    if (!declaredControl(control)) return undefined;
    if (control.type === 'budget' && budgetParameters.has(control.parameter)) return 'reasoningBudgetTokens';
    if (['adaptive', 'on-off'].includes(control.type) && control.parameter === 'thinking.type') return 'reasoningMode';
    if (control.type === 'on-off' && toggleParameters.has(control.parameter)) return control.parameter.endsWith('.exclude') ? 'reasoningExclude' : 'reasoningEnabled';
    return undefined;
}
export function reasoningControlValues(control: ModelReasoningControl): readonly (string | boolean)[] {
    const field = reasoningControlField(control);
    return (control.values || []).filter(value => (field === 'reasoningMode' ? ['adaptive', 'enabled', 'disabled'].includes(String(value))
        : field === 'reasoningEnabled' || field === 'reasoningExclude' ? typeof value === 'boolean' : false)
        && (!control.mandatory || value !== false && value !== 'disabled'));
}
/** Stored settings do not survive a provider removing or narrowing a control. */
export function declaredReasoningSettings(controls: readonly ModelReasoningControl[] | undefined, settings: ModelReasoningSettings): ModelReasoningSettings {
    const output: Record<string, unknown> = {};
    for (const control of controls || []) {
        const field = reasoningControlField(control);
        if (!field) continue;
        const value = settings[field];
        if (value === undefined || control.mandatory && (value === false || value === 'disabled')) continue;
        if (field === 'reasoningBudgetTokens') {
            if (typeof value === 'number' && Number.isSafeInteger(value) && value >= (control.min ?? 0) && value <= (control.max ?? 1_000_000_000)) output[field] = value;
        } else if (reasoningControlValues(control).includes(value as string | boolean)) output[field] = value;
    }
    return output;
}

/** Snapshot validation is declaration-independent; declarations are rechecked at dispatch. */
export function normalizeReasoningSettings(value: unknown): ModelReasoningSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    return {
        ...(typeof input.reasoningBudgetTokens === 'number' && Number.isSafeInteger(input.reasoningBudgetTokens) && input.reasoningBudgetTokens >= -1 && input.reasoningBudgetTokens <= 1_000_000_000 ? { reasoningBudgetTokens: input.reasoningBudgetTokens } : {}),
        ...(typeof input.reasoningEnabled === 'boolean' ? { reasoningEnabled: input.reasoningEnabled } : {}),
        ...(typeof input.reasoningExclude === 'boolean' ? { reasoningExclude: input.reasoningExclude } : {}),
        ...(['adaptive', 'enabled', 'disabled'].includes(String(input.reasoningMode)) ? { reasoningMode: input.reasoningMode as ModelReasoningSettings['reasoningMode'] } : {})
    };
}

/** One choice in the single “thinking depth” control, whatever the API's own parameter is. */
export interface ReasoningDepthOption {
    /** The evidence key of what this choice sends (`reasoningOptionKey`). */
    readonly id: string;
    readonly label: 'off' | 'on' | 'auto' | Exclude<AgentReasoningEffort, 'none'>;
    readonly effort?: AgentReasoningEffort;
    readonly settings: ModelReasoningSettings;
    readonly evidence?: Exclude<ReasoningEvidenceState, 'rejected'>;
}
export interface ReasoningDepthChoices {
    readonly options: readonly ReasoningDepthOption[];
    /** What the API does when nothing is chosen, when it says so. */
    readonly defaultId?: string;
}
const budgetPresets = [['low', 2_048], ['medium', 8_192], ['high', 24_576]] as const;
const option = (label: ReasoningDepthOption['label'], request: { effort?: AgentReasoningEffort; settings?: ModelReasoningSettings }): ReasoningDepthOption => ({
    id: reasoningOptionKey({ reasoningEffort: request.effort, ...request.settings }), label,
    ...(request.effort ? { effort: request.effort } : {}), settings: request.settings || {}
});

/**
 * Mainstream coding tools show one thinking control per model (Codex/Claude Code effort levels,
 * Cursor's thinking switch). An API may instead declare effort values, a thinking mode, an on/off
 * switch or a token budget; all of them become one ordered row here. “Include thinking in the
 * response” is transport plumbing, never a user choice. Options this API refused in real requests
 * (platform evidence for merchant APIs, local evidence for own APIs) are left out.
 */
export function reasoningDepthChoices(contract: (ModelContract & { readonly reasoningEfforts?: readonly AgentReasoningEffort[] }) | undefined,
    evidence?: Readonly<Record<string, ReasoningEvidenceState>>, efforts: readonly AgentReasoningEffort[] = declaredReasoningEfforts(contract)): ReasoningDepthChoices {
    if (contract?.capabilityDeclarations?.reasoning?.support === 'unsupported') return { options: [] };
    const controls = (contract?.reasoningControls || []).filter(control => reasoningControlField(control));
    const find = (field: keyof ModelReasoningSettings) => controls.find(control => reasoningControlField(control) === field);
    const toggle = find('reasoningEnabled'), mode = find('reasoningMode'), budget = find('reasoningBudgetTokens');
    const options: ReasoningDepthOption[] = [];
    let defaultId: string | undefined;
    if (efforts.length) {
        if (!efforts.includes('none')) {
            if (toggle && reasoningControlValues(toggle).includes(false)) options.push(option('off', { settings: { reasoningEnabled: false } }));
            else if (mode && reasoningControlValues(mode).includes('disabled')) options.push(option('off', { settings: { reasoningMode: 'disabled' } }));
        }
        for (const effort of efforts) options.push(option(effort === 'none' ? 'off' : effort, { effort }));
    } else if (mode) {
        const values = reasoningControlValues(mode);
        for (const [value, label] of [['disabled', 'off'], ['adaptive', 'auto'], ['enabled', 'on']] as const) {
            if (values.includes(value)) options.push(option(label, { settings: { reasoningMode: value } }));
        }
        if (typeof mode.default === 'string') defaultId = `mode:${mode.default}`;
    } else if (toggle) {
        const values = reasoningControlValues(toggle);
        if (values.includes(false)) options.push(option('off', { settings: { reasoningEnabled: false } }));
        if (values.includes(true)) options.push(option('on', { settings: { reasoningEnabled: true } }));
        if (typeof toggle.default === 'boolean') defaultId = `enabled:${toggle.default}`;
    } else if (budget) {
        const minimum = budget.min ?? 0, maximum = budget.max ?? 32_768;
        if (!budget.mandatory && minimum <= 0) options.push(option('off', { settings: { reasoningBudgetTokens: 0 } }));
        const seen = new Set<number>();
        for (const [label, tokens] of budgetPresets) {
            const value = Math.max(Math.max(1, minimum), Math.min(maximum, tokens));
            if (seen.has(value)) continue;
            seen.add(value);
            options.push(option(label, { settings: { reasoningBudgetTokens: value } }));
        }
    }
    const kept = options.filter(item => item.id && evidence?.[item.id] !== 'rejected')
        .map(item => evidence?.[item.id] ? { ...item, evidence: evidence[item.id] as Exclude<ReasoningEvidenceState, 'rejected'> } : item);
    // A single remaining choice is not a choice.
    return kept.length > 1 ? { options: kept, ...(defaultId && kept.some(item => item.id === defaultId) ? { defaultId } : {}) } : { options: [] };
}
