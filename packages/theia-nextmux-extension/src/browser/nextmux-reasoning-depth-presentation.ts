import type { ReasoningDepthChoices, ReasoningDepthOption } from '../common/nextmux-model-controls';

/**
 * The model picker shows depth choices, not thinking switches. Keep the
 * already-resolved choices intact: hiding a switch must not change a saved
 * setting, infer model support, or enable reasoning in the next request.
 */
export function reasoningDepthChoicesForDisplay(choices: ReasoningDepthChoices): ReasoningDepthChoices {
    const options = choices.options.filter(option => option.label !== 'on' && option.label !== 'off');
    // A lone adaptive mode or fixed depth leaves no depth to choose between.
    if (options.length < 2) return { options: [] };
    return {
        options,
        ...(choices.defaultId && options.some(option => option.id === choices.defaultId) ? { defaultId: choices.defaultId } : {})
    };
}

/**
 * An existing, eligible enable choice for a switch-only model. The caller may
 * apply this as its frontend default using the ordinary option setter. This
 * does not infer API parameters, bypass rejected options, or write settings.
 */
export function reasoningSwitchEnabledDefault(choices: ReasoningDepthChoices): ReasoningDepthOption | undefined {
    if (!choices.options.length || choices.options.some(option => option.label !== 'on' && option.label !== 'off')) return undefined;
    return choices.options.find(option => option.label === 'on');
}
