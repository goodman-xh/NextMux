import * as React from 'react';

/*
 * Theme preference glyphs ported from Lucide (https://lucide.dev, ISC
 * License, Copyright (c) Lucide Contributors): `monitor`, `sun` and `moon`.
 * Codicons has no sun/moon glyphs; the previous square/dot stand-ins read as
 * "maximize" and "record". Paths are unchanged; stroke follows currentColor.
 */
const paths: Readonly<Record<'system' | 'light' | 'dark', React.ReactNode>> = {
    system: <><rect width='20' height='14' x='2' y='3' rx='2' /><path d='M8 21h8' /><path d='M12 17v4' /></>,
    light: <><circle cx='12' cy='12' r='4' /><path d='M12 2v2' /><path d='M12 20v2' /><path d='m4.93 4.93 1.41 1.41' /><path d='m17.66 17.66 1.41 1.41' /><path d='M2 12h2' /><path d='M20 12h2' /><path d='m6.34 17.66-1.41 1.41' /><path d='m19.07 4.93-1.41 1.41' /></>,
    dark: <path d='M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' />
};

export function ThemePreferenceIcon({ theme }: { readonly theme: 'system' | 'light' | 'dark' }): React.ReactElement {
    return <svg className='nmx-theme-icon' data-theme-icon={theme} viewBox='0 0 24 24' width='15' height='15' fill='none' stroke='currentColor'
        strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{paths[theme]}</svg>;
}
