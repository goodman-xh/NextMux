import type { CanvasGenerationOptionDecision } from '@nextmux/comic-core/canvas';
import { canvasText, type CanvasTextKey } from './nextmux-comic-canvas-text';

const locales = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const messages = {
    on: ['开','On','開','オン','켜짐','Activado','Activé','Ein','Ativado','Вкл.','مفعّل','चालू'],
    off: ['关','Off','關','オフ','꺼짐','Desactivado','Désactivé','Aus','Desativado','Выкл.','معطّل','बंद'],
    adjusted: ['已按当前模型和方式调整以下选项：','Adjusted these options to the current model and mode:','已依目前模型與方式調整以下選項：','現在のモデルと方式に合わせて変更した設定：','현재 모델과 모드에 맞춰 조정된 설정:','Opciones ajustadas al modelo y modo actuales:','Options ajustées au modèle et au mode actuels :','An aktuelles Modell und Modus angepasste Optionen:','Opções ajustadas ao modelo e modo atuais:','Параметры приведены к текущей модели и режиму:','خيارات معدّلة وفق النموذج والوضع الحاليين:','वर्तमान मॉडल और मोड के अनुसार बदले विकल्प:'],
    unset: ['未设置','Not set','未設定','未設定','설정 안 됨','Sin definir','Non défini','Nicht festgelegt','Não definido','Не задано','غير محدد','सेट नहीं'],
    other: ['其他参数','Other setting','其他參數','その他の設定','기타 설정','Otro ajuste','Autre réglage','Andere Einstellung','Outra configuração','Другой параметр','إعداد آخر','अन्य सेटिंग'],
    audioReferences: ['参考音频保留在本次输入中（{n} 个）；生成声音开关不会移除这些参考。','Audio references remain in this request ({n}); the sound-generation switch does not remove them.','參考音訊保留於本次輸入（{n} 個）；生成聲音開關不會移除參考。','音声参照（{n}件）は入力に残ります。音声生成スイッチでは削除されません。','오디오 참조 {n}개가 입력에 유지됩니다. 사운드 생성 스위치로 제거되지 않습니다.','Se conservan {n} referencias de audio; el interruptor de generación de sonido no las elimina.','Les {n} références audio sont conservées ; le bouton de génération sonore ne les retire pas.','Die {n} Audioreferenzen bleiben erhalten; der Schalter zur Tonerzeugung entfernt sie nicht.','As {n} referências de áudio permanecem; a opção de gerar som não as remove.','Аудиообразцы ({n}) остаются во входных данных; переключатель генерации звука их не удаляет.','تبقى المراجع الصوتية ({n}) ضمن المدخلات؛ مفتاح توليد الصوت لا يزيلها.','ऑडियो संदर्भ ({n}) इनपुट में बने रहेंगे; ध्वनि निर्माण स्विच उन्हें नहीं हटाता।'],
    modeBlocked: ['该方式无法保留当前参考。请先移除不兼容的参考，再切换方式。','This mode cannot retain the current references. Remove incompatible references before switching.','此方式無法保留目前參考。請先移除不相容的參考，再切換方式。','この方式では現在の参照を保持できません。互換性のない参照を外してから切り替えてください。','이 모드는 현재 참조를 유지할 수 없습니다. 호환되지 않는 참조를 제거한 후 전환하세요.','Este modo no admite las referencias actuales. Elimina las incompatibles antes de cambiar.','Ce mode ne conserve pas les références actuelles. Retirez les références incompatibles avant de changer.','Dieser Modus kann die aktuellen Referenzen nicht behalten. Entfernen Sie inkompatible Referenzen vor dem Wechsel.','Este modo não mantém as referências atuais. Remova as incompatíveis antes de trocar.','Этот режим не сохраняет текущие ссылки. Перед переключением удалите несовместимые материалы.','لا يمكن لهذا الوضع الاحتفاظ بالمراجع الحالية. أزل المراجع غير المتوافقة قبل التبديل.','यह मोड मौजूदा संदर्भ नहीं रख सकता। बदलने से पहले असंगत संदर्भ हटाएँ।']
} as const;
export function canvasOptionsText(locale: string, key: keyof typeof messages, values: Record<string, string | number> = {}): string {
    const index = locales.indexOf(locale);
    return (messages[key]?.[index < 0 ? locale.startsWith('zh') ? 0 : 1 : index] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}
export function canvasOptionAdjustments(locale: string, decision: CanvasGenerationOptionDecision | undefined): readonly string[] {
    if (!decision) return [];
    const fields: Record<string, CanvasTextKey> = { mode: 'mode', resolution: 'resolution', aspectRatio: 'aspect', durationSeconds: 'duration', generateAudio: 'audio' };
    const value = (path: string, item: unknown): string => item === undefined ? canvasOptionsText(locale, 'unset')
        : path === 'mode' ? canvasText(locale, `mode.${item}` as CanvasTextKey) : typeof item === 'boolean' ? canvasOptionsText(locale, item ? 'on' : 'off') : String(item);
    return decision.adjustments.map(change => {
        const before = change.path === 'mode' ? decision.requested.mode : decision.requested.parameters[change.path];
        const after = change.path === 'mode' ? decision.effective.mode : decision.effective.parameters[change.path];
        return `${fields[change.path] ? canvasText(locale, fields[change.path]) : canvasOptionsText(locale, 'other')}: ${value(change.path, before)} → ${value(change.path, after)}`;
    });
}
