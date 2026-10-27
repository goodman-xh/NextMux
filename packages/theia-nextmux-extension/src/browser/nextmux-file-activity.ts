import type { NextMuxDesktopLocale } from './nextmux-locale';
import { localizeDesktopSurface } from './nextmux-surface-locale';

export type FileActivityAction = 'created' | 'updated' | 'read';

export function fileActivityText(locale: NextMuxDesktopLocale, action: FileActivityAction): string {
    return localizeDesktopSurface(locale, action === 'created' ? '已创建文件' : action === 'updated' ? '已编辑文件' : '已读取文件');
}

export function shortFileActivityName(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized.split('/').filter(Boolean).at(-1) || path;
}
