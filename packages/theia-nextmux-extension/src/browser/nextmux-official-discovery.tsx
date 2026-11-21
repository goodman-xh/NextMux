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
import { groupModelsByName, sameModelId } from '../common/nextmux-model-name';
export { isDiscoveredInvocationAllowed } from '../common/nextmux-official-invocation';
import { contextWindowTokenLabel } from '../common/nextmux-context-budget';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

type Connection = Pick<OfficialModelConnection, 'providerId' | 'model' | 'discoveredModels'>;

const isEmbeddingOnly = (model: Connection['discoveredModels'][number]): boolean =>
    model.capabilities?.includes('embedding') === true && !model.capabilities.includes('completion');

/** Native declarations describe capability, while live probes still authorize coding routes. */
export function officialDiscoveryCapabilityEvidence(connection: OfficialModelConnection, model: string,
    evidence: readonly ModelCapabilityEvidence[]): readonly ModelCapabilityEvidence[] {
    const entry = connection.discoveredModels.find(candidate => sameModelId(candidate.id, model));
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

/** One entry per model whatever its letter case (sameModelId); the first spelling, the configured model's, stays. */
function uniqueModelIds(ids: readonly string[]): string[] {
    const seen = new Set<string>();
    return ids.filter(id => {
        const key = id.toLowerCase();
        if (!id || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function officialInvokableModelIds(connection: Connection): readonly string[] {
    const configured = connection.discoveredModels.find(model => sameModelId(model.id, connection.model));
    return uniqueModelIds([configured && isEmbeddingOnly(configured) ? '' : connection.model, ...invokableOfficialDiscovery(connection).map(model => model.id)]);
}

/**
 * Return every chat model identifier reported by an authenticated directory.
 *
 * This is broader than `officialInvokableModelIds` for discovery and connection
 * details. Selection surfaces must intersect these IDs with verified routes;
 * a catalog entry alone cannot become an executable deployment/profile.
 */
export function officialDiscoveredModelIds(connection: Connection): readonly string[] {
    const configured = connection.discoveredModels.find(model => sameModelId(model.id, connection.model));
    return uniqueModelIds([configured && isEmbeddingOnly(configured) ? '' : connection.model,
        ...connection.discoveredModels.filter(model => !isEmbeddingOnly(model)).map(model => model.id)]);
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
    en: { button: 'Model list', note: 'What this API reported comes first; anything it left out is matched against the public model directory on this computer. Nothing is uploaded.', search: 'Search models', empty: 'No models read from this API yet. Click Refresh models above to load its list.', loading: 'Reading the model list from this API…', none: 'No match', moderation: "Moderation", other: 'Other', context: '{n} context', price: 'In {input} · Out {output} per 1M tokens', priceInputOnly: 'In {input} per 1M tokens', priceImage: '{price} / image', priceSecond: '{price} / s', priceCharacters: '{price} / 1M chars', priceRequest: '{price} / request', priceApi: 'API price', priceReference: 'Official reference price' },
    'zh-CN': { button: '模型列表', note: '先按这个 API 自己报告的信息分类；没报告的再对照公开模型目录，在本机匹配，不上传。', search: '搜索模型', empty: '还没有从这个 API 读到模型，可点右上角“刷新模型”获取列表。', loading: '正在从这个 API 读取模型列表…', none: '没有匹配的模型', moderation: "内容审核", other: '其他', context: '{n} 上下文', price: '输入 {input} · 输出 {output} / 百万 token', priceInputOnly: '输入 {input} / 百万 token', priceImage: '{price} / 张', priceSecond: '{price} / 秒', priceCharacters: '{price} / 百万字符', priceRequest: '{price} / 次', priceApi: 'API 报价', priceReference: '官方参考价' },
    'zh-TW': { button: '模型清單', note: '先依這個 API 自己回報的資訊分類；沒回報的再對照公開模型目錄，在本機比對，不上傳。', search: '搜尋模型', empty: '尚未從這個 API 讀到模型，可點右上角「重新整理模型」取得清單。', loading: '正在從這個 API 讀取模型清單…', none: '沒有符合的模型', moderation: "內容審核", other: '其他', context: '{n} 上下文', price: '輸入 {input} · 輸出 {output} / 百萬 token', priceInputOnly: '輸入 {input} / 百萬 token', priceImage: '{price} / 張', priceSecond: '{price} / 秒', priceCharacters: '{price} / 百萬字元', priceRequest: '{price} / 次', priceApi: 'API 報價', priceReference: '官方參考價' },
    ja: { button: 'モデル一覧', note: 'この API が報告した情報を優先し、足りない分は公開モデル一覧とこのコンピューター上で照合します。何も送信しません。', search: 'モデルを検索', empty: 'この API からまだモデルを読み取っていません。右上の「モデルを更新」を押して一覧を取得してください。', loading: 'この API からモデル一覧を読み込んでいます…', none: '一致するモデルはありません', moderation: "コンテンツ審査", other: 'その他', context: 'コンテキスト {n}', price: '入力 {input} · 出力 {output} / 100 万トークン', priceInputOnly: '入力 {input} / 100 万トークン', priceImage: '{price} / 枚', priceSecond: '{price} / 秒', priceCharacters: '{price} / 100 万文字', priceRequest: '{price} / 回', priceApi: 'API 価格', priceReference: '公式参考価格' },
    ko: { button: '모델 목록', note: '이 API가 알려 준 정보를 먼저 쓰고, 빠진 정보는 이 컴퓨터에서 공개 모델 목록과 대조합니다. 아무것도 올리지 않습니다.', search: '모델 검색', empty: '아직 이 API에서 모델을 읽지 않았습니다. 오른쪽 위의 ‘모델 새로고침’을 눌러 목록을 가져오세요.', loading: '이 API에서 모델 목록을 읽는 중…', none: '일치하는 모델 없음', moderation: "콘텐츠 검토", other: '기타', context: '컨텍스트 {n}', price: '입력 {input} · 출력 {output} / 100만 토큰', priceInputOnly: '입력 {input} / 100만 토큰', priceImage: '{price} / 장', priceSecond: '{price} / 초', priceCharacters: '{price} / 100만 자', priceRequest: '{price} / 회', priceApi: 'API 가격', priceReference: '공식 참고 가격' },
    es: { button: 'Lista de modelos', note: 'Primero lo que informa esta API; lo que falte se compara en este equipo con el directorio público de modelos. No se sube nada.', search: 'Buscar modelos', empty: 'Aún no se leyeron modelos de esta API. Pulsa Actualizar modelos arriba para cargar la lista.', loading: 'Leyendo la lista de modelos de esta API…', none: 'Sin coincidencias', moderation: "Moderación", other: 'Otros', context: 'Contexto {n}', price: 'Entrada {input} · Salida {output} por 1 M de tokens', priceInputOnly: 'Entrada {input} por 1 M de tokens', priceImage: '{price} / imagen', priceSecond: '{price} / s', priceCharacters: '{price} / 1 M de caracteres', priceRequest: '{price} / solicitud', priceApi: 'Precio de la API', priceReference: 'Precio oficial de referencia' },
    fr: { button: 'Liste des modèles', note: 'Ce que cette API indique passe en premier ; le reste est comparé sur cet ordinateur à l’annuaire public des modèles. Rien n’est envoyé.', search: 'Rechercher un modèle', empty: 'Aucun modèle lu pour cette API. Cliquez sur Actualiser les modèles ci-dessus pour charger la liste.', loading: 'Lecture de la liste des modèles de cette API…', none: 'Aucun résultat', moderation: "Modération", other: 'Autre', context: 'Contexte {n}', price: 'Entrée {input} · Sortie {output} par million de jetons', priceInputOnly: 'Entrée {input} par million de jetons', priceImage: '{price} / image', priceSecond: '{price} / s', priceCharacters: '{price} / million de car.', priceRequest: '{price} / requête', priceApi: 'Prix de l’API', priceReference: 'Prix officiel de référence' },
    de: { button: 'Modellliste', note: 'Zuerst zählt, was diese API meldet; Fehlendes wird auf diesem Computer mit dem öffentlichen Modellverzeichnis abgeglichen. Nichts wird hochgeladen.', search: 'Modelle suchen', empty: 'Noch keine Modelle von dieser API gelesen. Klicken Sie oben auf Modelle aktualisieren, um die Liste zu laden.', loading: 'Modellliste dieser API wird gelesen …', none: 'Keine Treffer', moderation: "Moderation", other: 'Sonstiges', context: 'Kontext {n}', price: 'Eingabe {input} · Ausgabe {output} pro 1 Mio. Tokens', priceInputOnly: 'Eingabe {input} pro 1 Mio. Tokens', priceImage: '{price} / Bild', priceSecond: '{price} / s', priceCharacters: '{price} / 1 Mio. Zeichen', priceRequest: '{price} / Anfrage', priceApi: 'API-Preis', priceReference: 'Offizieller Referenzpreis' },
    'pt-BR': { button: 'Lista de modelos', note: 'Primeiro vale o que esta API informou; o que faltar é comparado neste computador com o diretório público de modelos. Nada é enviado.', search: 'Pesquisar modelos', empty: 'Nenhum modelo lido desta API ainda. Clique em Atualizar modelos acima para carregar a lista.', loading: 'Lendo a lista de modelos desta API…', none: 'Nenhum resultado', moderation: "Moderação", other: 'Outros', context: 'Contexto {n}', price: 'Entrada {input} · Saída {output} por 1 mi de tokens', priceInputOnly: 'Entrada {input} por 1 mi de tokens', priceImage: '{price} / imagem', priceSecond: '{price} / s', priceCharacters: '{price} / 1 mi de car.', priceRequest: '{price} / requisição', priceApi: 'Preço da API', priceReference: 'Preço oficial de referência' },
    ru: { button: 'Список моделей', note: 'Сначала используется то, что сообщил этот API; недостающее сверяется на этом компьютере с открытым каталогом моделей. Ничего не отправляется.', search: 'Поиск моделей', empty: 'Модели этого API ещё не прочитаны. Нажмите «Обновить модели» выше, чтобы загрузить список.', loading: 'Читаем список моделей этого API…', none: 'Нет совпадений', moderation: "Модерация", other: 'Другое', context: 'Контекст {n}', price: 'Ввод {input} · Вывод {output} за 1 млн токенов', priceInputOnly: 'Ввод {input} за 1 млн токенов', priceImage: '{price} / изобр.', priceSecond: '{price} / с', priceCharacters: '{price} / 1 млн симв.', priceRequest: '{price} / запрос', priceApi: 'Цена API', priceReference: 'Официальная справочная цена' },
    ar: { button: 'قائمة النماذج', note: 'ما أبلغت عنه هذه الواجهة أولًا؛ وما لم تذكره يُطابَق على هذا الجهاز مع دليل النماذج العام. لا يُرفع شيء.', search: 'ابحث في النماذج', empty: 'لم تُقرأ نماذج من هذه الواجهة بعد. انقر على «تحديث النماذج» في الأعلى لجلب القائمة.', loading: 'جارٍ قراءة قائمة النماذج من هذه الواجهة…', none: 'لا نتائج', moderation: "الإشراف على المحتوى", other: 'أخرى', context: 'سياق {n}', price: 'الإدخال {input} · الإخراج {output} لكل مليون رمز', priceInputOnly: 'الإدخال {input} لكل مليون رمز', priceImage: '{price} / صورة', priceSecond: '{price} / ث', priceCharacters: '{price} / مليون حرف', priceRequest: '{price} / طلب', priceApi: 'سعر الواجهة', priceReference: 'السعر الرسمي المرجعي' },
    hi: { button: 'मॉडल सूची', note: 'पहले वह जो यह API बताता है; जो छूटा है उसे इसी कंप्यूटर पर सार्वजनिक मॉडल सूची से मिलाया जाता है। कुछ भी अपलोड नहीं होता।', search: 'मॉडल खोजें', empty: 'इस API से अभी कोई मॉडल नहीं पढ़ा गया। सूची लोड करने के लिए ऊपर “मॉडल रीफ़्रेश करें” चुनें।', loading: 'इस API से मॉडल सूची पढ़ी जा रही है…', none: 'कोई मेल नहीं', moderation: "मॉडरेशन", other: 'अन्य', context: '{n} संदर्भ', price: 'इनपुट {input} · आउटपुट {output} प्रति 10 लाख टोकन', priceInputOnly: 'इनपुट {input} प्रति 10 लाख टोकन', priceImage: '{price} / छवि', priceSecond: '{price} / सेकंड', priceCharacters: '{price} / 10 लाख वर्ण', priceRequest: '{price} / अनुरोध', priceApi: 'API मूल्य', priceReference: 'आधिकारिक संदर्भ मूल्य' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

function uncheckedOwnModelListText(locale: NextMuxDesktopLocale, key: keyof typeof ownListText.en): string {
    return (ownListText[locale] || ownListText.en)[key];
}

/** Every model this own API listed, grouped by what it is (classified locally). */
const priceText = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return '$0';
    if (value >= 1) return `$${value.toFixed(2).replace(/\.?0+$/, '')}`;
    const digits = Math.min(12, Math.max(0, 3 - Math.floor(Math.log10(value)) - 1));
    return `$${Number(value.toPrecision(3)).toFixed(digits).replace(/\.?0+$/, '')}`;
};
const tokenText = (value: number): string => contextWindowTokenLabel(value);
const formatOwnListText = (locale: NextMuxDesktopLocale, key: keyof typeof ownListText.en, values: Record<string, string> = {}): string =>
    ownModelListText(locale, key).replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);

/** Format a public directory reference price across token, image, second, character and per-request units. */
export function formatOwnModelReferencePrice(locale: NextMuxDesktopLocale, reference: CatalogModel['referencePrice'] | undefined): string | undefined {
    if (!reference) return undefined;
    const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (reference.unit === 'per_image') return valid(reference.image) ? formatOwnListText(locale, 'priceImage', { price: priceText(reference.image) }) : undefined;
    if (reference.unit === 'per_second') {
        const rate = valid(reference.videoSecond) ? reference.videoSecond : valid(reference.audioSecond) ? reference.audioSecond : undefined;
        return rate !== undefined ? formatOwnListText(locale, 'priceSecond', { price: priceText(rate) }) : undefined;
    }
    if (reference.unit === 'per_million_characters') return valid(reference.audioCharacter) ? formatOwnListText(locale, 'priceCharacters', { price: priceText(reference.audioCharacter) }) : undefined;
    if (reference.unit === 'per_request') return valid(reference.request) ? formatOwnListText(locale, 'priceRequest', { price: priceText(reference.request) }) : undefined;
    if (valid(reference.input) && valid(reference.output)) return formatOwnListText(locale, 'price', { input: priceText(reference.input), output: priceText(reference.output) });
    if (valid(reference.input)) return formatOwnListText(locale, 'priceInputOnly', { input: priceText(reference.input) });
    return undefined;
}

/** Context, price and capabilities: what this API reported first, the public directory's entry only for what it left out. */
const OwnModelFactsLine = React.memo(function OwnModelFactsLine({ locale, model, catalog }: { readonly locale: NextMuxDesktopLocale; readonly model: OfficialModelConnection['discoveredModels'][number]; readonly catalog?: CatalogModel }): React.ReactElement | null {
    const context = model.contextTokens || catalog?.contextTokens || undefined;
    // An API's per-token prices stand for a token-billed model only: for one the directory bills per image, second,
    // character or request (NextMux /v1/models lists speech and transcription in tokens), that unit's price is shown.
    const referenceUnit = catalog?.referencePrice?.unit;
    const apiInput = model.inputPricePerMillion !== undefined && (!referenceUnit || referenceUnit === 'per_million_tokens');
    const apiFull = apiInput && model.outputPricePerMillion !== undefined;
    // A complete API price, else the directory's reference, else the API's input price alone (embeddings, rerankers).
    const referenceLabel = !apiFull ? formatOwnModelReferencePrice(locale, catalog?.referencePrice) : undefined;
    const apiPrice = apiFull || (apiInput && !referenceLabel);
    const reference = referenceLabel ? catalog?.referencePrice : undefined;
    const priceLabel = apiFull
        ? formatOwnListText(locale, 'price', { input: priceText(model.inputPricePerMillion!), output: priceText(model.outputPricePerMillion!) })
        : referenceLabel ?? (apiPrice ? formatOwnListText(locale, 'priceInputOnly', { input: priceText(model.inputPricePerMillion!) }) : undefined);
    // The shared badges (model-taxonomy) from what this API reported, the directory entry filling only the gaps.
    const capabilities = new Set(catalog?.capabilities || []);
    if (model.toolsSupported === false) { capabilities.delete('tools'); capabilities.delete('coding'); } else if (model.toolsSupported) capabilities.add('tools');
    if (model.reasoningEfforts?.length) capabilities.add('reasoning');
    const facts = { id: model.id, label: model.label, kind: ownModelKind(model, catalog), capabilities: [...capabilities],
        input: model.inputModalities || catalog?.input || [], output: model.outputModalities?.length ? model.outputModalities : catalog?.output || [] };
    if (!context && !priceLabel && !modelTaxonomyView(locale, facts).badges.length) return null;
    return <small className='nmx-own-model-facts' dir='auto'>
        {context ? <span>{formatOwnListText(locale, 'context', { n: tokenText(context) })}</span> : null}
        {priceLabel ? <span title={apiPrice ? formatOwnListText(locale, 'priceApi') : `${formatOwnListText(locale, 'priceReference')} · ${reference!.source}`}>
            {priceLabel}<em>{apiPrice ? formatOwnListText(locale, 'priceApi') : formatOwnListText(locale, 'priceReference')}</em></span> : null}
        <ModelTaxonomyTags locale={locale} model={facts} />
    </small>;
});

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

/**
 * The model list of one own API. It renders again only when its API, the directory or the language changes, never on
 * the window's other renders (each keystroke, each streamed token): an API can list hundreds of models, and every row
 * classifies its model and formats its facts.
 */
export const OwnModelList = React.memo(function OwnModelList({ locale, connection, catalog, loading }: { readonly locale: NextMuxDesktopLocale; readonly connection: Pick<OfficialModelConnection, 'id' | 'model' | 'discoveredModels'>; readonly catalog?: readonly CatalogModel[]; readonly loading?: boolean }): React.ReactElement {
    const [query, setQuery] = React.useState('');
    const needle = query.trim().toLowerCase();
    const models = React.useMemo(() => ownModelListModels(connection), [connection.model, connection.discoveredModels]);
    const visible = React.useMemo(() => needle ? ownModelListModels(connection, needle) : models, [connection.model, connection.discoveredModels, models, needle]);
    const matches = React.useMemo(() => new Map(visible.map(model => [model.id, matchCatalogModel(model.id, model.label, catalog)])), [visible, catalog]);
    const groups = React.useMemo(() => {
        const byKind = new Map<OwnModelKind, typeof models[number][]>();
        for (const model of visible) {
            for (const kind of ownModelCategories(model, matches.get(model.id))) {
                const members = byKind.get(kind);
                if (members) members.push(model); else byKind.set(kind, [model]);
            }
        }
        return byKind;
    }, [visible, matches]);
    return <section className='nmx-own-model-list' dir={locale === 'ar' ? 'rtl' : undefined} aria-label={ownModelListText(locale, 'button')}>
        <header><input type='search' value={query} placeholder={ownModelListText(locale, 'search')} aria-label={ownModelListText(locale, 'search')} onChange={event => setQuery(event.currentTarget.value)} />
            <small>{ownModelListText(locale, 'note')}</small></header>
        {!models.length ? loading
            // The list is being read (the drawer starts it for an API saved untested): say so, not "nothing read yet".
            ? <p className='nmx-own-model-list-loading' role='status' aria-live='polite'><i className='codicon codicon-sync codicon-modifier-spin' aria-hidden='true' /><span>{ownModelListText(locale, 'loading')}</span></p>
            : <p>{ownModelListText(locale, 'empty')}</p> : !groups.size ? <p>{ownModelListText(locale, 'none')}</p>
            : OWN_MODEL_KINDS.filter(kind => groups.has(kind)).map(kind => <details key={kind} open={true} data-kind={kind}>
                <summary><span>{kind === 'moderation' || kind === 'other' ? ownModelListText(locale, kind) : modelCategoryLabel(locale, kind === 'llm' ? 'language' : kind)}</span><b>{groups.get(kind)!.length}</b></summary>
                <ul>{groups.get(kind)!.map(model => <li key={model.id}><div className='nmx-own-model-name'>{model.label && model.label !== model.id ? <><bdi dir='auto'>{model.label}</bdi><code dir='ltr' data-nmx-literal>{model.id}</code></> : <code dir='ltr' data-nmx-literal>{model.id}</code>}</div>
                    <OwnModelFactsLine locale={locale} model={model} catalog={matches.get(model.id)} /></li>)}</ul>
            </details>)}
    </section>;
});

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function ownModelListText(locale: Parameters<typeof uncheckedOwnModelListText>[0], key: Parameters<typeof uncheckedOwnModelListText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedOwnModelListText>>): string {
    return totalCopy(locale, key, language => uncheckedOwnModelListText(language, key, ...rest));
}

/**
 * What saving or testing a chat API established (audit A03-04: say only what was checked). A test whose paid call
 * failed (no balance, a used-up quota, rate limits) still saves the API with the models its list returned; the
 * sentence says so. {title} and {test} are the 我的 API dialog and its test button (myApisText), so they always match.
 */
export type OwnApiSaveKey = 'passed' | 'toolsFailed' | 'unconfirmed' | 'unconfirmedNoList' | 'saved' | 'testIncomplete';
const ownApiSaveCopy: Record<NextMuxDesktopLocale, Record<OwnApiSaveKey, string>> = {
    'zh-CN': {
        passed: '“{label}”已保存，连接与工具调用已通过 · {ms} ms',
        toolsFailed: '“{label}”已保存，可以连接，但模型没有按要求发起工具调用；仍可使用，Agent 排序会降低。',
        unconfirmed: '“{label}”已保存，读到 {count} 个模型。测试调用没有成功，常见原因是余额不足、额度用尽或请求过于频繁；可以稍后在“{title}”里点“{test}”重新测试。',
        unconfirmedNoList: '“{label}”已保存。测试调用没有成功，常见原因是余额不足、额度用尽或请求过于频繁；可以稍后在“{title}”里点“{test}”重新测试。',
        saved: '“{label}”已保存，读到 {count} 个模型。',
        testIncomplete: '“{label}”的测试调用没有成功，常见原因是余额不足、额度用尽或请求过于频繁；已读到的模型不受影响。'
    },
    'zh-TW': {
        passed: '「{label}」已儲存，連線與工具呼叫已通過 · {ms} ms',
        toolsFailed: '「{label}」已儲存，可以連線，但模型沒有依要求發起工具呼叫；仍可使用，Agent 排序會降低。',
        unconfirmed: '「{label}」已儲存，讀到 {count} 個模型。測試呼叫沒有成功，常見原因是餘額不足、額度用盡或請求過於頻繁；可以稍後在「{title}」裡點「{test}」重新測試。',
        unconfirmedNoList: '「{label}」已儲存。測試呼叫沒有成功，常見原因是餘額不足、額度用盡或請求過於頻繁；可以稍後在「{title}」裡點「{test}」重新測試。',
        saved: '「{label}」已儲存，讀到 {count} 個模型。',
        testIncomplete: '「{label}」的測試呼叫沒有成功，常見原因是餘額不足、額度用盡或請求過於頻繁；已讀到的模型不受影響。'
    },
    en: {
        passed: '“{label}” saved. Connection and tool calls passed · {ms} ms',
        toolsFailed: '“{label}” saved. It connects, but the model did not make the requested tool call; you can still use it, and Agent ranks it lower.',
        unconfirmed: '“{label}” saved. Models read from its list: {count}. The test call did not succeed, most often because of a low balance, a used-up quota or rate limits. You can test it again later with {test} in {title}.',
        unconfirmedNoList: '“{label}” saved. The test call did not succeed, most often because of a low balance, a used-up quota or rate limits. You can test it again later with {test} in {title}.',
        saved: '“{label}” saved. Models read from its list: {count}.',
        testIncomplete: 'The test call to “{label}” did not succeed, most often because of a low balance, a used-up quota or rate limits. The models already read stay as they are.'
    },
    ja: {
        passed: '「{label}」を保存しました。接続とツール呼び出しの確認に合格しました · {ms} ms',
        toolsFailed: '「{label}」を保存しました。接続はできますが、モデルが求められたツール呼び出しを行いませんでした。引き続き使えますが、Agent での順位は下がります。',
        unconfirmed: '「{label}」を保存しました。一覧から読み取ったモデル: {count} 件。テスト呼び出しは成功しませんでした。残高不足、利用枠の使い切り、リクエスト制限がよくある原因です。後で「{title}」の「{test}」からもう一度テストできます。',
        unconfirmedNoList: '「{label}」を保存しました。テスト呼び出しは成功しませんでした。残高不足、利用枠の使い切り、リクエスト制限がよくある原因です。後で「{title}」の「{test}」からもう一度テストできます。',
        saved: '「{label}」を保存しました。一覧から読み取ったモデル: {count} 件。',
        testIncomplete: '「{label}」へのテスト呼び出しは成功しませんでした。残高不足、利用枠の使い切り、リクエスト制限がよくある原因です。読み取り済みのモデルはそのままです。'
    },
    ko: {
        passed: '“{label}”을(를) 저장했습니다. 연결 및 도구 호출 확인 통과 · {ms} ms',
        toolsFailed: '“{label}”을(를) 저장했습니다. 연결은 되지만 모델이 요청한 도구 호출을 하지 않았습니다. 계속 사용할 수 있지만 Agent 순위가 낮아집니다.',
        unconfirmed: '“{label}”을(를) 저장했습니다. 목록에서 읽은 모델: {count}개. 테스트 호출이 성공하지 못했습니다. 잔액 부족, 사용 한도 소진, 요청 제한이 흔한 원인입니다. 나중에 ‘{title}’에서 ‘{test}’로 다시 테스트할 수 있습니다.',
        unconfirmedNoList: '“{label}”을(를) 저장했습니다. 테스트 호출이 성공하지 못했습니다. 잔액 부족, 사용 한도 소진, 요청 제한이 흔한 원인입니다. 나중에 ‘{title}’에서 ‘{test}’로 다시 테스트할 수 있습니다.',
        saved: '“{label}”을(를) 저장했습니다. 목록에서 읽은 모델: {count}개.',
        testIncomplete: '“{label}” 테스트 호출이 성공하지 못했습니다. 잔액 부족, 사용 한도 소진, 요청 제한이 흔한 원인입니다. 이미 읽은 모델은 그대로 유지됩니다.'
    },
    es: {
        passed: '«{label}» guardado. La conexión y las llamadas a herramientas pasaron la prueba · {ms} ms',
        toolsFailed: '«{label}» guardado. Se conecta, pero el modelo no hizo la llamada a herramientas solicitada; puedes seguir usándolo y Agent lo clasifica más abajo.',
        unconfirmed: '«{label}» guardado. Modelos leídos de su lista: {count}. La llamada de prueba no tuvo éxito; suele deberse a saldo insuficiente, cuota agotada o límites de solicitudes. Puedes volver a probarlo más tarde con «{test}» en «{title}».',
        unconfirmedNoList: '«{label}» guardado. La llamada de prueba no tuvo éxito; suele deberse a saldo insuficiente, cuota agotada o límites de solicitudes. Puedes volver a probarlo más tarde con «{test}» en «{title}».',
        saved: '«{label}» guardado. Modelos leídos de su lista: {count}.',
        testIncomplete: 'La llamada de prueba a «{label}» no tuvo éxito; suele deberse a saldo insuficiente, cuota agotada o límites de solicitudes. Los modelos ya leídos se mantienen.'
    },
    fr: {
        passed: '« {label} » enregistré. La connexion et les appels d’outils ont réussi · {ms} ms',
        toolsFailed: '« {label} » enregistré. Il se connecte, mais le modèle n’a pas fait l’appel d’outil demandé ; il reste utilisable et Agent le classe plus bas.',
        unconfirmed: '« {label} » enregistré. Modèles lus dans sa liste : {count}. L’appel de test n’a pas abouti, le plus souvent à cause d’un solde insuffisant, d’un quota épuisé ou de limites de requêtes. Vous pourrez le tester à nouveau plus tard avec « {test} » dans « {title} ».',
        unconfirmedNoList: '« {label} » enregistré. L’appel de test n’a pas abouti, le plus souvent à cause d’un solde insuffisant, d’un quota épuisé ou de limites de requêtes. Vous pourrez le tester à nouveau plus tard avec « {test} » dans « {title} ».',
        saved: '« {label} » enregistré. Modèles lus dans sa liste : {count}.',
        testIncomplete: 'L’appel de test à « {label} » n’a pas abouti, le plus souvent à cause d’un solde insuffisant, d’un quota épuisé ou de limites de requêtes. Les modèles déjà lus restent inchangés.'
    },
    de: {
        passed: '„{label}“ gespeichert. Verbindung und Tool-Aufrufe bestanden · {ms} ms',
        toolsFailed: '„{label}“ gespeichert. Die Verbindung steht, aber das Modell hat den angeforderten Tool-Aufruf nicht ausgeführt; es bleibt nutzbar, Agent stuft es niedriger ein.',
        unconfirmed: '„{label}“ gespeichert. Aus der Liste gelesene Modelle: {count}. Der Testaufruf war nicht erfolgreich; meist liegt es an zu wenig Guthaben, einem aufgebrauchten Kontingent oder Anfragelimits. Sie können ihn später mit „{test}“ in „{title}“ erneut testen.',
        unconfirmedNoList: '„{label}“ gespeichert. Der Testaufruf war nicht erfolgreich; meist liegt es an zu wenig Guthaben, einem aufgebrauchten Kontingent oder Anfragelimits. Sie können ihn später mit „{test}“ in „{title}“ erneut testen.',
        saved: '„{label}“ gespeichert. Aus der Liste gelesene Modelle: {count}.',
        testIncomplete: 'Der Testaufruf an „{label}“ war nicht erfolgreich; meist liegt es an zu wenig Guthaben, einem aufgebrauchten Kontingent oder Anfragelimits. Die bereits gelesenen Modelle bleiben erhalten.'
    },
    'pt-BR': {
        passed: '“{label}” salvo. Conexão e chamadas de ferramentas aprovadas · {ms} ms',
        toolsFailed: '“{label}” salvo. Ele conecta, mas o modelo não fez a chamada de ferramenta solicitada; continua utilizável, e o Agent o classifica mais abaixo.',
        unconfirmed: '“{label}” salvo. Modelos lidos da lista: {count}. A chamada de teste não teve sucesso; as causas mais comuns são saldo insuficiente, cota esgotada ou limites de requisições. Você pode testar de novo mais tarde com “{test}” em “{title}”.',
        unconfirmedNoList: '“{label}” salvo. A chamada de teste não teve sucesso; as causas mais comuns são saldo insuficiente, cota esgotada ou limites de requisições. Você pode testar de novo mais tarde com “{test}” em “{title}”.',
        saved: '“{label}” salvo. Modelos lidos da lista: {count}.',
        testIncomplete: 'A chamada de teste para “{label}” não teve sucesso; as causas mais comuns são saldo insuficiente, cota esgotada ou limites de requisições. Os modelos já lidos continuam como estão.'
    },
    ru: {
        passed: '«{label}» сохранено. Подключение и вызовы инструментов прошли проверку · {ms} мс',
        toolsFailed: '«{label}» сохранено. Подключение работает, но модель не выполнила запрошенный вызов инструмента; ею можно пользоваться, но в Agent она будет ниже.',
        unconfirmed: '«{label}» сохранено. Моделей прочитано из списка: {count}. Тестовый вызов не удался — чаще всего из-за недостатка средств, исчерпанной квоты или ограничения запросов. Позже можно проверить ещё раз кнопкой «{test}» в разделе «{title}».',
        unconfirmedNoList: '«{label}» сохранено. Тестовый вызов не удался — чаще всего из-за недостатка средств, исчерпанной квоты или ограничения запросов. Позже можно проверить ещё раз кнопкой «{test}» в разделе «{title}».',
        saved: '«{label}» сохранено. Моделей прочитано из списка: {count}.',
        testIncomplete: 'Тестовый вызов к «{label}» не удался — чаще всего из-за недостатка средств, исчерпанной квоты или ограничения запросов. Уже прочитанные модели остаются.'
    },
    ar: {
        passed: 'حُفظ «{label}». اجتاز الاتصال واستدعاء الأدوات · {ms} ms',
        toolsFailed: 'حُفظ «{label}». يتصل، لكن النموذج لم يُجرِ استدعاء الأداة المطلوب؛ يمكنك الاستمرار في استخدامه، ويضعه Agent في مرتبة أدنى.',
        unconfirmed: 'حُفظ «{label}». النماذج المقروءة من قائمته: {count}. لم ينجح استدعاء الاختبار، وغالبًا يكون السبب رصيدًا غير كافٍ أو حصة مستنفدة أو حدودًا على الطلبات. يمكنك اختباره مجددًا لاحقًا عبر «{test}» في «{title}».',
        unconfirmedNoList: 'حُفظ «{label}». لم ينجح استدعاء الاختبار، وغالبًا يكون السبب رصيدًا غير كافٍ أو حصة مستنفدة أو حدودًا على الطلبات. يمكنك اختباره مجددًا لاحقًا عبر «{test}» في «{title}».',
        saved: 'حُفظ «{label}». النماذج المقروءة من قائمته: {count}.',
        testIncomplete: 'لم ينجح استدعاء الاختبار إلى «{label}»، وغالبًا يكون السبب رصيدًا غير كافٍ أو حصة مستنفدة أو حدودًا على الطلبات. تبقى النماذج المقروءة كما هي.'
    },
    hi: {
        passed: '“{label}” सहेजा गया। कनेक्शन और टूल-कॉल जाँच पास हुई · {ms} ms',
        toolsFailed: '“{label}” सहेजा गया। यह जुड़ता है, पर मॉडल ने माँगा गया टूल-कॉल नहीं किया; आप इसे इस्तेमाल कर सकते हैं, पर Agent में इसकी रैंक कम रहेगी।',
        unconfirmed: '“{label}” सहेजा गया। सूची से पढ़े गए मॉडल: {count}। परीक्षण कॉल सफल नहीं हुई; आम कारण कम बैलेंस, खत्म हुआ कोटा या अनुरोध सीमा हैं। बाद में “{title}” में “{test}” से फिर जाँच सकते हैं।',
        unconfirmedNoList: '“{label}” सहेजा गया। परीक्षण कॉल सफल नहीं हुई; आम कारण कम बैलेंस, खत्म हुआ कोटा या अनुरोध सीमा हैं। बाद में “{title}” में “{test}” से फिर जाँच सकते हैं।',
        saved: '“{label}” सहेजा गया। सूची से पढ़े गए मॉडल: {count}।',
        testIncomplete: '“{label}” की परीक्षण कॉल सफल नहीं हुई; आम कारण कम बैलेंस, खत्म हुआ कोटा या अनुरोध सीमा हैं। पहले पढ़े गए मॉडल वैसे ही रहेंगे।'
    }
};

export function ownApiSaveText(locale: NextMuxDesktopLocale, key: OwnApiSaveKey, values: Readonly<Record<string, string>>): string {
    return totalCopy(locale, key, language => ownApiSaveCopy[language][key]).replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
