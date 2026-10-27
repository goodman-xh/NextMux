import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { comicShotFieldText, type ComicShotFieldTextKey } from './nextmux-comic-studio-text';

export interface ComicShotFieldsDraft {
    readonly cameraAngle: string;
    readonly lensFocalLength: string;
    readonly lensDepthOfField: string;
    readonly transition: string;
    readonly beatsText: string;
    readonly dialogueTone: string;
    readonly continuousTakeId: string;
}
export interface ComicShotBeatDraft { readonly startSeconds: number; readonly endSeconds: number; readonly action: string; }
export function formatComicShotBeats(beats: readonly ComicShotBeatDraft[] | undefined): string {
    return (beats || []).map(beat => `${beat.startSeconds}-${beat.endSeconds}: ${beat.action}`).join('\n');
}
export function parseComicShotBeats(text: string): ComicShotBeatDraft[] | undefined {
    if (!text.trim()) return [];
    const result: ComicShotBeatDraft[] = [];
    for (const line of text.split(/\n/).filter(value => value.trim())) {
        const match = /^\s*(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*[:：]\s*(\S.*)\s*$/.exec(line);
        if (!match) return undefined;
        const startSeconds = Number(match[1]); const endSeconds = Number(match[2]);
        if (endSeconds <= startSeconds || !Number.isFinite(endSeconds)) return undefined;
        result.push({ startSeconds, endSeconds, action: match[3].trim() });
    }
    return result;
}

export type ComicShotFieldPart = 'camera' | 'transition' | 'beats' | 'tone' | 'take';
const ALL_PARTS: readonly ComicShotFieldPart[] = ['camera', 'transition', 'beats', 'tone', 'take'];

/** Uses the existing inspector layout and IME fields; `parts` lets the inspector place each group in its own section. */
export function ComicShotFields(props: {
    readonly locale: NextMuxDesktopLocale; readonly draft: ComicShotFieldsDraft;
    readonly onChange: (patch: Partial<ComicShotFieldsDraft>) => void; readonly disabled?: boolean;
    readonly parts?: readonly ComicShotFieldPart[];
}): React.ReactElement {
    const show = (part: ComicShotFieldPart): boolean => (props.parts || ALL_PARTS).includes(part);
    const { draft, onChange, disabled } = props;
    const t = (key: ComicShotFieldTextKey): string => comicShotFieldText(props.locale, key);
    const select = (key: keyof ComicShotFieldsDraft, label: ComicShotFieldTextKey, values: readonly ComicShotFieldTextKey[]): React.ReactElement =>
        <label>{t(label)}<select value={draft[key]} disabled={disabled} onChange={event => onChange({ [key]: event.currentTarget.value })}>
            <option value=''>{t('automatic')}</option>{values.map(value => <option key={value} value={value}>{t(value)}</option>)}
        </select></label>;
    const validBeats = parseComicShotBeats(draft.beatsText) !== undefined;
    return <>
        {show('camera') && select('cameraAngle', 'cameraAngle', ['eye_level', 'low', 'high', 'overhead', 'over_the_shoulder', 'pov', 'dutch'])}
        {show('camera') && <div className='nmx-inspector-pair'>{select('lensFocalLength', 'lens', ['wide', 'normal', 'telephoto'])}{select('lensDepthOfField', 'depthOfField', ['shallow', 'deep'])}</div>}
        {show('transition') && select('transition', props.parts ? 'transitionIn' : 'transition', ['cut', 'dissolve', 'fade'])}
        {show('beats') && <label>{t('beats')}<ImeTextarea rows={3} value={draft.beatsText} disabled={disabled} placeholder={t('beatsHint')} aria-invalid={!validBeats} onChange={event => onChange({ beatsText: event.currentTarget.value })}/></label>}
        {show('beats') && !validBeats && <small role='alert'>{t('beatsInvalid')}</small>}
        {show('tone') && <label>{t('dialogueTone')}<ImeInput value={draft.dialogueTone} disabled={disabled} onChange={event => onChange({ dialogueTone: event.currentTarget.value })}/></label>}
        {show('take') && <label>{t('continuousTakeId')}<ImeInput value={draft.continuousTakeId} disabled={disabled} onChange={event => onChange({ continuousTakeId: event.currentTarget.value })}/></label>}
    </>;
}
