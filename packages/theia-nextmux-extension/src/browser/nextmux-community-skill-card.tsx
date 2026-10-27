import { skillDomainMessage } from './nextmux-skill-domain-locale';
import * as React from 'react';
import type { DesktopCommunitySkill, DesktopCommunitySkillInstallReview, DesktopCommunitySkillMetadata } from '../common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { communitySkillText as text } from './nextmux-community-skill-locale';

export function communitySkillReview(skill: DesktopCommunitySkill, acknowledgedToken: string | undefined): DesktopCommunitySkillInstallReview | undefined {
    const token = skill.permissionChange?.reviewToken;
    return skill.permissionChange?.requiresReview && token && token === acknowledgedToken
        ? { reviewToken: token, permissionChangeAcknowledged: true } : undefined;
}

function modeText(locale: NextMuxDesktopLocale, mode?: DesktopCommunitySkillMetadata['tools']['mode']): string {
    return text(locale, mode === 'inherit' || mode === 'restricted' || mode === 'invalid' ? mode : 'unknown');
}

export function CommunitySkillDetails({ skill, locale }: { readonly skill: DesktopCommunitySkill; readonly locale: NextMuxDesktopLocale }): React.ReactElement {
    const metadata = skill.metadata;
    const list = (values: readonly string[] | undefined) => values?.length ? values.slice(0, 32).join(', ') : '—';
    const declared = (value: { readonly status: string; readonly values?: readonly string[]; readonly items?: readonly string[] } | undefined) =>
        value?.status === 'declared' ? list(value.values || value.items) : text(locale, 'unknown');
    return <details className='nmx-community-skill-details' data-nmx-literal>
        <summary>{text(locale, 'details')}</summary>
        <dl>
            <dt>{text(locale, 'license')}</dt><dd>{metadata?.license.status === 'declared' ? metadata.license.value : text(locale, 'unknown')}</dd>
            <dt>{text(locale, 'os')}</dt><dd>{declared(metadata?.compatibility.operatingSystems)}</dd>
            <dt>{text(locale, 'cpu')}</dt><dd>{declared(metadata?.compatibility.architectures)}</dd>
            <dt>{text(locale, 'dependencies')}</dt><dd>{declared(metadata?.dependencies)}</dd>
            <dt>{text(locale, 'tools')}</dt><dd>{modeText(locale, metadata?.tools.mode)}{metadata?.tools.mode === 'restricted' && <bdi dir='auto'>{list(metadata.tools.allowedToolNames)}</bdi>}</dd>
            <dt>{text(locale, 'source')}</dt><dd>{text(locale, metadata?.source.status === 'verified' ? 'verified' : metadata?.source.status === 'modified' ? 'modified' : 'unknown')}
                <bdi dir='ltr'>{metadata?.source.repository || skill.repository} / {metadata?.source.path || skill.path}</bdi>
                <bdi dir='ltr'>{metadata?.source.revision || skill.sourceRevision || text(locale, 'unknown')}</bdi>
                {metadata?.source.treeSha && <bdi dir='ltr'>tree: {metadata.source.treeSha}</bdi>}
                {metadata?.source.blobSha && <bdi dir='ltr'>blob: {metadata.source.blobSha}</bdi>}
                {metadata?.source.sha256 && <bdi dir='ltr'>SHA-256: {metadata.source.sha256}</bdi>}
            </dd>
        </dl>
        {metadata?.compatibility.notes && <p>{metadata.compatibility.notes}</p>}
        {!!metadata?.issues.length && <small>{text(locale, 'issues')}: {list(metadata.issues)}</small>}
        <p>{text(locale, 'boundary')}</p>
    </details>;
}

export interface CommunitySkillCardProps {
    readonly skill: DesktopCommunitySkill;
    readonly locale: NextMuxDesktopLocale;
    readonly busy: boolean;
    readonly blocked: boolean;
    readonly status: string;
    readonly sourceLabel: string;
    readonly removeLabel: string;
    readonly onSource: () => void;
    readonly onRemove: () => void;
    readonly onInstall: (review?: DesktopCommunitySkillInstallReview) => Promise<boolean>;
}

/** Installation review is local to this exact catalog snapshot; it never changes runtime permissions. */
export function CommunitySkillCard({ skill, locale, busy, blocked, status, sourceLabel, removeLabel, onSource, onRemove, onInstall }: CommunitySkillCardProps): React.ReactElement {
    const [reviewing, setReviewing] = React.useState(false);
    const [acknowledgedToken, setAcknowledgedToken] = React.useState<string>();
    const inFlight = React.useRef(false);
    const change = skill.permissionChange;
    const approved = communitySkillReview(skill, acknowledgedToken);
    const perform = async (review?: DesktopCommunitySkillInstallReview): Promise<void> => {
        if (blocked || inFlight.current || (change?.requiresReview && !review)) return;
        inFlight.current = true;
        try { if (await onInstall(review)) { setReviewing(false); setAcknowledgedToken(undefined); } }
        finally { inFlight.current = false; }
    };
    return <article className={`nmx-community-skill-card${skill.installed ? ' is-installed' : ''}`} dir={locale === 'ar' ? 'rtl' : undefined} data-nmx-literal>
        <span className='nmx-community-skill-icon'><i className='codicon codicon-sparkle'></i></span>
        <div><strong>{skill.name}</strong><p>{skill.descriptionMessage ? skillDomainMessage(locale, skill.descriptionMessage) || text(locale, 'unknown') : skill.description}</p><small>{skill.sourceName} · {skill.version.slice(0, 8)}{status}</small>
            <CommunitySkillDetails skill={skill} locale={locale} />
        </div>
        <nav>
            <button aria-label={`${sourceLabel} · ${skill.name}`} title={sourceLabel} onClick={onSource}><i className='codicon codicon-link-external'></i></button>
            {skill.installed && <button className='is-subtle' disabled={blocked} onClick={onRemove}>{removeLabel}</button>}
            <button className={skill.updateAvailable ? 'is-update' : 'is-primary'} disabled={blocked} onClick={() => {
                if (change?.requiresReview) { setAcknowledgedToken(undefined); setReviewing(true); } else void perform();
            }}>{text(locale, busy ? 'busy' : skill.updateAvailable ? 'update' : skill.installed ? 'reinstall' : 'install')}</button>
        </nav>
        {reviewing && <section className='nmx-community-skill-review' aria-label={text(locale, 'review')}>
            <strong>{text(locale, 'review')}</strong>
            <bdi dir='ltr'>{skill.metadata?.source.revision || skill.sourceRevision || text(locale, 'unknown')}</bdi>
            {skill.metadata?.source.sha256 && <bdi dir='ltr'>SHA-256: {skill.metadata.source.sha256}</bdi>}
            <p>{modeText(locale, change?.previousMode)} → {modeText(locale, change?.nextMode)}</p>
            {change?.mayExpand === null && <p>{text(locale, 'reviewUnknown')}</p>}
            {!!change?.added.length && <p>{text(locale, 'added')}: <bdi dir='auto'>{change.added.slice(0, 32).join(', ')}</bdi></p>}
            {!!change?.removed.length && <p>{text(locale, 'removed')}: <bdi dir='auto'>{change.removed.slice(0, 32).join(', ')}</bdi></p>}
            <p>{text(locale, 'boundary')}</p>
            {!change?.reviewToken ? <p role='status'>{text(locale, 'refresh')}</p> : <label><input type='checkbox' checked={Boolean(approved)} disabled={blocked}
                onChange={event => setAcknowledgedToken(event.currentTarget.checked ? change.reviewToken : undefined)} /><span>{text(locale, 'ack')}</span></label>}
            <footer><button disabled={blocked} onClick={() => { setReviewing(false); setAcknowledgedToken(undefined); }}>{text(locale, 'cancel')}</button>
                <button className='is-primary' disabled={blocked || !approved} onClick={() => void perform(approved)}>{text(locale, busy ? 'busy' : 'confirm')}</button></footer>
        </section>}
    </article>;
}
