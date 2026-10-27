import * as React from '@theia/core/shared/react';

export function FavoriteHeartIcon(props: { readonly active?: boolean; readonly className?: string }): React.ReactElement {
    const { active = false, className } = props;
    return <svg className={`nmx-favorite-heart-icon${className ? ` ${className}` : ''}`}
        viewBox='0 0 16 16' width='14' height='14'
        fill={active ? 'currentColor' : 'none'}
        stroke='currentColor' strokeWidth='1.4'
        strokeLinecap='round' strokeLinejoin='round'
        aria-hidden='true'>
        <path d='M8 13.7C8 13.7 2 9.8 2 5.4C2 3.5 3.5 2 5.4 2C6.5 2 7.5 2.5 8 3.4C8.5 2.5 9.5 2 10.6 2C12.5 2 14 3.5 14 5.4C14 9.8 8 13.7 8 13.7Z' />
    </svg>;
}
