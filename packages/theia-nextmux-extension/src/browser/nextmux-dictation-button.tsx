import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { NativeDictationPhase } from './nextmux-native-dictation-adapter';
import './style/nextmux-dictation-button.css';

const labels: Readonly<Record<NextMuxDesktopLocale, readonly [string, string]>> = {
    'zh-CN': ['开始语音输入', '停止语音输入'], 'zh-TW': ['開始語音輸入', '停止語音輸入'],
    en: ['Start voice input', 'Stop voice input'], ja: ['音声入力を開始', '音声入力を停止'],
    ko: ['음성 입력 시작', '음성 입력 중지'], es: ['Iniciar entrada de voz', 'Detener entrada de voz'],
    fr: ['Démarrer la saisie vocale', 'Arrêter la saisie vocale'], de: ['Spracheingabe starten', 'Spracheingabe stoppen'],
    'pt-BR': ['Iniciar entrada de voz', 'Parar entrada de voz'], ru: ['Начать голосовой ввод', 'Остановить голосовой ввод'],
    ar: ['بدء الإدخال الصوتي', 'إيقاف الإدخال الصوتي'], hi: ['आवाज़ से इनपुट शुरू करें', 'आवाज़ से इनपुट रोकें']
};
export const dictationButtonText = (locale: NextMuxDesktopLocale, active: boolean): string => labels[locale][active ? 1 : 0];

/** Native level updates only notify the mic component, never the whole workbench. */
export class DictationActivity {
    protected value = 0;
    protected readonly listeners = new Set<(level: number) => void>();
    set(level: number): void {
        const value = Number.isFinite(level) && level > .025 && level <= 1 ? level : 0;
        if (this.value === value && value === 0) return;
        this.value = value;
        for (const listener of this.listeners) listener(value);
    }
    subscribe(listener: (level: number) => void): () => void {
        this.listeners.add(listener); listener(this.value);
        return () => this.listeners.delete(listener);
    }
}

export function DictationButton(props: {
    locale: NextMuxDesktopLocale; active: boolean; phase?: NativeDictationPhase;
    activity: DictationActivity; className?: string; disabled?: boolean; onClick(): void;
}): React.ReactElement {
    const [sound, setSound] = React.useState({ level: 0, revision: 0 });
    React.useEffect(() => {
        if (!props.active) { setSound({ level: 0, revision: 0 }); return; }
        return props.activity.subscribe(level => setSound(previous => ({ level, revision: previous.revision + 1 })));
    }, [props.active, props.activity]);
    const audible = props.active && props.phase === 'listening' && sound.level > .025;
    const label = dictationButtonText(props.locale, props.active);
    return <button type='button' className={`${props.className || 'nmx-mic-button'} nmx-dictation-button${props.active ? ' is-listening' : ''}${audible ? ' has-sound' : ''}`}
        disabled={props.disabled} aria-label={label} title={label} aria-pressed={props.active}
        aria-busy={props.phase === 'starting' || props.phase === 'finishing'}
        style={{ '--nmx-dictation-level': audible ? sound.level : 0 } as React.CSSProperties}
        onMouseDown={event => event.preventDefault()} onClick={props.onClick}>
        {audible && <span key={sound.revision} className='nmx-dictation-ripple' aria-hidden='true' />}
        <i className='codicon codicon-mic' aria-hidden='true' />
    </button>;
}
