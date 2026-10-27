import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { PlatformWalletTopupOptions, PlatformWalletTopupOrder } from '../common/nextmux-platform-protocol';
import '../../src/browser/style/nextmux-wallet-topup.css';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

// USD balance top-up through Whop hosted checkout. The desktop opens the
// checkout in the system browser and polls the order until it is credited.

const en = {
    eyebrow: 'Balance', title: 'Add balance', checkoutTitle: 'Finish payment', close: 'Close', amount: 'Amount (USD)',
    limits: 'Between {min} and {max}', credit: 'Balance added', fee: 'Processing fee', feeFree: 'None', total: 'Total due',
    note: 'Pay securely with Whop: cards, Apple Pay, Google Pay, WeChat Pay, Alipay and more.',
    cancel: 'Cancel', submit: 'Top up', creating: 'Opening checkout…',
    checkoutBody: 'Checkout is open in your browser. Your balance updates here as soon as the payment is confirmed.',
    waiting: 'Waiting for payment', credited: 'Balance added', creditedBody: 'Your balance is up to date.',
    reopen: 'Open checkout again', check: 'I’ve paid, check now', restart: 'Change amount', done: 'Done',
    unavailable: 'Top-up is unavailable right now. Please try again later.',
    invalid: 'Enter an amount between {min} and {max}.', daily: 'You’ve reached today’s top-up limit. Try a smaller amount or come back tomorrow.',
    createFailed: 'The checkout couldn’t be opened. Please try again.', checkFailed: 'Couldn’t confirm the payment yet. Still checking…',
    expired: 'This checkout has closed. If you already paid, your balance is added automatically.',
    closed: 'This top-up was closed. Start a new one.', review: 'Your payment is being reviewed. Your balance is added once it’s confirmed.',
    notifyTitle: 'Balance added', notifyBody: '{amount} was added to your balance.', timeLeft: 'Time left'
};

type TopupTextKey = keyof typeof en;

const translations: Record<NextMuxDesktopLocale, Partial<Record<TopupTextKey, string>>> = {
    en,
    'zh-CN': { eyebrow: '统一余额', title: '充值余额', checkoutTitle: '完成付款', close: '关闭', amount: '充值金额（美元）', limits: '金额范围 {min} – {max}', credit: '到账余额', fee: '手续费', feeFree: '无需手续费', total: '应付总额', note: '通过 Whop 安全支付，支持银行卡、微信支付、支付宝、Apple Pay、Google Pay 等方式。', cancel: '取消', submit: '残忍充值', creating: '正在打开支付页…', checkoutBody: '支付页已在浏览器中打开。付款确认后，这里的余额会立即更新。', waiting: '正在等待付款', credited: '充值已到账', creditedBody: '余额已自动更新。', reopen: '重新打开支付页', check: '我已支付，检查到账', restart: '修改金额', done: '完成', unavailable: '暂时无法充值，请稍后再试。', invalid: '请输入 {min} 至 {max} 之间的金额。', daily: '已达到今日充值上限，请减少金额或明天再试。', createFailed: '支付页暂时无法打开，请重试。', checkFailed: '暂时无法确认到账，正在继续检查…', expired: '该支付已关闭。如果你已付款，余额会自动到账。', closed: '该充值已关闭，请重新发起。', review: '付款正在审核，确认后余额会自动到账。', notifyTitle: '充值已到账', notifyBody: '{amount} 已加入余额。', timeLeft: '剩余时间' },
    'zh-TW': { eyebrow: '統一餘額', title: '儲值餘額', checkoutTitle: '完成付款', close: '關閉', amount: '儲值金額（美元）', limits: '金額範圍 {min} – {max}', credit: '入帳餘額', fee: '手續費', feeFree: '免手續費', total: '應付總額', note: '透過 Whop 安全付款，支援信用卡、微信支付、支付寶、Apple Pay、Google Pay 等方式。', cancel: '取消', submit: '儲值', creating: '正在開啟付款頁…', checkoutBody: '付款頁已在瀏覽器中開啟。付款確認後，這裡的餘額會立即更新。', waiting: '正在等待付款', credited: '儲值已入帳', creditedBody: '餘額已自動更新。', reopen: '重新開啟付款頁', check: '我已付款，檢查入帳', restart: '修改金額', done: '完成', unavailable: '暫時無法儲值，請稍後再試。', invalid: '請輸入 {min} 至 {max} 之間的金額。', daily: '已達到今日儲值上限，請減少金額或明天再試。', createFailed: '付款頁暫時無法開啟，請重試。', checkFailed: '暫時無法確認入帳，正在繼續檢查…', expired: '該付款已關閉。如果你已付款，餘額會自動入帳。', closed: '該儲值已關閉，請重新發起。', review: '付款正在審核，確認後餘額會自動入帳。', notifyTitle: '儲值已入帳', notifyBody: '{amount} 已加入餘額。', timeLeft: '剩餘時間' },
    ja: { eyebrow: '残高', title: '残高をチャージ', checkoutTitle: 'お支払いを完了', close: '閉じる', amount: '金額（USD）', limits: '{min}〜{max}', credit: '入金される残高', fee: '決済手数料', feeFree: '手数料なし', total: 'お支払い合計', note: 'Whop で安全にお支払いいただけます（カード、WeChat Pay、Alipay、Apple Pay、Google Pay など）。', cancel: 'キャンセル', submit: 'チャージ', creating: '決済ページを開いています…', checkoutBody: 'ブラウザーで決済ページを開きました。お支払いが確認され次第、ここの残高が更新されます。', waiting: 'お支払いを待っています', credited: 'チャージが完了しました', creditedBody: '残高は最新です。', reopen: '決済ページをもう一度開く', check: '支払い済み、今すぐ確認', restart: '金額を変更', done: '完了', unavailable: '現在チャージできません。しばらくしてからお試しください。', invalid: '{min}〜{max} の金額を入力してください。', daily: '本日のチャージ上限に達しました。金額を減らすか、明日お試しください。', createFailed: '決済ページを開けませんでした。もう一度お試しください。', checkFailed: 'まだ入金を確認できません。確認を続けています…', expired: 'この決済は終了しました。お支払い済みの場合は自動で残高に反映されます。', closed: 'このチャージは終了しました。新しく始めてください。', review: 'お支払いを確認中です。確認後に残高へ反映されます。', notifyTitle: 'チャージが完了しました', notifyBody: '{amount} が残高に追加されました。', timeLeft: '残り時間' },
    ko: { eyebrow: '잔액', title: '잔액 충전', checkoutTitle: '결제 완료하기', close: '닫기', amount: '금액(USD)', limits: '{min} ~ {max}', credit: '충전될 잔액', fee: '처리 수수료', feeFree: '수수료 없음', total: '총 결제 금액', note: 'Whop으로 안전하게 결제하세요. 카드, WeChat Pay, Alipay, Apple Pay, Google Pay 등을 지원합니다.', cancel: '취소', submit: '충전', creating: '결제 페이지 여는 중…', checkoutBody: '브라우저에서 결제 페이지가 열렸습니다. 결제가 확인되면 이곳의 잔액이 바로 업데이트됩니다.', waiting: '결제 대기 중', credited: '충전 완료', creditedBody: '잔액이 최신 상태입니다.', reopen: '결제 페이지 다시 열기', check: '결제했어요, 지금 확인', restart: '금액 변경', done: '완료', unavailable: '지금은 충전할 수 없습니다. 잠시 후 다시 시도하세요.', invalid: '{min}~{max} 사이의 금액을 입력하세요.', daily: '오늘의 충전 한도에 도달했습니다. 금액을 줄이거나 내일 다시 시도하세요.', createFailed: '결제 페이지를 열 수 없습니다. 다시 시도하세요.', checkFailed: '아직 결제를 확인하지 못했습니다. 계속 확인 중…', expired: '이 결제는 종료되었습니다. 이미 결제했다면 잔액에 자동으로 반영됩니다.', closed: '이 충전은 종료되었습니다. 새로 시작하세요.', review: '결제를 검토 중입니다. 확인되면 잔액에 반영됩니다.', notifyTitle: '충전 완료', notifyBody: '{amount}이(가) 잔액에 추가되었습니다.', timeLeft: '남은 시간' },
    es: { eyebrow: 'Saldo', title: 'Añadir saldo', checkoutTitle: 'Completa el pago', close: 'Cerrar', amount: 'Importe (USD)', limits: 'Entre {min} y {max}', credit: 'Saldo añadido', fee: 'Comisión de procesamiento', feeFree: 'Sin comisión', total: 'Total a pagar', note: 'Paga de forma segura con Whop: tarjetas, WeChat Pay, Alipay, Apple Pay, Google Pay y más.', cancel: 'Cancelar', submit: 'Recargar', creating: 'Abriendo el pago…', checkoutBody: 'El pago está abierto en tu navegador. Tu saldo se actualizará aquí en cuanto se confirme.', waiting: 'Esperando el pago', credited: 'Saldo añadido', creditedBody: 'Tu saldo está al día.', reopen: 'Abrir el pago de nuevo', check: 'Ya pagué, comprobar', restart: 'Cambiar importe', done: 'Listo', unavailable: 'La recarga no está disponible por ahora. Inténtalo más tarde.', invalid: 'Introduce un importe entre {min} y {max}.', daily: 'Has alcanzado el límite diario. Prueba un importe menor o vuelve mañana.', createFailed: 'No se pudo abrir el pago. Inténtalo de nuevo.', checkFailed: 'Aún no se confirma el pago. Seguimos comprobando…', expired: 'Este pago se cerró. Si ya pagaste, el saldo se añadirá automáticamente.', closed: 'Esta recarga se cerró. Empieza una nueva.', review: 'Estamos revisando tu pago. El saldo se añadirá al confirmarse.', notifyTitle: 'Saldo añadido', notifyBody: 'Se añadieron {amount} a tu saldo.', timeLeft: 'Tiempo restante' },
    fr: { eyebrow: 'Solde', title: 'Ajouter du solde', checkoutTitle: 'Finaliser le paiement', close: 'Fermer', amount: 'Montant (USD)', limits: 'Entre {min} et {max}', credit: 'Solde crédité', fee: 'Frais de traitement', feeFree: 'Aucuns frais', total: 'Total à payer', note: 'Payez en toute sécurité avec Whop : cartes, WeChat Pay, Alipay, Apple Pay, Google Pay et plus.', cancel: 'Annuler', submit: 'Recharger', creating: 'Ouverture du paiement…', checkoutBody: 'Le paiement est ouvert dans votre navigateur. Votre solde se met à jour ici dès la confirmation.', waiting: 'En attente du paiement', credited: 'Solde ajouté', creditedBody: 'Votre solde est à jour.', reopen: 'Rouvrir le paiement', check: 'J’ai payé, vérifier', restart: 'Modifier le montant', done: 'Terminé', unavailable: 'La recharge est momentanément indisponible. Réessayez plus tard.', invalid: 'Saisissez un montant entre {min} et {max}.', daily: 'Limite du jour atteinte. Essayez un montant plus petit ou revenez demain.', createFailed: 'Impossible d’ouvrir le paiement. Réessayez.', checkFailed: 'Paiement pas encore confirmé. Vérification en cours…', expired: 'Ce paiement est clôturé. Si vous avez déjà payé, le solde sera ajouté automatiquement.', closed: 'Cette recharge est clôturée. Recommencez.', review: 'Votre paiement est en cours de vérification. Le solde sera ajouté après confirmation.', notifyTitle: 'Solde ajouté', notifyBody: '{amount} ajouté à votre solde.', timeLeft: 'Temps restant' },
    de: { eyebrow: 'Guthaben', title: 'Guthaben aufladen', checkoutTitle: 'Zahlung abschließen', close: 'Schließen', amount: 'Betrag (USD)', limits: 'Zwischen {min} und {max}', credit: 'Gutgeschriebenes Guthaben', fee: 'Bearbeitungsgebühr', feeFree: 'Keine Gebühr', total: 'Gesamtbetrag', note: 'Sicher bezahlen mit Whop: Karten, WeChat Pay, Alipay, Apple Pay, Google Pay und mehr.', cancel: 'Abbrechen', submit: 'Aufladen', creating: 'Kasse wird geöffnet…', checkoutBody: 'Die Kasse ist in Ihrem Browser geöffnet. Ihr Guthaben aktualisiert sich hier, sobald die Zahlung bestätigt ist.', waiting: 'Warten auf Zahlung', credited: 'Guthaben aufgeladen', creditedBody: 'Ihr Guthaben ist aktuell.', reopen: 'Kasse erneut öffnen', check: 'Bezahlt – jetzt prüfen', restart: 'Betrag ändern', done: 'Fertig', unavailable: 'Aufladen ist gerade nicht verfügbar. Bitte später erneut versuchen.', invalid: 'Geben Sie einen Betrag zwischen {min} und {max} ein.', daily: 'Tageslimit erreicht. Wählen Sie einen kleineren Betrag oder versuchen Sie es morgen.', createFailed: 'Die Kasse konnte nicht geöffnet werden. Bitte erneut versuchen.', checkFailed: 'Zahlung noch nicht bestätigt. Wir prüfen weiter…', expired: 'Diese Kasse ist geschlossen. Falls Sie schon bezahlt haben, wird das Guthaben automatisch gutgeschrieben.', closed: 'Diese Aufladung wurde geschlossen. Starten Sie eine neue.', review: 'Ihre Zahlung wird geprüft. Das Guthaben wird nach der Bestätigung gutgeschrieben.', notifyTitle: 'Guthaben aufgeladen', notifyBody: '{amount} wurde Ihrem Guthaben hinzugefügt.', timeLeft: 'Verbleibende Zeit' },
    'pt-BR': { eyebrow: 'Saldo', title: 'Adicionar saldo', checkoutTitle: 'Concluir pagamento', close: 'Fechar', amount: 'Valor (USD)', limits: 'Entre {min} e {max}', credit: 'Saldo adicionado', fee: 'Taxa de processamento', feeFree: 'Sem taxa', total: 'Total a pagar', note: 'Pague com segurança pela Whop: cartões, WeChat Pay, Alipay, Apple Pay, Google Pay e mais.', cancel: 'Cancelar', submit: 'Recarregar', creating: 'Abrindo o pagamento…', checkoutBody: 'O pagamento está aberto no navegador. Seu saldo é atualizado aqui assim que for confirmado.', waiting: 'Aguardando pagamento', credited: 'Saldo adicionado', creditedBody: 'Seu saldo está atualizado.', reopen: 'Abrir pagamento de novo', check: 'Já paguei, verificar', restart: 'Alterar valor', done: 'Concluído', unavailable: 'A recarga está indisponível no momento. Tente mais tarde.', invalid: 'Informe um valor entre {min} e {max}.', daily: 'Você atingiu o limite de hoje. Tente um valor menor ou volte amanhã.', createFailed: 'Não foi possível abrir o pagamento. Tente novamente.', checkFailed: 'Pagamento ainda não confirmado. Continuamos verificando…', expired: 'Este pagamento foi encerrado. Se você já pagou, o saldo será adicionado automaticamente.', closed: 'Esta recarga foi encerrada. Comece outra.', review: 'Seu pagamento está em revisão. O saldo será adicionado após a confirmação.', notifyTitle: 'Saldo adicionado', notifyBody: '{amount} adicionado ao seu saldo.', timeLeft: 'Tempo restante' },
    ru: { eyebrow: 'Баланс', title: 'Пополнить баланс', checkoutTitle: 'Завершите оплату', close: 'Закрыть', amount: 'Сумма (USD)', limits: 'От {min} до {max}', credit: 'Зачислится', fee: 'Комиссия за обработку', feeFree: 'Без комиссии', total: 'Итого к оплате', note: 'Безопасная оплата через Whop: карты, WeChat Pay, Alipay, Apple Pay, Google Pay и другое.', cancel: 'Отмена', submit: 'Пополнить', creating: 'Открываем оплату…', checkoutBody: 'Оплата открыта в браузере. Баланс обновится здесь сразу после подтверждения.', waiting: 'Ожидаем оплату', credited: 'Баланс пополнен', creditedBody: 'Баланс обновлён.', reopen: 'Открыть оплату снова', check: 'Я оплатил, проверить', restart: 'Изменить сумму', done: 'Готово', unavailable: 'Пополнение временно недоступно. Попробуйте позже.', invalid: 'Введите сумму от {min} до {max}.', daily: 'Дневной лимит исчерпан. Уменьшите сумму или вернитесь завтра.', createFailed: 'Не удалось открыть оплату. Попробуйте снова.', checkFailed: 'Оплата ещё не подтверждена. Продолжаем проверять…', expired: 'Эта оплата закрыта. Если вы уже оплатили, баланс пополнится автоматически.', closed: 'Это пополнение закрыто. Начните новое.', review: 'Платёж на проверке. Баланс пополнится после подтверждения.', notifyTitle: 'Баланс пополнен', notifyBody: 'На баланс зачислено {amount}.', timeLeft: 'Осталось' },
    ar: { eyebrow: 'الرصيد', title: 'إضافة رصيد', checkoutTitle: 'أكمل الدفع', close: 'إغلاق', amount: 'المبلغ (USD)', limits: 'بين {min} و{max}', credit: 'الرصيد المضاف', fee: 'رسوم المعالجة', feeFree: 'بدون رسوم', total: 'الإجمالي المستحق', note: 'ادفع بأمان عبر Whop: البطاقات وWeChat Pay وAlipay وApple Pay وGoogle Pay وغيرها.', cancel: 'إلغاء', submit: 'اشحن', creating: 'جارٍ فتح صفحة الدفع…', checkoutBody: 'صفحة الدفع مفتوحة في المتصفح. يُحدَّث رصيدك هنا فور تأكيد الدفع.', waiting: 'بانتظار الدفع', credited: 'أُضيف الرصيد', creditedBody: 'رصيدك محدَّث.', reopen: 'فتح صفحة الدفع مجددًا', check: 'دفعت، تحقّق الآن', restart: 'تغيير المبلغ', done: 'تم', unavailable: 'الشحن غير متاح حاليًا. حاول لاحقًا.', invalid: 'أدخل مبلغًا بين {min} و{max}.', daily: 'بلغت حد الشحن اليومي. جرّب مبلغًا أقل أو عُد غدًا.', createFailed: 'تعذّر فتح صفحة الدفع. حاول مرة أخرى.', checkFailed: 'لم يُؤكَّد الدفع بعد. نواصل التحقق…', expired: 'أُغلقت صفحة الدفع هذه. إذا دفعت بالفعل فسيُضاف الرصيد تلقائيًا.', closed: 'أُغلقت عملية الشحن هذه. ابدأ عملية جديدة.', review: 'دفعتك قيد المراجعة. سيُضاف الرصيد بعد التأكيد.', notifyTitle: 'أُضيف الرصيد', notifyBody: 'أُضيف {amount} إلى رصيدك.', timeLeft: 'الوقت المتبقي' },
    hi: { eyebrow: 'बैलेंस', title: 'बैलेंस जोड़ें', checkoutTitle: 'भुगतान पूरा करें', close: 'बंद करें', amount: 'राशि (USD)', limits: '{min} से {max} के बीच', credit: 'जुड़ने वाला बैलेंस', fee: 'प्रोसेसिंग शुल्क', feeFree: 'कोई शुल्क नहीं', total: 'कुल देय', note: 'Whop से सुरक्षित भुगतान करें: कार्ड, WeChat Pay, Alipay, Apple Pay, Google Pay आदि।', cancel: 'रद्द करें', submit: 'टॉप अप करें', creating: 'चेकआउट खुल रहा है…', checkoutBody: 'चेकआउट आपके ब्राउज़र में खुला है। भुगतान की पुष्टि होते ही यहाँ बैलेंस अपडेट होगा।', waiting: 'भुगतान की प्रतीक्षा', credited: 'बैलेंस जुड़ गया', creditedBody: 'आपका बैलेंस अपडेट है।', reopen: 'चेकआउट फिर खोलें', check: 'भुगतान कर दिया, अभी जाँचें', restart: 'राशि बदलें', done: 'हो गया', unavailable: 'टॉप-अप अभी उपलब्ध नहीं है। बाद में कोशिश करें।', invalid: '{min} से {max} के बीच राशि डालें।', daily: 'आज की टॉप-अप सीमा पूरी हो गई। कम राशि आज़माएँ या कल आएँ।', createFailed: 'चेकआउट नहीं खुल सका। फिर से कोशिश करें।', checkFailed: 'भुगतान की पुष्टि अभी नहीं हुई। जाँच जारी है…', expired: 'यह चेकआउट बंद हो गया है। अगर आपने भुगतान कर दिया है, तो बैलेंस अपने आप जुड़ जाएगा।', closed: 'यह टॉप-अप बंद हो गया। नया शुरू करें।', review: 'आपके भुगतान की समीक्षा हो रही है। पुष्टि के बाद बैलेंस जुड़ जाएगा।', notifyTitle: 'बैलेंस जुड़ गया', notifyBody: '{amount} आपके बैलेंस में जोड़ा गया।', timeLeft: 'शेष समय' }
};

function uncheckedWalletTopupText(locale: NextMuxDesktopLocale, key: TopupTextKey, values: Record<string, string> = {}): string {
    const template = translations[locale]?.[key] || en[key];
    return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** Mirrors whop.js whopTopupQuote: charge = ceil((credit + fixed) / (1 − bps/10⁴)). */
export function walletTopupCharge(creditMinor: number, fee: PlatformWalletTopupOptions['fee']): { creditMinor: number; feeMinor: number; chargeMinor: number } {
    const denominator = 10_000 - fee.bps;
    const charge = Math.floor(((creditMinor + fee.fixedMinor) * 10_000 + denominator - 1) / denominator);
    return { creditMinor, feeMinor: charge - creditMinor, chargeMinor: charge };
}

/** Whole or two-decimal dollars → cents; anything else is invalid. */
export function walletTopupAmountMinor(text: string): number | undefined {
    const value = text.trim().replace(',', '.');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return undefined;
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Maps a platform error to a sentence in the user's language; never shows server internals. */
export function walletTopupErrorText(locale: NextMuxDesktopLocale, error: unknown, stage: 'create' | 'check', options?: PlatformWalletTopupOptions): string {
    const record = error && typeof error === 'object' ? error as { code?: unknown; data?: { code?: unknown } } : undefined;
    const code = String(record?.code ?? record?.data?.code ?? '').toLowerCase();
    if (code === 'topup_daily_limit') return walletTopupText(locale, 'daily');
    if (code === 'topup_amount_out_of_range' || code === 'topup_invalid') return walletTopupRangeText(locale, options);
    if (code === 'payment_unavailable') return walletTopupText(locale, 'unavailable');
    return walletTopupText(locale, stage === 'create' ? 'createFailed' : 'checkFailed');
}

function formatUsd(locale: NextMuxDesktopLocale, minor: number, fractionDigits = 2): string {
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(minor / 100);
    } catch {
        return `$${(minor / 100).toFixed(fractionDigits)}`;
    }
}

export function walletTopupRangeText(locale: NextMuxDesktopLocale, options?: PlatformWalletTopupOptions): string {
    return walletTopupText(locale, 'invalid', { min: formatUsd(locale, options?.minimumMinor ?? 1_000, 0), max: formatUsd(locale, options?.maximumMinor ?? 100_000, 0) });
}

export type WalletTopupStage = 'idle' | 'creating' | 'waiting' | 'credited' | 'error';

export interface WalletTopupSheetProps {
    readonly locale: NextMuxDesktopLocale;
    readonly stage: WalletTopupStage;
    readonly amount: string;
    readonly options?: PlatformWalletTopupOptions;
    readonly order?: PlatformWalletTopupOrder;
    readonly error: string;
    readonly now: number;
    readonly formatMicros: (currency: string, micros: number) => string;
    readonly onAmountChange: (value: string) => void;
    readonly onSubmit: () => void;
    readonly onClose: () => void;
    readonly onOpenCheckout: () => void;
    readonly onCheck: () => void;
    readonly onRestart: () => void;
    readonly onDone: () => void;
}

export function WalletTopupSheet(props: WalletTopupSheetProps): React.ReactElement {
    const { locale, stage, order, options } = props;
    const text = (key: TopupTextKey, values?: Record<string, string>) => walletTopupText(locale, key, values);
    const busy = stage === 'creating';
    const amountMinor = walletTopupAmountMinor(props.amount);
    const inRange = amountMinor !== undefined && (!options || (amountMinor >= options.minimumMinor && amountMinor <= options.maximumMinor));
    const quote = amountMinor !== undefined && inRange && options ? walletTopupCharge(amountMinor, options.fee) : undefined;
    const presets = options?.presetsMinor.length ? options.presetsMinor : [1_000, 2_000, 5_000, 10_000, 20_000, 50_000];
    const unavailable = options !== undefined && !options.available;
    const remainingSeconds = order ? Math.max(0, Math.ceil((order.topup.expiresAt - props.now) / 1000)) : 0;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const summary = (credit: string, fee: string, total: string) => <dl className='nmx-topup-summary'>
        <div><dt>{text('credit')}</dt><dd>{credit}</dd></div>
        <div><dt>{text('fee')}</dt><dd>{fee}</dd></div>
        <div className='is-total'><dt>{text('total')}</dt><dd>{total}</dd></div>
    </dl>;
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop nmx-topup-backdrop' onMouseDown={() => { if (!busy) props.onClose(); }}>
        <section className='nmx-topup-sheet' role='dialog' aria-modal='true' aria-labelledby='nmx-topup-title' onMouseDown={event => event.stopPropagation()}>
            <header><div><h2 id='nmx-topup-title'>{order ? text(stage === 'credited' ? 'credited' : 'checkoutTitle') : text('title')}</h2></div><button aria-label={text('close')} disabled={busy} onClick={props.onClose}><i className='codicon codicon-close'></i></button></header>
            {!order && <form onSubmit={event => { event.preventDefault(); props.onSubmit(); }}>
                <label htmlFor='nmx-topup-amount'>{text('amount')}</label>
                <div className='nmx-topup-amount-field'><span>$</span><input id='nmx-topup-amount' className='nmx-topup-amount-input' name='amount' inputMode='decimal' autoComplete='off' dir='ltr' value={props.amount} aria-describedby='nmx-topup-amount-help' aria-invalid={props.amount !== '' && !inRange} onChange={event => props.onAmountChange(event.currentTarget.value.replace(/[^0-9.,]/g, '').slice(0, 9))} /></div>
                <div className='nmx-topup-presets'>{presets.map(value => <button type='button' key={value} aria-pressed={amountMinor === value} onClick={() => props.onAmountChange(String(value / 100))}>{formatUsd(locale, value, 0)}</button>)}</div>
                <p id='nmx-topup-amount-help' className='nmx-topup-limits'>{text('limits', { min: formatUsd(locale, options?.minimumMinor ?? 1_000, 0), max: formatUsd(locale, options?.maximumMinor ?? 100_000, 0) })}</p>
                {summary(quote ? formatUsd(locale, quote.creditMinor) : '—', quote ? (quote.feeMinor === 0 ? text('feeFree') : formatUsd(locale, quote.feeMinor)) : '—', quote ? formatUsd(locale, quote.chargeMinor) : '—')}
                <p className='nmx-topup-note'><i className='codicon codicon-lock'></i><span>{text('note')}</span></p>
                {(props.error || unavailable) && <div className='nmx-topup-error' role='alert'><i className='codicon codicon-warning'></i><span>{props.error || text('unavailable')}</span></div>}
                <footer><button type='button' disabled={busy} onClick={props.onClose}>{text('cancel')}</button><button type='submit' className='is-primary' disabled={busy || unavailable || !quote}>{busy ? text('creating') : text('submit')}</button></footer>
            </form>}
            {order && <div className={`nmx-topup-payment nmx-topup-checkout is-${stage}`}>
                <div className='nmx-topup-checkout-mark' aria-hidden='true'><i className={`codicon ${stage === 'credited' ? 'codicon-pass-filled' : 'codicon-credit-card'}`}></i></div>
                <div className='nmx-topup-payment-copy'>
                    <span>{stage === 'credited' ? text('creditedBody') : text('checkoutBody')}</span>
                    <strong>{stage === 'credited' ? `+${props.formatMicros(order.payment.creditAmount.currency, order.payment.creditAmount.micros)}` : formatUsd(locale, order.payment.payableAmount.minor)}</strong>
                    {stage !== 'credited' && summary(props.formatMicros(order.payment.creditAmount.currency, order.payment.creditAmount.micros), (order.payment.feeAmount?.minor ?? 0) === 0 ? text('feeFree') : formatUsd(locale, order.payment.feeAmount?.minor ?? 0), formatUsd(locale, order.payment.payableAmount.minor))}
                    {stage === 'credited' ? <div className='nmx-topup-success'><i className='codicon codicon-pass-filled'></i><span>{text('credited')}</span></div>
                        : stage === 'waiting' ? <div className='nmx-topup-waiting'><i></i><span>{text('waiting')}</span><time aria-label={text('timeLeft')}>{minutes}:{String(seconds).padStart(2, '0')}</time></div> : undefined}
                </div>
                {props.error && <div className='nmx-topup-error' role='alert'><i className='codicon codicon-warning'></i><span>{props.error}</span></div>}
                <footer>
                    {stage === 'credited' ? <button className='is-primary' onClick={props.onDone}>{text('done')}</button>
                        : <><button onClick={props.onRestart}>{text('restart')}</button>
                            {order.payment.checkoutUrl && stage === 'waiting' && <button onClick={props.onOpenCheckout}>{text('reopen')}</button>}
                            <button className='is-primary' onClick={props.onCheck}>{text('check')}</button></>}
                </footer>
            </div>}
        </section>
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function walletTopupText(locale: Parameters<typeof uncheckedWalletTopupText>[0], key: Parameters<typeof uncheckedWalletTopupText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedWalletTopupText>>): string {
    return totalCopy(locale, key, language => uncheckedWalletTopupText(language, key, ...rest));
}
