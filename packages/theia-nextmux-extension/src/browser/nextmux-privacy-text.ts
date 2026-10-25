/** Privacy settings: what each switch does when on and when off (node-loadable). A missing language falls back to English. */
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

export type PrivacyTextKey = 'retentionLabel' | 'collectionLabel' | 'advisoryScope' | 'collectionOn' | 'collectionOff' | 'retentionOn' | 'retentionOff' | 'saving' | 'saved' | 'saveFailed' | 'autoSave';

const TEXT: Readonly<Record<string, Readonly<Record<PrivacyTextKey, string>>>> = {
    'zh-CN': {
        saving: "正在保存…", saved: "隐私设置已保存", saveFailed: "保存失败，已恢复上次保存的设置。", autoSave: "更改会自动保存。",
        retentionLabel: "请求上游不留存与不收集对话数据",
        collectionLabel: "请求上游不收集数据",
        retentionOn: "开启后：向托管请求的上游提出不保留且不收集对话数据的意愿。",
        retentionOff: "关闭后：不额外提出不保留与不收集对话数据的意愿。",
        collectionOn: "开启后：向托管请求的上游提出不收集请求数据的意愿。",
        collectionOff: "关闭后：不额外提出不收集数据的意愿。",
        advisoryScope: "这些偏好不会隐藏模型或阻止调用。上游可能不支持或忽略，无法保证执行；不影响自有 API 或本机保存。",
    },
    'zh-TW': {
        saving: "正在儲存…", saved: "隱私設定已儲存", saveFailed: "儲存失敗，已還原上次儲存的設定。", autoSave: "變更會自動儲存。",
        retentionLabel: "請求上游不留存與不收集對話資料",
        collectionLabel: "請求上游不收集資料",
        retentionOn: "開啟後：向託管請求的上游提出不保留且不收集對話資料的意願。",
        retentionOff: "關閉後：不額外提出不保留與不收集對話資料的意願。",
        collectionOn: "開啟後：向託管請求的上游提出不收集請求資料的意願。",
        collectionOff: "關閉後：不額外提出不收集資料的意願。",
        advisoryScope: "這些偏好不會隱藏模型或阻止呼叫。上游可能不支援或忽略，無法保證執行；不影響自有 API 或本機儲存。",
    },
    en: {
        saving: "Saving…", saved: "Privacy settings saved", saveFailed: "Could not save. The last saved settings were restored.", autoSave: "Changes are saved automatically.",
        retentionLabel: "Request zero retention and no data collection upstream",
        collectionLabel: "Request no upstream data collection",
        retentionOn: "On: asks the upstream of managed requests not to retain or collect conversation data.",
        retentionOff: "Off: sends no additional zero-retention or no-collection preference.",
        collectionOn: "On: asks the upstream of managed requests not to collect request data.",
        collectionOff: "Off: sends no additional no-collection preference.",
        advisoryScope: "These preferences do not hide models or block calls. Upstreams may not support or may ignore them; compliance is not guaranteed. Own API connections and local saving are unaffected.",
    },
    ja: {
        saving: "保存中…", saved: "プライバシー設定を保存しました", saveFailed: "保存できませんでした。前回保存した設定に戻しました。", autoSave: "変更は自動的に保存されます。",
        retentionLabel: "上流に会話データの保持・収集を行わないよう依頼",
        collectionLabel: "上流にデータを収集しないよう依頼",
        retentionOn: "オン：管理型リクエストの上流に、会話データを保持・収集しないよう依頼します。",
        retentionOff: "オフ：データの保持・収集を行わないという追加の希望は送りません。",
        collectionOn: "オン：管理型リクエストの上流に、リクエストデータを収集しないよう依頼します。",
        collectionOff: "オフ：データを収集しないという追加の希望は送りません。",
        advisoryScope: "これらの希望によってモデルが非表示になったり、呼び出しがブロックされたりすることはありません。上流が未対応または無視する場合があり、実行は保証されません。自分の API とローカル保存には影響しません。",
    },
    ko: {
        saving: "저장 중…", saved: "개인정보 설정이 저장되었습니다", saveFailed: "저장하지 못했습니다. 마지막으로 저장한 설정으로 복원했습니다.", autoSave: "변경 사항은 자동으로 저장됩니다.",
        retentionLabel: "상위 제공업체에 대화 데이터 미보관 및 미수집 요청",
        collectionLabel: "상위 제공업체에 데이터 미수집 요청",
        retentionOn: "켜짐: 관리형 요청의 상위 제공업체에 대화 데이터를 보관하거나 수집하지 않도록 요청합니다.",
        retentionOff: "꺼짐: 데이터 미보관 및 미수집에 대한 추가 선호를 보내지 않습니다.",
        collectionOn: "켜짐: 관리형 요청의 상위 제공업체에 요청 데이터를 수집하지 않도록 요청합니다.",
        collectionOff: "꺼짐: 데이터 미수집에 대한 추가 선호를 보내지 않습니다.",
        advisoryScope: "이 선호로 모델을 숨기거나 호출을 차단하지 않습니다. 제공업체가 지원하지 않거나 무시할 수 있으므로 이행을 보장하지 않습니다. 직접 추가한 API와 로컬 저장에는 영향을 주지 않습니다.",
    },
    es: {
        saving: "Guardando…", saved: "Privacidad guardada", saveFailed: "No se pudo guardar. Se restauró la última configuración guardada.", autoSave: "Los cambios se guardan automáticamente.",
        retentionLabel: "Solicitar al proveedor no retener ni recopilar datos de conversación",
        collectionLabel: "Solicitar que el proveedor no recopile datos",
        retentionOn: "Activado: pide al proveedor de las solicitudes gestionadas que no conserve ni recopile datos de conversación.",
        retentionOff: "Desactivado: no envía una preferencia adicional contra la retención o recopilación.",
        collectionOn: "Activado: pide al proveedor de las solicitudes gestionadas que no recopile sus datos.",
        collectionOff: "Desactivado: no envía una preferencia adicional de no recopilación.",
        advisoryScope: "Estas preferencias no ocultan modelos ni bloquean llamadas. El proveedor puede no admitirlas o ignorarlas; no se garantiza su cumplimiento. No afectan a tus propias API ni al guardado local.",
    },
    fr: {
        saving: "Enregistrement…", saved: "Confidentialité enregistrée", saveFailed: "Échec de l’enregistrement. Les derniers réglages enregistrés ont été rétablis.", autoSave: "Les modifications sont enregistrées automatiquement.",
        retentionLabel: "Demander au fournisseur de ne pas conserver ni collecter les données de conversation",
        collectionLabel: "Demander au fournisseur de ne pas collecter de données",
        retentionOn: "Activé : demande au fournisseur des requêtes gérées de ne pas conserver ni collecter les données de conversation.",
        retentionOff: "Désactivé : aucune préférence supplémentaire contre la conservation ou la collecte n’est envoyée.",
        collectionOn: "Activé : demande au fournisseur des requêtes gérées de ne pas collecter leurs données.",
        collectionOff: "Désactivé : aucune préférence supplémentaire contre la collecte n’est envoyée.",
        advisoryScope: "Ces préférences ne masquent aucun modèle et ne bloquent aucun appel. Le fournisseur peut ne pas les prendre en charge ou les ignorer ; leur respect n’est pas garanti. Vos propres API et la sauvegarde locale ne sont pas concernés.",
    },
    de: {
        saving: "Wird gespeichert…", saved: "Datenschutzeinstellungen gespeichert", saveFailed: "Speichern fehlgeschlagen. Die zuletzt gespeicherten Einstellungen wurden wiederhergestellt.", autoSave: "Änderungen werden automatisch gespeichert.",
        retentionLabel: "Keine Aufbewahrung und Erhebung von Gesprächsdaten beim Anbieter anfragen",
        collectionLabel: "Keine Datenerhebung beim Anbieter anfragen",
        retentionOn: "An: Bittet den Anbieter verwalteter Anfragen, Gesprächsdaten weder aufzubewahren noch zu erheben.",
        retentionOff: "Aus: Sendet keinen zusätzlichen Wunsch gegen Aufbewahrung oder Datenerhebung.",
        collectionOn: "An: Bittet den Anbieter verwalteter Anfragen, deren Daten nicht zu erheben.",
        collectionOff: "Aus: Sendet keinen zusätzlichen Wunsch gegen die Datenerhebung.",
        advisoryScope: "Diese Wünsche blenden keine Modelle aus und blockieren keine Aufrufe. Anbieter unterstützen sie möglicherweise nicht oder ignorieren sie; die Einhaltung ist nicht garantiert. Eigene APIs und lokales Speichern bleiben unverändert.",
    },
    'pt-BR': {
        saving: "Salvando…", saved: "Privacidade salva", saveFailed: "Não foi possível salvar. As últimas configurações salvas foram restauradas.", autoSave: "As alterações são salvas automaticamente.",
        retentionLabel: "Solicitar ao provedor não reter nem coletar dados de conversa",
        collectionLabel: "Solicitar que o provedor não colete dados",
        retentionOn: "Ativado: pede ao provedor das solicitações gerenciadas que não retenha nem colete dados de conversa.",
        retentionOff: "Desativado: não envia uma preferência adicional contra retenção ou coleta.",
        collectionOn: "Ativado: pede ao provedor das solicitações gerenciadas que não colete seus dados.",
        collectionOff: "Desativado: não envia uma preferência adicional contra a coleta.",
        advisoryScope: "Essas preferências não ocultam modelos nem bloqueiam chamadas. O provedor pode não oferecer suporte ou ignorá-las; o cumprimento não é garantido. Suas próprias APIs e o salvamento local não são afetados.",
    },
    ru: {
        saving: "Сохранение…", saved: "Настройки приватности сохранены", saveFailed: "Не удалось сохранить. Восстановлены последние сохранённые настройки.", autoSave: "Изменения сохраняются автоматически.",
        retentionLabel: "Попросить провайдера не хранить и не собирать данные диалогов",
        collectionLabel: "Попросить провайдера не собирать данные",
        retentionOn: "Включено: провайдеру управляемых запросов передаётся пожелание не хранить и не собирать данные диалогов.",
        retentionOff: "Выключено: дополнительное пожелание не хранить и не собирать данные не передаётся.",
        collectionOn: "Включено: провайдеру управляемых запросов передаётся пожелание не собирать их данные.",
        collectionOff: "Выключено: дополнительное пожелание не собирать данные не передаётся.",
        advisoryScope: "Эти пожелания не скрывают модели и не блокируют вызовы. Провайдер может не поддерживать или игноровать их; выполнение не гарантируется. Собственные API и локальное сохранение не затрагиваются.",
    },
    ar: {
        saving: "جارٍ الحفظ…", saved: "تم حفظ إعدادات الخصوصية", saveFailed: "تعذّر الحفظ. تمت استعادة آخر إعدادات محفوظة.", autoSave: "تُحفظ التغييرات تلقائيًا.",
        retentionLabel: "طلب عدم الاحتفاظ ببيانات المحادثة أو جمعها من المزوّد",
        collectionLabel: "طلب عدم جمع البيانات من المزوّد",
        retentionOn: "مفعّل: يطلب من مزوّد الطلبات المُدارة عدم الاحتفاظ ببيانات المحادثة أو جمعها.",
        retentionOff: "معطّل: لا يرسل تفضيلًا إضافيًا لعدم الاحتفاظ بالبيانات أو جمعها.",
        collectionOn: "مفعّل: يطلب من مزوّد الطلبات المُدارة عدم جمع بيانات الطلب.",
        collectionOff: "معطّل: لا يرسل تفضيلًا إضافيًا لعدم جمع البيانات.",
        advisoryScope: "لا تُخفي هذه التفضيلات النماذج ولا تمنع الاستدعاءات. قد لا يدعمها المزوّد أو قد يتجاهلها، لذا لا نضمن تنفيذها. لا تؤثر في واجهات API الخاصة بك أو الحفظ المحلي.",
    },
    hi: {
        saving: "सहेजा जा रहा है…", saved: "गोपनीयता सेटिंग सहेजी गईं", saveFailed: "सहेजा नहीं जा सका। पिछली सहेजी गई सेटिंग बहाल कर दी गईं।", autoSave: "बदलाव अपने आप सहेजे जाते हैं।",
        retentionLabel: "प्रदाता से बातचीत का डेटा न रखने और न जुटाने का अनुरोध",
        collectionLabel: "प्रदाता से डेटा न जुटाने का अनुरोध",
        retentionOn: "चालू: प्रबंधित अनुरोधों के प्रदाता से बातचीत का डेटा न रखने और न जुटाने को कहता है।",
        retentionOff: "बंद: डेटा न रखने या न जुटाने की कोई अतिरिक्त पसंद नहीं भेजता।",
        collectionOn: "चालू: प्रबंधित अनुरोधों के प्रदाता से अनुरोध डेटा न जुटाने को कहता है।",
        collectionOff: "बंद: डेटा न जुटाने की कोई अतिरिक्त पसंद नहीं भेजता।",
        advisoryScope: "इन पसंदों से मॉडल छिपते नहीं और कॉल रुकती नहीं हैं। प्रदाता इनका समर्थन न करे या इन्हें अनदेखा कर सकता है; पालन की गारंटी नहीं है। आपकी अपनी API और स्थानीय सेविंग पर असर नहीं पड़ता।",
    }
};
export const PRIVACY_TEXT_LOCALES = Object.keys(TEXT);

function uncheckedPrivacyText(locale: string, key: PrivacyTextKey, values?: Readonly<Record<string, string | number>>): string {
    const raw = (TEXT[locale] ?? (locale.startsWith('zh') ? TEXT['zh-CN'] : undefined))?.[key];
    if (typeof raw !== 'string') throw new Error('missing');
    return raw.replace(/\{(\w+)\}/g, (match, name: string) => values && values[name] !== undefined ? String(values[name]) : match);
}

export function privacyText(locale: string, key: PrivacyTextKey, ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedPrivacyText>>): string {
    return totalCopy(locale, key, language => uncheckedPrivacyText(language, key, ...rest));
}
