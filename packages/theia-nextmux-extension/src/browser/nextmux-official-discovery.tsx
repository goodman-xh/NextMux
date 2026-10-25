import { modelFailureText } from './nextmux-model-errors';
import * as React from 'react';
import { isInvokableDiscoveredModel } from '@nextmux/model-runtime/presets';
import { mergeModelCapabilityEvidence, type ModelCapabilityEvidence } from '@nextmux/model-runtime/capabilities';
import type { OfficialModelConnection } from '../common/nextmux-platform-protocol';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { officialDiscoveryText as text } from './nextmux-official-discovery-locale';
import { officialModelSurfaceText } from './nextmux-surface-locale';
import { OWN_MODEL_KINDS, ownModelCategories, ownModelKind, type OwnModelKind } from './nextmux-own-model-kind';
import { modelCategoryLabel, modelTaxonomyView } from './nextmux-model-taxonomy-locale';
import { ModelTaxonomyTags } from './nextmux-model-taxonomy-tags';
import { matchCatalogModel, type CatalogModel } from './nextmux-own-model-match';
import { groupModelsByName } from '../common/nextmux-model-name';
import { contextWindowTokenLabel } from '../common/nextmux-context-budget';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

type Connection = Pick<OfficialModelConnection, 'providerId' | 'model' | 'discoveredModels'>;

const isEmbeddingOnly = (model: Connection['discoveredModels'][number]): boolean =>
    model.capabilities?.includes('embedding') === true && !model.capabilities.includes('completion');

/** Native declarations describe capability, while live probes still authorize coding routes. */
export function officialDiscoveryCapabilityEvidence(connection: OfficialModelConnection, model: string,
    evidence: readonly ModelCapabilityEvidence[]): readonly ModelCapabilityEvidence[] {
    const entry = connection.discoveredModels.find(candidate => candidate.id === model);
    if (!entry || (entry.toolsSupported === undefined && !entry.capabilities && !entry.capabilityDeclarations)) return evidence;
    const observedAt = connection.lastSuccessfulModelDiscoveryAt || connection.lastModelDiscoveryAt || connection.updatedAt;
    const metadata: ModelCapabilityEvidence[] = [];
    const declare = (capability: ModelCapabilityEvidence['capability'], supported: boolean): void => {
        metadata.push({ capability, support: supported ? 'supported' : 'unsupported', confidence: 'declared', source: 'provider_metadata', observedAt });
    };
    if (entry.toolsSupported !== undefined) declare('tools', entry.toolsSupported);
    if (entry.capabilities) {
        declare('input:image', entry.capabilities.includes('vision'));
        declare('reasoning', entry.capabilities.includes('thinking'));
    }
    for (const [capability, declaration] of Object.entries(entry.capabilityDeclarations || {})) {
        if (declaration.source === 'model_heuristic' || declaration.scope === 'transport' || declaration.support === 'unknown'
            || !['tools', 'reasoning', 'streaming', 'input:image', 'input:pdf', 'input:audio', 'input:video'].includes(capability)) continue;
        const index = metadata.findIndex(item => item.capability === capability);
        if (index >= 0) metadata.splice(index, 1);
        metadata.push({ capability: capability as ModelCapabilityEvidence['capability'], support: declaration.support,
            confidence: 'declared', source: 'provider_metadata', observedAt });
    }
    if (entry.interfaceSupport === 'unsupported' || isEmbeddingOnly(entry)) declare('model:generatable', false);
    // A refreshed native declaration must also invalidate older positive probe
    // evidence, including a manually configured default model with a changed digest.
    const unsupported = new Set(metadata.filter(item => item.support === 'unsupported').map(item => item.capability));
    return mergeModelCapabilityEvidence(evidence.filter(item => !unsupported.has(item.capability)), metadata);
}

export const isCatalogOnlyOfficialProvider = (providerId: string): boolean => providerId === 'azure_openai' || providerId === 'bedrock';

/** Catalog discovery is not a deployment/profile authorization inventory, including old cache entries. */
export function invokableOfficialDiscovery(connection: Connection): OfficialModelConnection['discoveredModels'] {
    return isCatalogOnlyOfficialProvider(connection.providerId) ? [] : connection.discoveredModels.filter(model => isInvokableDiscoveredModel(model) && !isEmbeddingOnly(model));
}

export function officialInvokableModelIds(connection: Connection): readonly string[] {
    const configured = connection.discoveredModels.find(model => model.id === connection.model);
    return [...new Set([configured && isEmbeddingOnly(configured) ? '' : connection.model, ...invokableOfficialDiscovery(connection).map(model => model.id)].filter(Boolean))];
}

/**
 * Return every chat model identifier reported by an authenticated directory.
 *
 * This is broader than `officialInvokableModelIds` for discovery and connection
 * details. Selection surfaces must intersect these IDs with verified routes;
 * a catalog entry alone cannot become an executable deployment/profile.
 */
export function officialDiscoveredModelIds(connection: Connection): readonly string[] {
    const configured = connection.discoveredModels.find(model => model.id === connection.model);
    return [...new Set([configured && isEmbeddingOnly(configured) ? '' : connection.model,
        ...connection.discoveredModels.filter(model => !isEmbeddingOnly(model)).map(model => model.id)].filter(Boolean))];
}

const ollamaRunningText: Record<NextMuxDesktopLocale, string> = {
    en: 'Ollama {version} running, {models} models, {tools} with tools',
    'zh-CN': 'Ollama {version} 正在运行，{models} 个模型，{tools} 个支持工具调用',
    'zh-TW': 'Ollama {version} 正在執行，{models} 個模型，{tools} 個支援工具呼叫',
    ja: 'Ollama {version} が稼働中、モデル {models} 件、ツール対応 {tools} 件',
    ko: 'Ollama {version} 실행 중, 모델 {models}개, 도구 지원 {tools}개',
    es: 'Ollama {version} en ejecución, {models} modelos, {tools} con herramientas',
    fr: 'Ollama {version} en cours, {models} modèles, {tools} avec outils',
    de: 'Ollama {version} läuft, {models} Modelle, {tools} mit Werkzeugen',
    'pt-BR': 'Ollama {version} em execução, {models} modelos, {tools} com ferramentas',
    ru: 'Ollama {version} работает, моделей: {models}, с инструментами: {tools}',
    ar: 'Ollama {version} قيد التشغيل، {models} نموذجًا، {tools} تدعم الأدوات',
    hi: 'Ollama {version} चल रहा है, {models} मॉडल, {tools} टूल समर्थित'
};

export function officialDiscoverySummary(locale: NextMuxDesktopLocale, connection: OfficialModelConnection): string {
    if (connection.modelDiscoveryError) return modelFailureText(locale, connection.modelDiscoveryError, { source: connection.providerId === 'ollama' ? 'local' : 'own_api' });
    if (connection.modelDiscoveryFailure) return text(locale, connection.modelDiscoveryFailure);
    if (connection.ollamaStatus && connection.modelDiscoveryStatus === 'verified') return ollamaRunningText[locale]
        .replace('{version}', connection.ollamaStatus.version)
        .replace('{models}', String(connection.ollamaStatus.modelCount))
        .replace('{tools}', String(connection.ollamaStatus.toolsModelCount));
    if (connection.modelDiscoveryStatus === 'catalog_discovered' || (isCatalogOnlyOfficialProvider(connection.providerId) && connection.modelDiscoveryStatus === 'verified'))
        return `${text(locale, 'catalog')} · ${connection.discoveredModels.length}`;
    if (connection.modelDiscoveryStatus === 'verified') return officialModelSurfaceText(locale, 'modelCount', { count: String(invokableOfficialDiscovery(connection).length) });
    // Media-only APIs (速创 video, ElevenLabs, MiniMax music) list no models: the configured model is the model.
    if (['async_media_template', 'elevenlabs_music', 'elevenlabs_sound_effect', 'minimax_music'].includes(connection.protocol)) return officialModelSurfaceText(locale, 'modelCount', { count: '1' });
    return text(locale, connection.modelDiscoveryStatus === 'unsupported' ? 'endpoint_unsupported' : 'pending');
}

export function OfficialCatalogDetails({ locale, connection }: { readonly locale: NextMuxDesktopLocale; readonly connection: Connection }): React.ReactElement | null {
    const catalog = connection.discoveredModels.filter(model => isCatalogOnlyOfficialProvider(connection.providerId) || !isInvokableDiscoveredModel(model));
    if (!catalog.length) return null;
    const visible = catalog.slice(0, 200);
    return <details className='nmx-official-catalog-only' dir={locale === 'ar' ? 'rtl' : undefined} data-nmx-literal>
        <summary>{text(locale, 'catalog')} · {catalog.length}</summary>
        <p>{text(locale, 'catalogNote')}</p>
        <ul>{visible.map(model => <li key={model.id}><bdi dir='auto'>{model.label}</bdi><code dir='ltr'>{model.id}</code></li>)}</ul>
        {visible.length < catalog.length && <small>{visible.length} / {catalog.length}</small>}
    </details>;
}

const ownListText = {
    en: { button: 'Model list', note: 'What this API reported comes first; anything it left out is matched against the public model directory on this computer. Nothing is uploaded.', search: 'Search models', empty: 'No models read from this API yet. Choose Refresh models.', none: 'No match', moderation: "Moderation", other: 'Other', context: '{n} context', price: 'In {input} · Out {output} per 1M tokens', priceApi: 'API price', priceReference: 'Official reference price' },
    'zh-CN': { button: '模型列表', note: '先按这个 API 自己报告的信息分类；没报告的再对照公开模型目录，在本机匹配，不上传。', search: '搜索模型', empty: '还没有从这个 API 读到模型，点“刷新模型”。', none: '没有匹配的模型', moderation: "内容审核", other: '其他', context: '{n} 上下文', price: '输入 {input} · 输出 {output} / 百万 token', priceApi: 'API 报价', priceReference: '官方参考价' },
    'zh-TW': { button: '模型清單', note: '先依這個 API 自己回報的資訊分類；沒回報的再對照公開模型目錄，在本機比對，不上傳。', search: '搜尋模型', empty: '尚未從這個 API 讀到模型，點「重新整理模型」。', none: '沒有符合的模型', moderation: "內容審核", other: '其他', context: '{n} 上下文', price: '輸入 {input} · 輸出 {output} / 百萬 token', priceApi: 'API 報價', priceReference: '官方參考價' },
    ja: { button: 'モデル一覧', note: 'この API が報告した情報を優先し、足りない分は公開モデル一覧とこのコンピューター上で照合します。何も送信しません。', search: 'モデルを検索', empty: 'この API からまだモデルを読み取っていません。「モデルを更新」を押してください。', none: '一致するモデルはありません', moderation: "コンテンツ審査", other: 'その他', context: 'コンテキスト {n}', price: '入力 {input} · 出力 {output} / 100 万トークン', priceApi: 'API 価格', priceReference: '公式参考価格' },
    ko: { button: '모델 목록', note: '이 API가 알려 준 정보를 먼저 쓰고, 빠진 정보는 이 컴퓨터에서 공개 모델 목록과 대조합니다. 아무것도 올리지 않습니다.', search: '모델 검색', empty: '아직 이 API에서 모델을 읽지 않았습니다. ‘모델 새로고침’을 누르세요.', none: '일치하는 모델 없음', moderation: "콘텐츠 검토", other: '기타', context: '컨텍스트 {n}', price: '입력 {input} · 출력 {output} / 100만 토큰', priceApi: 'API 가격', priceReference: '공식 참고 가격' },
    es: { button: 'Lista de modelos', note: 'Primero lo que informa esta API; lo que falte se compara en este equipo con el directorio público de modelos. No se sube nada.', search: 'Buscar modelos', empty: 'Aún no se leyeron modelos de esta API. Pulsa Actualizar modelos.', none: 'Sin coincidencias', moderation: "Moderación", other: 'Otros', context: 'Contexto {n}', price: 'Entrada {input} · Salida {output} por 1 M de tokens', priceApi: 'Precio de la API', priceReference: 'Precio oficial de referencia' },
    fr: { button: 'Liste des modèles', note: 'Ce que cette API indique passe en premier ; le reste est comparé sur cet ordinateur à l’annuaire public des modèles. Rien n’est envoyé.', search: 'Rechercher un modèle', empty: 'Aucun modèle lu pour cette API. Choisissez Actualiser les modèles.', none: 'Aucun résultat', moderation: "Modération", other: 'Autre', context: 'Contexte {n}', price: 'Entrée {input} · Sortie {output} par million de jetons', priceApi: 'Prix de l’API', priceReference: 'Prix officiel de référence' },
    de: { button: 'Modellliste', note: 'Zuerst zählt, was diese API meldet; Fehlendes wird auf diesem Computer mit dem öffentlichen Modellverzeichnis abgeglichen. Nichts wird hochgeladen.', search: 'Modelle suchen', empty: 'Noch keine Modelle von dieser API gelesen. Wählen Sie Modelle aktualisieren.', none: 'Keine Treffer', moderation: "Moderation", other: 'Sonstiges', context: 'Kontext {n}', price: 'Eingabe {input} · Ausgabe {output} pro 1 Mio. Tokens', priceApi: 'API-Preis', priceReference: 'Offizieller Referenzpreis' },
    'pt-BR': { button: 'Lista de modelos', note: 'Primeiro vale o que esta API informou; o que faltar é comparado neste computador com o diretório público de modelos. Nada é enviado.', search: 'Pesquisar modelos', empty: 'Nenhum modelo lido desta API ainda. Escolha Atualizar modelos.', none: 'Nenhum resultado', moderation: "Moderação", other: 'Outros', context: 'Contexto {n}', price: 'Entrada {input} · Saída {output} por 1 mi de tokens', priceApi: 'Preço da API', priceReference: 'Preço oficial de referência' },
    ru: { button: 'Список моделей', note: 'Сначала используется то, что сообщил этот API; недостающее сверяется на этом компьютере с открытым каталогом моделей. Ничего не отправляется.', search: 'Поиск моделей', empty: 'Модели этого API ещё не прочитаны. Нажмите «Обновить модели».', none: 'Нет совпадений', moderation: "Модерация", other: 'Другое', context: 'Контекст {n}', price: 'Ввод {input} · Вывод {output} за 1 млн токенов', priceApi: 'Цена API', priceReference: 'Официальная справочная цена' },
    ar: { button: 'قائمة النماذج', note: 'ما أبلغت عنه هذه الواجهة أولًا؛ وما لم تذكره يُطابَق على هذا الجهاز مع دليل النماذج العام. لا يُرفع شيء.', search: 'ابحث في النماذج', empty: 'لم تُقرأ نماذج من هذه الواجهة بعد. اختر «تحديث النماذج».', none: 'لا نتائج', moderation: "الإشراف على المحتوى", other: 'أخرى', context: 'سياق {n}', price: 'الإدخال {input} · الإخراج {output} لكل مليون رمز', priceApi: 'سعر الواجهة', priceReference: 'السعر الرسمي المرجعي' },
    hi: { button: 'मॉडल सूची', note: 'पहले वह जो यह API बताता है; जो छूटा है उसे इसी कंप्यूटर पर सार्वजनिक मॉडल सूची से मिलाया जाता है। कुछ भी अपलोड नहीं होता।', search: 'मॉडल खोजें', empty: 'इस API से अभी कोई मॉडल नहीं पढ़ा गया। “मॉडल रीफ़्रेश करें” चुनें।', none: 'कोई मेल नहीं', moderation: "मॉडरेशन", other: 'अन्य', context: '{n} संदर्भ', price: 'इनपुट {input} · आउटपुट {output} प्रति 10 लाख टोकन', priceApi: 'API मूल्य', priceReference: 'आधिकारिक संदर्भ मूल्य' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

function uncheckedOwnModelListText(locale: NextMuxDesktopLocale, key: keyof typeof ownListText.en): string {
    return (ownListText[locale] || ownListText.en)[key];
}

/** Every model this own API listed, grouped by what it is (classified locally). */
const priceText = (value: number): string => `$${value >= 1 ? value.toFixed(2).replace(/\.?0+$/, '') : Number(value.toPrecision(3)).toString()}`;
const tokenText = (value: number): string => contextWindowTokenLabel(value);

/** Context, price and capabilities: what this API reported first, the public directory's entry only for what it left out. */
function OwnModelFactsLine({ locale, model, catalog }: { readonly locale: NextMuxDesktopLocale; readonly model: OfficialModelConnection['discoveredModels'][number]; readonly catalog?: CatalogModel }): React.ReactElement | null {
    const t = (key: keyof typeof ownListText.en, values: Record<string, string> = {}): string => ownModelListText(locale, key).replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
    const context = model.contextTokens || catalog?.contextTokens || undefined;
    const apiPrice = model.inputPricePerMillion !== undefined && model.outputPricePerMillion !== undefined;
    const reference = !apiPrice ? catalog?.referencePrice : undefined;
    const input = apiPrice ? model.inputPricePerMillion! : reference?.input, output = apiPrice ? model.outputPricePerMillion! : reference?.output;
    // The shared badges (model-taxonomy) from what this API reported, the directory entry filling only the gaps.
    const capabilities = new Set(catalog?.capabilities || []);
    if (model.toolsSupported === false) { capabilities.delete('tools'); capabilities.delete('coding'); } else if (model.toolsSupported) capabilities.add('tools');
    if (model.reasoningEfforts?.length) capabilities.add('reasoning');
    const facts = { id: model.id, label: model.label, kind: ownModelKind(model, catalog), capabilities: [...capabilities],
        input: model.inputModalities || catalog?.input || [], output: model.outputModalities?.length ? model.outputModalities : catalog?.output || [] };
    if (!context && input === undefined && !modelTaxonomyView(locale, facts).badges.length) return null;
    return <small className='nmx-own-model-facts' dir='auto'>
        {context ? <span>{t('context', { n: tokenText(context) })}</span> : null}
        {input !== undefined && output !== undefined ? <span title={apiPrice ? t('priceApi') : `${t('priceReference')} · ${reference!.source}`}>
            {t('price', { input: priceText(input), output: priceText(output) })}<em>{apiPrice ? t('priceApi') : t('priceReference')}</em></span> : null}
        <ModelTaxonomyTags locale={locale} model={facts} />
    </small>;
}

/** Display inventory: keep every reported kind and include a manual default absent from the directory.
 * This does not grant invocation or tool capability to any model.
 */
export function ownModelListModels(connection: Pick<OfficialModelConnection, 'model' | 'discoveredModels'>, query = ''): OfficialModelConnection['discoveredModels'] {
    const models = new Map(connection.discoveredModels.map(model => [model.id, model]));
    if (connection.model && !models.has(connection.model)) models.set(connection.model, { id: connection.model, label: connection.model });
    // Search all original IDs before grouping, so a hidden snapshot is still findable.
    const needle = query.trim().toLowerCase();
    return groupModelsByName([...models.values()].filter(model => !needle || `${model.id} ${model.label}`.toLowerCase().includes(needle)), model => model.id);
}

export function OwnModelList({ locale, connection, catalog }: { readonly locale: NextMuxDesktopLocale; readonly connection: Pick<OfficialModelConnection, 'id' | 'model' | 'discoveredModels'>; readonly catalog?: readonly CatalogModel[] }): React.ReactElement {
    const [query, setQuery] = React.useState('');
    const needle = query.trim().toLowerCase();
    const models = React.useMemo(() => ownModelListModels(connection), [connection.model, connection.discoveredModels]);
    const visible = React.useMemo(() => needle ? ownModelListModels(connection, needle) : models, [connection.model, connection.discoveredModels, models, needle]);
    const matches = React.useMemo(() => new Map(visible.map(model => [model.id, matchCatalogModel(model.id, model.label, catalog)])), [visible, catalog]);
    const groups = new Map<OwnModelKind, typeof models[number][]>();
    for (const model of visible) {
        for (const kind of ownModelCategories(model, matches.get(model.id))) {
            groups.set(kind, [...(groups.get(kind) || []), model]);
        }
    }
    return <section className='nmx-own-model-list' dir={locale === 'ar' ? 'rtl' : undefined} aria-label={ownModelListText(locale, 'button')}>
        <header><input type='search' value={query} placeholder={ownModelListText(locale, 'search')} aria-label={ownModelListText(locale, 'search')} onChange={event => setQuery(event.currentTarget.value)} />
            <small>{ownModelListText(locale, 'note')}</small></header>
        {!models.length ? <p>{ownModelListText(locale, 'empty')}</p> : !groups.size ? <p>{ownModelListText(locale, 'none')}</p>
            : OWN_MODEL_KINDS.filter(kind => groups.has(kind)).map(kind => <details key={kind} open={true} data-kind={kind}>
                <summary><span>{kind === 'moderation' || kind === 'other' ? ownModelListText(locale, kind) : modelCategoryLabel(locale, kind === 'llm' ? 'language' : kind)}</span><b>{groups.get(kind)!.length}</b></summary>
                <ul>{groups.get(kind)!.map(model => <li key={model.id}><div className='nmx-own-model-name'>{model.label && model.label !== model.id ? <><bdi dir='auto'>{model.label}</bdi><code dir='ltr' data-nmx-literal>{model.id}</code></> : <code dir='ltr' data-nmx-literal>{model.id}</code>}</div>
                    <OwnModelFactsLine locale={locale} model={model} catalog={matches.get(model.id)} /></li>)}</ul>
            </details>)}
    </section>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function ownModelListText(locale: Parameters<typeof uncheckedOwnModelListText>[0], key: Parameters<typeof uncheckedOwnModelListText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedOwnModelListText>>): string {
    return totalCopy(locale, key, language => uncheckedOwnModelListText(language, key, ...rest));
}
