import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const keys = ['update', 'ready', 'availableHint', 'readyHint', 'preparing', 'downloadFailed', 'backgroundHint', 'download', 'checking', 'check', 'current', 'waiting', 'error', 'downloadPage', 'checkedAt', 'portableHint', 'developmentHint', 'verificationHint', 'retry'] as const;
type UpdateTextKey = typeof keys[number];
const copy: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['更新', '已准备', '点击下载更新；不会中断当前工作', '更新已准备。正常退出后安装，下次手动启动使用新版本。', '正在校验并准备更新', '下载未完成；点击重新下载，当前版本可继续使用。', '自动检查更新；由你点击下载，后台准备，正常退出后安装。', '下载更新', '正在检查', '检查更新', '当前是最新的版本', '等待检查', '检查未完成', '下载页面', '上次检查', '便携版不会替换自身，请从下载页获取新版。', '开发运行不连接正式更新通道。', '下载完成后会校验完整性。', '重试更新'],
    'zh-TW': ['更新', '已準備', '點擊下載更新；不會中斷目前工作', '更新已準備。正常結束後安裝，下次手動啟動使用新版本。', '正在驗證並準備更新', '下載未完成；點擊重新下載，目前版本可繼續使用。', '自動檢查更新；由你點擊下載，背景準備，正常結束後安裝。', '下載更新', '正在檢查', '檢查更新', '目前已是最新版本', '等待檢查', '檢查未完成', '下載頁面', '上次檢查', '可攜版不會替換自身，請從下載頁取得新版。', '開發執行不連線正式更新通道。', '下載完成後會驗證完整性。', '重試更新'],
    en: ['Update', 'Ready', 'Download the update without interrupting your work', 'Ready. Installs after a normal quit; your next manual launch uses the new version.', 'Verifying and preparing the update', 'Download incomplete. Click to retry; the current version remains usable.', 'Checks automatically. Click to download; preparation stays in the background and installation waits for a normal quit.', 'Download update', 'Checking', 'Check for updates', 'You are on the latest version', 'Waiting to check', 'Check incomplete', 'Download page', 'Last checked', 'Portable builds do not replace themselves. Get a new build from the download page.', 'Development runs do not use the production update feed.', 'Downloads are checked for integrity after completion.', 'Update Retry'],
    ja: ['更新', '準備済み', '作業を中断せず更新をダウンロード', '準備済み。通常終了後にインストールし、次の手動起動で新バージョンを使用します。', '更新を検証して準備中', '未完了です。クリックして再試行できます。現在のバージョンは利用可能です。', '自動で確認し、クリック後にダウンロード。準備はバックグラウンド、インストールは通常終了後です。', '更新をダウンロード', '確認中', '更新を確認', '現在のバージョンを利用可能', '確認待ち', '確認未完了', 'ダウンロードページ', '最終確認', 'ポータブル版は自動置換しません。ダウンロードページで取得してください。', '開発実行では正式な更新配信を使用しません。', 'ダウンロード完了後に整合性を確認します。', '更新を再試行'],
    ko: ['업데이트', '준비됨', '작업을 중단하지 않고 업데이트 다운로드', '준비됐습니다. 정상 종료 후 설치하며 다음에 직접 실행하면 새 버전을 사용합니다.', '업데이트 확인 및 준비 중', '다운로드 미완료. 클릭하여 재시도하세요. 현재 버전은 계속 사용할 수 있습니다.', '자동 확인 후 클릭하면 다운로드합니다. 백그라운드에서 준비하고 정상 종료 후 설치합니다.', '업데이트 다운로드', '확인 중', '업데이트 확인', '현재 버전 사용 가능', '확인 대기', '확인 미완료', '다운로드 페이지', '마지막 확인', '포터블 버전은 자동 교체하지 않습니다. 다운로드 페이지를 이용하세요.', '개발 실행에서는 정식 업데이트 피드를 사용하지 않습니다.', '다운로드가 완료되면 무결성을 확인합니다.', '업데이트 재시도'],
    es: ['Actualizar', 'Lista', 'Descargar sin interrumpir el trabajo', 'Lista. Se instala tras cerrar normalmente; el próximo inicio manual usa la nueva versión.', 'Verificando y preparando', 'Descarga incompleta. Haz clic para reintentar; la versión actual sigue disponible.', 'Busca automáticamente. Haz clic para descargar; prepara en segundo plano e instala tras cerrar normalmente.', 'Descargar actualización', 'Buscando', 'Buscar actualizaciones', 'Versión actual disponible', 'Esperando comprobación', 'Comprobación incompleta', 'Página de descarga', 'Última comprobación', 'La versión portátil no se reemplaza sola. Usa la página de descarga.', 'El modo de desarrollo no usa el canal de producción.', 'Las descargas comprueban la integridad al finalizar.', 'Reintentar actualización'],
    fr: ['Mettre à jour', 'Prête', 'Télécharger sans interrompre votre travail', 'Prête. Installation après une fermeture normale ; votre prochain démarrage manuel utilise la nouvelle version.', 'Vérification et préparation', 'Téléchargement incomplet. Cliquez pour réessayer ; la version actuelle reste utilisable.', 'Recherche automatique. Cliquez pour télécharger ; préparation en arrière-plan et installation après fermeture normale.', 'Télécharger la mise à jour', 'Recherche', 'Rechercher une mise à jour', 'Version actuelle disponible', 'En attente de vérification', 'Vérification incomplète', 'Page de téléchargement', 'Dernière vérification', 'La version portable ne se remplace pas. Utilisez la page de téléchargement.', 'Le mode développement ne consulte pas le canal de production.', 'Les téléchargements vérifient leur intégrité à la fin.', 'Réessayer la mise à jour'],
    de: ['Aktualisieren', 'Bereit', 'Update laden, ohne die Arbeit zu unterbrechen', 'Bereit. Installation nach normalem Beenden; der nächste manuelle Start verwendet die neue Version.', 'Update wird geprüft und vorbereitet', 'Download unvollständig. Zum Wiederholen klicken; die aktuelle Version bleibt nutzbar.', 'Automatische Prüfung. Download per Klick, Vorbereitung im Hintergrund, Installation nach normalem Beenden.', 'Update herunterladen', 'Wird geprüft', 'Nach Updates suchen', 'Aktuelle Version verfügbar', 'Wartet auf Prüfung', 'Prüfung unvollständig', 'Downloadseite', 'Zuletzt geprüft', 'Portable Versionen ersetzen sich nicht selbst. Bitte die Downloadseite verwenden.', 'Entwicklungsstarts verwenden nicht den Produktionskanal.', 'Downloads werden nach Abschluss auf Integrität geprüft.', 'Update wiederholen'],
    'pt-BR': ['Atualizar', 'Pronta', 'Baixar sem interromper seu trabalho', 'Pronta. Instala após sair normalmente; a próxima abertura manual usa a nova versão.', 'Verificando e preparando', 'Download incompleto. Clique para tentar de novo; a versão atual continua disponível.', 'Verifica automaticamente. Clique para baixar; prepara em segundo plano e instala após sair normalmente.', 'Baixar atualização', 'Verificando', 'Verificar atualizações', 'Versão atual disponível', 'Aguardando verificação', 'Verificação incompleta', 'Página de download', 'Última verificação', 'A versão portátil não se substitui. Use a página de download.', 'A execução de desenvolvimento não usa o canal de produção.', 'Os downloads verificam a integridade após a conclusão.', 'Tentar atualizar novamente'],
    ru: ['Обновить', 'Готово', 'Скачать обновление, не прерывая работу', 'Готово. Установка после обычного выхода; следующий ручной запуск использует новую версию.', 'Проверка и подготовка', 'Загрузка не завершена. Нажмите для повтора; текущая версия остаётся доступной.', 'Проверка автоматическая. Загрузка по нажатию, подготовка в фоне, установка после обычного выхода.', 'Скачать обновление', 'Проверка', 'Проверить обновления', 'Текущая версия доступна', 'Ожидание проверки', 'Проверка не завершена', 'Страница загрузки', 'Последняя проверка', 'Переносная версия не заменяет себя. Используйте страницу загрузки.', 'В режиме разработки рабочий канал обновлений не используется.', 'После загрузки проверяется целостность.', 'Повторить обновление'],
    ar: ['تحديث', 'جاهز', 'تنزيل التحديث دون مقاطعة عملك', 'جاهز. يُثبّت بعد الخروج العادي، ويستخدم التشغيل اليدوي التالي الإصدار الجديد.', 'التحقق من التحديث وتجهيزه', 'التنزيل غير مكتمل. انقر للمحاولة مجدداً؛ يبقى الإصدار الحالي قابلاً للاستخدام.', 'فحص تلقائي. انقر للتنزيل؛ التجهيز في الخلفية والتثبيت بعد الخروج العادي.', 'تنزيل التحديث', 'جارٍ الفحص', 'البحث عن تحديثات', 'الإصدار الحالي متاح', 'بانتظار الفحص', 'الفحص غير مكتمل', 'صفحة التنزيل', 'آخر فحص', 'النسخة المحمولة لا تستبدل نفسها. استخدم صفحة التنزيل.', 'التشغيل التطويري لا يستخدم قناة التحديث الرسمية.', 'يتم التحقق من سلامة التنزيل بعد اكتماله.', 'إعادة محاولة التحديث'],
    hi: ['अपडेट', 'तैयार', 'काम रोके बिना अपडेट डाउनलोड करें', 'तैयार है। सामान्य निकास के बाद इंस्टॉल होगा; अगले मैनुअल लॉन्च में नया संस्करण खुलेगा।', 'अपडेट की जाँच और तैयारी', 'डाउनलोड अधूरा है। फिर प्रयास करने के लिए क्लिक करें; वर्तमान संस्करण चलता रहेगा।', 'स्वचालित जाँच। डाउनलोड के लिए क्लिक करें; तैयारी पृष्ठभूमि में और इंस्टॉल सामान्य निकास के बाद होगा।', 'अपडेट डाउनलोड करें', 'जाँच जारी', 'अपडेट जाँचें', 'वर्तमान संस्करण उपलब्ध', 'जाँच की प्रतीक्षा', 'जाँच अधूरी', 'डाउनलोड पृष्ठ', 'पिछली जाँच', 'पोर्टेबल संस्करण खुद को नहीं बदलता। डाउनलोड पृष्ठ से नया संस्करण लें।', 'डेवलपमेंट रन प्रोडक्शन अपडेट फ़ीड नहीं उपयोग करता।', 'डाउनलोड पूरा होने पर उसकी अखंडता जाँची जाती है।', 'अपडेट फिर आज़माएँ'],
};

const restartCopy: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '更新准备未完成。当前工作不受影响；下次正常启动后可重新检查。',
    'zh-TW': '更新準備未完成。目前工作不受影響；下次正常啟動後可重新檢查。',
    en: 'Update preparation did not finish. Keep working; check again after your next normal launch.',
    ja: '更新の準備が完了しませんでした。作業は続けられます。次の通常起動後に再確認できます。',
    ko: '업데이트 준비가 완료되지 않았습니다. 작업은 계속하고 다음 정상 실행 후 다시 확인하세요.',
    es: 'La preparación no terminó. Puedes seguir trabajando y comprobar tras el próximo inicio normal.',
    fr: 'La préparation est incomplète. Continuez à travailler et vérifiez au prochain démarrage normal.',
    de: 'Die Vorbereitung wurde nicht abgeschlossen. Weiterarbeiten und nach dem nächsten normalen Start erneut prüfen.',
    'pt-BR': 'A preparação não terminou. Continue trabalhando e verifique após a próxima abertura normal.',
    ru: 'Подготовка не завершена. Продолжайте работу и проверьте после следующего обычного запуска.',
    ar: 'لم يكتمل تجهيز التحديث. واصل عملك وتحقق بعد التشغيل العادي التالي.',
    hi: 'अपडेट की तैयारी अधूरी है। काम जारी रखें; अगले सामान्य लॉन्च के बाद फिर जाँचें।',
};

function uncheckedDesktopUpdateText(locale: NextMuxDesktopLocale, key: UpdateTextKey | 'restartHint'): string {
    if (key === 'restartHint') return restartCopy[locale];
    return copy[locale][keys.indexOf(key)];
}

export function updateAppearsInDock(state: Pick<NextMuxDesktopUpdateState, 'phase'>): boolean {
    return state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready';
}

export interface DesktopUpdateActionModel {
    readonly label: string;
    readonly hint: string;
    readonly tone: 'default' | 'warning';
    readonly action: 'download' | 'details';
    readonly disabled: boolean;
}

/**
 * What the dock's update button says and does. A failed download keeps phase
 * 'available' (the update is still known), so the failure — not the phase — decides
 * the warning tone, the retry label and the error detail in the tooltip.
 */
export function resolveDesktopUpdateActionModel(state: NextMuxDesktopUpdateState, locale: NextMuxDesktopLocale, busy: boolean): DesktopUpdateActionModel {
    const downloading = state.phase === 'downloading';
    const percent = Math.max(0, Math.min(100, Math.floor(Number.isFinite(state.progress) ? state.progress : 0)));
    const failed = state.phase === 'available' && Boolean(state.errorCode || state.error);
    const label = downloading ? `${percent}%`
        : desktopUpdateText(locale, state.phase === 'ready' ? 'ready' : failed ? 'retry' : 'update');
    const baseHint = desktopUpdateText(locale, state.phase === 'ready' ? 'readyHint' : state.preparing ? 'preparing'
        : state.errorCode || state.error ? 'downloadFailed' : downloading ? 'backgroundHint' : 'availableHint');
    const detail = failed ? String(state.error || state.message || state.errorCode || '').trim() : '';
    return {
        label,
        hint: detail ? `${baseHint} · ${detail}` : baseHint,
        tone: failed ? 'warning' : 'default',
        action: state.phase === 'available' ? 'download' : 'details',
        disabled: Boolean(busy) || downloading,
    };
}

export function DesktopUpdateAction({ state, locale, busy, onDownload, onDetails }: {
    readonly state: NextMuxDesktopUpdateState; readonly locale: NextMuxDesktopLocale; readonly busy: boolean;
    readonly onDownload: () => void; readonly onDetails: () => void;
}): React.ReactElement | null {
    if (!updateAppearsInDock(state)) return null;
    const model = resolveDesktopUpdateActionModel(state, locale, busy);
    return <button type='button' className={`nmx-account-update is-${state.phase}${model.tone === 'warning' ? ' is-warning' : ''}`} data-nmx-literal
        disabled={model.disabled} title={model.hint} aria-label={`${model.label} · ${model.hint}`} aria-busy={state.phase === 'downloading'}
        onClick={() => { if (model.disabled) return; if (model.action === 'download') onDownload(); else onDetails(); }}>
        <span>{model.label}</span>
    </button>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function desktopUpdateText(locale: Parameters<typeof uncheckedDesktopUpdateText>[0], key: Parameters<typeof uncheckedDesktopUpdateText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedDesktopUpdateText>>): string {
    return totalCopy(locale, key, language => uncheckedDesktopUpdateText(language, key, ...rest));
}
