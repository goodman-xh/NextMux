import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { RelayWidgetFixture } from 'relay-widget-fixture-source';

/** Product rendering/handlers, synthetic catalog only: no account, RPC, billing or model endpoint. */
function Fixture(): React.ReactElement {
    const [, refresh] = React.useReducer(value => value + 1, 0);
    const [widget] = React.useState(() => new RelayWidgetFixture());
    const root = React.useRef<HTMLElement>(null);
    const params = new URLSearchParams(window.location.search);
    const locale = params.get('locale') || 'zh-CN';
    const theme = params.get('theme') === 'light' ? 'light' : 'dark';
    React.useLayoutEffect(() => {
        widget.node = root.current;
        widget.desktopLocale = locale;
        widget.theme = theme;
        widget.update = refresh;
        widget.modelPickerRelayOpen = true;
        widget.codingPopover = 'routes';
        const update = (): void => refresh();
        window.addEventListener('resize', update);
        document.documentElement.dir = 'ltr';
        document.documentElement.dataset.theme = theme;
        refresh();
        return () => window.removeEventListener('resize', update);
    }, [widget, locale, theme]);
    return <main ref={root} dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} className={`fixture nmx-desktop-widget nmx-shell nmx-theme-${theme}`}>
        <div className='nmx-titlebar-primary-nav fixture-titlebar'>NextMux · Synthetic relay fixture</div>
        <p className='fixture-note'>18 synthetic merchants · 2 API connections · no external requests</p>
        <output className='fixture-selection' data-fixture-selection={widget.activeRelayKey}>Selected: {widget.activeRelayKey || 'none'}</output>
        <button className='nmx-composer-relay-button fixture-trigger' onClick={() => widget.toggleComposerRelayPicker()}>Open / close source picker</button>
        {widget.node && widget.renderRelayPickerPortal()}
    </main>;
}

createRoot(document.getElementById('fixture')!).render(<Fixture />);
