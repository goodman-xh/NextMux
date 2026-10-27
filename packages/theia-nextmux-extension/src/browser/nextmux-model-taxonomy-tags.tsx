import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { modelTaxonomyView } from './nextmux-model-taxonomy-locale';

/**
 * A model's primary category and capability badges as one chip strip, the same words and look on every surface
 * (style: nextmux-model-taxonomy.css). `showCategory` is off where the list is already grouped by category.
 */
export function ModelTaxonomyTags(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly model: unknown;
    readonly showCategory?: boolean;
    readonly className?: string;
}): React.ReactElement | null {
    const view = modelTaxonomyView(props.locale, props.model);
    if (!props.showCategory && !view.badges.length) return null;
    const summary = [props.showCategory ? view.categoryLabel : '', ...view.badges.map(badge => badge.label)].filter(Boolean).join(' · ');
    return <span className={`nmx-model-taxonomy${props.className ? ` ${props.className}` : ''}`} title={summary} data-nmx-literal>
        {props.showCategory && <span className='nmx-model-taxonomy-category' data-model-category={view.category}>{view.categoryLabel}</span>}
        {view.badges.map(badge => <span key={badge.key} className='nmx-model-taxonomy-badge' data-model-capability={badge.key}>{badge.label}</span>)}
    </span>;
}
