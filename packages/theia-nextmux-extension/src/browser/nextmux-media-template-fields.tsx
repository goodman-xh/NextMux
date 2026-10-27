import * as React from '@theia/core/shared/react';
import { MEDIA_TEMPLATE_PRESETS, formatMediaSeconds, normalizeMediaTemplate, parseMediaSeconds } from '@nextmux/model-runtime/media-template';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { musicTemplateText, type MusicTemplateLabel } from './nextmux-music-template-locale';

/**
 * 添加连接 → 高级. The basic form stays as it is (name, model, address, key); here a custom API
 * picks what it is — a chat API or a generation API that takes tasks — and, for a generation API,
 * its task format: one of the presets, with every field open to adjustment from the provider's docs.
 */

/** A template being edited: the same shape as a saved one, possibly not valid yet. */
export type MediaTemplateDraft = Record<string, unknown>;

const FIELD_LABELS: Readonly<Record<string, string>> = {
    'submit.path': '提交地址', 'poll.path': '查询地址', downloadPath: '下载地址', 'submit.body': '请求体模板',
    'poll.body': '查询请求体', idField: '任务 ID 字段', statusField: '状态字段', resultField: '结果字段',
    errorField: '错误信息字段', pollUrlField: '查询地址字段', resultUrlField: '结果地址字段', headers: '附加请求头',
    auth: '鉴权方式', images: '图片传递', kind: '生成类型', method: '查询方式', referenceAspect: '参考图画幅'
};

/** What is wrong with a draft, in the user's language (undefined when it can be saved). */
export function mediaTemplateProblem(locale: NextMuxDesktopLocale, draft: MediaTemplateDraft | undefined): string | undefined {
    if (!draft) return undefined;
    try { normalizeMediaTemplate(draft); return undefined; } catch (error) {
        const metadata = error && typeof error === 'object' ? error as { code?: string; params?: { field?: unknown } } : undefined;
        const parameter = metadata?.code === 'media_template_invalid' && typeof metadata.params?.field === 'string' ? metadata.params.field : '';
        const rootField = parameter.split('.')[0];
        if (rootField === 'vocalReference' || rootField === 'referenceSong') return `${localizeDesktopSurface(locale, '接口格式有一项需要修改')}：${musicTemplateText(locale, rootField)}`;
        const field = FIELD_LABELS[parameter];
        return `${localizeDesktopSurface(locale, '接口格式有一项需要修改')}${field ? `：${localizeDesktopSurface(locale, field)}` : ''}`;
    }
}

export function mediaTemplatePresetLabel(locale: NextMuxDesktopLocale, preset: string): string {
    return localizeDesktopSurface(locale, String(MEDIA_TEMPLATE_PRESETS[preset]?.label || preset));
}

/** A preset's full template, ready to edit. */
export function mediaTemplateFromPreset(preset: string): MediaTemplateDraft {
    return { ...normalizeMediaTemplate({ preset }) } as unknown as MediaTemplateDraft;
}

export function MediaTemplateAdvanced(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly disabled: boolean;
    /** Chat API or generation API; only while creating (a saved connection keeps its type). */
    readonly apiType?: { readonly value: 'chat' | 'generation'; readonly onChange: (value: 'chat' | 'generation') => void };
    readonly template?: MediaTemplateDraft;
    readonly mediaApiStyle?: { readonly value: "auto" | "openai" | "openrouter"; readonly onChange: (value: "auto" | "openai" | "openrouter") => void };
    /** The format was picked from the address, not by the user. */
    readonly automatic?: boolean;
    readonly inline?: boolean;
    readonly onTemplate: (template: MediaTemplateDraft) => void;
}): React.ReactElement {
    const t = (text: string): string => localizeDesktopSurface(props.locale, text);
    const mt = (key: MusicTemplateLabel): string => musicTemplateText(props.locale, key);
    const template = props.template;
    const [headersText, setHeadersText] = React.useState(() => JSON.stringify((template?.submit as { headers?: unknown } | undefined)?.headers || {}, null, 0));
    const [headersError, setHeadersError] = React.useState(false);
    React.useEffect(() => {
        setHeadersText(JSON.stringify((template?.submit as { headers?: unknown } | undefined)?.headers || {}));
        setHeadersError(false);
    }, [template?.preset]);
    const set = (patch: MediaTemplateDraft): void => { if (template) props.onTemplate({ ...template, ...patch }); };
    const submit = (template?.submit || {}) as { method?: string; path?: string; body?: string; headers?: Record<string, string> };
    const poll = (template?.poll || {}) as { method?: string; path?: string; body?: string };
    const text = (value: unknown): string => Array.isArray(value) ? value.join(', ') : value === undefined || value === null ? '' : String(value);
    const list = (value: string): string[] => value.split(/[,，]/).map(item => item.trim()).filter(Boolean);
    const auth = String(template?.auth || 'bearer');
    const authStyle = auth.startsWith('header:') ? 'header' : auth.startsWith('query:') ? 'query' : auth;
    const authName = auth.includes(':') ? auth.slice(auth.indexOf(':') + 1) : '';
    const problem = mediaTemplateProblem(props.locale, template);
    const summary = template ? `${t('接口格式')}：${mediaTemplatePresetLabel(props.locale, String(template.preset))}${props.automatic ? ` · ${t('按地址自动识别')}` : ''}`
        : props.apiType ? t('对话（OpenAI 兼容）') : '';
    const row = (label: string, hint: string | undefined, control: React.ReactNode, wide = false): React.ReactNode =>
        <label className={wide ? 'is-wide' : undefined}><span>{t(label)}{hint && <small>{t(hint)}</small>}</span>{control}</label>;
    const body = <>
        {props.mediaApiStyle && <label><span>{t('媒体格式')}</span><select disabled={props.disabled} value={props.mediaApiStyle.value} data-media-api-style-selector='true'
            onChange={event => props.mediaApiStyle!.onChange(event.currentTarget.value === 'openrouter' ? 'openrouter' : event.currentTarget.value === 'openai' ? 'openai' : 'auto')}>
            <option value='auto'>{t('自动')}</option><option value='openai'>OpenAI</option><option value='openrouter'>OpenRouter</option>
        </select></label>}
        {props.apiType && row('接口类型', undefined, <select disabled={props.disabled} value={props.apiType.value}
            onChange={event => props.apiType!.onChange(event.currentTarget.value === 'generation' ? 'generation' : 'chat')}>
            <option value='chat'>{t('对话（OpenAI 兼容）')}</option>
            <option value='generation' data-nmx-literal>{mt('generationApi')}</option>
        </select>)}
        {template && <>
            {row('接口格式', '按预设微调', <select disabled={props.disabled} value={String(template.preset)}
                onChange={event => props.onTemplate(mediaTemplateFromPreset(event.currentTarget.value))}>
                {Object.keys(MEDIA_TEMPLATE_PRESETS).map(id => <option key={id} value={id}>{mediaTemplatePresetLabel(props.locale, id)}</option>)}
            </select>)}
            {row('生成类型', undefined, <select disabled={props.disabled} value={String(template.kind || 'video')} onChange={event => set({ kind: event.currentTarget.value,
                ...(event.currentTarget.value === 'music' ? {} : { vocalReference: undefined, referenceSong: undefined }) })}>
                <option value='video'>{t('视频')}</option><option value='image'>{t('图片')}</option><option value='music' data-nmx-literal>{mt('music')}</option>
            </select>)}
            {row('提交地址', 'POST', <ImeInput disabled={props.disabled} spellCheck={false} value={text(submit.path)} placeholder='{base}/video/create'
                onChange={event => set({ submit: { ...submit, path: event.currentTarget.value } })} />)}
            {row('请求体模板', 'JSON', <ImeTextarea className='nmx-code-field' disabled={props.disabled} spellCheck={false} rows={5} value={text(submit.body)}
                onChange={event => set({ submit: { ...submit, body: event.currentTarget.value } })} />, true)}
            {row('查询地址', undefined, <div className='nmx-inline-pair'>
                <select disabled={props.disabled} value={String(poll.method || 'GET')} onChange={event => set({ poll: { ...poll, method: event.currentTarget.value } })}>
                    <option value='GET'>GET</option><option value='POST'>POST</option></select>
                <ImeInput disabled={props.disabled} spellCheck={false} value={text(poll.path)} placeholder='{base}/video/query?id={id}'
                    onChange={event => set({ poll: { ...poll, path: event.currentTarget.value } })} />
            </div>)}
            {poll.method === 'POST' && row('查询请求体', 'JSON', <ImeTextarea className='nmx-code-field' disabled={props.disabled} spellCheck={false} rows={2} value={text(poll.body)}
                onChange={event => set({ poll: { ...poll, body: event.currentTarget.value } })} />, true)}
            <div className='nmx-official-advanced-grid'>
                {row('任务 ID 字段', undefined, <ImeInput disabled={props.disabled} spellCheck={false} value={text(template.idField)} onChange={event => set({ idField: event.currentTarget.value })} />)}
                {row('状态字段', undefined, <ImeInput disabled={props.disabled} spellCheck={false} value={text(template.statusField)} onChange={event => set({ statusField: event.currentTarget.value })} />)}
                {row('完成状态值', '逗号分隔', <ImeInput disabled={props.disabled} spellCheck={false} value={text(template.doneValues)} onChange={event => set({ doneValues: list(event.currentTarget.value) })} />)}
                {row('失败状态值', '逗号分隔', <ImeInput disabled={props.disabled} spellCheck={false} value={text(template.failedValues)} onChange={event => set({ failedValues: list(event.currentTarget.value) })} />)}
                {row('结果字段', undefined, <ImeInput disabled={props.disabled} spellCheck={false} value={text(template.resultField)} placeholder={t('留空：整个回复')} onChange={event => set({ resultField: event.currentTarget.value })} />)}
                {row('错误信息字段', undefined, <ImeInput disabled={props.disabled} spellCheck={false} value={text(template.errorField)} onChange={event => set({ errorField: event.currentTarget.value })} />)}
            </div>
            {row('鉴权方式', undefined, <div className='nmx-inline-pair'>
                <select disabled={props.disabled} value={authStyle} onChange={event => {
                    const style = event.currentTarget.value;
                    set({ auth: style === 'header' ? `header:${authName || 'X-API-Key'}` : style === 'query' ? `query:${authName || 'key'}` : style });
                }}>
                    <option value='bearer'>Authorization: Bearer …</option>
                    <option value='raw'>{t('Authorization: 密钥原样')}</option>
                    <option value='key'>Authorization: Key …</option>
                    <option value='header'>{t('自定义请求头')}</option>
                    <option value='query'>{t('URL 参数')}</option>
                </select>
                {(authStyle === 'header' || authStyle === 'query') && <ImeInput disabled={props.disabled} spellCheck={false} value={authName}
                    placeholder={authStyle === 'header' ? 'X-API-Key' : 'key'} onChange={event => set({ auth: `${authStyle}:${event.currentTarget.value.trim()}` })} />}
            </div>)}
            {template.kind !== 'music' && row('图片传递', undefined, <select disabled={props.disabled} value={String(template.images || 'link')} onChange={event => set({ images: event.currentTarget.value })}>
                <option value='link'>{t('临时链接（6 小时）')}</option>
                <option value='data_url'>data URL（base64）</option>
                <option value='base64'>{t('纯 base64')}</option>
                <option value='none'>{t('不传图片')}</option>
            </select>)}
            {template.kind === 'music' && <div data-nmx-literal dir={props.locale === 'ar' ? 'rtl' : undefined}>
                {(['vocalReference', 'referenceSong'] as const).map(input => <MediaTemplateAudioFields key={input} locale={props.locale} disabled={props.disabled}
                    input={input} value={template[input] as MediaTemplateDraft | undefined} onChange={value => set({ [input]: value })} />)}
                <p className='nmx-connection-note'>{mt('musicVariables')}：<code>{'{{title}} {{lyrics}} {{genre}} {{mood}} {{instrumental}} {{music_mode}} {{vocal_reference}} {{reference_song}}'}</code> {mt('variablesHint')}</p>
            </div>}
            <div className='nmx-official-advanced-grid'>
                {template.kind !== 'music' && row('最多参考图', '张', <input type='number' min={0} max={16} disabled={props.disabled} value={Number(template.maxReferences) || 0}
                    onChange={event => set({ maxReferences: Math.max(0, Math.min(16, Math.trunc(Number(event.currentTarget.value) || 0))) })} />)}
                {template.kind !== 'music' && row('参考图画幅', undefined, <select disabled={props.disabled} value={String(template.referenceAspect || '')} onChange={event => set({ referenceAspect: event.currentTarget.value })}>
                    <option value=''>{t('不限')}</option>{['16:9', '9:16', '1:1', '4:3', '3:4'].map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
                </select>)}
                {row('可生成时长', '秒，如 5, 10 或 4-30', <SecondsField disabled={props.disabled} seconds={template.seconds} placeholder={t('留空：不限')}
                    onChange={seconds => set({ seconds })} />)}
            </div>
            {row('附加请求头', 'JSON', <ImeInput className={headersError ? 'is-invalid' : undefined} disabled={props.disabled} spellCheck={false} value={headersText}
                placeholder='{"X-DashScope-Async":"enable"}' onChange={event => {
                    const value = event.currentTarget.value;
                    setHeadersText(value);
                    try {
                        const parsed = value.trim() ? JSON.parse(value) : {};
                        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
                        setHeadersError(false);
                        set({ submit: { ...submit, headers: parsed } });
                    } catch { setHeadersError(true); }
                }} />, true)}
            <details className='nmx-official-advanced-more'>
                <summary>{t('更多')}</summary>
                <div className='nmx-official-advanced-grid'>
                    {row('查询地址字段', '提交后回复里给出的查询地址', <ImeInput disabled={props.disabled} spellCheck={false} value={text(template.pollUrlField)} placeholder='status_url' onChange={event => set({ pollUrlField: event.currentTarget.value })} />)}
                    {row('结果地址字段', '完成后再读一次的地址', <ImeInput disabled={props.disabled} spellCheck={false} value={text(template.resultUrlField)} placeholder='response_url' onChange={event => set({ resultUrlField: event.currentTarget.value })} />)}
                    {row('下载地址', '直接下载文件的地址', <ImeInput disabled={props.disabled} spellCheck={false} value={text(template.downloadPath)} placeholder='{base}/videos/{id}/content' onChange={event => set({ downloadPath: event.currentTarget.value })} />)}
                </div>
            </details>
            <p className='nmx-connection-note' data-nmx-literal>{t('地址变量：{base}、{model}、{id}；请求体变量：{{prompt}} {{model}} {{seconds}} {{aspect_ratio}} {{size}} {{resolution}} {{first_frame}} {{last_frame}} {{references}} {{image}} {{images}} {{negative_prompt}}。')}</p>
            {(problem || headersError) && <div className='nmx-purchase-error' role='alert'>{headersError ? `${t('接口格式有一项需要修改')}：${t('附加请求头')}` : problem}</div>}
        </>}
    </>;
    if (props.inline) {
        return <div className='nmx-official-advanced-section' data-official-advanced-media='true'>{body}</div>;
    }
    return <details className='nmx-official-advanced'>
        <summary><strong>{t('高级')}</strong><small>{summary}</small></summary>
        <div className='nmx-official-advanced-body'>{body}</div>
    </details>;
}

/** Two independently configured audio inputs; absent means the feature is not configured. */
export function MediaTemplateAudioFields(props: {
    readonly locale: NextMuxDesktopLocale; readonly disabled: boolean;
    readonly input: 'vocalReference' | 'referenceSong'; readonly value?: MediaTemplateDraft;
    readonly onChange: (value: MediaTemplateDraft | undefined) => void;
}): React.ReactElement {
    const t = (key: MusicTemplateLabel): string => musicTemplateText(props.locale, key);
    const mode = String(props.value?.mode || '');
    const upload = (props.value?.upload || {}) as MediaTemplateDraft;
    const value = (field: string, fallback = ''): string => upload[field] === undefined ? fallback : String(upload[field]);
    const defaults = { method: 'POST', path: '', format: 'multipart', fileField: 'file', body: '{}', headers: {}, idField: '' };
    const setUpload = (patch: MediaTemplateDraft): void => props.onChange({ ...props.value, mode: 'upload', upload: { ...defaults, ...upload, ...patch } });
    const row = (label: MusicTemplateLabel, control: React.ReactNode, hint?: string): React.ReactNode => <label><span>{t(label)}{hint && <small>{hint}</small>}</span>{control}</label>;
    const validHeaders = upload.headers === undefined || (upload.headers !== null && typeof upload.headers === 'object' && !Array.isArray(upload.headers));
    return <div data-nmx-literal data-music-input={props.input}>
        {row(props.input, <select disabled={props.disabled} value={mode} onChange={event => {
            const next = event.currentTarget.value;
            props.onChange(next ? { ...props.value, mode: next, ...(next === 'upload' ? { upload: { ...defaults, ...upload } } : {}) } : undefined);
        }}>
            <option value=''>{t('disabled')}</option><option value='url'>{t('url')}</option><option value='base64'>{t('base64')}</option><option value='upload'>{t('upload')}</option>
        </select>)}
        {mode === 'upload' && <>
            <div className='nmx-official-advanced-grid'>
                {row('uploadPath', <ImeInput disabled={props.disabled} spellCheck={false} value={value('path')} placeholder='{base}/uploads' onChange={event => setUpload({ path: event.currentTarget.value })} />, 'POST')}
                {row('uploadFormat', <select disabled={props.disabled} value={value('format', 'multipart')} onChange={event => setUpload({ format: event.currentTarget.value })}>
                    <option value='multipart'>multipart/form-data</option><option value='json'>JSON</option>
                </select>)}
                {row('fileField', <ImeInput disabled={props.disabled} spellCheck={false} value={value('fileField', 'file')} onChange={event => setUpload({ fileField: event.currentTarget.value })} />)}
                {row('idField', <ImeInput disabled={props.disabled} spellCheck={false} value={value('idField')} placeholder='data.id' onChange={event => setUpload({ idField: event.currentTarget.value })} />)}
                {row('expires', <input type='number' min={1} max={31536000} disabled={props.disabled} value={value('expiresInSeconds')} onChange={event => setUpload({ expiresInSeconds: event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value) })} />, t('expiryHint'))}
            </div>
            {row('uploadBody', <ImeTextarea className='nmx-code-field' disabled={props.disabled} spellCheck={false} rows={3} value={value('body', '{}')} onChange={event => setUpload({ body: event.currentTarget.value })} />, t('bodyHint'))}
            {row('uploadHeaders', <ImeInput className={validHeaders ? undefined : 'is-invalid'} disabled={props.disabled} spellCheck={false}
                value={typeof upload.headers === 'string' ? upload.headers : JSON.stringify(upload.headers ?? {})} placeholder='{}' onChange={event => {
                    const entered = event.currentTarget.value;
                    let headers: unknown = entered;
                    try { headers = entered.trim() ? JSON.parse(entered) : {}; } catch { /* Keep an invalid draft so saving cannot silently use stale headers. */ }
                    setUpload({ headers });
                }} />, 'JSON')}
            {!validHeaders && <div className='nmx-purchase-error' role='alert'>{t('invalidHeaders')}</div>}
            <p className='nmx-connection-note'>{t('uploadVariables')}：<code>{'{{audio_base64}} {{audio_url}} {{filename}} {{mime_type}}'}</code></p>
        </>}
    </div>;
}

/** Lengths typed as "4-30" or "5, 10"; read when the field is left, so a range can be typed through. */
function SecondsField(props: { readonly seconds: unknown; readonly disabled?: boolean; readonly placeholder: string; readonly onChange: (seconds: number[]) => void }): React.ReactElement {
    const shown = formatMediaSeconds(Array.isArray(props.seconds) ? props.seconds.map(Number).filter(Number.isFinite) : []);
    const [draft, setDraft] = React.useState<string>();
    return <ImeInput disabled={props.disabled} spellCheck={false} value={draft ?? shown} placeholder={props.placeholder}
        onChange={event => setDraft(event.currentTarget.value)}
        onBlur={() => { if (draft !== undefined) { props.onChange(parseMediaSeconds(draft)); setDraft(undefined); } }} />;
}
