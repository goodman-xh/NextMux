import * as React from '@theia/core/shared/react';
import type { NativeWebResearchDeclaration } from '@nextmux/model-runtime';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { totalCopy } from './nextmux-copy-fallback';

export type NativeWebResearchSetting = NativeWebResearchDeclaration | null | 'automatic';

const en = {
    title: 'Web protocol', protocol: 'Web protocol', local: 'Local only', automatic: 'Auto', disabled: 'Disabled',
    hint: 'Uses the provider’s supported protocol; billed by actual usage.'
} as const;
type Key = keyof typeof en;
const translations: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': { title: '联网协议', protocol: '联网协议', local: '仅本机', automatic: '自动', disabled: '禁用联网', hint: '按上游支持协议启用，按实际用量计费。' },
    'zh-TW': { title: '連網協定', protocol: '連網協定', local: '僅本機', automatic: '自動', disabled: '停用連網', hint: '依上游支援協定啟用，依實際用量計費。' },
    ja: { title: 'ウェブ接続プロトコル', protocol: 'API プロトコル', local: 'このコンピューターにのみ保存', automatic: '自動（API 設定）', disabled: 'ウェブ接続を無効化', hint: 'プロバイダーが対応する API プロトコルを選択してください。選択しても現在のモデルのウェブ接続能力が検証されるわけではありません。ウェブ接続はプロバイダーの実際の使用量に応じて課金されます。' },
    ko: { title: '웹 연결 프로토콜', protocol: 'API 프로토콜', local: '이 컴퓨터에만 저장', automatic: '자동(API 설정)', disabled: '웹 연결 사용 안 함', hint: '제공업체가 지원하는 API 프로토콜을 선택하세요. 선택해도 현재 모델의 웹 연결 기능이 검증되는 것은 아닙니다. 웹 연결은 제공업체의 실제 사용량에 따라 청구됩니다.' },
    es: { title: 'Protocolo de acceso web', protocol: 'Protocolo de API', local: 'Guardado solo en este equipo', automatic: 'Automático (configuración de API)', disabled: 'Desactivar acceso web', hint: 'Elige un protocolo de API compatible con tu proveedor. Elegirlo no verifica el acceso web del modelo actual. El acceso web se factura según el uso real del proveedor.' },
    fr: { title: 'Protocole d’accès web', protocol: 'Protocole API', local: 'Enregistré sur cet ordinateur uniquement', automatic: 'Automatique (paramètres API)', disabled: 'Désactiver l’accès web', hint: 'Choisissez un protocole API pris en charge par votre fournisseur. Ce choix ne vérifie pas l’accès web du modèle actuel. L’accès web est facturé selon l’utilisation réelle du fournisseur.' },
    de: { title: 'Protokoll für Webzugriff', protocol: 'API-Protokoll', local: 'Nur auf diesem Computer gespeichert', automatic: 'Automatisch (API-Einstellungen)', disabled: 'Webzugriff deaktivieren', hint: 'Wählen Sie ein API-Protokoll, das Ihr Anbieter unterstützt. Die Auswahl bestätigt keinen Webzugriff des aktuellen Modells. Webzugriff wird nach dem tatsächlichen Verbrauch beim Anbieter abgerechnet.' },
    'pt-BR': { title: 'Protocolo de acesso à web', protocol: 'Protocolo de API', local: 'Salvo apenas neste computador', automatic: 'Automático (configuração da API)', disabled: 'Desativar acesso à web', hint: 'Escolha um protocolo de API compatível com seu provedor. A escolha não verifica o acesso à web do modelo atual. O acesso à web é cobrado conforme o uso real do provedor.' },
    ru: { title: 'Протокол доступа к вебу', protocol: 'Протокол API', local: 'Сохраняется только на этом компьютере', automatic: 'Автоматически (настройки API)', disabled: 'Отключить доступ к вебу', hint: 'Выберите протокол API, поддерживаемый вашим провайдером. Выбор не подтверждает доступ к вебу у текущей модели. Доступ к вебу оплачивается по фактическому использованию у провайдера.' },
    ar: { title: 'بروتوكول الوصول إلى الويب', protocol: 'بروتوكول API', local: 'يُحفظ على هذا الكمبيوتر فقط', automatic: 'تلقائي (إعدادات API)', disabled: 'تعطيل الوصول إلى الويب', hint: 'اختر بروتوكول API يدعمه مزوّدك. اختيار البروتوكول لا يتحقق من قدرة النموذج الحالي على الوصول إلى الويب. تُحتسب تكلفة الوصول إلى الويب وفق الاستخدام الفعلي لدى المزوّد.' },
    hi: { title: 'वेब ऐक्सेस प्रोटोकॉल', protocol: 'API प्रोटोकॉल', local: 'केवल इस कंप्यूटर पर सहेजा जाता है', automatic: 'अपने-आप (API सेटिंग)', disabled: 'वेब ऐक्सेस बंद करें', hint: 'अपने प्रदाता द्वारा समर्थित API प्रोटोकॉल चुनें। प्रोटोकॉल चुनने से मौजूदा मॉडल की वेब ऐक्सेस क्षमता सत्यापित नहीं होती। वेब ऐक्सेस का शुल्क प्रदाता के वास्तविक उपयोग के अनुसार लगता है।' }
};

export function nativeWebResearchText(locale: NextMuxDesktopLocale, key: Key): string {
    return totalCopy(locale, key, language => (translations[language] || en)[key]);
}

const profiles: Readonly<Record<NativeWebResearchDeclaration['profile'], string>> = {
    openrouter_server_tools: 'OpenRouter Server Tools',
    openai_responses: 'OpenAI Responses',
    anthropic_messages: 'Anthropic Messages',
    gemini_generate_content: 'Gemini GenerateContent',
    zhipu_chat: 'Zhipu Chat Completions (search_std)'
};

/** Automatic provider metadata is not a manual override when editing a connection. */
export function nativeWebResearchDraft(value: NativeWebResearchDeclaration | null | undefined): NativeWebResearchSetting {
    return value === null ? null : value?.source === 'manual_override' ? value : 'automatic';
}

export function nativeWebResearchSelection(value: NativeWebResearchSetting | undefined): string {
    return value === null ? 'disabled' : value && typeof value === 'object' ? value.profile : 'automatic';
}

/** This declares the selected wire format; it is not proof that a model supports it. */
export function nativeWebResearchSetting(value: string): NativeWebResearchSetting {
    if (value === 'disabled') return null;
    if (!Object.hasOwn(profiles, value)) return 'automatic';
    const profile = value as NativeWebResearchDeclaration['profile'];
    return { version: 1, profile, search: 'supported', fetch: ['openrouter_server_tools', 'anthropic_messages', 'gemini_generate_content'].includes(profile) ? 'supported' : 'unsupported',
        source: 'manual_override', ...(profile === 'zhipu_chat' ? { zhipuSearchEngine: 'search_std' as const } : {}) };
}

export function NativeWebResearchFields(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly value?: NativeWebResearchSetting;
    readonly disabled: boolean;
    readonly inline?: boolean;
    readonly onChange: (value: NativeWebResearchSetting) => void;
}): React.ReactElement {
    const t = (key: Key): string => nativeWebResearchText(props.locale, key);
    const selection = nativeWebResearchSelection(props.value), hintId = React.useId();
    const selectedLabel = selection === 'automatic' ? t('automatic') : selection === 'disabled' ? t('disabled') : profiles[selection as keyof typeof profiles];
    const content = <>
        <label data-official-field='native-web-research'><span>{t('protocol')}<small>{t('local')}</small></span>
            <select disabled={props.disabled} value={selection} aria-describedby={hintId}
                onChange={event => props.onChange(nativeWebResearchSetting(event.currentTarget.value))}>
                <option value='automatic'>{t('automatic')}</option><option value='disabled'>{t('disabled')}</option>
                {Object.entries(profiles).map(([profile, label]) => <option key={profile} value={profile}>{label}</option>)}
            </select>
        </label>
        <p id={hintId} className='nmx-connection-note'>{t('hint')}</p>
    </>;
    if (props.inline) {
        return <div className='nmx-official-advanced-section' data-native-web-research='true' data-nmx-literal dir={props.locale === 'ar' ? 'rtl' : undefined}>
            {content}
        </div>;
    }
    return <details className='nmx-official-advanced' data-native-web-research='true' data-nmx-literal dir={props.locale === 'ar' ? 'rtl' : undefined}>
        <summary><strong>{t('title')}</strong><small>{selectedLabel}</small></summary>
        <div className='nmx-official-advanced-body'>
            {content}
        </div>
    </details>;
}
