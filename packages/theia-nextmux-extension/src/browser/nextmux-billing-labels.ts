import type { NextMuxDesktopLocale } from './nextmux-locale';

type BillingReferenceTypeKey =
    | 'redeem_code'
    | 'wallet_topup'
    | 'inference_request'
    | 'task_account_v1'
    | 'merchant_security_deposit'
    | 'merchant_security_deposit_refund';

const BILLING_REFERENCE_LABELS: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<BillingReferenceTypeKey, string>>>> = {
    'zh-CN': {
        redeem_code: '兑换码充值',
        wallet_topup: '在线充值',
        inference_request: '模型请求',
        task_account_v1: '任务结算',
        merchant_security_deposit: '商家保证金',
        merchant_security_deposit_refund: '保证金退还'
    },
    'zh-TW': {
        redeem_code: '兌換碼儲值',
        wallet_topup: '線上儲值',
        inference_request: '模型請求',
        task_account_v1: '任務結算',
        merchant_security_deposit: '商家保證金',
        merchant_security_deposit_refund: '保證金退還'
    },
    en: {
        redeem_code: 'Redeem code',
        wallet_topup: 'Top-up',
        inference_request: 'Model request',
        task_account_v1: 'Task settlement',
        merchant_security_deposit: 'Merchant deposit',
        merchant_security_deposit_refund: 'Deposit refund'
    },
    ja: {
        redeem_code: '引き換えコード',
        wallet_topup: 'チャージ',
        inference_request: 'モデルリクエスト',
        task_account_v1: 'タスク精算',
        merchant_security_deposit: 'マーチャント保証金',
        merchant_security_deposit_refund: '保証金返金'
    },
    ko: {
        redeem_code: '리딤 코드',
        wallet_topup: '충전',
        inference_request: '모델 요청',
        task_account_v1: '작업 정산',
        merchant_security_deposit: '판매자 보증금',
        merchant_security_deposit_refund: '보증금 환불'
    },
    es: {
        redeem_code: 'Código de canje',
        wallet_topup: 'Recarga',
        inference_request: 'Solicitud de modelo',
        task_account_v1: 'Liquidación de tarea',
        merchant_security_deposit: 'Depósito de comerciante',
        merchant_security_deposit_refund: 'Reembolso de depósito'
    },
    fr: {
        redeem_code: 'Code d’échange',
        wallet_topup: 'Rechargement',
        inference_request: 'Requête modèle',
        task_account_v1: 'Règlement de tâche',
        merchant_security_deposit: 'Dépôt marchand',
        merchant_security_deposit_refund: 'Remboursement du dépôt'
    },
    de: {
        redeem_code: 'Einlösecode',
        wallet_topup: 'Aufladung',
        inference_request: 'Modellanfrage',
        task_account_v1: 'Aufgabenabrechnung',
        merchant_security_deposit: 'Händlerkaution',
        merchant_security_deposit_refund: 'Kautionsrückerstattung'
    },
    'pt-BR': {
        redeem_code: 'Código de resgate',
        wallet_topup: 'Recarga',
        inference_request: 'Solicitação de modelo',
        task_account_v1: 'Liquidação de tarefa',
        merchant_security_deposit: 'Depósito de comerciante',
        merchant_security_deposit_refund: 'Reembolso de depósito'
    },
    ru: {
        redeem_code: 'Промокод',
        wallet_topup: 'Пополнение',
        inference_request: 'Запрос к модели',
        task_account_v1: 'Расчёт задачи',
        merchant_security_deposit: 'Депозит продавца',
        merchant_security_deposit_refund: 'Возврат депозита'
    },
    ar: {
        redeem_code: 'رمز استرداد',
        wallet_topup: 'شحن الرصيد',
        inference_request: 'طلب نموذج',
        task_account_v1: 'تسوية مهمة',
        merchant_security_deposit: 'تأمين التاجر',
        merchant_security_deposit_refund: 'استرداد التأمين'
    },
    hi: {
        redeem_code: 'रिडीम कोड',
        wallet_topup: 'टॉप-अप',
        inference_request: 'मॉडल अनुरोध',
        task_account_v1: 'कार्य निपटान',
        merchant_security_deposit: 'मर्चेंट जमा',
        merchant_security_deposit_refund: 'जमा धनवापसी'
    }
};

const hasOwn = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Maps raw billing ledger `referenceType` codes to localized display labels without breaking unknown values.
 * Both lookups are own-property only, so neither a code nor a locale such as `constructor`, `__proto__` or `toString`
 * can reach Object.prototype. An unknown code shows as itself (the ledger's own name, trimmed); a missing, blank or
 * non-string one as "—"; an unknown locale falls back to English.
 */
export function billingMovementReferenceLabel(locale: NextMuxDesktopLocale, referenceType: unknown): string {
    const raw = typeof referenceType === 'string' ? referenceType.trim() : '';
    if (!raw) return '—';
    const key = raw.toLowerCase();
    const table = hasOwn(BILLING_REFERENCE_LABELS, locale) ? BILLING_REFERENCE_LABELS[locale] : BILLING_REFERENCE_LABELS.en;
    return hasOwn(table, key) ? table[key as BillingReferenceTypeKey] : raw;
}
