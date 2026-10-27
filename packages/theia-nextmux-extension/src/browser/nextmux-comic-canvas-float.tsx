import * as React from '@theia/core/shared/react';
import '../../src/browser/style/nextmux-comic-canvas-float.css';

/** The selected node owns one inline form; rerenders never move its active input into a portal. */
export function CanvasFloatingForm(props: { readonly locale: string; readonly title: string; readonly children: React.ReactNode }): React.ReactElement {
    return <div className='nmx-canvas-floating-mount'>
        <div className='nmx-canvas-floating-host nmx-desktop-widget' lang={props.locale} dir={props.locale === 'ar' ? 'rtl' : 'ltr'}>
            <div className='nmx-canvas-floating-form is-inline' data-canvas-keyboard-exclude onKeyDown={event => event.stopPropagation()}>
                <div className='nmx-canvas-floating-body'>{props.children}</div>
            </div>
        </div>
    </div>;
}
