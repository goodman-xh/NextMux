import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type {
    PlatformWalletTopupConfirmResult,
    PlatformWalletTopupOptions,
    PlatformWalletTopupOrder,
    PlatformWalletTopupPaymentMethod
} from '../common/nextmux-platform-protocol';
import '../../src/browser/style/nextmux-wallet-topup.css';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

// Unified USD wallet top-up through NextMux's hosted /checkout-embed Elements card
// (Card / Apple Pay, WeChat Pay, AlipayHK) with buyer-paid Whop fee disclosure and
// strict-origin postMessage token confirmation.

export type WalletTopupPaymentMethod = PlatformWalletTopupPaymentMethod;
/** @deprecated Legacy alias retained while desktop widget migrates to WalletTopupPaymentMethod. */
export type WalletTopupRail = 'usd' | 'cny';
export type WalletTopupStage = 'idle' | 'creating' | 'waiting' | 'credited' | 'error';

export const DEFAULT_PLATFORM_CHECKOUT_ORIGIN = 'https://nextmux.app';
export const DESKTOP_CHECKOUT_SCOPE = 'nextmux-desktop-checkout';
export const CHECKOUT_EMBED_MIN_HEIGHT = 160;
export const CHECKOUT_EMBED_MAX_HEIGHT = 560;
export const DEFAULT_WHOP_TOPUP_FEE: PlatformWalletTopupOptions['fee'] = {
    bps: 520,
    fixedMinor: 30
};

const ORDER_ID_RE = /^[A-Za-z0-9_-]{8,120}$/;
const PLAN_ID_RE = /^plan_[A-Za-z0-9]{4,80}$/;
const ACCOUNT_ID_RE = /^biz_[A-Za-z0-9]{4,80}$/;
const CHECKOUT_ID_RE = /^ch_[A-Za-z0-9]{4,80}$/;
const AMOUNT_LABEL_RE = /^[\p{L}\p{N}$€£¥₩.,\s+-]{1,32}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_RE = /^[A-Za-z]{2}$/;
const LOCALE_RE = /^[A-Za-z0-9_-]{2,20}$/;
const BIDI_MARKS_RE = /[\u200e\u200f\u061c]/g;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export interface CheckoutEmbedUrlOptions {
    readonly platformOrigin?: string;
    readonly fallbackCheckoutUrl?: string;
    readonly orderId?: string;
    readonly planId?: string;
    readonly whopAccountId?: string;
    readonly paymentMethod?: WalletTopupPaymentMethod;
    readonly amountLabel?: string;
    readonly checkoutId?: string;
    readonly checkoutCountry?: string;
    readonly prefillEmail?: string;
    readonly theme?: 'light' | 'dark';
    readonly locale?: string;
}

function isNextMuxHostname(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return lower === 'nextmux.app' || lower.endsWith('.nextmux.app');
}

function safeHttpsNonLoopbackOrigin(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'https:' || url.username || url.password) return undefined;
        const host = url.hostname.toLowerCase();
        if (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')) return undefined;
        return url.origin;
    } catch {
        return undefined;
    }
}

/**
 * Resolves the trusted HTTPS NextMux origin for `/checkout-embed` and `return_url`.
 * Never falls back to `http://127.0.0.1`, `file://`, or `https://whop.com`.
 */
export function resolveCheckoutPlatformOrigin(platformOrigin?: string, fallbackCheckoutUrl?: string): string {
    const explicit = safeHttpsNonLoopbackOrigin(platformOrigin);
    if (explicit) return explicit;
    const fallback = safeHttpsNonLoopbackOrigin(fallbackCheckoutUrl);
    if (fallback) {
        try {
            if (isNextMuxHostname(new URL(fallback).hostname)) return fallback;
        } catch {
            // Fall through to default origin.
        }
    }
    return DEFAULT_PLATFORM_CHECKOUT_ORIGIN;
}

/** Strict HTTPS `/payment-complete?order=...` return URL (never loopback). */
export function buildCheckoutReturnUrl(platformOrigin: string, orderId: string): string | undefined {
    const trimmedOrder = typeof orderId === 'string' ? orderId.trim() : '';
    if (!ORDER_ID_RE.test(trimmedOrder)) return undefined;
    const origin = resolveCheckoutPlatformOrigin(platformOrigin);
    return `${origin}/payment-complete?order=${encodeURIComponent(trimmedOrder)}`;
}

function safeBridgeReturnUrl(raw: unknown, expectedOrigin: string, fallbackReturnUrl?: string): string | undefined {
    if (typeof raw !== 'string') return fallbackReturnUrl;
    const origin = safeHttpsNonLoopbackOrigin(raw);
    if (!origin) return fallbackReturnUrl;
    try {
        const parsed = new URL(raw.trim());
        if (parsed.origin === expectedOrigin || isNextMuxHostname(parsed.hostname)) {
            return parsed.href;
        }
    } catch {
        // Use fallback return URL.
    }
    return fallbackReturnUrl;
}

/**
 * Builds the `/checkout-embed` iframe URL matching `apps/cloudflare-platform/web/src/routes/checkout-embed.tsx`
 * validation rules byte-for-byte.
 */
export function buildCheckoutEmbedUrl(options: CheckoutEmbedUrlOptions): string | undefined {
    const order = typeof options.orderId === 'string' ? options.orderId.trim() : '';
    const plan = typeof options.planId === 'string' ? options.planId.trim() : '';
    const account = typeof options.whopAccountId === 'string' ? options.whopAccountId.trim() : '';
    if (!ORDER_ID_RE.test(order) || !PLAN_ID_RE.test(plan) || !ACCOUNT_ID_RE.test(account)) {
        return undefined;
    }
    const origin = resolveCheckoutPlatformOrigin(options.platformOrigin, options.fallbackCheckoutUrl);
    const url = new URL('/checkout-embed', origin);
    const pm: WalletTopupPaymentMethod =
        options.paymentMethod === 'wechat_pay' || options.paymentMethod === 'alipayhk' || options.paymentMethod === 'card'
            ? options.paymentMethod
            : 'card';
    url.searchParams.set('order', order);
    url.searchParams.set('plan', plan);
    url.searchParams.set('account', account);
    url.searchParams.set('pm', pm);

    const amountLabel = typeof options.amountLabel === 'string' ? options.amountLabel.replace(BIDI_MARKS_RE, '').trim() : '';
    if (amountLabel && AMOUNT_LABEL_RE.test(amountLabel)) {
        url.searchParams.set('amount', amountLabel);
    }
    const checkoutId = typeof options.checkoutId === 'string' ? options.checkoutId.trim() : '';
    if (CHECKOUT_ID_RE.test(checkoutId)) {
        url.searchParams.set('ch', checkoutId);
    }
    if (options.theme === 'light' || options.theme === 'dark') {
        url.searchParams.set('theme', options.theme);
    }
    const locale = typeof options.locale === 'string' ? options.locale.trim() : '';
    if (LOCALE_RE.test(locale)) {
        url.searchParams.set('locale', locale);
    }
    const email = typeof options.prefillEmail === 'string' ? options.prefillEmail.trim() : '';
    if (email && email.length <= 254 && EMAIL_RE.test(email)) {
        url.searchParams.set('email', email);
    }
    const rawCountry = typeof options.checkoutCountry === 'string' ? options.checkoutCountry.trim().toUpperCase() : '';
    const country = COUNTRY_RE.test(rawCountry)
        ? rawCountry
        : pm === 'wechat_pay'
            ? 'CN'
            : pm === 'alipayhk'
                ? 'HK'
                : undefined;
    if (country) {
        url.searchParams.set('country', country);
    }
    const returnUrl = buildCheckoutReturnUrl(origin, order);
    if (returnUrl) {
        url.searchParams.set('return_url', returnUrl);
    }
    return url.toString();
}

export type CheckoutEmbedEvent =
    | { readonly event: 'ready' }
    | { readonly event: 'resize'; readonly height: number }
    | { readonly event: 'complete'; readonly result?: string; readonly paymentId?: string }
    | { readonly event: 'error'; readonly message: string; readonly code?: string }
    | {
        readonly event: 'confirm_token';
        readonly requestId: string;
        readonly orderId: string;
        readonly confirmationToken: string;
        readonly returnUrl?: string;
    };

export function clampCheckoutEmbedHeight(height: number): number {
    return Math.max(CHECKOUT_EMBED_MIN_HEIGHT, Math.min(CHECKOUT_EMBED_MAX_HEIGHT, Math.ceil(height)));
}

/**
 * Validates and parses a `postMessage` event from `/checkout-embed`.
 * Requires matching `event.origin`, exact `event.source === frame`,
 * `data.__scope === 'nextmux-desktop-checkout'`, and matching `orderId`
 * (mandatory on `confirm_token`, verified whenever present on other events).
 */
export function parseCheckoutEmbedEvent(
    event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
    expectedOrigin: string,
    frame: Window | null | undefined,
    expectedOrderId: string
): CheckoutEmbedEvent | undefined {
    if (!frame || !expectedOrigin || !expectedOrderId) return undefined;
    if (event.source !== frame || event.origin !== expectedOrigin) return undefined;
    const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
        ? event.data as Record<string, unknown>
        : undefined;
    if (!data || data.__scope !== DESKTOP_CHECKOUT_SCOPE) return undefined;
    if (data.orderId !== undefined && data.orderId !== expectedOrderId) return undefined;
    const kind = typeof data.event === 'string' ? data.event : '';
    if (kind === 'ready') return { event: 'ready' };
    if (kind === 'resize') {
        const rawHeight = Number(data.height);
        if (!Number.isFinite(rawHeight) || rawHeight <= 0) return undefined;
        return { event: 'resize', height: clampCheckoutEmbedHeight(rawHeight) };
    }
    if (kind === 'complete') {
        const result = typeof data.result === 'string' && data.result.trim() ? data.result.trim() : undefined;
        const paymentId = typeof data.paymentId === 'string' && data.paymentId.trim() ? data.paymentId.trim() : undefined;
        return {
            event: 'complete',
            ...(result ? { result } : {}),
            ...(paymentId ? { paymentId } : {})
        };
    }
    if (kind === 'error') {
        const message = typeof data.message === 'string' && data.message.trim() ? data.message.trim() : 'Checkout error';
        const code = typeof data.code === 'string' && data.code.trim() ? data.code.trim() : undefined;
        return {
            event: 'error',
            message,
            ...(code ? { code } : {})
        };
    }
    if (kind === 'confirm_token') {
        const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
        const orderId = typeof data.orderId === 'string' ? data.orderId.trim() : '';
        const confirmationToken = typeof data.confirmationToken === 'string' ? data.confirmationToken.trim() : '';
        if (!requestId || orderId !== expectedOrderId || !confirmationToken) return undefined;
        const returnUrl = typeof data.returnUrl === 'string' && data.returnUrl.trim() ? data.returnUrl.trim() : undefined;
        return {
            event: 'confirm_token',
            requestId,
            orderId,
            confirmationToken,
            ...(returnUrl ? { returnUrl } : {})
        };
    }
    return undefined;
}

export interface CheckoutEmbedBridgeOptions {
    readonly getFrame: () => Window | null | undefined;
    readonly expectedOrigin: string;
    readonly expectedOrderId: string;
    readonly defaultReturnUrl?: string;
    readonly isCancelled?: () => boolean;
    readonly onReady?: () => void;
    readonly onResize?: (height: number) => void;
    readonly onComplete?: () => void;
    readonly onError?: (error: { readonly message: string; readonly code?: string }) => void;
    readonly onConfirmToken?: (orderId: string, confirmationToken: string, returnUrl?: string) => Promise<PlatformWalletTopupConfirmResult>;
}

function extractConfirmHttpStatus(error: unknown): number {
    if (!error || typeof error !== 'object') return 0;
    const rec = error as { httpStatus?: unknown; status?: unknown; data?: { httpStatus?: unknown; status?: unknown } };
    for (const candidate of [rec.httpStatus, rec.status, rec.data?.httpStatus, rec.data?.status]) {
        if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0) {
            return candidate;
        }
    }
    return 0;
}

function extractConfirmErrorCode(error: unknown): string {
    if (!error || typeof error !== 'object') return 'payment_confirm_failed';
    const rec = error as { code?: unknown; data?: { code?: unknown } };
    const raw = typeof rec.code === 'string' ? rec.code.trim() : typeof rec.data?.code === 'string' ? rec.data.code.trim() : '';
    return raw || 'payment_confirm_failed';
}

function extractConfirmErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message.trim();
    if (error && typeof error === 'object') {
        const rec = error as { message?: unknown; data?: { message?: unknown } };
        const raw = typeof rec.message === 'string' ? rec.message.trim() : typeof rec.data?.message === 'string' ? rec.data.message.trim() : '';
        if (raw) return raw;
    }
    return 'Payment confirmation failed';
}

/**
 * Creates the `window` `message` event handler bridging `/checkout-embed` and Desktop RPC.
 * Replies strictly to the verified `frame.postMessage(..., expectedOrigin)` (never `'*'`).
 */
export function createCheckoutEmbedMessageHandler(
    options: CheckoutEmbedBridgeOptions
): (event: Pick<MessageEvent, 'origin' | 'source' | 'data'>) => Promise<void> {
    return async (event): Promise<void> => {
        if (options.isCancelled?.()) return;
        const frame = options.getFrame();
        const parsed = parseCheckoutEmbedEvent(event, options.expectedOrigin, frame, options.expectedOrderId);
        if (!parsed || !frame) return;

        if (parsed.event === 'ready') {
            options.onReady?.();
            return;
        }
        if (parsed.event === 'resize') {
            options.onResize?.(parsed.height);
            return;
        }
        if (parsed.event === 'complete') {
            options.onComplete?.();
            return;
        }
        if (parsed.event === 'error') {
            options.onError?.({ message: parsed.message, ...(parsed.code ? { code: parsed.code } : {}) });
            return;
        }

        const postReply = (payload: Record<string, unknown>): void => {
            if (options.isCancelled?.()) return;
            if (options.getFrame() !== frame) return;
            frame.postMessage(
                {
                    __scope: DESKTOP_CHECKOUT_SCOPE,
                    event: 'confirm_result',
                    requestId: parsed.requestId,
                    ...payload
                },
                options.expectedOrigin
            );
        };

        const confirmHandler = options.onConfirmToken;
        if (!confirmHandler) {
            postReply({
                ok: false,
                code: 'payment_provider_unavailable',
                message: 'Payment confirmation is unavailable',
                httpStatus: 0
            });
            return;
        }

        const resolvedReturnUrl = safeBridgeReturnUrl(parsed.returnUrl, options.expectedOrigin, options.defaultReturnUrl);
        try {
            const result = await confirmHandler(parsed.orderId, parsed.confirmationToken, resolvedReturnUrl);
            postReply({
                ok: Boolean(result?.ok),
                ...(result?.paymentId ? { paymentId: result.paymentId } : {}),
                ...(result?.clientSecret ? { clientSecret: result.clientSecret } : {}),
                ...(result?.status ? { status: result.status } : {}),
                ...(result?.code ? { code: result.code } : {}),
                ...(result?.message ? { message: result.message } : {}),
                ...(typeof result?.httpStatus === 'number' ? { httpStatus: result.httpStatus } : {})
            });
        } catch (error) {
            postReply({
                ok: false,
                code: extractConfirmErrorCode(error),
                message: extractConfirmErrorMessage(error),
                httpStatus: extractConfirmHttpStatus(error)
            });
        }
    };
}

const en = {
    eyebrow: 'Balance', title: 'Add balance', checkoutTitle: 'Finish payment', close: 'Close', amount: 'Amount (USD)',
    methodsLabel: 'Payment method', methodCard: 'Card / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
    wechatHint: 'Whop settles WeChat Pay in RMB at checkout; your wallet still credits the exact USD amount above.',
    limits: 'Between {min} and {max}', credit: 'Balance added', fee: 'Processing fee', feeFree: 'None', total: 'Total due',
    payCny: 'Total in RMB (reference)',
    note: 'Pay securely with Whop: cards, Apple Pay, Google Pay, WeChat Pay, AlipayHK and more.',
    noteFee: 'Your balance receives the exact USD amount chosen; Whop’s processing fee ({fee}) is paid by the buyer and shown above.',
    cancel: 'Cancel', submit: 'Top up', creating: 'Preparing checkout…',
    checkoutBody: 'Checkout is open in your browser. Your balance updates here as soon as the payment is confirmed.',
    checkoutBodyEmbedded: 'Complete payment below. Your balance updates automatically once confirmed.',
    embedLoading: 'Loading secure checkout…',
    embedFallbackError: 'The embedded checkout could not load. You can open the payment page in your browser.',
    waiting: 'Waiting for payment', credited: 'Balance added', creditedBody: 'Your balance is up to date.',
    reopen: 'Open checkout again', openExternal: 'Open in browser (Apple Pay)', check: 'I’ve paid, check now', restart: 'Change amount', done: 'Done',
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
    'zh-CN': {
        eyebrow: '统一余额', title: '充值余额', checkoutTitle: '完成付款', close: '关闭', amount: '充值金额（美元）',
        methodsLabel: '支持付款方式', methodCard: '银行卡 / Apple Pay', methodWechat: '微信支付', methodAlipayHk: 'AlipayHK',
        wechatHint: '微信支付由 Whop 以人民币扣款，钱包仍按上方所选美元金额足额到账。',
        limits: '金额范围 {min} – {max}', credit: '到账余额', fee: '手续费', feeFree: '无需手续费', total: '应付总额',
        payCny: '人民币实付（参考）',
        note: '通过 Whop 安全支付，支持银行卡、微信支付、AlipayHK、Apple Pay、Google Pay 等方式。',
        noteFee: '余额按所选美元金额足额到账；Whop 支付通道手续费（{fee}）由付款方承担并在上方明示。',
        cancel: '取消', submit: '残忍充值', creating: '正在加载收银台…',
        checkoutBody: '支付页已在浏览器中打开。付款确认后，这里的余额会立即更新。',
        checkoutBodyEmbedded: '请在下方直接完成付款，确认后这里的余额会自动到账。',
        embedLoading: '正在加载安全收银台…',
        embedFallbackError: '内嵌收银台暂时无法加载，可点击下方在浏览器中打开支付页。',
        waiting: '正在等待付款', credited: '充值已到账', creditedBody: '余额已自动更新。',
        reopen: '重新打开支付页', openExternal: '在浏览器中打开（支持 Apple Pay）', check: '我已支付，检查到账', restart: '修改金额', done: '完成',
        unavailable: '暂时无法充值，请稍后再试。', invalid: '请输入 {min} 至 {max} 之间的金额。',
        daily: '已达到今日充值上限，请减少金额或明天再试。', createFailed: '支付页暂时无法打开，请重试。',
        checkFailed: '暂时无法确认到账，正在继续检查…', expired: '该支付已关闭。如果你已付款，余额会自动到账。',
        closed: '该充值已关闭，请重新发起。', review: '付款正在审核，确认后余额会自动到账。',
        notifyTitle: '充值已到账', notifyBody: '{amount} 已加入余额。', timeLeft: '剩余时间'
    },
    'zh-TW': {
        eyebrow: '統一餘額', title: '儲值餘額', checkoutTitle: '完成付款', close: '關閉', amount: '儲值金額（美元）',
        methodsLabel: '支援付款方式', methodCard: '信用卡 / Apple Pay', methodWechat: '微信支付', methodAlipayHk: 'AlipayHK',
        wechatHint: '微信支付由 Whop 以人民幣扣款，錢包仍依上方所選美元金額足額入帳。',
        limits: '金額範圍 {min} – {max}', credit: '入帳餘額', fee: '手續費', feeFree: '免手續費', total: '應付總額',
        payCny: '人民幣實付（參考）',
        note: '透過 Whop 安全付款，支援信用卡、微信支付、AlipayHK、Apple Pay、Google Pay 等方式。',
        noteFee: '餘額依所選美元金額足額入帳；Whop 支付通道手續費（{fee}）由付款方承擔並於上方清楚顯示。',
        cancel: '取消', submit: '儲值', creating: '正在載入收銀台…',
        checkoutBody: '付款頁已在瀏覽器中開啟。付款確認後，這裡的餘額會立即更新。',
        checkoutBodyEmbedded: '請在下方直接完成付款，確認後餘額會自動入帳。',
        embedLoading: '正在載入安全收銀台…',
        embedFallbackError: '內嵌收銀台暫時無法載入，可在瀏覽器中開啟付款頁。',
        waiting: '正在等待付款', credited: '儲值已入帳', creditedBody: '餘額已自動更新。',
        reopen: '重新開啟付款頁', openExternal: '在瀏覽器中開啟（支援 Apple Pay）', check: '我已付款，檢查入帳', restart: '修改金額', done: '完成',
        unavailable: '暫時無法儲值，請稍後再試。', invalid: '請輸入 {min} 至 {max} 之間的金額。',
        daily: '已達到今日儲值上限，請減少金額或明天再試。', createFailed: '付款頁暫時無法開啟，請重試。',
        checkFailed: '暫時無法確認入帳，正在繼續檢查…', expired: '該付款已關閉。如果你已付款，餘額會自動入帳。',
        closed: '該儲值已關閉，請重新發起。', review: '付款正在審核，確認後餘額會自動入帳。',
        notifyTitle: '儲值已入帳', notifyBody: '{amount} 已加入餘額。', timeLeft: '剩餘時間'
    },
    ja: {
        eyebrow: '残高', title: '残高をチャージ', checkoutTitle: 'お支払いを完了', close: '閉じる', amount: '金額（USD）',
        methodsLabel: 'お支払い方法', methodCard: 'カード / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
        wechatHint: 'WeChat Pay は Whop 側で人民元建て決済となりますが、残高には上記の米ドル額がそのまま反映されます。',
        limits: '{min}〜{max}', credit: '入金される残高', fee: '決済手数料', feeFree: '手数料なし', total: 'お支払い合計',
        payCny: '人民元お支払い額（目安）',
        note: 'Whop で安全にお支払いいただけます（カード、WeChat Pay、AlipayHK、Apple Pay、Google Pay など）。',
        noteFee: '選んだ USD 金額がそのまま残高に入金されます。Whop の決済手数料（{fee}）は購入者負担となります。',
        cancel: 'キャンセル', submit: 'チャージ', creating: '決済画面を準備中…',
        checkoutBody: 'ブラウザーで決済ページを開きました。お支払いが確認され次第、ここの残高が更新されます。',
        checkoutBodyEmbedded: '下のお支払いフォームから決済を完了してください。確認後に残高が自動更新されます。',
        embedLoading: '安全な決済画面を読み込み中…',
        embedFallbackError: '決済フォームを読み込めませんでした。ブラウザーで決済ページを開けます。',
        waiting: 'お支払いを待っています', credited: 'チャージが完了しました', creditedBody: '残高は最新です。',
        reopen: '決済ページをもう一度開く', openExternal: 'ブラウザーで開く（Apple Pay 対応）', check: '支払い済み、今すぐ確認', restart: '金額を変更', done: '完了',
        unavailable: '現在チャージできません。しばらくしてからお試しください。', invalid: '{min}〜{max} の金額を入力してください。',
        daily: '本日のチャージ上限に達しました。金額を減らすか、明日お試しください。', createFailed: '決済ページを開けませんでした。もう一度お試しください。',
        checkFailed: 'まだ入金を確認できません。確認を続けています…', expired: 'この決済は終了しました。お支払い済みの場合は自動で残高に反映されます。',
        closed: 'このチャージは終了しました。新しく始めてください。', review: 'お支払いを確認中です。確認後に残高へ反映されます。',
        notifyTitle: 'チャージが完了しました', notifyBody: '{amount} が残高に追加されました。', timeLeft: '残り時間'
    },
    ko: {
        eyebrow: '잔액', title: '잔액 충전', checkoutTitle: '결제 완료하기', close: '닫기', amount: '금액(USD)',
        methodsLabel: '결제 수단', methodCard: '카드 / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
        wechatHint: 'WeChat Pay는 Whop에서 위안화(RMB)로 결제되지만, 지갑에는 위에서 선택한 USD 금액이 전액 충전됩니다.',
        limits: '{min} ~ {max}', credit: '충전될 잔액', fee: '처리 수수료', feeFree: '수수료 없음', total: '총 결제 금액',
        payCny: '위안화 결제 금액(참고)',
        note: 'Whop으로 안전하게 결제하세요. 카드, WeChat Pay, AlipayHK, Apple Pay, Google Pay 등을 지원합니다.',
        noteFee: '선택한 USD 금액이 그대로 잔액에 전액 충전됩니다. Whop 결제 채널 수수료({fee})는 구매자 부담입니다.',
        cancel: '취소', submit: '충전', creating: '결제 창 준비 중…',
        checkoutBody: '브라우저에서 결제 페이지가 열렸습니다. 결제가 확인되면 이곳의 잔액이 바로 업데이트됩니다.',
        checkoutBodyEmbedded: '아래 결제 창에서 결제를 완료하세요. 확인 즉시 잔액이 업데이트됩니다.',
        embedLoading: '보안 결제 창 불러오는 중…',
        embedFallbackError: '결제 창을 불러오지 못했습니다. 브라우저에서 결제 페이지를 여세요.',
        waiting: '결제 대기 중', credited: '충전 완료', creditedBody: '잔액이 최신 상태입니다.',
        reopen: '결제 페이지 다시 열기', openExternal: '브라우저에서 열기 (Apple Pay 지원)', check: '결제했어요, 지금 확인', restart: '금액 변경', done: '완료',
        unavailable: '지금은 충전할 수 없습니다. 잠시 후 다시 시도하세요.', invalid: '{min}~{max} 사이의 금액을 입력하세요.',
        daily: '오늘의 충전 한도에 도달했습니다. 금액을 줄이거나 내일 다시 시도하세요.', createFailed: '결제 페이지를 열 수 없습니다. 다시 시도하세요.',
        checkFailed: '아직 결제를 확인하지 못했습니다. 계속 확인 중…', expired: '이 결제는 종료되었습니다. 이미 결제했다면 잔액에 자동으로 반영됩니다.',
        closed: '이 충전은 종료되었습니다. 새로 시작하세요.', review: '결제를 검토 중입니다. 확인되면 잔액에 반영됩니다.',
        notifyTitle: '충전 완료', notifyBody: '{amount}이(가) 잔액에 추가되었습니다.', timeLeft: '남은 시간'
    },
    es: {
        eyebrow: 'Saldo', title: 'Añadir saldo', checkoutTitle: 'Completa el pago', close: 'Cerrar', amount: 'Importe (USD)',
        methodsLabel: 'Método de pago', methodCard: 'Tarjeta / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
        wechatHint: 'Whop procesa WeChat Pay en RMB al pagar; tu saldo se acredita igualmente por el importe exacto en USD.',
        limits: 'Entre {min} y {max}', credit: 'Saldo añadido', fee: 'Comisión de procesamiento', feeFree: 'Sin comisión', total: 'Total a pagar',
        payCny: 'Total en RMB (referencia)',
        note: 'Paga de forma segura con Whop: tarjetas, WeChat Pay, AlipayHK, Apple Pay, Google Pay y más.',
        noteFee: 'Tu saldo recibe el importe exacto en USD; la comisión de procesamiento de Whop ({fee}) corre a cargo del comprador.',
        cancel: 'Cancelar', submit: 'Recargar', creating: 'Preparando el pago…',
        checkoutBody: 'El pago está abierto en tu navegador. Tu saldo se actualizará aquí en cuanto se confirme.',
        checkoutBodyEmbedded: 'Completa el pago abajo. Tu saldo se actualizará automáticamente al confirmarse.',
        embedLoading: 'Cargando pago seguro…',
        embedFallbackError: 'No se pudo cargar el pago integrado. Puedes abrir la página de pago en el navegador.',
        waiting: 'Esperando el pago', credited: 'Saldo añadido', creditedBody: 'Tu saldo está al día.',
        reopen: 'Abrir el pago de nuevo', openExternal: 'Abrir en navegador (Apple Pay)', check: 'Ya pagué, comprobar', restart: 'Cambiar importe', done: 'Listo',
        unavailable: 'La recarga no está disponible por ahora. Inténtalo más tarde.', invalid: 'Introduce un importe entre {min} y {max}.',
        daily: 'Has alcanzado el límite diario. Prueba un importe menor o vuelve mañana.', createFailed: 'No se pudo abrir el pago. Inténtalo de nuevo.',
        checkFailed: 'Aún no se confirma el pago. Seguimos comprobando…', expired: 'Este pago se cerró. Si ya pagaste, el saldo se añadirá automáticamente.',
        closed: 'Esta recarga se cerró. Empieza una nueva.', review: 'Estamos revisando tu pago. El saldo se añadirá al confirmarse.',
        notifyTitle: 'Saldo añadido', notifyBody: 'Se añadieron {amount} a tu saldo.', timeLeft: 'Tiempo restante'
    },
    fr: {
        eyebrow: 'Solde', title: 'Ajouter du solde', checkoutTitle: 'Finaliser le paiement', close: 'Fermer', amount: 'Montant (USD)',
        methodsLabel: 'Moyen de paiement', methodCard: 'Carte / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
        wechatHint: 'Whop traite WeChat Pay en RMB au paiement ; votre solde reste crédité du montant exact en USD.',
        limits: 'Entre {min} et {max}', credit: 'Solde crédité', fee: 'Frais de traitement', feeFree: 'Aucuns frais', total: 'Total à payer',
        payCny: 'Total en RMB (référence)',
        note: 'Payez en toute sécurité avec Whop : cartes, WeChat Pay, AlipayHK, Apple Pay, Google Pay et plus.',
        noteFee: 'Votre solde reçoit exactement le montant en USD choisi ; les frais de traitement Whop ({fee}) sont à la charge de l’acheteur.',
        cancel: 'Annuler', submit: 'Recharger', creating: 'Préparation du paiement…',
        checkoutBody: 'Le paiement est ouvert dans votre navigateur. Votre solde se met à jour ici dès la confirmation.',
        checkoutBodyEmbedded: 'Finalisez le paiement ci-dessous. Votre solde est crédité automatiquement dès confirmation.',
        embedLoading: 'Chargement du paiement sécurisé…',
        embedFallbackError: 'Impossible de charger le paiement intégré. Ouvrez la page de paiement dans votre navigateur.',
        waiting: 'En attente du paiement', credited: 'Solde ajouté', creditedBody: 'Votre solde est à jour.',
        reopen: 'Rouvrir le paiement', openExternal: 'Ouvrir dans le navigateur (Apple Pay)', check: 'J’ai payé, vérifier', restart: 'Modifier le montant', done: 'Terminé',
        unavailable: 'La recharge est momentanément indisponible. Réessayez plus tard.', invalid: 'Saisissez un montant entre {min} et {max}.',
        daily: 'Limite du jour atteinte. Essayez un montant plus petit ou revenez demain.', createFailed: 'Impossible d’ouvrir le paiement. Réessayez.',
        checkFailed: 'Paiement pas encore confirmé. Vérification en cours…', expired: 'Ce paiement est clôturé. Si vous avez déjà payé, le solde sera ajouté automatiquement.',
        closed: 'Cette recharge est clôturée. Recommencez.', review: 'Votre paiement est en cours de vérification. Le solde sera ajouté après confirmation.',
        notifyTitle: 'Solde ajouté', notifyBody: '{amount} ajouté à votre solde.', timeLeft: 'Temps restant'
    },
    de: {
        eyebrow: 'Guthaben', title: 'Guthaben aufladen', checkoutTitle: 'Zahlung abschließen', close: 'Schließen', amount: 'Betrag (USD)',
        methodsLabel: 'Zahlungsart', methodCard: 'Karte / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
        wechatHint: 'Whop rechnet WeChat Pay in RMB ab; Ihrem Guthaben wird dennoch der volle gewählte USD-Betrag gutgeschrieben.',
        limits: 'Zwischen {min} und {max}', credit: 'Gutgeschriebenes Guthaben', fee: 'Bearbeitungsgebühr', feeFree: 'Keine Gebühr', total: 'Gesamtbetrag',
        payCny: 'Betrag in RMB (Referenz)',
        note: 'Sicher bezahlen mit Whop: Karten, WeChat Pay, AlipayHK, Apple Pay, Google Pay und mehr.',
        noteFee: 'Ihr Guthaben erhält genau den gewählten USD-Betrag; die Whop-Bearbeitungsgebühr ({fee}) trägt der Käufer.',
        cancel: 'Abbrechen', submit: 'Aufladen', creating: 'Kasse wird vorbereitet…',
        checkoutBody: 'Die Kasse ist in Ihrem Browser geöffnet. Ihr Guthaben aktualisiert sich hier, sobald die Zahlung bestätigt ist.',
        checkoutBodyEmbedded: 'Schließen Sie die Zahlung unten ab. Ihr Guthaben wird nach Bestätigung automatisch gutgeschrieben.',
        embedLoading: 'Sichere Kasse wird geladen…',
        embedFallbackError: 'Das eingebettete Formular konnte nicht geladen werden. Öffnen Sie die Zahlungsseite im Browser.',
        waiting: 'Warten auf Zahlung', credited: 'Guthaben aufgeladen', creditedBody: 'Ihr Guthaben ist aktuell.',
        reopen: 'Kasse erneut öffnen', openExternal: 'Im Browser öffnen (Apple Pay)', check: 'Bezahlt – jetzt prüfen', restart: 'Betrag ändern', done: 'Fertig',
        unavailable: 'Aufladen ist gerade nicht verfügbar. Bitte später erneut versuchen.', invalid: 'Geben Sie einen Betrag zwischen {min} und {max} ein.',
        daily: 'Tageslimit erreicht. Wählen Sie einen kleineren Betrag oder versuchen Sie es morgen.', createFailed: 'Die Kasse konnte nicht geöffnet werden. Bitte erneut versuchen.',
        checkFailed: 'Zahlung noch nicht bestätigt. Wir prüfen weiter…', expired: 'Diese Kasse ist geschlossen. Falls Sie schon bezahlt haben, wird das Guthaben automatisch gutgeschrieben.',
        closed: 'Diese Aufladung wurde geschlossen. Starten Sie eine neue.', review: 'Ihre Zahlung wird geprüft. Das Guthaben wird nach der Bestätigung gutgeschrieben.',
        notifyTitle: 'Guthaben aufgeladen', notifyBody: '{amount} wurde Ihrem Guthaben hinzugefügt.', timeLeft: 'Verbleibende Zeit'
    },
    'pt-BR': {
        eyebrow: 'Saldo', title: 'Adicionar saldo', checkoutTitle: 'Concluir pagamento', close: 'Fechar', amount: 'Valor (USD)',
        methodsLabel: 'Forma de pagamento', methodCard: 'Cartão / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
        wechatHint: 'O Whop processa o WeChat Pay em RMB no pagamento; sua carteira recebe o valor exato em USD.',
        limits: 'Entre {min} e {max}', credit: 'Saldo adicionado', fee: 'Taxa de processamento', feeFree: 'Sem taxa', total: 'Total a pagar',
        payCny: 'Total em RMB (referência)',
        note: 'Pague com segurança pela Whop: cartões, WeChat Pay, AlipayHK, Apple Pay, Google Pay e mais.',
        noteFee: 'Seu saldo recebe o valor exato em USD; a taxa de processamento da Whop ({fee}) é paga pelo comprador.',
        cancel: 'Cancelar', submit: 'Recarregar', creating: 'Preparando o pagamento…',
        checkoutBody: 'O pagamento está aberto no navegador. Seu saldo é atualizado aqui assim que for confirmado.',
        checkoutBodyEmbedded: 'Conclua o pagamento abaixo. Seu saldo é atualizado automaticamente após a confirmação.',
        embedLoading: 'Carregando pagamento seguro…',
        embedFallbackError: 'Não foi possível carregar o checkout integrado. Abra a página de pagamento no navegador.',
        waiting: 'Aguardando pagamento', credited: 'Saldo adicionado', creditedBody: 'Seu saldo está atualizado.',
        reopen: 'Abrir pagamento de novo', openExternal: 'Abrir no navegador (Apple Pay)', check: 'Já paguei, verificar', restart: 'Alterar valor', done: 'Concluído',
        unavailable: 'A recarga está indisponível no momento. Tente mais tarde.', invalid: 'Informe um valor entre {min} e {max}.',
        daily: 'Você atingiu o limite de hoje. Tente um valor menor ou volte amanhã.', createFailed: 'Não foi possível abrir o pagamento. Tente novamente.',
        checkFailed: 'Pagamento ainda não confirmado. Continuamos verificando…', expired: 'Este pagamento foi encerrado. Se você já pagou, o saldo será adicionado automaticamente.',
        closed: 'Esta recarga foi encerrada. Comece outra.', review: 'Seu pagamento está em revisão. O saldo será adicionado após a confirmação.',
        notifyTitle: 'Saldo adicionado', notifyBody: '{amount} adicionado ao seu saldo.', timeLeft: 'Tempo restante'
    },
    ru: {
        eyebrow: 'Баланс', title: 'Пополнить баланс', checkoutTitle: 'Завершите оплату', close: 'Закрыть', amount: 'Сумма (USD)',
        methodsLabel: 'Способ оплаты', methodCard: 'Карта / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
        wechatHint: 'Whop проводит оплату WeChat Pay в юанях (RMB), но на баланс зачисляется ровно выбранная сумма в USD.',
        limits: 'От {min} до {max}', credit: 'Зачислится', fee: 'Комиссия за обработку', feeFree: 'Без комиссии', total: 'Итого к оплате',
        payCny: 'К оплате в юанях (ориентир)',
        note: 'Безопасная оплата через Whop: карты, WeChat Pay, AlipayHK, Apple Pay, Google Pay и другое.',
        noteFee: 'На баланс зачисляется точная выбранная сумма в USD; комиссия платёжного канала Whop ({fee}) оплачивается покупателем.',
        cancel: 'Отмена', submit: 'Пополнить', creating: 'Готовим форму оплаты…',
        checkoutBody: 'Оплата открыта в браузере. Баланс обновится здесь сразу после подтверждения.',
        checkoutBodyEmbedded: 'Завершите оплату ниже. Баланс обновится автоматически после подтверждения.',
        embedLoading: 'Загрузка защищённой кассы…',
        embedFallbackError: 'Не удалось загрузить встроенную форму оплаты. Откройте страницу оплаты в браузере.',
        waiting: 'Ожидаем оплату', credited: 'Баланс пополнен', creditedBody: 'Баланс обновлён.',
        reopen: 'Открыть оплату снова', openExternal: 'Открыть в браузере (Apple Pay)', check: 'Я оплатил, проверить', restart: 'Изменить сумму', done: 'Готово',
        unavailable: 'Пополнение временно недоступно. Попробуйте позже.', invalid: 'Введите сумму от {min} до {max}.',
        daily: 'Дневной лимит исчерпан. Уменьшите сумму или вернитесь завтра.', createFailed: 'Не удалось открыть оплату. Попробуйте снова.',
        checkFailed: 'Оплата ещё не подтверждена. Продолжаем проверять…', expired: 'Эта оплата закрыта. Если вы уже оплатили, баланс пополнится автоматически.',
        closed: 'Это пополнение закрыто. Начните новое.', review: 'Платёж на проверке. Баланс пополнится после подтверждения.',
        notifyTitle: 'Баланс пополнен', notifyBody: 'На баланс зачислено {amount}.', timeLeft: 'Осталось'
    },
    ar: {
        eyebrow: 'الرصيد', title: 'إضافة رصيد', checkoutTitle: 'أكمل الدفع', close: 'إغلاق', amount: 'المبلغ (USD)',
        methodsLabel: 'طريقة الدفع', methodCard: 'بطاقة / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
        wechatHint: 'تعالج Whop الدفع عبر WeChat Pay باليوان الصيني، بينما يُضاف إلى محفظتك المبلغ الكامل بالدولار الأمريكي.',
        limits: 'بين {min} و{max}', credit: 'الرصيد المضاف', fee: 'رسوم المعالجة', feeFree: 'بدون رسوم', total: 'الإجمالي المستحق',
        payCny: 'الإجمالي باليوان (مرجعي)',
        note: 'ادفع بأمان عبر Whop: البطاقات وWeChat Pay وAlipayHK وApple Pay وGoogle Pay وغيرها.',
        noteFee: 'يُضاف إلى رصيدك المبلغ الذي تختاره بالدولار كاملًا؛ يتحمل المشتري رسوم معالجة Whop ({fee}) الموضحة أعلاه.',
        cancel: 'إلغاء', submit: 'اشحن', creating: 'جارٍ تجهيز الدفع…',
        checkoutBody: 'صفحة الدفع مفتوحة في المتصفح. يُحدَّث رصيدك هنا فور تأكيد الدفع.',
        checkoutBodyEmbedded: 'أكمل الدفع أدناه. يُحدَّث رصيدك تلقائيًا فور التأكيد.',
        embedLoading: 'جارٍ تحميل بوابة الدفع الآمنة…',
        embedFallbackError: 'تعذّر تحميل نموذج الدفع المدمج. يمكنك فتح صفحة الدفع في المتصفح.',
        waiting: 'بانتظار الدفع', credited: 'أُضيف الرصيد', creditedBody: 'رصيدك محدَّث.',
        reopen: 'فتح صفحة الدفع مجددًا', openExternal: 'فتح في المتصفح (Apple Pay)', check: 'دفعت، تحقّق الآن', restart: 'تغيير المبلغ', done: 'تم',
        unavailable: 'الشحن غير متاح حاليًا. حاول لاحقًا.', invalid: 'أدخل مبلغًا بين {min} و{max}.',
        daily: 'بلغت حد الشحن اليومي. جرّب مبلغًا أقل أو عُد غدًا.', createFailed: 'تعذّر فتح صفحة الدفع. حاول مرة أخرى.',
        checkFailed: 'لم يُؤكَّد الدفع بعد. نواصل التحقق…', expired: 'أُغلقت صفحة الدفع هذه. إذا دفعت بالفعل فسيُضاف الرصيد تلقائيًا.',
        closed: 'أُغلقت عملية الشحن هذه. ابدأ عملية جديدة.', review: 'دفعتك قيد المراجعة. سيُضاف الرصيد بعد التأكيد.',
        notifyTitle: 'أُضيف الرصيد', notifyBody: 'أُضيف {amount} إلى رصيدك.', timeLeft: 'الوقت المتبقي'
    },
    hi: {
        eyebrow: 'बैलेंस', title: 'बैलेंस जोड़ें', checkoutTitle: 'भुगतान पूरा करें', close: 'बंद करें', amount: 'राशि (USD)',
        methodsLabel: 'भुगतान का तरीका', methodCard: 'कार्ड / Apple Pay', methodWechat: 'WeChat Pay', methodAlipayHk: 'AlipayHK',
        wechatHint: 'Whop चेकआउट पर WeChat Pay को RMB में प्रोसेस करता है; आपके वॉलेट में ऊपर चुनी गई पूरी USD राशि ही जुड़ती है।',
        limits: '{min} से {max} के बीच', credit: 'जुड़ने वाला बैलेंस', fee: 'प्रोसेसिंग शुल्क', feeFree: 'कोई शुल्क नहीं', total: 'कुल देय',
        payCny: 'RMB में कुल राशि (संदर्भ)',
        note: 'Whop से सुरक्षित भुगतान करें: कार्ड, WeChat Pay, AlipayHK, Apple Pay, Google Pay आदि।',
        noteFee: 'आपके बैलेंस में चुनी गई सटीक USD राशि जुड़ती है; Whop प्रोसेसिंग शुल्क ({fee}) भुगतानकर्ता द्वारा वहन किया जाता है।',
        cancel: 'रद्द करें', submit: 'टॉप अप करें', creating: 'चेकआउट तैयार हो रहा है…',
        checkoutBody: 'चेकआउट आपके ब्राउज़र में खुला है। भुगतान की पुष्टि होते ही यहाँ बैलेंस अपडेट होगा।',
        checkoutBodyEmbedded: 'नीचे भुगतान पूरा करें। पुष्टि होते ही आपका बैलेंस अपने आप अपडेट होगा।',
        embedLoading: 'सुरक्षित चेकआउट लोड हो रहा है…',
        embedFallbackError: 'एम्बेडेड चेकआउट लोड नहीं हो सका। आप ब्राउज़र में भुगतान पृष्ठ खोल सकते हैं।',
        waiting: 'भुगतान की प्रतीक्षा', credited: 'बैलेंस जुड़ गया', creditedBody: 'आपका बैलेंस अपडेट है।',
        reopen: 'चेकआउट फिर खोलें', openExternal: 'ब्राउज़र में खोलें (Apple Pay)', check: 'भुगतान कर दिया, अभी जाँचें', restart: 'राशि बदलें', done: 'हो गया',
        unavailable: 'टॉप-अप अभी उपलब्ध नहीं है। बाद में कोशिश करें।', invalid: '{min} से {max} के बीच राशि डालें।',
        daily: 'आज की टॉप-अप सीमा पूरी हो गई। कम राशि आज़माएँ या कल आएँ।', createFailed: 'चेकआउट नहीं खुल सका। फिर से कोशिश करें।',
        checkFailed: 'भुगतान की पुष्टि अभी नहीं हुई। जाँच जारी है…', expired: 'यह चेकआउट बंद हो गया है। अगर आपने भुगतान कर दिया है, तो बैलेंस अपने आप जुड़ जाएगा।',
        closed: 'यह टॉप-अप बंद हो गया। नया शुरू करें।', review: 'आपके भुगतान की समीक्षा हो रही है। पुष्टि के बाद बैलेंस जुड़ जाएगा।',
        notifyTitle: 'बैलेंस जुड़ गया', notifyBody: '{amount} आपके बैलेंस में जोड़ा गया।', timeLeft: 'शेष समय'
    }
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

export function formatWalletTopupFeeSchedule(fee: PlatformWalletTopupOptions['fee']): string {
    const bps = Number.isFinite(fee.bps) && fee.bps > 0 ? Math.trunc(fee.bps) : 0;
    const fixedMinor = Number.isFinite(fee.fixedMinor) && fee.fixedMinor > 0 ? Math.trunc(fee.fixedMinor) : 0;
    const parts: string[] = [];
    if (bps > 0) parts.push(`${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`);
    if (fixedMinor > 0) parts.push(`$${(fixedMinor / 100).toFixed(2)}`);
    return parts.join(' + ');
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
    if (code === 'topup_expired') return walletTopupText(locale, 'expired');
    if (code === 'topup_not_payable') return walletTopupText(locale, 'closed');
    return walletTopupText(locale, stage === 'create' ? 'createFailed' : 'checkFailed');
}

function formatUsd(locale: NextMuxDesktopLocale, minor: number, fractionDigits = 2): string {
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(minor / 100);
    } catch {
        return `$${(minor / 100).toFixed(fractionDigits)}`;
    }
}

function formatCheckoutAmountLabel(locale: NextMuxDesktopLocale, minor: number): string {
    const formatted = formatUsd(locale, minor, 2).replace(BIDI_MARKS_RE, '').trim();
    if (AMOUNT_LABEL_RE.test(formatted)) return formatted;
    return `$${(minor / 100).toFixed(2)}`;
}

function formatRmbReference(minor: number): string {
    return `${(minor / 100).toFixed(2)} RMB`;
}

export function walletTopupRangeText(locale: NextMuxDesktopLocale, options?: PlatformWalletTopupOptions): string {
    return walletTopupText(locale, 'invalid', { min: formatUsd(locale, options?.minimumMinor ?? 1_000, 0), max: formatUsd(locale, options?.maximumMinor ?? 100_000, 0) });
}

function CardBrandIcon(): React.ReactElement {
    return <svg viewBox='0 0 24 16' width='20' height='14' className='nmx-topup-icon-card' aria-hidden='true'>
        <circle cx='9' cy='8' r='6' fill='#EB001B' />
        <circle cx='15' cy='8' r='6' fill='#F79E1B' />
        <path d='M12 2.8a6 6 0 0 1 0 10.39 6 6 0 0 1 0-10.39Z' fill='#FF5F00' />
    </svg>;
}

function AppleMarkIcon(): React.ReactElement {
    return <svg viewBox='0 0 16 18' width='13' height='14' className='nmx-topup-icon-apple' fill='currentColor' aria-hidden='true'>
        <path d='M12.97 9.57c-.02-2.06 1.68-3.05 1.76-3.1-.96-1.4-2.46-1.6-2.99-1.62-1.26-.13-2.48.75-3.12.75-.65 0-1.63-.73-2.69-.71-1.37.02-2.64.81-3.34 2.04-1.44 2.49-.37 6.17 1.02 8.19.69.99 1.5 2.09 2.57 2.05 1.04-.04 1.43-.66 2.68-.66 1.25 0 1.6.66 2.69.64 1.12-.02 1.82-.99 2.5-1.99.8-1.15 1.12-2.27 1.14-2.33-.03-.01-2.2-.84-2.22-3.26ZM10.92 3.51c.56-.69.95-1.63.84-2.59-.82.03-1.83.55-2.41 1.22-.52.6-.98 1.57-.86 2.5.91.07 1.86-.45 2.43-1.13Z' />
    </svg>;
}

function WechatPayMarkIcon(): React.ReactElement {
    return <svg viewBox='0 0 18 18' width='15' height='15' className='nmx-topup-icon-wechat' aria-hidden='true'>
        <rect width='18' height='18' rx='4' fill='#07C160' />
        <path d='M9 4.2c-2.76 0-5 1.86-5 4.15 0 1.24.66 2.35 1.72 3.11l-.44 1.64 1.83-.96c.59.17 1.23.26 1.89.26 2.76 0 5-1.86 5-4.15S11.76 4.2 9 4.2Z' fill='#FFFFFF' />
        <path d='M6.9 8.35 8.4 9.7l2.9-2.75' fill='none' stroke='#07C160' strokeWidth='1.35' strokeLinecap='round' strokeLinejoin='round' />
    </svg>;
}

function AlipayMarkIcon(): React.ReactElement {
    return <svg viewBox='0 0 18 18' width='15' height='15' className='nmx-topup-icon-alipay' aria-hidden='true'>
        <rect width='18' height='18' rx='4' fill='#1677FF' />
        <path d='M4.5 6.3h9M9 3.8v4.5M5.4 8.3h7.2c-.35 2.15-1.58 3.9-3.6 4.95-1.35.7-2.85.85-3.65.45-.8-.4-1.05-1.35-.4-2.1.7-.8 2.15-1.15 4.15-.65 1.85.46 3.45 1.45 4.75 2.55' fill='none' stroke='#FFFFFF' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
    </svg>;
}

const PAYMENT_METHODS: readonly { readonly id: WalletTopupPaymentMethod; readonly labelKey: TopupTextKey }[] = [
    { id: 'card', labelKey: 'methodCard' },
    { id: 'wechat_pay', labelKey: 'methodWechat' },
    { id: 'alipayhk', labelKey: 'methodAlipayHk' }
];

export interface WalletTopupSheetProps {
    readonly locale: NextMuxDesktopLocale;
    readonly stage: WalletTopupStage;
    readonly amount: string;
    readonly paymentMethod?: WalletTopupPaymentMethod;
    /** @deprecated Legacy prop fallback mapped to paymentMethod. */
    readonly rail?: WalletTopupRail;
    readonly theme?: 'light' | 'dark';
    readonly platformOrigin?: string;
    readonly options?: PlatformWalletTopupOptions;
    readonly order?: PlatformWalletTopupOrder;
    readonly error: string;
    readonly now: number;
    readonly formatMicros: (currency: string, micros: number) => string;
    readonly onAmountChange: (value: string) => void;
    readonly onPaymentMethodChange?: (paymentMethod: WalletTopupPaymentMethod) => void;
    /** @deprecated Legacy callback invoked when onPaymentMethodChange is absent. */
    readonly onRailChange?: (rail: WalletTopupRail) => void;
    readonly onConfirmToken?: (orderId: string, confirmationToken: string, returnUrl?: string) => Promise<PlatformWalletTopupConfirmResult>;
    readonly onSubmit: () => void;
    readonly onClose: () => void;
    readonly onOpenCheckout: () => void;
    readonly onCheck: () => void;
    readonly onRestart: () => void;
    readonly onDone: () => void;
}

interface NextMuxCheckoutEmbedProps {
    readonly embedUrl: string;
    readonly expectedOrigin: string;
    readonly orderId: string;
    readonly paymentMethod: WalletTopupPaymentMethod;
    readonly defaultReturnUrl?: string;
    readonly loadingText: string;
    readonly errorFallbackText: string;
    readonly iframeTitle: string;
    readonly onComplete: () => void;
    readonly onConfirmToken?: (orderId: string, confirmationToken: string, returnUrl?: string) => Promise<PlatformWalletTopupConfirmResult>;
}

function NextMuxCheckoutEmbed(props: NextMuxCheckoutEmbedProps): React.ReactElement {
    const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
    const onCompleteRef = React.useRef(props.onComplete);
    onCompleteRef.current = props.onComplete;
    const onConfirmTokenRef = React.useRef(props.onConfirmToken);
    onConfirmTokenRef.current = props.onConfirmToken;

    const initialHeight = props.paymentMethod === 'card' ? 380 : 240;
    const [height, setHeight] = React.useState(initialHeight);
    const [loaded, setLoaded] = React.useState(false);
    const [embedError, setEmbedError] = React.useState('');

    React.useEffect(() => {
        setHeight(props.paymentMethod === 'card' ? 380 : 240);
        setLoaded(false);
        setEmbedError('');
    }, [props.embedUrl, props.orderId, props.paymentMethod]);

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        let cancelled = false;
        const handler = createCheckoutEmbedMessageHandler({
            getFrame: () => iframeRef.current?.contentWindow,
            expectedOrigin: props.expectedOrigin,
            expectedOrderId: props.orderId,
            defaultReturnUrl: props.defaultReturnUrl,
            isCancelled: () => cancelled,
            onReady: () => {
                if (cancelled) return;
                setLoaded(true);
                setEmbedError('');
            },
            onResize: (nextHeight) => {
                if (cancelled) return;
                setHeight(nextHeight);
                setLoaded(true);
            },
            onComplete: () => {
                if (cancelled) return;
                onCompleteRef.current();
            },
            onError: (err) => {
                if (cancelled) return;
                setLoaded(true);
                // The page reports Whop's raw, untranslated error (it shows its own localized retry card in the frame);
                // the buyer gets this sheet's sentence pointing at the browser fallback, the raw text stays in the log.
                console.warn('[nextmux] embedded checkout error', err.code || '', err.message);
                setEmbedError(props.errorFallbackText);
            },
            onConfirmToken: async (orderId, confirmationToken, returnUrl) => {
                const fn = onConfirmTokenRef.current;
                if (!fn) {
                    return {
                        ok: false,
                        code: 'payment_provider_unavailable',
                        message: 'Payment confirmation is unavailable',
                        httpStatus: 0
                    };
                }
                return fn(orderId, confirmationToken, returnUrl);
            }
        });
        const onMessage = (event: MessageEvent): void => {
            void handler(event);
        };
        window.addEventListener('message', onMessage);
        return () => {
            cancelled = true;
            window.removeEventListener('message', onMessage);
        };
    }, [props.expectedOrigin, props.orderId, props.defaultReturnUrl, props.errorFallbackText]);

    return <div className='nmx-topup-embed-shell'>
        {!loaded && <div className='nmx-topup-embed-loading'><span>{props.loadingText}</span></div>}
        {embedError && <div className='nmx-topup-embed-error' role='alert'><i className='codicon codicon-warning'></i><span>{embedError}</span></div>}
        <iframe
            key={props.embedUrl}
            ref={iframeRef}
            className='nmx-topup-embed-frame'
            title={props.iframeTitle}
            src={props.embedUrl}
            style={{ height }}
            sandbox='allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-downloads'
            allow='payment; paymentRequest;'
            onLoad={() => setLoaded(true)}
        />
    </div>;
}

export function WalletTopupSheet(props: WalletTopupSheetProps): React.ReactElement {
    const { locale, stage, order, options } = props;
    const text = (key: TopupTextKey, values?: Record<string, string>) => walletTopupText(locale, key, values);
    const busy = stage === 'creating';
    const paymentMethod: WalletTopupPaymentMethod =
        props.paymentMethod === 'wechat_pay' || props.paymentMethod === 'alipayhk' || props.paymentMethod === 'card'
            ? props.paymentMethod
            : (props.rail === 'cny' ? 'wechat_pay' : 'card');
    const selectPaymentMethod = (next: WalletTopupPaymentMethod): void => {
        if (props.onPaymentMethodChange) props.onPaymentMethodChange(next);
        else props.onRailChange?.(next === 'wechat_pay' ? 'cny' : 'usd');
    };
    const theme = props.theme === 'light' ? 'light' : 'dark';
    const amountMinor = walletTopupAmountMinor(props.amount);
    const inRange = amountMinor !== undefined && (!options || (amountMinor >= options.minimumMinor && amountMinor <= options.maximumMinor));
    const effectiveFee = options?.fee ?? DEFAULT_WHOP_TOPUP_FEE;
    const feeSchedule = formatWalletTopupFeeSchedule(effectiveFee);
    const quote = amountMinor !== undefined && inRange ? walletTopupCharge(amountMinor, effectiveFee) : undefined;
    const cnyPerUsdMinor = options?.checkout?.cnyPerUsdMinor ?? options?.checkout?.perUsdMinor;
    const cnyReferenceMinor = paymentMethod === 'wechat_pay' && quote && typeof cnyPerUsdMinor === 'number' && Number.isSafeInteger(cnyPerUsdMinor) && cnyPerUsdMinor > 0
        ? Math.ceil((quote.chargeMinor * cnyPerUsdMinor) / 100)
        : undefined;
    const presets = options?.presetsMinor.length ? options.presetsMinor : [1_000, 2_000, 5_000, 10_000, 20_000, 50_000];
    const unavailable = options !== undefined && !options.available;
    const remainingSeconds = order ? Math.max(0, Math.ceil((order.topup.expiresAt - props.now) / 1000)) : 0;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    const orderPaymentMethod: WalletTopupPaymentMethod = order?.payment.paymentMethod
        ?? (order?.payment.checkoutCurrency === 'CNY' ? 'wechat_pay' : paymentMethod);
    const embedOrigin = resolveCheckoutPlatformOrigin(props.platformOrigin, order?.payment.checkoutUrl);
    const embedUrl = order && stage === 'waiting'
        ? buildCheckoutEmbedUrl({
            platformOrigin: embedOrigin,
            fallbackCheckoutUrl: order.payment.checkoutUrl,
            orderId: order.topup.id,
            planId: order.payment.planId,
            whopAccountId: order.payment.whopAccountId,
            paymentMethod: orderPaymentMethod,
            amountLabel: formatCheckoutAmountLabel(locale, order.payment.payableAmount.minor),
            checkoutId: order.payment.checkoutId,
            checkoutCountry: order.payment.checkoutCountry,
            prefillEmail: order.payment.prefillEmail,
            theme,
            locale
        })
        : undefined;
    const hasEmbeddedTarget = Boolean(embedUrl);
    const defaultReturnUrl = order ? buildCheckoutReturnUrl(embedOrigin, order.topup.id) : undefined;
    const orderIsCny = Boolean(
        order && order.payment.checkoutCharge?.currency === 'CNY' && (orderPaymentMethod === 'wechat_pay' || order.payment.checkoutCurrency === 'CNY')
    );

    const summary = (credit: string, fee: string, total: string, feeRate?: string, cnyRef?: string) => <dl className='nmx-topup-summary'>
        <div><dt>{text('credit')}</dt><dd>{credit}</dd></div>
        <div>
            <dt>{text('fee')}{feeRate ? <span className='nmx-topup-fee-rate'> ({feeRate})</span> : undefined}</dt>
            <dd>{fee}</dd>
        </div>
        <div className='is-total'><dt>{text('total')}</dt><dd>{total}</dd></div>
        {cnyRef && <div className='is-reference'><dt>{text('payCny')}</dt><dd>{cnyRef}</dd></div>}
    </dl>;

    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop nmx-topup-backdrop' onMouseDown={() => { if (!busy) props.onClose(); }}>
        <section className={`nmx-topup-sheet${hasEmbeddedTarget ? ' is-embedded' : ''}`} role='dialog' aria-modal='true' aria-labelledby='nmx-topup-title' onMouseDown={event => event.stopPropagation()}>
            <header><div><h2 id='nmx-topup-title'>{order ? text(stage === 'credited' ? 'credited' : 'checkoutTitle') : text('title')}</h2></div><button aria-label={text('close')} disabled={busy} onClick={props.onClose}><i className='codicon codicon-close'></i></button></header>
            {!order && <form onSubmit={event => { event.preventDefault(); props.onSubmit(); }}>
                <label htmlFor='nmx-topup-amount'>{text('amount')}</label>
                <div className='nmx-topup-amount-field'><span>$</span><input id='nmx-topup-amount' className='nmx-topup-amount-input' name='amount' inputMode='decimal' autoComplete='off' dir='ltr' value={props.amount} aria-describedby='nmx-topup-amount-help' aria-invalid={props.amount !== '' && !inRange} onChange={event => props.onAmountChange(event.currentTarget.value.replace(/[^0-9.,]/g, '').slice(0, 9))} /></div>
                <div className='nmx-topup-presets'>{presets.map(value => <button type='button' key={value} aria-pressed={amountMinor === value} onClick={() => props.onAmountChange(String(value / 100))}>{formatUsd(locale, value, 0)}</button>)}</div>
                <p id='nmx-topup-amount-help' className='nmx-topup-limits'>{text('limits', { min: formatUsd(locale, options?.minimumMinor ?? 1_000, 0), max: formatUsd(locale, options?.maximumMinor ?? 100_000, 0) })}</p>
                <div className='nmx-topup-method-section'>
                    <span id='nmx-topup-methods-label' className='nmx-topup-method-label'>{text('methodsLabel')}</span>
                    <div className='nmx-topup-method-group' role='radiogroup' aria-labelledby='nmx-topup-methods-label'>
                        {PAYMENT_METHODS.map(({ id, labelKey }) => {
                            const active = paymentMethod === id;
                            return <button
                                key={id}
                                type='button'
                                role='radio'
                                aria-checked={active}
                                data-payment-method={id}
                                className={`nmx-topup-method-btn${active ? ' is-active' : ''}`}
                                onClick={() => selectPaymentMethod(id)}
                            >
                                <span className='nmx-topup-method-icons'>
                                    {id === 'card' ? <><CardBrandIcon /><AppleMarkIcon /></>
                                        : id === 'wechat_pay' ? <WechatPayMarkIcon />
                                            : <AlipayMarkIcon />}
                                </span>
                                <span className='nmx-topup-method-text'>{text(labelKey)}</span>
                            </button>;
                        })}
                    </div>
                    {paymentMethod === 'wechat_pay' && <p className='nmx-topup-method-hint'>{text('wechatHint')}</p>}
                </div>
                {summary(
                    quote ? formatUsd(locale, quote.creditMinor) : '—',
                    quote ? (quote.feeMinor === 0 ? text('feeFree') : formatUsd(locale, quote.feeMinor)) : '—',
                    quote ? formatUsd(locale, quote.chargeMinor) : '—',
                    feeSchedule || undefined,
                    cnyReferenceMinor !== undefined ? formatRmbReference(cnyReferenceMinor) : undefined
                )}
                <p className='nmx-topup-note'><i className='codicon codicon-lock'></i><span>{feeSchedule ? text('noteFee', { fee: feeSchedule }) : text('note')}</span></p>
                {(props.error || unavailable) && <div className='nmx-topup-error' role='alert'><i className='codicon codicon-warning'></i><span>{props.error || text('unavailable')}</span></div>}
                <footer><button type='button' disabled={busy} onClick={props.onClose}>{text('cancel')}</button><button type='submit' className='is-primary' disabled={busy || unavailable || !quote}>{busy ? text('creating') : text('submit')}</button></footer>
            </form>}
            {order && <div className={`nmx-topup-payment nmx-topup-checkout is-${stage}${hasEmbeddedTarget ? ' is-embedded' : ''}`}>
                {!hasEmbeddedTarget && <div className='nmx-topup-checkout-mark' aria-hidden='true'><i className={`codicon ${stage === 'credited' ? 'codicon-pass-filled' : 'codicon-credit-card'}`}></i></div>}
                <div className='nmx-topup-payment-copy'>
                    <span>{stage === 'credited' ? text('creditedBody') : hasEmbeddedTarget ? text('checkoutBodyEmbedded') : text('checkoutBody')}</span>
                    <strong>{stage === 'credited' ? `+${props.formatMicros(order.payment.creditAmount.currency, order.payment.creditAmount.micros)}` : formatUsd(locale, order.payment.payableAmount.minor)}</strong>
                    {stage !== 'credited' && summary(
                        props.formatMicros(order.payment.creditAmount.currency, order.payment.creditAmount.micros),
                        (order.payment.feeAmount?.minor ?? 0) === 0 ? text('feeFree') : formatUsd(locale, order.payment.feeAmount?.minor ?? 0),
                        formatUsd(locale, order.payment.payableAmount.minor),
                        (order.payment.feeAmount?.minor ?? 0) > 0 && feeSchedule ? feeSchedule : undefined,
                        orderIsCny && order.payment.checkoutCharge ? formatRmbReference(order.payment.checkoutCharge.minor) : undefined
                    )}
                    {embedUrl && <NextMuxCheckoutEmbed
                        embedUrl={embedUrl}
                        expectedOrigin={embedOrigin}
                        orderId={order.topup.id}
                        paymentMethod={orderPaymentMethod}
                        defaultReturnUrl={defaultReturnUrl}
                        loadingText={text('embedLoading')}
                        errorFallbackText={text('embedFallbackError')}
                        iframeTitle={text('checkoutTitle')}
                        onComplete={props.onCheck}
                        onConfirmToken={props.onConfirmToken}
                    />}
                    {stage === 'credited' ? <div className='nmx-topup-success'><i className='codicon codicon-pass-filled'></i><span>{text('credited')}</span></div>
                        : stage === 'waiting' ? <div className='nmx-topup-waiting'><i></i><span>{text('waiting')}</span><time aria-label={text('timeLeft')}>{minutes}:{String(seconds).padStart(2, '0')}</time></div> : undefined}
                </div>
                {props.error && <div className='nmx-topup-error' role='alert'><i className='codicon codicon-warning'></i><span>{props.error}</span></div>}
                <footer>
                    {stage === 'credited' ? <button className='is-primary' onClick={props.onDone}>{text('done')}</button>
                        : <><button onClick={props.onRestart}>{text('restart')}</button>
                            {order.payment.checkoutUrl && stage === 'waiting' && <button onClick={props.onOpenCheckout}>{text(hasEmbeddedTarget ? 'openExternal' : 'reopen')}</button>}
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
