import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import '../../src/browser/style/nextmux-durable-retry-dialog.css';

const labels: Record<NextMuxDesktopLocale, readonly [string, string, string, string, string]> = {
    'zh-CN': ['上次操作结果未确认', '重新执行可能重复修改文件、调用服务或产生费用。请先核对原结果，再决定是否重试。', '取消', '确认重试', '暂时无法安全恢复这项操作。请先核对原结果。'],
    'zh-TW': ['上次操作結果尚未確認', '重新執行可能重複修改檔案、呼叫服務或產生費用。請先核對原結果，再決定是否重試。', '取消', '確認重試', '暫時無法安全恢復這項操作。請先核對原結果。'],
    en: ['The previous result is unconfirmed', 'Running it again may repeat file changes, service calls, or charges. Check the original result before deciding to retry.', 'Cancel', 'Confirm retry', 'This operation cannot be resumed safely yet. Check the original result first.'],
    ja: ['前回の結果を確認できません', '再実行すると、ファイルの変更、サービスの呼び出し、課金が重複する可能性があります。元の結果を確認してから再試行してください。', 'キャンセル', '再試行を確認', 'この操作はまだ安全に再開できません。先に元の結果を確認してください。'],
    ko: ['이전 결과가 확인되지 않았습니다', '다시 실행하면 파일 변경, 서비스 호출 또는 요금이 중복될 수 있습니다. 재시도하기 전에 원래 결과를 확인하세요.', '취소', '재시도 확인', '아직 이 작업을 안전하게 재개할 수 없습니다. 먼저 원래 결과를 확인하세요.'],
    es: ['El resultado anterior no está confirmado', 'Ejecutarlo de nuevo puede repetir cambios en archivos, llamadas a servicios o cargos. Comprueba el resultado original antes de reintentar.', 'Cancelar', 'Confirmar reintento', 'Esta operación aún no se puede reanudar de forma segura. Comprueba primero el resultado original.'],
    fr: ['Le résultat précédent est incertain', 'Une nouvelle exécution peut répéter des modifications de fichiers, des appels de services ou des frais. Vérifiez le résultat initial avant de réessayer.', 'Annuler', 'Confirmer la nouvelle tentative', 'Cette opération ne peut pas encore reprendre en toute sécurité. Vérifiez d’abord le résultat initial.'],
    de: ['Das vorherige Ergebnis ist unbestätigt', 'Eine erneute Ausführung kann Dateiänderungen, Dienstaufrufe oder Kosten wiederholen. Prüfen Sie das ursprüngliche Ergebnis, bevor Sie es erneut versuchen.', 'Abbrechen', 'Erneuten Versuch bestätigen', 'Dieser Vorgang kann noch nicht sicher fortgesetzt werden. Prüfen Sie zuerst das ursprüngliche Ergebnis.'],
    'pt-BR': ['O resultado anterior não foi confirmado', 'Executar novamente pode repetir alterações em arquivos, chamadas a serviços ou cobranças. Verifique o resultado original antes de tentar de novo.', 'Cancelar', 'Confirmar nova tentativa', 'Ainda não é possível retomar esta operação com segurança. Verifique primeiro o resultado original.'],
    ru: ['Предыдущий результат не подтверждён', 'Повторный запуск может повторить изменения файлов, обращения к сервисам или списания. Проверьте исходный результат перед повтором.', 'Отмена', 'Подтвердить повтор', 'Безопасно возобновить эту операцию пока нельзя. Сначала проверьте исходный результат.'],
    ar: ['لم تتأكد نتيجة العملية السابقة', 'قد يؤدي التشغيل مجددًا إلى تكرار تعديلات الملفات أو استدعاءات الخدمات أو الرسوم. تحقّق من النتيجة الأصلية قبل إعادة المحاولة.', 'إلغاء', 'تأكيد إعادة المحاولة', 'لا يمكن استئناف هذه العملية بأمان بعد. تحقّق من النتيجة الأصلية أولًا.'],
    hi: ['पिछले परिणाम की पुष्टि नहीं हुई है', 'दोबारा चलाने पर फ़ाइल बदलाव, सेवा कॉल या शुल्क दोहराए जा सकते हैं। फिर से प्रयास करने से पहले मूल परिणाम जाँचें।', 'रद्द करें', 'दोबारा प्रयास की पुष्टि करें', 'इस कार्रवाई को अभी सुरक्षित रूप से फिर शुरू नहीं किया जा सकता। पहले मूल परिणाम जाँचें।']
};

export function durableRecoveryText(locale: NextMuxDesktopLocale) {
    const [title, description, cancel, confirm, unavailable] = labels[locale];
    return { title, description, cancel, confirm, unavailable };
}

export function NextMuxDurableRetryDialog(props: {
    locale: NextMuxDesktopLocale;
    onCancel(): void;
    onConfirm(): void;
    onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
}): React.ReactElement {
    const text = durableRecoveryText(props.locale);
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop nmx-durable-retry-backdrop' onMouseDown={props.onCancel}>
        <section className='nmx-durable-retry-dialog' role='alertdialog' aria-modal='true'
            aria-labelledby='nmx-durable-retry-title' aria-describedby='nmx-durable-retry-description'
            onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.onCancel(); }
                else props.onKeyDown(event);
            }}>
            <h2 id='nmx-durable-retry-title'>{text.title}</h2>
            <p id='nmx-durable-retry-description'>{text.description}</p>
            <footer>
                <button type='button' autoFocus onClick={props.onCancel}>{text.cancel}</button>
                <button type='button' className='is-primary' onClick={props.onConfirm}>{text.confirm}</button>
            </footer>
        </section>
    </div>;
}
