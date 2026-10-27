import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import type { NextMuxDesktopLocale } from './nextmux-locale';

const copy: Record<NextMuxDesktopLocale, readonly [string, string, string]> = {
    'zh-CN': ['允许自动切换 {model}', '本次对话优先使用同一中转商的 {model} 最佳线路；不可用时切换其他中转商。', '自动最优'],
    'zh-TW': ['允許自動切換 {model}', '本次對話優先使用同一中轉商的 {model} 最佳線路；不可用時切換其他中轉商。', '自動最佳'],
    en: ['Allow automatic switching for {model}', 'this conversation prefers the best {model} route at this merchant; switch merchants when unavailable.', 'Automatic best'],
    ja: ['{model} の自動切替を許可', 'この会話では同じ事業者の {model} 最適経路を優先し、利用できなければ別事業者へ切り替えます。', '自動最適'],
    ko: ['{model} 자동 전환 허용', '이 대화는 현재 사업자의 {model} 최적 경로를 우선하고, 사용할 수 없으면 다른 사업자로 전환합니다.', '자동 최적'],
    es: ['Permitir cambio automático para {model}', 'Esta conversación prioriza la mejor ruta de {model} en este proveedor; cambia si no está disponible.', 'Mejor automático'],
    fr: ['Autoriser le basculement automatique pour {model}', 'Cette conversation privilégie la meilleure route {model} chez ce marchand ; change s’il est indisponible.', 'Meilleur automatique'],
    de: ['Automatisches Umschalten für {model} erlauben', 'Dieses Gespräch bevorzugt beim Anbieter die beste {model}-Route und wechselt bei Ausfall.', 'Automatisch optimal'],
    'pt-BR': ['Permitir troca automática para {model}', 'Esta conversa prioriza a melhor rota de {model} neste fornecedor; muda se ela não estiver disponível.', 'Melhor automático'],
    ru: ['Разрешить автопереключение для {model}', 'В этом разговоре выбирается лучший маршрут {model} у поставщика; при недоступности выполняется переключение.', 'Автоматически лучший'],
    ar: ['السماح بالتبديل التلقائي لـ {model}', 'تفضّل هذه المحادثة أفضل مسار لـ {model} لدى التاجر، ثم تبدّل عند عدم التوفر.', 'الأفضل تلقائياً'],
    hi: ['{model} के लिए स्वतः स्विच करने दें', 'यह बातचीत इस विक्रेता पर {model} का सर्वोत्तम मार्ग पहले चुनती है; अनुपलब्ध होने पर बदलती है।', 'स्वचालित सर्वोत्तम']
};

const conversationHint: Record<NextMuxDesktopLocale, string> = {
    'zh-CN': '本次对话优先使用当前中转商中所选模型的最佳线路；不可用时切换其他中转商，保持模型不变。',
    'zh-TW': '本次對話優先使用目前中轉商中所選模型的最佳線路；不可用時切換其他中轉商，保持模型不變。',
    en: 'This conversation prefers the best route for the selected model at this merchant; if unavailable, it switches merchants while keeping the same model.',
    ja: 'この会話では現在の事業者にある選択モデルの最適経路を優先し、利用できない場合はモデルを変えずに別の事業者へ切り替えます。',
    ko: '이 대화에서는 현재 사업자의 선택한 모델에 대한 최적 경로를 우선 사용하며, 이용할 수 없으면 모델을 유지한 채 다른 사업자로 전환합니다.',
    es: 'Esta conversación prioriza la mejor ruta del modelo seleccionado en este proveedor; si no está disponible, cambia de proveedor y conserva el modelo.',
    fr: 'Cette conversation privilégie la meilleure route du modèle sélectionné chez ce fournisseur ; si elle est indisponible, elle change de fournisseur en gardant le même modèle.',
    de: 'Dieses Gespräch bevorzugt die beste Route des gewählten Modells bei diesem Anbieter; bei Ausfall wechselt es den Anbieter und behält das Modell bei.',
    'pt-BR': 'Esta conversa prioriza a melhor rota do modelo selecionado neste fornecedor; se estiver indisponível, troca de fornecedor e mantém o mesmo modelo.',
    ru: 'В этом разговоре используется лучший маршрут выбранной модели у текущего поставщика; при недоступности поставщик меняется, а модель остаётся прежней.',
    ar: 'تفضّل هذه المحادثة أفضل مسار للنموذج المحدد لدى المورّد الحالي؛ وإذا لم يكن متاحاً، تبدّل المورّد مع الإبقاء على النموذج نفسه.',
    hi: 'यह बातचीत इस विक्रेता पर चुने गए मॉडल का सर्वोत्तम मार्ग पहले चुनती है; अनुपलब्ध होने पर मॉडल बदले बिना दूसरे विक्रेता पर जाती है।'
};

const globalCopy: Record<NextMuxDesktopLocale, readonly [string, string]> = {
    'zh-CN': ['自动最优-全局生效', '优先选择同模型最佳线路；当前中转商不可用时自动切换其他中转商。'],
    'zh-TW': ['自動最佳-全域生效', '全域啟用同模型最佳線路；目前中轉商不可用時自動切換其他中轉商。'],
    en: ['Automatic best · global', 'Use the best same-model route everywhere; switch merchants when the current one is unavailable.'],
    ja: ['自動最適・グローバル', 'すべての会話で同モデルの最適経路を使い、利用できなければ別事業者へ切り替えます。'],
    ko: ['자동 최적 · 전역 적용', '모든 대화에서 같은 모델의 최적 경로를 사용하고, 불가하면 다른 사업자로 전환합니다.'],
    es: ['Mejor automático · global', 'Usa la mejor ruta del mismo modelo en todas partes y cambia de proveedor si no está disponible.'],
    fr: ['Meilleur automatique · global', 'Utilise partout la meilleure route du même modèle et change de marchand si elle est indisponible.'],
    de: ['Automatisch optimal · global', 'Nutze überall die beste Route desselben Modells und wechsle bei Ausfall den Anbieter.'],
    'pt-BR': ['Melhor automático · global', 'Usa a melhor rota do mesmo modelo em todas as conversas e muda de fornecedor se necessário.'],
    ru: ['Автоматически лучший · глобально', 'Используйте лучший маршрут той же модели во всех разговорах и переключайтесь при недоступности.'],
    ar: ['الأفضل تلقائياً · عام', 'استخدم أفضل مسار للنموذج نفسه في كل المحادثات وبدّل التاجر عند عدم التوفر.'],
    hi: ['स्वचालित सर्वोत्तम · वैश्विक', 'हर बातचीत में उसी मॉडल का सर्वोत्तम मार्ग चुनें और अनुपलब्ध होने पर विक्रेता बदलें।']
};

export function relaySwitchCopy(locale: NextMuxDesktopLocale, model: string, global = false): { label: string; hint: string } {
    if (global) {
        const [label, hint] = globalCopy[locale];
        return { label, hint };
    }
    const text = copy[locale];
    return model ? { label: text[0].replace('{model}', model), hint: text[1].replace('{model}', model) }
        : { label: text[2], hint: conversationHint[locale] };
}

/** Compact label used in the model picker header.  The full explanation is
 * still available through the control tooltip so the header stays usable in
 * narrow drawers. */
export function automaticOptimalText(locale: NextMuxDesktopLocale, global = false): string {
    const labels: Record<NextMuxDesktopLocale, string> = {
        'zh-CN': '自动最优', 'zh-TW': '自動最佳', en: 'Automatic best', ja: '自動最適', ko: '자동 최적',
        es: 'Mejor automático', fr: 'Meilleur automatique', de: 'Automatisch optimal', 'pt-BR': 'Melhor automático',
        ru: 'Автоматически лучший', ar: 'الأفضل تلقائياً', hi: 'स्वचालित सर्वोत्तम'
    };
    if (!global) return labels[locale];
    const globalLabels: Record<NextMuxDesktopLocale, string> = {
        'zh-CN': '自动最优-全局生效', 'zh-TW': '自動最佳-全域生效', en: 'Automatic best · global', ja: '自動最適・グローバル',
        ko: '자동 최적 · 전역 적용', es: 'Mejor automático · global', fr: 'Meilleur automatique · global', de: 'Automatisch optimal · global',
        'pt-BR': 'Melhor automático · global', ru: 'Автоматически лучший · глобально', ar: 'الأفضل تلقائياً · عام', hi: 'स्वचालित सर्वोत्तम · वैश्विक'
    };
    return globalLabels[locale];
}


export function modelSwitchSaveError(locale: NextMuxDesktopLocale): string {
    const messages: Record<NextMuxDesktopLocale, string> = {
        'zh-CN': '保存失败，请重试', 'zh-TW': '儲存失敗，請重試', en: 'Could not save; please retry',
        ja: '保存できません。再試行してください', ko: '저장 실패. 다시 시도하세요', es: 'No se pudo guardar; reintenta',
        fr: 'Échec de sauvegarde ; réessayez', de: 'Speichern fehlgeschlagen; erneut versuchen', 'pt-BR': 'Falha ao salvar; tente novamente',
        ru: 'Не удалось сохранить; повторите', ar: 'تعذر الحفظ؛ حاول مجدداً', hi: 'सहेजा नहीं जा सका; पुनः प्रयास करें'
    };
    return messages[locale];
}

const settingsCopy: Record<NextMuxDesktopLocale, readonly [string, string, string, string]> = {
    'zh-CN': ['自动模型切换', '先尝试当前商家的其他 API，再尝试其他商家的同一模型；不跨模型。', '允许自动切换', '全局开关作用于所有对话；关闭后仍可在单个对话中单独开启。'],
    'zh-TW': ['自動模型切換', '先嘗試目前商家的其他 API，再嘗試其他商家的同一模型；不跨模型。', '允許自動切換', '全域開關套用至所有對話；關閉後仍可在單一對話中個別開啟。'],
    en: ['Automatic model switching', 'Try other APIs at the current merchant before other merchants serving the same model. Never change models.', 'Allow automatic switching', 'The global switch applies to every conversation; after turning it off, a conversation can still opt in by itself.'],
    ja: ['モデルの自動切替', '同じ事業者の別 API を先に試し、その後に同じモデルを扱う別の事業者を試します。モデルは変更しません。', '自動切替を許可', '現在の会話と同期し、新しい会話の既定値にします。他の既存の会話の設定は保持します。'],
    ko: ['모델 자동 전환', '현재 사업자의 다른 API를 먼저 시도한 후 같은 모델을 제공하는 다른 사업자를 시도합니다. 모델은 바꾸지 않습니다.', '자동 전환 허용', '현재 대화와 동기화하고 새 대화의 기본값으로 사용합니다. 다른 기존 대화의 설정은 유지됩니다.'],
    es: ['Cambio automático de modelo', 'Prueba primero otras API del proveedor actual y después otros proveedores del mismo modelo. Nunca cambia de modelo.', 'Permitir cambio automático', 'Sincroniza esta conversación y fija el valor predeterminado para las nuevas. Las demás conservan sus ajustes.'],
    fr: ['Basculement automatique', 'Essaie les autres API du marchand actuel avant les autres marchands du même modèle. Ne change jamais de modèle.', 'Autoriser le basculement automatique', 'Synchronise cette conversation et définit le réglage des nouvelles. Les autres conversations existantes gardent leurs réglages.'],
    de: ['Automatisches Umschalten', 'Zuerst andere APIs desselben Anbieters, dann andere Anbieter desselben Modells versuchen. Das Modell bleibt gleich.', 'Automatisches Umschalten erlauben', 'Synchronisiert dieses Gespräch und legt den Standard für neue fest. Andere bestehende Gespräche behalten ihre Einstellungen.'],
    'pt-BR': ['Troca automática de modelo', 'Tenta outras APIs do fornecedor atual antes de outros fornecedores do mesmo modelo. Nunca muda o modelo.', 'Permitir troca automática', 'Sincroniza esta conversa e define o padrão para novas. As outras conversas existentes mantêm suas configurações.'],
    ru: ['Автоматическое переключение', 'Сначала пробуются другие API текущего поставщика, затем другие поставщики той же модели. Модель не меняется.', 'Разрешить автопереключение', 'Синхронизирует этот разговор и задаёт настройку для новых. Остальные существующие разговоры сохраняют свои настройки.'],
    ar: ['التبديل التلقائي', 'تُجرَّب واجهات التاجر الحالي الأخرى أولاً، ثم تجار آخرون للنموذج نفسه. لا يتغير النموذج.', 'السماح بالتبديل التلقائي', 'يتزامن مع هذه المحادثة ويحدد الإعداد الافتراضي للجديدة. تحتفظ المحادثات الأخرى بإعداداتها.'],
    hi: ['स्वचालित मॉडल स्विचिंग', 'पहले वर्तमान विक्रेता के अन्य API, फिर उसी मॉडल के दूसरे विक्रेताओं को आज़माएँ। मॉडल नहीं बदलता।', 'स्वतः स्विच करने दें', 'इस बातचीत से समन्वय करता है और नई बातचीत का डिफ़ॉल्ट तय करता है। अन्य मौजूदा बातचीत अपनी सेटिंग रखती हैं।']
};

export function modelSwitchSettingCopy(locale: NextMuxDesktopLocale): { title: string; body: string; label: string; hint: string } {
    const [title, body, label, hint] = settingsCopy[locale];
    return { title, body, label, hint };
}

export function RelaySwitchControl({ locale, model, enabled, onChange, global = false }: {
    readonly locale: NextMuxDesktopLocale; readonly model: string; readonly enabled: boolean;
    readonly onChange: (enabled: boolean) => void; readonly global?: boolean;
}): React.ReactElement {
    const text = relaySwitchCopy(locale, model, global);
    const id = React.useId();
    const [anchor, setAnchor] = React.useState<DOMRect>();
    const control = React.useRef<HTMLLabelElement>(null);
    const tooltip = React.useRef<HTMLDivElement>(null);
    const [height, setHeight] = React.useState(160);
    React.useLayoutEffect(() => { if (anchor && tooltip.current) setHeight(tooltip.current.getBoundingClientRect().height); }, [anchor, text.hint]);
    React.useEffect(() => {
        if (!anchor) return;
        const reposition = (): void => { if (control.current) setAnchor(control.current.getBoundingClientRect()); };
        window.addEventListener('scroll', reposition, true); window.addEventListener('resize', reposition);
        return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
    }, [anchor]);
    const width = Math.min(280, window.innerWidth - 16);
    return <label ref={control} className='nmx-same-model-switch nmx-topbar-routing' onPointerEnter={event => setAnchor(event.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setAnchor(undefined)} onFocus={event => setAnchor(event.currentTarget.getBoundingClientRect())}
        onBlur={() => setAnchor(undefined)} onKeyDown={event => { if (event.key === 'Escape' && anchor) { event.stopPropagation(); setAnchor(undefined); } }}>
        <input type='checkbox' checked={enabled} disabled={!global && !model} aria-label={text.label} aria-describedby={anchor ? id : undefined}
            onChange={event => onChange(event.currentTarget.checked)} />
        <span className='nmx-checkbox-indicator' aria-hidden='true'></span>
        <span>{text.label}</span>
        {anchor && ReactDOM.createPortal(<div ref={tooltip} id={id} role='tooltip' className='nmx-same-model-switch-tooltip'
            lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}
            style={{ width, left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
                top: Math.max(8, Math.min(anchor.top - height - 6, window.innerHeight - height - 8)) }}>{text.hint}</div>, document.body)}
    </label>;
}
