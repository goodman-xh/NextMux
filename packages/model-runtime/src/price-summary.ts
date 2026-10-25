/** Select display-only primary charges without treating undisplayed dimensions as missing prices. */
export interface PriceSummaryModel {
    readonly kind?: string;
    readonly category?: string;
    readonly output?: readonly string[];
}
export interface SummaryRate { readonly unitSize: number; readonly amountMicros: number; }
export interface SummaryDimension {
    readonly metric: string;
    readonly currency: string;
    readonly official: SummaryRate | null;
    readonly user: SummaryRate | null;
}
export type PriceSummaryState = 'available' | 'missing' | 'not_summarized';
export function validSummaryRate(rate: SummaryRate | null | undefined): rate is SummaryRate {
    return !!rate && Number.isFinite(rate.amountMicros) && rate.amountMicros >= 0 && Number.isFinite(rate.unitSize) && rate.unitSize > 0;
}
export function priceDisplayUnitSize(metric: string): number {
    return metric.endsWith('_token') || metric === 'audio_character' ? 1_000_000 : 1;
}
export function selectMainPriceDimensions<T extends { readonly metric: string }>(
    dimensions: readonly T[], model: PriceSummaryModel, hasPrice: (dimension: T) => boolean
): { dimensions: T[]; state: PriceSummaryState } {
    const available = dimensions.filter(hasPrice);
    const byMetric = new Map(available.map(item => [item.metric, item]));
    const outputs = new Set(model.output || []);
    const kind = model.kind || model.category || '';
    const first = (metrics: readonly string[]): T[] => {
        const item = metrics.map(metric => byMetric.get(metric)).find(Boolean);
        return item ? [item] : [];
    };
    let selected: T[];
    if (kind === 'video' || outputs.has('video')) selected = first(['video_second', 'request']);
    else if (kind === 'music' || outputs.has('music')) selected = first(['request', 'audio_second', 'audio_character', 'output_token']);
    else if (['speech', 'sound_effect', 'audio', 'transcription'].includes(kind) || ['audio', 'speech'].some(output => outputs.has(output))) {
        selected = first(kind === 'transcription' ? ['audio_second', 'request', 'input_token'] : ['audio_character', 'audio_second', 'request', 'output_token']);
    } else if (kind === 'image' || outputs.has('image')) selected = first(['image', 'image_output_token', 'request']);
    else if (['decision', 'embedding', 'embeddings', 'moderation'].includes(kind) || ['decisions', 'embedding', 'embeddings', 'moderation'].some(output => outputs.has(output))) selected = first(['input_token', 'request']);
    else if (kind === 'rerank' || outputs.has('rerank')) selected = first(['request', 'input_token']);
    else {
        selected = ['input_token', 'output_token'].flatMap(metric => byMetric.has(metric) ? [byMetric.get(metric)!] : []);
        // Legacy catalogs may omit kind/output but still declare a media charge.
        if (!selected.length) selected = first(['request', 'image', 'image_output_token', 'video_second', 'audio_second', 'audio_character']);
    }
    return { dimensions: selected, state: selected.length ? 'available' : available.length ? 'not_summarized' : 'missing' };
}
