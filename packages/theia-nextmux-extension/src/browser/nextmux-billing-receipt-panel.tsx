import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { NextMuxPlatformService, PlatformUsageRecord } from '../common/nextmux-platform-protocol';
import type { BillingReceiptRecovery } from '../common/nextmux-billing-receipts';
import { CitationList } from './nextmux-citations';

const labels: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['原请求恢复', '只核对原账务或读取已保存结果；不会重新调用模型或执行工具。', '原请求 ID', '核对 / 找回', '等待结算', '需要人工核对，请保留请求 ID；冻结金额不代表已收费或免费。', '原结果已过期；不会重新生成。', '暂不可用，请检查账户与网络后重试。', '已找回', '工具调用（仅展示，不执行）', '请稍后再检查', '近期可恢复请求'],
    'zh-TW': ['原請求復原', '僅核對原帳務或讀取已儲存結果；不重新呼叫模型或執行工具。', '原請求 ID', '核對 / 找回', '等待結算', '需要人工核對，請保留請求 ID；凍結金額不代表已收費或免費。', '原結果已過期；不重新生成。', '暫時無法使用，請檢查帳戶與網路後重試。', '已找回', '工具呼叫（僅顯示，不執行）', '請稍後再檢查', '近期可復原請求'],
    en: ['Original request recovery', 'Check original billing or read a saved result. Never call the model again or execute tools.', 'Original request ID', 'Check / recover', 'Awaiting settlement', 'Manual review required. Keep the request ID; reserved funds mean neither a confirmed charge nor free usage.', 'The original result expired. It will not be regenerated.', 'Unavailable. Check the account and network, then retry.', 'Recovered', 'Tool calls (display only; not executed)', 'Check again later', 'Recent recoverable requests'],
    ja: ['元のリクエストを復元', '元の請求を確認し保存済み結果を読みます。モデルやツールを再実行しません。', '元のリクエスト ID', '確認 / 復元', '精算待ち', '手動確認が必要です。ID を保管してください。保留額は課金確定や無料を意味しません。', '元の結果は期限切れです。再生成しません。', '利用できません。アカウントと接続を確認してください。', '復元済み', 'ツール呼び出し（表示のみ）', '後ほど確認', '最近の復元可能なリクエスト'],
    ko: ['원래 요청 복구', '기존 청구를 확인하거나 저장된 결과를 읽습니다. 모델이나 도구를 다시 실행하지 않습니다.', '원래 요청 ID', '확인 / 복구', '정산 대기', '수동 확인이 필요합니다. 요청 ID를 보관하세요. 보류 금액은 청구 확정 또는 무료를 뜻하지 않습니다.', '원래 결과가 만료되었습니다. 다시 생성하지 않습니다.', '사용할 수 없습니다. 계정과 네트워크를 확인하세요.', '복구됨', '도구 호출 (표시만, 실행하지 않음)', '나중에 다시 확인', '최근 복구 가능한 요청'],
    fr: ['Récupérer la requête initiale', 'Vérifier la facturation initiale ou lire un résultat enregistré, sans relancer le modèle ni les outils.', 'ID de la requête initiale', 'Vérifier / récupérer', 'En attente de règlement', 'Vérification manuelle nécessaire. Conservez l’ID ; une réserve ne prouve ni un débit ni la gratuité.', 'Le résultat initial a expiré. Il ne sera pas régénéré.', 'Indisponible. Vérifiez le compte et la connexion.', 'Récupéré', 'Appels d’outils (affichage uniquement)', 'Réessayer plus tard', 'Requêtes récentes récupérables'],
    de: ['Ursprüngliche Anfrage wiederherstellen', 'Originalabrechnung prüfen oder gespeichertes Ergebnis lesen. Modell und Werkzeuge werden nicht erneut ausgeführt.', 'Ursprüngliche Anfrage-ID', 'Prüfen / abrufen', 'Abrechnung ausstehend', 'Manuelle Prüfung nötig. Anfrage-ID aufbewahren; reservierte Beträge sind weder bestätigte Kosten noch kostenlose Nutzung.', 'Das Originalergebnis ist abgelaufen. Keine Neugenerierung.', 'Nicht verfügbar. Konto und Verbindung prüfen.', 'Wiederhergestellt', 'Werkzeugaufrufe (nur Anzeige)', 'Später erneut prüfen', 'Aktuelle wiederherstellbare Anfragen'],
    es: ['Recuperar solicitud original', 'Comprueba la facturación original o lee un resultado guardado, sin ejecutar de nuevo el modelo ni las herramientas.', 'ID de solicitud original', 'Comprobar / recuperar', 'Pendiente de liquidación', 'Requiere revisión manual. Conserva el ID; los fondos reservados no confirman un cargo ni uso gratuito.', 'El resultado original caducó. No se volverá a generar.', 'No disponible. Comprueba la cuenta y la conexión.', 'Recuperado', 'Llamadas a herramientas (solo lectura)', 'Comprueba más tarde', 'Solicitudes recientes recuperables'],
    'pt-BR': ['Recuperar solicitação original', 'Verifique a cobrança original ou leia um resultado salvo, sem executar novamente o modelo ou as ferramentas.', 'ID da solicitação original', 'Verificar / recuperar', 'Aguardando liquidação', 'Revisão manual necessária. Guarde o ID; valores reservados não confirmam cobrança nem gratuidade.', 'O resultado original expirou. Não será gerado novamente.', 'Indisponível. Verifique a conta e a conexão.', 'Recuperado', 'Chamadas de ferramentas (somente exibição)', 'Verifique mais tarde', 'Solicitações recentes recuperáveis'],
    ru: ['Восстановить исходный запрос', 'Проверить исходный расчёт или прочитать сохранённый результат, не запуская модель и инструменты повторно.', 'ID исходного запроса', 'Проверить / получить', 'Ожидает расчёта', 'Нужна ручная проверка. Сохраните ID: резерв не означает ни подтверждённое списание, ни бесплатное использование.', 'Срок хранения результата истёк. Повторной генерации не будет.', 'Недоступно. Проверьте аккаунт и соединение.', 'Восстановлено', 'Вызовы инструментов (только просмотр)', 'Проверьте позже', 'Недавние запросы для восстановления'],
    ar: ['استعادة الطلب الأصلي', 'تحقق من الفاتورة الأصلية أو اقرأ نتيجة محفوظة دون إعادة تشغيل النموذج أو الأدوات.', 'معرّف الطلب الأصلي', 'تحقق / استعادة', 'بانتظار التسوية', 'تلزم مراجعة يدوية. احتفظ بالمعرّف؛ الأموال المحجوزة لا تعني تأكيد الرسوم ولا الاستخدام المجاني.', 'انتهت صلاحية النتيجة الأصلية ولن تُنشأ مجدداً.', 'غير متاح. تحقق من الحساب والاتصال.', 'تمت الاستعادة', 'استدعاءات الأدوات (عرض فقط)', 'تحقق لاحقاً', 'طلبات حديثة قابلة للاستعادة'],
    hi: ['मूल अनुरोध की पुनर्प्राप्ति', 'मूल बिल जाँचें या सहेजा परिणाम पढ़ें। मॉडल या टूल दोबारा नहीं चलेंगे।', 'मूल अनुरोध ID', 'जाँचें / प्राप्त करें', 'निपटान की प्रतीक्षा', 'मैन्युअल जाँच ज़रूरी है। अनुरोध ID रखें; आरक्षित राशि न पक्की कटौती है, न मुफ्त उपयोग।', 'मूल परिणाम की अवधि समाप्त है। इसे दोबारा नहीं बनाया जाएगा।', 'उपलब्ध नहीं। खाता और नेटवर्क जाँचें।', 'प्राप्त हुआ', 'टूल कॉल (केवल दिखाए गए)', 'बाद में फिर जाँचें', 'हाल के पुनर्प्राप्ति योग्य अनुरोध']
};

const mediaLabels: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['保存到本机', '打开文件', '已保存'], 'zh-TW': ['儲存至本機', '開啟檔案', '已儲存'],
    en: ['Save on this device', 'Open file', 'Saved'], ja: ['この端末に保存', 'ファイルを開く', '保存済み'],
    ko: ['이 기기에 저장', '파일 열기', '저장됨'], fr: ['Enregistrer sur cet appareil', 'Ouvrir le fichier', 'Enregistré'],
    de: ['Auf diesem Gerät speichern', 'Datei öffnen', 'Gespeichert'], es: ['Guardar en este dispositivo', 'Abrir archivo', 'Guardado'],
    'pt-BR': ['Salvar neste dispositivo', 'Abrir arquivo', 'Salvo'], ru: ['Сохранить на устройстве', 'Открыть файл', 'Сохранено'],
    ar: ['حفظ على هذا الجهاز', 'فتح الملف', 'تم الحفظ'], hi: ['इस डिवाइस पर सहेजें', 'फ़ाइल खोलें', 'सहेजा गया']
};

export function BillingReceiptPanel(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly service: Pick<NextMuxPlatformService, 'recoverManagedReceipt' | 'saveManagedReceiptMedia'>;
    readonly ownerId?: string;
    readonly openSavedFile?: (uri: string) => void;
    readonly openSource?: (url: string) => void;
    readonly usage: readonly PlatformUsageRecord[];
    readonly afterRecovery: () => Promise<void>;
}): React.ReactElement {
    const t = labels[props.locale];
    const [requestId, setRequestId] = React.useState('');
    const [receipt, setReceipt] = React.useState<BillingReceiptRecovery>();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(false);
    const [cooldown, setCooldown] = React.useState(0);
    const [savedUri, setSavedUri] = React.useState<string>();
    const active = React.useRef(true);
    const operation = React.useRef(false);
    React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    React.useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(0), cooldown); return () => clearTimeout(timer); }, [cooldown]);
    const recover = async (id: string): Promise<void> => {
        if (operation.current || cooldown) return;
        operation.current = true; setBusy(true); setError(false); setReceipt(undefined); setSavedUri(undefined); setRequestId(id);
        try {
            const result = await props.service.recoverManagedReceipt(id);
            if (!active.current) return;
            setReceipt(result);
            if (result.retryAfterMs || result.status === 'pending') setCooldown(result.retryAfterMs || 15_000);
            await props.afterRecovery();
        } catch { if (active.current) setError(true); }
        finally { operation.current = false; if (active.current) setBusy(false); }
    };
    const saveMedia = async (): Promise<void> => {
        if (operation.current || !props.ownerId || !receipt?.result?.media) return;
        operation.current = true; setBusy(true); setError(false);
        try {
            const uri = new URL(await props.service.saveManagedReceiptMedia(receipt.requestId, props.ownerId));
            if (uri.protocol !== 'file:' || uri.hostname || uri.search || uri.hash) throw new Error('INVALID_LOCAL_MEDIA_URI');
            if (active.current) setSavedUri(uri.toString());
        }
        catch { if (active.current) setError(true); }
        finally { operation.current = false; if (active.current) setBusy(false); }
    };
    const recent = [...props.usage.filter(item => item.recoveryState === 'pending' || item.recoveryState === 'review'),
        ...props.usage.filter(item => item.recoveryState === 'available').slice(0, 5)].slice(0, 20);
    return <details className='nmx-billing-receipts'>
        <summary>{t[0]}{recent.length ? ` · ${recent.length}` : ''}</summary>
        <p>{t[1]}</p>
        <form noValidate onSubmit={event => { event.preventDefault(); void recover(requestId.trim()); }}>
            <input required aria-label={t[2]} placeholder={t[2]} value={requestId} maxLength={36} spellCheck={false} autoComplete='off'
                pattern='[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}' onChange={event => setRequestId(event.currentTarget.value)} />
            <button disabled={busy || Boolean(cooldown)} type='submit'>{cooldown ? t[10] : t[3]}</button>
        </form>
        {!!recent.length && <ul aria-label={t[11]}>{recent.map(item => <li key={item.id}><span><strong>{item.modelName || item.canonicalModel}</strong><code>{item.id}</code></span><button disabled={busy || Boolean(cooldown)} onClick={() => void recover(item.id)}>{t[3]}</button></li>)}</ul>}
        {error && <p role='alert'>{t[7]}</p>}
        {receipt && <section aria-live='polite'><code>{receipt.requestId}</code><p>{t[receipt.status === 'pending' ? 4 : receipt.status === 'review' ? 5 : receipt.status === 'expired' ? 6 : 8]}</p>
            {receipt.result && <><strong>{receipt.result.model} · {new Intl.NumberFormat(props.locale, { style: 'currency', currency: receipt.result.currency, maximumFractionDigits: 6 }).format(receipt.result.chargedMicros / 1_000_000)}</strong>
                {receipt.result.content && <pre>{receipt.result.content}</pre>}{receipt.result.toolCallCount > 0 && <p>{t[9]} · {receipt.result.toolCallCount}</p>}
                <CitationList locale={props.locale} citations={receipt.result.citations} onOpen={props.openSource} />
                {receipt.result.media && <div><p>{receipt.result.media.mimeType} · {(receipt.result.media.sizeBytes / 1024 / 1024).toFixed(1)} MB</p>
                    {!savedUri && <button disabled={busy || !props.ownerId} onClick={() => void saveMedia()}>{mediaLabels[props.locale][0]}</button>}
                    {savedUri && <><p>{mediaLabels[props.locale][2]}</p><code>{decodeURIComponent(new URL(savedUri).pathname)}</code>
                        {props.openSavedFile && <button onClick={() => props.openSavedFile!(savedUri)}>{mediaLabels[props.locale][1]}</button>}</>}
                </div>}</>}
        </section>}
    </details>;
}
