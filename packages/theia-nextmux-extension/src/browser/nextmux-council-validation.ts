import { agentCouncilValidationErrorMessage } from '@nextmux/agent-runtime/council';
import type { DesktopCouncilValidationError } from '../common/nextmux-council-config';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { councilModeText } from './nextmux-council-mode-locale';

const correction: Partial<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '已保存的 Council 配置无效，请打开配置修正后再启用。',
    'zh-TW': '已儲存的 Council 設定無效，請開啟設定修正後再啟用。',
    en: 'The saved Council configuration is invalid. Open its settings and correct it before enabling.',
    ja: '保存された Council 設定が無効です。設定を開いて修正してから有効にしてください。',
    ko: '저장된 Council 구성이 유효하지 않습니다. 설정을 열어 수정한 후 활성화하세요.',
    es: 'La configuración guardada de Council no es válida. Corrígela antes de activarla.',
    fr: 'La configuration Council enregistrée est invalide. Corrigez-la avant de l’activer.',
    de: 'Die gespeicherte Council-Konfiguration ist ungültig. Bitte vor dem Aktivieren korrigieren.',
    'pt-BR': 'A configuração salva do Council é inválida. Corrija-a antes de ativar.',
    ru: 'Сохранённая конфигурация Council недействительна. Исправьте её перед включением.',
    ar: 'إعداد Council المحفوظ غير صالح. افتح الإعدادات وصححها قبل التفعيل.',
    hi: 'सहेजा गया Council विन्यास अमान्य है। सक्रिय करने से पहले सेटिंग खोलकर सुधारें।'
};
const bounds: Partial<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '请选择 3–8 个模型席位。', 'zh-TW': '請選擇 3–8 個模型席位。', en: 'Choose 3–8 model slots.',
    ja: 'モデル枠を3〜8個設定してください。', ko: '모델 슬롯을 3~8개 선택하세요.', es: 'Elige entre 3 y 8 modelos.',
    fr: 'Choisissez entre 3 et 8 modèles.', de: 'Wählen Sie 3 bis 8 Modellplätze.', 'pt-BR': 'Escolha de 3 a 8 modelos.',
    ru: 'Выберите от 3 до 8 слотов моделей.', ar: 'اختر من 3 إلى 8 خانات للنماذج.', hi: '3 से 8 मॉडल स्लॉट चुनें।'
};
const details: Record<string, Partial<Record<DesktopCouncilValidationError, string>>> = {
    'zh-CN': { config_invalid: '配置字段损坏，请打开配置修正。', slot_invalid: '模型席位数据不完整，请重新配置。', slot_id_required: '模型席位缺少编号，请打开配置修正。',
        duplicate_slot_ids: '模型席位编号重复，请打开配置修正。', slot_roles_invalid: '存在未知岗位，请从 8 个岗位中重新选择。',
        lead_slot_mismatch: '负责人编号与负责人岗位不一致，请重新指定负责人。' },
    'zh-TW': { config_invalid: '設定欄位損壞，請開啟設定修正。', slot_invalid: '模型席位資料不完整，請重新設定。', slot_id_required: '模型席位缺少編號，請開啟設定修正。',
        duplicate_slot_ids: '模型席位編號重複，請開啟設定修正。', slot_roles_invalid: '存在未知崗位，請從 8 個崗位中重新選擇。',
        lead_slot_mismatch: '負責人編號與負責人崗位不一致，請重新指定負責人。' }
};

export function councilValidationMessage(locale: NextMuxDesktopLocale, error: DesktopCouncilValidationError | undefined): string {
    if (!error) return '';
    if (error === 'min_slots' || error === 'max_slots') return bounds[locale] || bounds.en!;
    if (error === 'lead_required' || error === 'multiple_leads') return councilModeText(locale, 'leadRequiredHint');
    if (error === 'slot_model_required') return councilModeText(locale, 'selectModelPlaceholder');
    if (error === 'slot_roles_required') return councilModeText(locale, 'selectRolesPlaceholder');
    if (error === 'slot_route_required') return councilModeText(locale, 'routeUnavailable');
    return details[locale]?.[error] || (locale === 'en' ? agentCouncilValidationErrorMessage(error) : correction[locale] || correction.en!);
}

export function councilInvalidHistoryMessage(locale: NextMuxDesktopLocale, error: DesktopCouncilValidationError | undefined): string {
    return `${correction[locale] || correction.en} ${councilValidationMessage(locale, error)}`;
}
