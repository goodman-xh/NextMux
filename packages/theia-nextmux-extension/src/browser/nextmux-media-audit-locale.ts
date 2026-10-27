import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'] as const;
const rows = {
    regenerate: ['Regenerate (new task)', '重新生成（新任务）', '重新生成（新任務）', '再生成（新しいタスク）', '다시 생성 (새 작업)', 'Regenerar (nueva tarea)', 'Régénérer (nouvelle tâche)', 'Neu generieren (neue Aufgabe)', 'Gerar novamente (nova tarefa)', 'Создать заново (новая задача)', 'إعادة الإنشاء (مهمة جديدة)', 'फिर से बनाएँ (नया कार्य)'],
    voiceId: ['Voice ID', '声音 ID', '聲音 ID', '音声 ID', '음성 ID', 'ID de voz', 'ID de voix', 'Stimmen-ID', 'ID da voz', 'ID голоса', 'معرّف الصوت', 'आवाज़ ID'],
    previousImage: ['Previous image version', '上一版本画面', '上一版本畫面', '前のバージョンの画像', '이전 버전 이미지', 'Versión anterior de la imagen', 'Version précédente de l’image', 'Vorherige Bildversion', 'Versão anterior da imagem', 'Предыдущая версия изображения', 'الإصدار السابق من الصورة', 'छवि का पिछला संस्करण'],
    currentImage: ['Current image version', '当前版本画面', '目前版本畫面', '現在のバージョンの画像', '현재 버전 이미지', 'Versión actual de la imagen', 'Version actuelle de l’image', 'Aktuelle Bildversion', 'Versão atual da imagem', 'Текущая версия изображения', 'الإصدار الحالي من الصورة', 'छवि का वर्तमान संस्करण'],
    generatedImage: ['Generated image', '已生成画面', '已生成畫面', '生成された画像', '생성된 이미지', 'Imagen generada', 'Image générée', 'Generiertes Bild', 'Imagem gerada', 'Созданное изображение', 'الصورة المُنشأة', 'बनाई गई छवि'],
    shotImage: ['{title}: generated image', '{title}：已生成画面', '{title}：已生成畫面', '{title}：生成された画像', '{title}: 생성된 이미지', '{title}: imagen generada', '{title} : image générée', '{title}: generiertes Bild', '{title}: imagem gerada', '{title}: созданное изображение', '{title}: الصورة المُنشأة', '{title}: बनाई गई छवि'],
    videoPreview: ['Video preview', '视频预览', '影片預覽', '動画プレビュー', '동영상 미리보기', 'Vista previa del vídeo', 'Aperçu vidéo', 'Videovorschau', 'Prévia do vídeo', 'Предпросмотр видео', 'معاينة الفيديو', 'वीडियो पूर्वावलोकन'],
    shotVideoPreview: ['{title}: video preview', '{title}：视频预览', '{title}：影片預覽', '{title}：動画プレビュー', '{title}: 동영상 미리보기', '{title}: vista previa del vídeo', '{title} : aperçu vidéo', '{title}: Videovorschau', '{title}: prévia do vídeo', '{title}: предпросмотр видео', '{title}: معاينة الفيديو', '{title}: वीडियो पूर्वावलोकन'],
    unsaved: ['Unsaved changes', '有未保存修改', '有未儲存的變更', '未保存の変更があります', '저장하지 않은 변경 사항', 'Cambios sin guardar', 'Modifications non enregistrées', 'Ungespeicherte Änderungen', 'Alterações não salvas', 'Несохранённые изменения', 'تغييرات غير محفوظة', 'बदलाव सहेजे नहीं गए हैं'],
    details: ['Original diagnostic details', '原始诊断详情', '原始診斷詳情', '元の診断情報', '원본 진단 정보', 'Detalles de diagnóstico originales', 'Détails du diagnostic d’origine', 'Ursprüngliche Diagnosedetails', 'Detalhes originais do diagnóstico', 'Исходные сведения диагностики', 'تفاصيل التشخيص الأصلية', 'मूल निदान विवरण'],
    warnings: ['Export notices: {count}', '导出提示：{count} 条', '匯出提示：{count} 則', '書き出しの通知：{count} 件', '내보내기 알림: {count}개', 'Avisos de exportación: {count}', 'Avis d’exportation : {count}', 'Exporthinweise: {count}', 'Avisos de exportação: {count}', 'Уведомления об экспорте: {count}', 'تنبيهات التصدير: {count}', 'निर्यात सूचनाएँ: {count}'],
    shotCount: ['{done} / {total} shots', '{done} / {total} 个镜头', '{done} / {total} 個鏡頭', '{done} / {total} ショット', '{done} / {total}개 숏', '{done} / {total} planos', '{done} / {total} plans', '{done} / {total} Einstellungen', '{done} / {total} tomadas', '{done} / {total} кадров', '{done} / {total} لقطات', '{done} / {total} शॉट'],
    elevenLabsAudio: ['ElevenLabs Audio', 'ElevenLabs 音频', 'ElevenLabs 音訊', 'ElevenLabs オーディオ', 'ElevenLabs 오디오', 'ElevenLabs Audio', 'ElevenLabs Audio', 'ElevenLabs Audio', 'ElevenLabs Áudio', 'ElevenLabs Аудио', 'ElevenLabs صوت', 'ElevenLabs ऑडियो'],
} as const;

/** Explicit copy for literal and accessibility surfaces. Parameters are user data. */
function uncheckedMediaAuditText(locale: NextMuxDesktopLocale, key: keyof typeof rows, params: Readonly<Record<string, string | number>> = {}): string {
    const index = locales.indexOf(locale);
    return rows[key][index < 0 ? 0 : index].replace(/\{(\w+)\}/g, (token, name: string) => String(params[name] ?? token));
}
export const MEDIA_AUDIT_TEXT_ROWS = rows;

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function mediaAuditText(locale: Parameters<typeof uncheckedMediaAuditText>[0], key: Parameters<typeof uncheckedMediaAuditText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedMediaAuditText>>): string {
    return totalCopy(locale, key, language => uncheckedMediaAuditText(language, key, ...rest));
}
