import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { relayText } from './nextmux-relay-locale';
import { ImeTextarea } from './nextmux-ime-field';
import { ConversationMarkdown, type CodeTokenizer } from './nextmux-conversation-markdown';
import { StreamText } from './nextmux-conversation-stream';
import { DictationButton, type DictationActivity } from './nextmux-dictation-button';
import type { NativeDictationPhase } from './nextmux-native-dictation-adapter';
import { comicChatText, type ComicChatTextKey } from './nextmux-comic-chat-text';
import {
    COMIC_CHAT_LIMITS, extractComicChatThinking,
    type ComicChatAspect, type ComicChatMediaKind, type ComicChatMode, type ComicChatParams, type ComicChatProposal, type ComicChatTurn
} from '../common/nextmux-comic-chat';

/**
 * 漫剧对话 — presentation only. The widget owns the conversation, the jobs and the models, and passes plain
 * view models in; everything the user does comes back through callbacks. The composer is the coding composer's
 * markup and words (发送消息或描述任务, 添加内容, 选择中转商), with a row of modes above it and the settings of
 * the chosen mode in its tool row.
 */

export const COMIC_CHAT_MODE_ICONS: Readonly<Record<ComicChatMode, string>> = {
    agent: 'sparkle', image: 'file-media', video: 'device-camera-video', music: 'music', speech: 'mic'
};

export type ComicChatSkillId = 'portrait' | 'scene' | 'poster' | 'shot' | 'animate' | 'theme' | 'voice';

export interface ComicChatSkill {
    readonly id: ComicChatSkillId;
    readonly mode: ComicChatMode;
    readonly icon: string;
    readonly name: ComicChatTextKey;
    readonly lead: ComicChatTextKey;
    readonly template?: ComicChatTextKey;
    readonly params?: ComicChatParams;
    /** Opens the reference picker straight away (图生视频 needs its first frame). */
    readonly wantsReference?: boolean;
}

/** The functions the conversation offers: every one makes its output from the prompt (pictures optional). */
export const COMIC_CHAT_UI_MODES: readonly ComicChatMode[] = ['image', 'video', 'music'];
export const COMIC_CHAT_DRAWER_MODES: readonly ComicChatMode[] = ['image', 'video', 'music'];

/** Designed for comics rather than copied: every card is a mode, a starting prompt and the settings it needs. */
export const COMIC_CHAT_SKILLS: readonly ComicChatSkill[] = [
    { id: 'portrait', mode: 'image', icon: 'person', name: 'skillPortrait', lead: 'skillPortraitLead', template: 'tplPortrait', params: { aspect: '3:4', count: 1 } },
    { id: 'scene', mode: 'image', icon: 'globe', name: 'skillScene', lead: 'skillSceneLead', template: 'tplScene', params: { aspect: '16:9', count: 2 } },
    { id: 'poster', mode: 'image', icon: 'symbol-color', name: 'skillPoster', lead: 'skillPosterLead', template: 'tplPoster', params: { aspect: '3:4', count: 1 } },
    { id: 'shot', mode: 'video', icon: 'device-camera-video', name: 'skillShot', lead: 'skillShotLead', template: 'tplShot', params: { aspect: '16:9' } },
    { id: 'animate', mode: 'video', icon: 'play-circle', name: 'skillAnimate', lead: 'skillAnimateLead', template: 'tplAnimate', wantsReference: true },
    { id: 'theme', mode: 'music', icon: 'music', name: 'skillTheme', lead: 'skillThemeLead', template: 'tplTheme', params: { instrumental: true } },
    { id: 'voice', mode: 'speech', icon: 'mic', name: 'skillVoice', lead: 'skillVoiceLead', template: 'tplVoice' }
];

export interface ComicChatMediaView {
    /** The media job ID. */
    readonly key: string;
    readonly kind: ComicChatMediaKind;
    readonly state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
    readonly url?: string;
    /** The project asset once the result is filed (素材库, 剪辑). */
    readonly assetId?: string;
    readonly aspect?: ComicChatAspect;
    readonly error?: string;
    readonly elapsed?: string;
    readonly prompt?: string;
    readonly retryable?: boolean;
    /** It failed only because this API reads references from a web link, which needs a signed-in NextMux. */
    readonly needsSignIn?: boolean;
}

export interface ComicChatProposalView {
    readonly proposal: ComicChatProposal;
    readonly media: readonly ComicChatMediaView[];
    readonly estimate?: string;
    /** Why it cannot run now (no model for its kind). */
    readonly blocked?: string;
}

export interface ComicChatTurnView {
    readonly turn: ComicChatTurn;
    readonly media: readonly ComicChatMediaView[];
    readonly references: readonly { readonly id: string; readonly url?: string }[];
    readonly modelLabel?: string;
    readonly proposals: readonly ComicChatProposalView[];
    readonly running?: boolean;
    readonly progress?: string;
    readonly thinking?: string;
}

function aspectStyle(aspect: ComicChatAspect | undefined): React.CSSProperties {
    const [width, height] = (aspect || '16:9').split(':').map(Number);
    // The ratio also caps the tile's width, so a tall picture fits the window instead of hiding its top.
    return { aspectRatio: `${width} / ${height}`, '--nmx-media-ratio': String(width / height) } as React.CSSProperties;
}

export function ComicChatSkills(props: { readonly locale: NextMuxDesktopLocale; readonly disabled?: boolean; readonly onPick: (skill: ComicChatSkill) => void }): React.ReactElement {
    const t = (key: ComicChatTextKey): string => comicChatText(props.locale, key);
    return <section className='nmx-comic-chat-skills' aria-label={t('skills')}>
        <h3>{t('skills')}</h3>
        <div role='list'>{COMIC_CHAT_SKILLS.map(skill => <button key={skill.id} type='button' role='listitem' className={`nmx-comic-chat-skill is-${skill.mode}`}
            disabled={props.disabled} onClick={() => props.onPick(skill)}>
            <span className='nmx-comic-chat-skill-icon' aria-hidden='true'><i className={`codicon codicon-${skill.icon}`}></i></span>
            <strong>{t(skill.name)}</strong><small>{t(skill.lead)}</small>
        </button>)}</div>
    </section>;
}

/** One result: a picture (click: view large), a clip (click: play / pause) or a sound; right-click opens its menu. */
export function ComicChatMediaTile(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly media: ComicChatMediaView;
    readonly onMenu: (media: ComicChatMediaView, event: React.MouseEvent) => void;
    readonly onOpen: (media: ComicChatMediaView) => void;
    readonly onRetry: (jobId: string) => void;
    readonly onCancel: (jobId: string) => void;
    readonly onSignIn?: () => void;
}): React.ReactElement {
    const t = (key: ComicChatTextKey): string => comicChatText(props.locale, key);
    const { media } = props;
    const video = React.useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = React.useState(false);
    const menu = (event: React.MouseEvent): void => { event.preventDefault(); props.onMenu(media, event); };
    const visual = media.kind === 'image' || media.kind === 'video';
    if (media.state !== 'done' || !media.url) {
        // A failure keeps its whole reason readable instead of the picture's shape.
        return <div className={`nmx-comic-chat-media is-${media.kind} is-${media.state}`} style={visual && media.state !== 'failed' ? aspectStyle(media.aspect) : undefined}>
            <span className='nmx-comic-chat-media-state' role='status'>
                {media.state === 'failed' || media.state === 'cancelled'
                    ? <i className={`codicon codicon-${media.state === 'failed' ? 'warning' : 'circle-slash'}`} aria-hidden='true'></i>
                    : <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>}
                <strong>{t(media.state === 'done' ? 'running' : media.state)}</strong>
                {media.elapsed && (media.state === 'running' || media.state === 'queued') && <small data-nmx-literal>{media.elapsed}</small>}
                {media.error && <small className='is-error' data-nmx-literal title={media.error}>{media.error}</small>}
            </span>
            <span className='nmx-comic-chat-media-actions'>
                {(media.state === 'queued' || media.state === 'running') && <button type='button' onClick={() => props.onCancel(media.key)}>{t('cancel')}</button>}
                {media.state === 'failed' && media.needsSignIn && props.onSignIn && <button type='button' className='is-primary' onClick={() => props.onSignIn?.()}>{t('signIn')}</button>}
                {(media.state === 'failed' || media.state === 'cancelled') && media.retryable !== false && <button type='button' onClick={() => props.onRetry(media.key)}>{t('retry')}</button>}
            </span>
        </div>;
    }
    if (media.kind === 'image') {
        return <button type='button' className='nmx-comic-chat-media is-image is-done' style={aspectStyle(media.aspect)} title={t('openLarge')}
            onClick={() => props.onOpen(media)} onContextMenu={menu}>
            <img src={media.url} alt='' loading='lazy' draggable={false} />
        </button>;
    }
    if (media.kind === 'video') {
        const toggle = (): void => {
            const element = video.current;
            if (!element) return;
            if (element.paused) void element.play().catch(() => undefined); else element.pause();
        };
        return <div className={`nmx-comic-chat-media is-video is-done ${playing ? 'is-playing' : ''}`} style={aspectStyle(media.aspect)} onContextMenu={menu}>
            <video ref={video} src={media.url} preload='metadata' playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
                onClick={toggle} onDoubleClick={() => void video.current?.requestFullscreen?.().catch(() => undefined)} />
            {!playing && <button type='button' className='nmx-comic-chat-play' aria-label={t('play')} onClick={toggle}><i className='codicon codicon-play' aria-hidden='true'></i></button>}
        </div>;
    }
    return <div className='nmx-comic-chat-media is-audio is-done' onContextMenu={menu}>
        <i className={`codicon codicon-${media.kind === 'music' ? 'music' : 'mic'}`} aria-hidden='true'></i>
        <audio src={media.url} controls preload='metadata' />
    </div>;
}

export function ComicChatThread(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly turns: readonly ComicChatTurnView[];
    readonly onMenu: (media: ComicChatMediaView, event: React.MouseEvent) => void;
    readonly onOpen: (media: ComicChatMediaView) => void;
    readonly onRetry: (jobId: string) => void;
    readonly onCancel: (jobId: string) => void;
    readonly onGenerate: (turnId: string, proposalIds: readonly string[]) => void;
    readonly onCopy: (text: string) => void;
    readonly onSignIn?: () => void;
    readonly onRenderMarkdown?: (element: HTMLElement) => void;
    readonly markdownTokenizer?: CodeTokenizer;
    readonly onContentClick?: (event: React.MouseEvent<HTMLElement>) => void;
    readonly formatTurnTime?: (iso: string) => string;
    readonly onReadAloud?: (turnId: string, text: string) => void;
    readonly readingTurnId?: string;
    /** The reading's first piece is still being synthesized. */
    readonly readAloudPreparing?: boolean;
    readonly readAloudLabel?: (turnId: string) => string;
    readonly feedbackLabels?: { readonly up: string; readonly down: string };
    readonly onFeedback?: (turnId: string, vote: 'up' | 'down') => void;
    readonly feedbackByTurnId?: Readonly<Record<string, 'up' | 'down' | null | undefined>>;
    /** Replies whose rating is being recorded, with the button pressed: both buttons wait, the pressed one spins. */
    readonly feedbackSubmitting?: Readonly<Record<string, 'up' | 'down'>>;
    readonly children?: React.ReactNode;
}): React.ReactElement {
    const t = (key: ComicChatTextKey, values?: Readonly<Record<string, string | number>>): string => comicChatText(props.locale, key, values);
    const scroller = React.useRef<HTMLDivElement>(null);
    const last = props.turns[props.turns.length - 1];
    // A turn just sent always comes into view; the answer growing under it follows only a reader near the bottom.
    const shownTurns = React.useRef(props.turns.length);
    React.useEffect(() => {
        const element = scroller.current;
        const added = props.turns.length > shownTurns.current;
        shownTurns.current = props.turns.length;
        if (!element) return;
        if (added || element.scrollHeight - element.scrollTop - element.clientHeight < 360) element.scrollTop = element.scrollHeight;
    }, [props.turns.length, last?.turn.reply, last?.media.length, last?.proposals.length, last?.running]);
    const tile = (media: ComicChatMediaView) => <ComicChatMediaTile key={media.key} locale={props.locale} media={media} onMenu={props.onMenu} onOpen={props.onOpen}
        onRetry={props.onRetry} onCancel={props.onCancel} onSignIn={props.onSignIn} />;
    return <div className='nmx-comic-chat-thread' ref={scroller} onClick={props.onContentClick}>
        <div className='nmx-comic-chat-column'>
            {props.children}
            {props.turns.map(view => {
                const { turn } = view;
                const settings = [
                    turn.params.aspect, turn.params.count && turn.params.count > 1 ? t('count', { n: turn.params.count }) : '',
                    turn.params.seconds && turn.mode === 'video' ? t('seconds', { n: turn.params.seconds }) : '',
                    turn.mode === 'music' ? t(turn.params.instrumental ? 'instrumental' : 'withVocals') : '', turn.mode === 'speech' ? turn.params.voice : ''
                ].filter(Boolean);
                const pending = view.proposals.filter(item => !item.proposal.jobIds?.length && !item.blocked);
                const turnTimeLabel = turn.createdAt && props.formatTurnTime ? props.formatTurnTime(turn.createdAt) : '';
                const extractedReply = turn.reply ? extractComicChatThinking(turn.reply) : { text: '' };
                const thoughtContent = [view.thinking, turn.thinking, extractedReply.thinking].filter(Boolean).join('\n\n').trim();
                const cleanReply = extractedReply.text;
                return <section key={turn.id} className={`nmx-comic-chat-turn nmx-task-turn is-${turn.mode}`} data-turn-id={turn.id}>
                    <div className='nmx-comic-chat-ask'>
                        {view.references.length > 0 && <span className='nmx-comic-chat-ask-refs'>{view.references.map(reference => reference.url
                            ? <button key={reference.id} type='button' className='nmx-comic-chat-ask-ref' title={t('openLarge')} aria-label={t('openLarge')}
                                onClick={() => props.onOpen({ key: `ref:${reference.id}`, kind: 'image', state: 'done', assetId: reference.id, url: reference.url })}>
                                <img src={reference.url} alt='' draggable={false} />
                            </button> : <i key={reference.id} className='codicon codicon-file-media' aria-hidden='true'></i>)}</span>}
                        <ConversationMarkdown markdown={turn.prompt} className='nmx-user-markdown' locale={props.locale} tokenizer={props.markdownTokenizer} onCopyCode={props.onCopy} onRender={props.onRenderMarkdown} />
                        <small className='nmx-comic-chat-meta'>
                            <i className={`codicon codicon-${COMIC_CHAT_MODE_ICONS[turn.mode]}`} aria-hidden='true'></i>{t(turn.mode)}
                            {view.modelLabel && <span data-nmx-literal> · {view.modelLabel}</span>}
                            {settings.length > 0 && <span data-nmx-literal> · {settings.join(' · ')}</span>}
                            {turnTimeLabel && <time dateTime={turn.createdAt} data-nmx-literal>{turnTimeLabel}</time>}
                            <button type='button' className='nmx-comic-chat-copy' aria-label={t('copyPrompt')} title={t('copyPrompt')} onClick={() => props.onCopy(turn.prompt)}>
                                <i className='codicon codicon-copy' aria-hidden='true'></i></button>
                        </small>
                    </div>
                    {turn.from && <p className='nmx-comic-chat-divert'><i className='codicon codicon-comment-discussion' aria-hidden='true'></i>
                        <span>{t('asChat', { kind: t(turn.from) })}</span></p>}
                    {turn.mode === 'agent'
                        ? <div className='nmx-comic-chat-answer'>
                            {thoughtContent ? <details className={`nmx-comic-chat-thought ${view.running ? 'is-running' : ''}`} open={Boolean(view.running && !cleanReply)}>
                                <summary className='nmx-comic-chat-thought-summary'>
                                    <i className={`codicon ${view.running && !cleanReply ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`} aria-hidden='true'></i>
                                    <span data-nmx-literal={Boolean(view.running && view.progress) || undefined}>{view.running && !cleanReply ? (view.progress || t('thinking')) : t('thoughtProcess')}</span>
                                    <i className='codicon codicon-chevron-right nmx-comic-chat-thought-chevron' aria-hidden='true'></i>
                                </summary>
                                <div className='nmx-comic-chat-thought-body'>
                                    <ConversationMarkdown markdown={thoughtContent} className='nmx-thought-markdown' locale={props.locale} tokenizer={props.markdownTokenizer} onCopyCode={props.onCopy} onRender={props.onRenderMarkdown} />
                                </div>
                            </details> : view.running && !cleanReply ? <p className='nmx-comic-chat-thinking' role='status'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>
                                <span data-nmx-literal={Boolean(view.progress) || undefined}>{view.progress || t('thinking')}</span></p> : null}
                            {cleanReply ? <StreamText text={cleanReply} streaming={Boolean(view.running)}
                                markdownKey={`comic-turn:${turn.id}`}
                                renderMarkdown={(segment, key) => <ConversationMarkdown key={key} markdown={segment}
                                    className='nmx-assistant-markdown' locale={props.locale} tokenizer={props.markdownTokenizer}
                                    onCopyCode={props.onCopy} onRender={props.onRenderMarkdown} />} /> : null}
                            {view.running && cleanReply && view.progress ? <p className='nmx-comic-chat-thinking' role='status'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>
                                <span data-nmx-literal>{view.progress}</span></p> : null}
                            {view.proposals.length > 0 && <div className='nmx-comic-chat-proposals'>
                                <header><strong>{t('suggestions', { n: view.proposals.length })}</strong>
                                    {pending.length > 1 && <button type='button' className='nmx-primary-button' onClick={() => props.onGenerate(turn.id, pending.map(item => item.proposal.id))}>
                                        <i className='codicon codicon-sparkle' aria-hidden='true'></i>{t('generateAll')}</button>}</header>
                                {view.proposals.map(item => <article key={item.proposal.id} className={`nmx-comic-chat-proposal is-${item.proposal.kind}`}>
                                    <div className='nmx-comic-chat-proposal-copy'>
                                        <span><i className={`codicon codicon-${COMIC_CHAT_MODE_ICONS[item.proposal.kind]}`} aria-hidden='true'></i>{t(item.proposal.kind)}
                                            {item.proposal.aspect && <em data-nmx-literal>{item.proposal.aspect}</em>}
                                            {item.proposal.seconds && item.proposal.kind === 'video' && <em>{t('seconds', { n: item.proposal.seconds })}</em>}</span>
                                        {item.proposal.title && <strong data-nmx-literal>{item.proposal.title}</strong>}
                                        <p data-nmx-literal>{item.proposal.prompt}</p>
                                    </div>
                                    {item.proposal.jobIds?.length ? <div className={`nmx-comic-chat-results is-${item.proposal.kind}`}>{item.media.map(tile)}</div>
                                        : <footer>{item.blocked ? <small className='is-error'>{item.blocked}</small> : item.estimate ? <small data-nmx-literal>{item.estimate}</small> : null}
                                            <button type='button' disabled={Boolean(item.blocked)} onClick={() => props.onGenerate(turn.id, [item.proposal.id])}>{t('generate')}</button></footer>}
                                </article>)}
                            </div>}
                            {!view.running && cleanReply && <div className='nmx-comic-chat-turn-actions nmx-turn-copy'>
                                {(['up', 'down'] as const).map(vote => {
                                    const pressed = props.feedbackByTurnId?.[turn.id] === vote;
                                    const submitting = props.feedbackSubmitting?.[turn.id];
                                    const label = props.feedbackLabels?.[vote];
                                    return <button key={vote} type='button' data-relay-feedback={vote}
                                        className={`nmx-relay-feedback${pressed ? vote === 'up' ? ' is-active' : ' is-active is-negative' : ''}`}
                                        aria-label={label} title={label} data-help={label} aria-pressed={pressed} aria-busy={submitting === vote} disabled={submitting !== undefined}
                                        onClick={() => props.onFeedback?.(turn.id, vote)}>
                                        <i className={`codicon codicon-${submitting === vote ? 'loading codicon-modifier-spin' : vote === 'up' ? 'thumbsup' : 'thumbsdown'}`} aria-hidden='true'></i>
                                    </button>;
                                })}
                                {props.onReadAloud && <button type='button' data-message-action='read-aloud'
                                    className={`nmx-turn-read-aloud${props.readingTurnId === turn.id ? props.readAloudPreparing ? ' is-preparing' : ' is-active' : ''}`}
                                    aria-label={props.readAloudLabel?.(turn.id)} title={props.readAloudLabel?.(turn.id)} data-help={props.readAloudLabel?.(turn.id)} aria-pressed={props.readingTurnId === turn.id}
                                    onClick={() => props.onReadAloud?.(turn.id, cleanReply)}><i className={`codicon codicon-${props.readingTurnId !== turn.id ? 'unmute' : props.readAloudPreparing ? 'loading codicon-modifier-spin' : 'debug-stop'}`} aria-hidden='true'></i></button>}
                            </div>}
                        </div>
                        : view.media.length > 0 && <div className={`nmx-comic-chat-results is-${turn.mode} is-count-${Math.min(4, view.media.length)}`}>{view.media.map(tile)}</div>}
                    {turn.error && <p className='nmx-comic-chat-error' role='alert' data-nmx-literal>{turn.error}</p>}
                </section>;
            })}
        </div>
    </div>;
}

export interface ComicChatMenuItem {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly disabled?: boolean;
    readonly separatorBefore?: boolean;
}

/** A small menu at the pointer: Escape, a click elsewhere, scrolling or leaving the window closes it. */
export function ComicChatMenu(props: { readonly x: number; readonly y: number; readonly items: readonly ComicChatMenuItem[]; readonly onPick: (id: string) => void; readonly onClose: () => void }): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const [place, setPlace] = React.useState({ left: props.x, top: props.y });
    React.useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        setPlace({ left: Math.max(8, Math.min(props.x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(props.y, window.innerHeight - rect.height - 8)) });
        element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }, [props.x, props.y]);
    React.useEffect(() => {
        const close = (event: Event): void => { if (event.type === 'keydown' ? (event as KeyboardEvent).key === 'Escape' : !ref.current?.contains(event.target as Node)) props.onClose(); };
        const leave = (): void => props.onClose();
        window.addEventListener('mousedown', close, true);
        window.addEventListener('keydown', close, true);
        window.addEventListener('blur', leave);
        window.addEventListener('scroll', leave, true);
        return () => {
            window.removeEventListener('mousedown', close, true);
            window.removeEventListener('keydown', close, true);
            window.removeEventListener('blur', leave);
            window.removeEventListener('scroll', leave, true);
        };
    }, [props.onClose]);
    return <div ref={ref} className='nmx-comic-chat-menu' role='menu' style={place} onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
        }}>
        {props.items.map(item => <React.Fragment key={item.id}>
            {item.separatorBefore && <span className='nmx-comic-chat-menu-separator' role='separator'></span>}
            <button type='button' role='menuitem' disabled={item.disabled} onClick={() => { props.onPick(item.id); props.onClose(); }}>
                <i className={`codicon codicon-${item.icon}`} aria-hidden='true'></i><span>{item.label}</span></button>
        </React.Fragment>)}
    </div>;
}

export interface ComicChatReferenceView {
    readonly key: string;
    readonly url?: string;
    readonly name: string;
    readonly kind?: 'image' | 'video';
}

/** One model of the chosen relay on a tab of the model panel. */
export interface ComicChatModelOption {
    /** Its key for this tab's function. */
    readonly key: string;
    readonly label: string;
    readonly note?: string;
    /** The same model at this relay for every function it serves: mode → its key there. */
    readonly also: Partial<Record<ComicChatMode, string>>;
}

export interface ComicChatModelTab {
    readonly mode: ComicChatMode;
    readonly selected?: { readonly key: string; readonly label: string };
    readonly options: readonly ComicChatModelOption[];
}

/**
 * 推荐模型 on: every function uses the model the platform recommends for it (the defaults staff set for the four
 * kinds), and nothing else is shown. Off: the relay picker and the model panel slide out to the left of the switch;
 * the panel has one tab per function, so a different model can serve each, or one model every function it supports.
 */
export interface ComicChatModelPicker {
    readonly recommended: boolean;
    readonly relays: readonly { readonly key: string; readonly label: string; readonly kind: string; readonly modes: readonly ComicChatMode[] }[];
    readonly relay?: { readonly key: string; readonly label: string; readonly kind: string };
    readonly tabs: readonly ComicChatModelTab[];
    /** 推荐模型: which model each function uses now, one line per function, for the switch's tooltip. */
    readonly summary: string;
}

export interface ComicChatCastPick {
    readonly id: string;
    readonly name: string;
    readonly url?: string;
}

export interface ComicChatComposerProps {
    readonly locale: NextMuxDesktopLocale;
    readonly mode: ComicChatMode;
    readonly prompt: string;
    readonly params: ComicChatParams;
    readonly references: readonly ComicChatReferenceView[];
    /** How many reference pictures this mode and model take (0: none). */
    readonly referenceLimit: number;
    /** Video: the picture becomes the first frame. */
    readonly firstFrame: boolean;
    readonly aspects: readonly ComicChatAspect[];
    readonly secondsChoices: readonly number[];
    readonly soundChoice: boolean;
    readonly voices: readonly string[];
    readonly picker: ComicChatModelPicker;
    /** The model the current mode uses (none: 发送 is off). */
    readonly model?: { readonly key: string; readonly label: string };
    readonly estimate?: string;
    readonly running: boolean;
    readonly sending: boolean;
    /** Why 发送 is off (empty prompt aside); shown as its tooltip and under the composer. */
    readonly blocked?: string;
    readonly voiceActive: boolean;
    readonly voicePhase?: NativeDictationPhase;
    readonly voiceActivity: DictationActivity;
    readonly keyboardSubmitDisabled?: boolean;
    /** The conversation's folder; none: a new conversation not filed in a folder yet (it goes under 最近). */
    readonly folder?: { readonly label: string; readonly path: string };
    /** An existing conversation stays in its folder. */
    readonly folderFixed: boolean;
    readonly cast: readonly ComicChatCastPick[];
    readonly notice?: string;
    readonly error?: string;
    readonly onMode: (mode: ComicChatMode) => void;
    readonly onPrompt: (value: string) => void;
    readonly onParams: (patch: ComicChatParams) => void;
    readonly onSend: () => void;
    readonly onStop: () => void;
    readonly onRecommended: (on: boolean) => void;
    /** Opens the relay drawer (the coding composer's own, rendered by the widget next to this button). */
    readonly onOpenRelay: () => void;
    readonly relayOpen: boolean;
    readonly onOpenModel?: () => void;
    readonly modelOpen?: boolean;
    readonly onSignIn?: () => void;
    readonly onModel: (mode: ComicChatMode, key: string) => void;
    readonly onModels: (keys: Partial<Record<ComicChatMode, string>>) => void;
    /** Pictures (references) and videos (kept as materials) from disk. */
    readonly onFiles: (files: readonly File[]) => void;
    readonly onPickMaterials: () => void;
    readonly onPickCast: (id: string) => void;
    readonly onOpenCast: () => void;
    readonly onRemoveReference: (key: string) => void;
    readonly onVoice: () => void;
    readonly onChooseFolder: () => void;
    readonly onClearFolder: () => void;
    readonly onSetUpModels: () => void;
    readonly textareaRef?: React.Ref<HTMLTextAreaElement>;
}

const MEDIA_FILE = /^(image\/(png|jpe?g|webp)|video\/(mp4|quicktime|webm))$/i;

export function ComicChatComposer(props: ComicChatComposerProps): React.ReactElement {
    const t = (key: ComicChatTextKey, values?: Readonly<Record<string, string | number>>): string => comicChatText(props.locale, key, values);
    const [popover, setPopover] = React.useState<'add' | 'cast' | 'models'>();
    const [tab, setTab] = React.useState<ComicChatMode>(props.mode);
    const [dragging, setDragging] = React.useState(false);
    const composing = React.useRef(false);
    const box = React.useRef<HTMLDivElement>(null);
    const fileInput = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (!popover) return;
        // A press anywhere but the open drawer and the button that opened it closes it: the message box too.
        // The press still reaches what was pressed (the box takes the caret at once).
        const close = (event: Event): void => {
            if (event.type === 'keydown') { if ((event as KeyboardEvent).key === 'Escape') setPopover(undefined); return; }
            const target = event.target as Element | null;
            if (target?.closest?.('.nmx-comic-chat-popover, [data-nmx-chat-toggle], .nmx-offering-price-pop, .nmx-model-price-overlay-drawer')) return;
            setPopover(undefined);
        };
        window.addEventListener('pointerdown', close, true);
        window.addEventListener('keydown', close, true);
        return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', close, true); };
    }, [popover]);
    // The model panel opens on the mode being written in.
    React.useEffect(() => { if (popover !== 'models') setTab(props.mode); }, [props.mode, popover]);
    const canSend = Boolean(props.prompt.trim()) && !props.blocked && !props.sending && Boolean(props.model);
    const media = (list: FileList | null | undefined): File[] => [...(list || [])].filter(file => MEDIA_FILE.test(file.type));
    const rows = Math.max(2, Math.min(8, props.prompt.split('\n').length));
    const picker = props.picker;
    const current = picker.tabs.find(item => item.mode === tab) || picker.tabs[0];
    const modeLabel = (mode: ComicChatMode): string => t(mode);
    const select = (label: string, value: string, options: readonly (readonly [string, string])[], change: (value: string) => void) =>
        <label className='nmx-comic-chat-chip' title={label}><span className='nmx-visually-hidden'>{label}</span>
            <select value={value} aria-label={label} onChange={event => change(event.currentTarget.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
            <i className='codicon codicon-chevron-down' aria-hidden='true'></i></label>;
    const relayIcon = (kind: string | undefined): string => kind === 'official' ? 'verified-filled' : kind === 'automatic' ? 'sparkle' : kind === 'local' ? 'vm' : 'server-environment';
    const isModelOpen = props.onOpenModel ? Boolean(props.modelOpen) : popover === 'models';
    return <div className='nmx-comic-chat-dock'>
        <div className={`nmx-composer-wrap is-rows-${rows > 4 ? 'many' : 'few'}`} ref={box}>
            <div className='nmx-comic-chat-modes'>
                {/* The folder this conversation is filed in sits before the functions, outside the message box. */}
                {props.folder
                    ? <span className='nmx-composer-project-chip nmx-comic-chat-folder' title={props.folder.path}><i className='codicon codicon-folder' aria-hidden='true'></i><b data-nmx-literal>{props.folder.label}</b>
                        {!props.folderFixed && <button type='button' aria-label={t('clearFolder')} title={t('clearFolder')} onClick={props.onClearFolder}><i className='codicon codicon-close' aria-hidden='true'></i></button>}</span>
                    : !props.folderFixed && <button type='button' className='nmx-composer-project-select nmx-comic-chat-folder' title={t('chooseFolderHint')} onClick={props.onChooseFolder}>
                        <i className='codicon codicon-folder-opened' aria-hidden='true'></i><span>{t('chooseFolder')}</span></button>}
                <div role='tablist' aria-label={t('skills')}>
                    {COMIC_CHAT_UI_MODES.map(mode => <button key={mode} type='button' role='tab' aria-selected={props.mode === mode} className={props.mode === mode ? 'is-active' : ''}
                        disabled={props.running} onClick={() => props.onMode(mode)}>
                        <i className={`codicon codicon-${COMIC_CHAT_MODE_ICONS[mode]}`} aria-hidden='true'></i><span>{t(mode)}</span></button>)}
                    {/* 配音 has no tab of its own: chosen through its skill card, it shows here until the user leaves it. */}
                    {props.mode === 'speech' && <button type='button' role='tab' aria-selected className='is-active nmx-comic-chat-voice-mode' disabled={props.running}
                        title={t('leaveVoice')} aria-label={`${t('speech')} · ${t('leaveVoice')}`} onClick={() => props.onMode('image')}>
                        <i className={`codicon codicon-${COMIC_CHAT_MODE_ICONS.speech}`} aria-hidden='true'></i><span>{t('speech')}</span>
                        <i className='codicon codicon-close' aria-hidden='true'></i></button>}
                </div>
                <div className='nmx-comic-chat-mode-params'>
                    {(props.mode === 'image' || props.mode === 'video') && props.aspects.length > 0 && select(t('aspect'), props.params.aspect || props.aspects[0],
                        props.aspects.map(aspect => [aspect, aspect] as const), value => props.onParams({ aspect: value as ComicChatAspect }))}
                    {props.mode === 'image' && select(t('count', { n: props.params.count || 1 }), String(props.params.count || 1), [1, 2, 3, 4].map(n => [String(n), t('count', { n })] as const),
                        value => props.onParams({ count: Number(value) }))}
                    {props.mode === 'video' && props.secondsChoices.length > 0 && select(t('seconds', { n: '' }).trim(), String(props.params.seconds || props.secondsChoices[0]),
                        props.secondsChoices.map(n => [String(n), t('seconds', { n })] as const), value => props.onParams({ seconds: Number(value) }))}
                    {props.mode === 'video' && props.soundChoice && select(props.params.sound === false ? t('noSound') : t('sound'), props.params.sound === false ? 'off' : 'on',
                        [['on', t('sound')], ['off', t('noSound')]], value => props.onParams({ sound: value === 'on' }))}
                    {props.mode === 'music' && select(props.params.instrumental === false ? t('withVocals') : t('instrumental'), props.params.instrumental === false ? 'vocals' : 'instrumental',
                        [['instrumental', t('instrumental')], ['vocals', t('withVocals')]], value => props.onParams({ instrumental: value === 'instrumental' }))}
                    {props.mode === 'music' && select(props.params.seconds === 180 ? t('songFull') : t('songClip'), String(props.params.seconds === 180 ? 180 : 30),
                        [['30', t('songClip')], ['180', t('songFull')]], value => props.onParams({ seconds: Number(value) }))}
                    {props.mode === 'speech' && props.voices.length > 0 && select(t('voice'), props.params.voice || props.voices[0],
                        props.voices.map(voice => [voice, voice] as const), value => props.onParams({ voice: value }))}
                </div>
            </div>
            <div className={`nmx-composer ${dragging ? 'is-dragging' : ''}`}
                onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!dragging) setDragging(true); } }}
                onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
                onDrop={event => {
                    setDragging(false);
                    const files = media(event.dataTransfer.files);
                    if (!files.length) return;
                    event.preventDefault();
                    props.onFiles(files);
                }}>
                {dragging && <div className='nmx-comic-chat-drop' aria-hidden='true'><i className='codicon codicon-file-media'></i><span>{t('dropHint')}</span></div>}
                {props.references.length > 0 && <div className='nmx-composer-assets nmx-comic-chat-refs'>
                    {props.references.map((reference, index) => <span key={reference.key} className='nmx-comic-chat-ref' title={reference.name}>
                        {reference.url ? <img src={reference.url} alt='' draggable={false} /> : <i className='codicon codicon-file-media' aria-hidden='true'></i>}
                        <small>{props.firstFrame && index === 0 ? t('firstFrame') : t('reference')}</small>
                        <button type='button' aria-label={`${t('remove')} · ${reference.name}`} title={t('remove')} onClick={() => props.onRemoveReference(reference.key)}>
                            <i className='codicon codicon-close' aria-hidden='true'></i></button>
                    </span>)}
                </div>}
                <div className='nmx-composer-input'>
                    <ImeTextarea ref={props.textareaRef} value={props.prompt} rows={rows} maxLength={props.mode === 'speech' ? 8_000 : COMIC_CHAT_LIMITS.prompt}
                        placeholder={localizeDesktopSurface(props.locale, '发送消息或描述任务')}
                        onChange={event => props.onPrompt(event.currentTarget.value)}
                        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
                        onPaste={event => {
                            const files = media(event.clipboardData?.files);
                            if (!files.length) return;
                            event.preventDefault();
                            props.onFiles(files);
                        }}
                        onKeyDown={event => {
                            if (event.key !== 'Enter' || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || props.keyboardSubmitDisabled) return;
                            event.preventDefault();
                            if (canSend && !props.running) props.onSend();
                        }} />
                </div>
                <div className='nmx-comic-chat-toolbar'>
                    <span className='nmx-comic-chat-add'>
                        <button type='button' data-nmx-chat-toggle className={`nmx-composer-tool ${popover === 'add' ? 'is-active' : ''}`}
                            title={localizeDesktopSurface(props.locale, '添加内容')} aria-label={localizeDesktopSurface(props.locale, '添加内容')}
                            aria-expanded={popover === 'add'} onClick={() => setPopover(popover ? undefined : 'add')}><i className='codicon codicon-add' aria-hidden='true'></i></button>
                        {popover === 'add' && <div className='nmx-comic-chat-popover is-add' role='menu'>
                            <button type='button' role='menuitem' onClick={() => { setPopover(undefined); fileInput.current?.click(); }}><i className='codicon codicon-cloud-upload' aria-hidden='true'></i>{t('upload')}</button>
                            <button type='button' role='menuitem' onClick={() => { setPopover(undefined); props.onPickMaterials(); }}><i className='codicon codicon-library' aria-hidden='true'></i>{t('fromMaterials')}</button>
                            <small>{props.referenceLimit > 0 ? t('referencesLimit', { n: props.referenceLimit }) : t('noReferencesHere')}</small>
                        </div>}
                        <input ref={fileInput} type='file' hidden multiple accept='image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm'
                            onChange={event => { const files = media(event.currentTarget.files); event.currentTarget.value = ''; if (files.length) props.onFiles(files); }} />
                    </span>
                    <span className='nmx-composer-spacer'></span>
                    <span className='nmx-comic-chat-pickers is-open'>
                        <span className='nmx-comic-chat-drawers'>
                            <button type='button' className={`nmx-composer-relay-button ${props.relayOpen ? 'is-active' : ''}`} aria-expanded={props.relayOpen}
                                title={picker.relay?.label || relayText(props.locale, 'selectRelay')} aria-label={relayText(props.locale, 'selectRelay')}
                                onClick={() => { setPopover(undefined); props.onOpenRelay(); }}>
                                <i className={`codicon codicon-${relayIcon(picker.relay?.kind)}`} aria-hidden='true'></i>
                                <span data-nmx-literal={Boolean(picker.relay) || undefined}>{picker.relay?.label || relayText(props.locale, 'selectRelay')}</span><i className='codicon codicon-chevron-down' aria-hidden='true'></i></button>
                            <button type='button' data-nmx-chat-toggle className={`nmx-route-button ${isModelOpen ? 'is-active' : ''}`} aria-expanded={isModelOpen}
                                title={props.model?.label || t('selectModel')}
                                disabled={!picker.relay && !props.model}
                                onClick={() => { if (props.onOpenModel) { setPopover(undefined); props.onOpenModel(); } else { setPopover(popover === 'models' ? undefined : 'models'); } }}>
                                <i className='codicon codicon-zap' aria-hidden='true'></i>
                                <span data-nmx-literal={Boolean(props.model) || undefined}>{props.model?.label || t('selectModel')}</span>
                                <i className='codicon codicon-chevron-down' aria-hidden='true'></i></button>
                        </span>
                        {!props.onOpenModel && popover === 'models' && current && <div className='nmx-comic-chat-popover is-models' data-comic-model-panel role='dialog' aria-label={t('selectModel')}>
                            <header><span data-nmx-literal={Boolean(picker.relay) || undefined}>{picker.relay?.label || t('selectModel')}</span>
                                <button type='button' className='nmx-link-button' onClick={() => { setPopover(undefined); props.onOpenRelay(); }}>{t('changeRelay')}</button></header>
                            <div className='nmx-comic-chat-model-tabs' role='tablist'>
                                {picker.tabs.map(item => <button key={item.mode} type='button' role='tab' aria-selected={item.mode === current.mode}
                                    className={`${item.mode === current.mode ? 'is-active' : ''} ${item.selected ? 'is-set' : ''}`}
                                    onClick={() => { setTab(item.mode); props.onMode(item.mode); }}>
                                    <i className={`codicon codicon-${COMIC_CHAT_MODE_ICONS[item.mode]}`} aria-hidden='true'></i><strong>{modeLabel(item.mode)}</strong>
                                    <small data-nmx-literal={Boolean(item.selected) || undefined}>{item.selected?.label || t('noModelFor')}</small></button>)}
                            </div>
                            {current.options.length ? <div className='nmx-comic-chat-model-list' role='listbox' aria-label={modeLabel(current.mode)}>
                                {current.options.map(option => {
                                    const selected = option.key === current.selected?.key;
                                    const others = (Object.keys(option.also) as ComicChatMode[]).filter(mode => mode !== current.mode);
                                    const allSet = others.every(mode => picker.tabs.find(item => item.mode === mode)?.selected?.key === option.also[mode]);
                                    return <div key={option.key} className={`nmx-comic-chat-model ${selected ? 'is-active' : ''}`}>
                                        <button type='button' role='option' aria-selected={selected} onClick={() => props.onModel(current.mode, option.key)}>
                                            <span data-nmx-literal>{option.label}</span>
                                            <span className='nmx-comic-chat-caps'>{(Object.keys(option.also) as ComicChatMode[]).map(mode => <em key={mode} className={mode === current.mode ? 'is-here' : ''}>{modeLabel(mode)}</em>)}</span>
                                            {option.note && <small data-nmx-literal>{option.note}</small>}
                                            {selected && <i className='codicon codicon-check' aria-hidden='true'></i>}</button>
                                        {others.length > 0 && <button type='button' className='nmx-comic-chat-model-all' disabled={selected && allSet}
                                            title={t('useForAllHint', { list: [current.mode, ...others].map(modeLabel).join('、') })} onClick={() => props.onModels(option.also)}>{t('useForAll')}</button>}
                                    </div>;
                                })}
                            </div> : <p className='nmx-comic-chat-model-empty'>{t('noModelHere', { kind: modeLabel(current.mode) })}
                                <button type='button' className='nmx-link-button' onClick={() => { setPopover(undefined); props.onSetUpModels(); }}>{t('setUpModels')}</button></p>}
                        </div>}
                    </span>
                    <DictationButton locale={props.locale} active={props.voiceActive} phase={props.voicePhase}
                        activity={props.voiceActivity} onClick={props.onVoice} />
                    {props.running
                        ? <button type='button' className='nmx-send-button is-stop' aria-label={t('stop')} title={t('stop')} onClick={props.onStop}><i className='codicon codicon-debug-stop' aria-hidden='true'></i></button>
                        : <button type='button' className='nmx-send-button' disabled={!canSend} aria-label={localizeDesktopSurface(props.locale, '发送')}
                            title={props.blocked || localizeDesktopSurface(props.locale, '发送')} onClick={props.onSend}>
                            {props.sending ? <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i> : <i className='codicon codicon-arrow-up' aria-hidden='true'></i>}</button>}
                </div>
            </div>
            <div className='nmx-composer-below nmx-comic-chat-below'>
                {/* The left keeps only the cost estimate (a status, not a notice). */}
                {props.model && !props.blocked && props.estimate ? <span className='nmx-comic-chat-note' data-nmx-literal title={props.estimate}>{props.estimate}</span> : null}
                {(() => {
                    // One notice at a time, in the corner: a failure, then the latest notice, then what keeps Send disabled.
                    const text = props.error || props.notice || (!props.model ? t('noModel') : props.blocked || '');
                    if (!text) return null;
                    const tone = props.error ? 'is-error' : props.notice ? 'is-info' : 'is-warning';
                    const needsSignIn = text === t('signInNeeded') || text === t('signIn') || text === relayText(props.locale, 'signInRequired');
                    return <div className={`nmx-route-price-notice nmx-council-below-notice ${tone}`} role='status' title={text}>
                        <i className={`codicon codicon-${props.error ? 'error' : props.notice ? 'info' : 'warning'}`} aria-hidden='true' /><span data-nmx-literal>{text}</span>
                        {needsSignIn && props.onSignIn
                            ? <button type='button' className='nmx-council-below-action' onClick={props.onSignIn}>{t('signIn')}</button>
                            : !props.error && !props.notice && !props.model && <button type='button' className='nmx-council-below-action' onClick={props.onSetUpModels}>{t('setUpModels')}</button>}
                    </div>;
                })()}
            </div>
        </div>
    </div>;
}

export interface ComicMaterialView {
    readonly assetId: string;
    readonly kind: 'image' | 'video' | 'audio';
    readonly category?: 'character' | 'image' | 'other';
    readonly libraryAssetId?: string;
    readonly url?: string;
    readonly title: string;
    readonly origin: 'chat' | 'flow' | 'imported';
    readonly prompt?: string;
    readonly aspect?: ComicChatAspect;
    readonly updatedAt: string;
    /** From another project (全部素材): its name, and the file, copied into this project when it is used. */
    readonly project?: string;
    readonly path?: string;
}

export type ComicMaterialScope = 'chat' | 'project' | 'all';

/**
 * 素材库: the pictures, clips and sounds the user kept (right-click → 加入素材库), most recently kept first — of this
 * conversation, of the whole folder, or of every folder and project. In “pick” mode a click chooses a reference picture.
 */
export function ComicMaterialsPanel(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly items: readonly ComicMaterialView[];
    readonly scope: ComicMaterialScope;
    /** Scopes offered: a new conversation has no 本对话 yet. */
    readonly scopes: readonly ComicMaterialScope[];
    readonly loading?: boolean;
    /** What an empty list says (an empty 素材库 explains how to keep materials). */
    readonly emptyText?: string;
    readonly focus?: string;
    readonly pick?: 'image';
    readonly onScope: (scope: ComicMaterialScope) => void;
    readonly onPick?: (item: ComicMaterialView) => void;
    readonly onOpen: (item: ComicMaterialView) => void;
    readonly onMenu: (item: ComicMaterialView, event: React.MouseEvent) => void;
    readonly onClose: () => void;
}): React.ReactElement {
    const t = (key: ComicChatTextKey, values?: Readonly<Record<string, string | number>>): string => comicChatText(props.locale, key, values);
    const [kind, setKind] = React.useState<'all' | 'image' | 'character' | 'video' | 'audio'>('all');
    const panel = React.useRef<HTMLElement>(null);
    React.useEffect(() => {
        if (props.pick && (kind === 'video' || kind === 'audio')) setKind('all');
    }, [props.pick, kind]);
    React.useEffect(() => {
        panel.current?.focus();
        if (props.focus) panel.current?.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(props.focus)}"]`)?.scrollIntoView({ block: 'center' });
    }, [props.focus]);
    React.useEffect(() => {
        const handleOutsidePress = (event: Event): void => {
            const raw = event.target as Node | null;
            const target = raw instanceof Element ? raw : raw?.parentElement ?? null;
            if (!target || panel.current?.contains(target)) return;
            if (target.closest('[data-nmx-library-button], .nmx-comic-materials-btn')) return;
            props.onClose();
        };
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                props.onClose();
            }
        };
        window.addEventListener('pointerdown', handleOutsidePress, true);
        window.addEventListener('mousedown', handleOutsidePress, true);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('pointerdown', handleOutsidePress, true);
            window.removeEventListener('mousedown', handleOutsidePress, true);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [props.onClose]);
    const matchesKind = (item: ComicMaterialView, filter: 'all' | 'image' | 'character' | 'video' | 'audio'): boolean => {
        if (filter === 'all') return true;
        if (filter === 'character') return item.category === 'character';
        if (filter === 'image') return item.kind === 'image' && item.category !== 'character';
        return item.kind === filter;
    };
    const shown = props.items.filter(item => matchesKind(item, kind));
    const kinds: readonly (readonly ['all' | 'image' | 'character' | 'video' | 'audio', ComicChatTextKey])[] = props.pick
        ? [['all', 'all'], ['image', 'images'], ['character', 'character']]
        : [['all', 'all'], ['image', 'images'], ['character', 'character'], ['video', 'videos'], ['audio', 'audio']];
    const scopeLabel: Readonly<Record<ComicMaterialScope, ComicChatTextKey>> = { chat: 'scopeChat', project: 'scopeProject', all: 'scopeAll' };
    return <aside ref={panel} tabIndex={-1} className={`nmx-comic-materials ${props.pick ? 'is-picking' : ''}`} aria-label={t('materials')}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); props.onClose(); } }}>
        <header>
            <div><strong>{props.pick ? t('fromMaterials') : t('materials')}</strong><small>{t('materialsLead')}</small></div>
            <button type='button' className='nmx-comic-materials-close' aria-label={t('close')} title={t('close')} onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
        </header>
        <div className='nmx-comic-materials-scope' role='tablist' aria-label={t('materials')}>
            {props.scopes.map(scope => <button key={scope} type='button' role='tab' aria-selected={props.scope === scope} className={props.scope === scope ? 'is-active' : ''}
                onClick={() => props.onScope(scope)}>{t(scopeLabel[scope])}</button>)}
        </div>
        <div className='nmx-comic-materials-filters'>
            <div role='tablist' aria-label={t('materials')}>{kinds.map(([id, label]) => <button key={id} type='button' role='tab' aria-selected={kind === id}
                className={kind === id ? 'is-active' : ''} onClick={() => setKind(id)}>{t(label)}<b data-nmx-literal>{props.items.filter(item => matchesKind(item, id)).length}</b></button>)}</div>
        </div>
        {props.loading ? <p className='nmx-comic-materials-empty'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i> {t('loadingChats')}</p>
            : shown.length === 0 ? <p className='nmx-comic-materials-empty'>{props.items.length === 0 && props.emptyText || t('noMaterials')}</p>
            : <div className='nmx-comic-materials-grid' role='list'>{shown.map(item => <button key={`${item.path || ''}${item.assetId}`} type='button' role='listitem' data-asset-id={item.assetId}
                className={`nmx-comic-material is-${item.kind} ${item.assetId === props.focus ? 'is-focus' : ''}`} title={item.prompt || item.title}
                onClick={() => props.pick ? props.onPick?.(item) : props.onOpen(item)} onContextMenu={event => { event.preventDefault(); props.onMenu(item, event); }}>
                <span className='nmx-comic-material-thumb' style={item.kind === 'audio' ? undefined : aspectStyle(item.aspect)}>
                    {item.kind === 'image' && item.url ? <img src={item.url} alt='' loading='lazy' draggable={false} />
                        : item.kind === 'video' && item.url ? <video src={item.url} preload='metadata' muted playsInline />
                            : <i className={`codicon codicon-${item.kind === 'audio' ? 'music' : 'file-media'}`} aria-hidden='true'></i>}
                    {item.kind === 'video' && <i className='codicon codicon-play nmx-comic-material-play' aria-hidden='true'></i>}
                </span>
                <strong data-nmx-literal>{item.title}</strong>
                <small data-nmx-literal={item.project ? true : undefined}>{item.project || t(item.origin === 'chat' ? 'fromChat' : item.origin === 'flow' ? 'fromFlow' : 'imported')}</small>
            </button>)}</div>}
    </aside>;
}
