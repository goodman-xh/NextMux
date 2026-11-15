import { classifyModelError } from '@nextmux/model-runtime/errors';
import type { NextMuxDesktopLocale } from './nextmux-locale';

/** Who served the failed request: the NextMux relay (billed from the wallet), the person's own API key, or a local model. */
export type BillingFailureSource = 'relay' | 'own_api' | 'local';

const WALLET_CODES: ReadonlySet<string> = new Set(['wallet_balance_insufficient', 'nextmux_balance_insufficient']);
const BALANCE_WORDS = /insufficient\s+balance|余额不足|余额不够|잔액이 부족|saldo insuficiente/i;

function shortfallRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] {
    const records: Readonly<Record<string, unknown>>[] = [];
    const push = (item: unknown): void => {
        if (item instanceof Error) item = { ...item, message: item.message, name: item.name };
        if (item && typeof item === 'object' && !Array.isArray(item) && !records.includes(item as Record<string, unknown>)) records.push(item as Record<string, unknown>);
    };
    push(value);
    for (let index = 0; index < records.length && index < 16; index++) {
        for (const key of ['error', 'failure', 'details', 'cause', 'data', 'readableError']) push(records[index][key]);
    }
    return records;
}

/**
 * Which account ran out, if any: the one rule behind every wallet notice, 立即充值 button, balance fuse and paused goal.
 *
 * The NextMux wallet on NextMux's own word: its codes (wallet_balance_insufficient, nextmux_balance_insufficient), the
 * desktop's media budget refusal, a message naming NextMux, the gateway's bare insufficient_balance (unless the request
 * went to the person's own key), or wallet / top-up wording on the NextMux relay with a 402 or no HTTP status (under a 429
 * or another status it is the upstream provider's message). On the person's own API key every other 402 or quota refusal is that
 * provider's balance (model-runtime's provider_quota_exhausted, e.g. DeepSeek's "Insufficient Balance"), which no NextMux
 * top-up fixes. Untyped failures off an own key read as they always did, so the wallet's own behaviour is unchanged.
 * The failure's own recorded source comes first: it is stamped where the request was made (model-runtime's direct
 * clients mark the person's own key or a local model), while the caller's `source` is the route of the whole turn, which
 * a council run's own-key slot under a relay lead does not share. `source` fills in when the failure names none.
 */
export function billingShortfall(value: unknown, source?: BillingFailureSource): 'wallet' | 'provider' | undefined {
    if (!value) return undefined;
    const records = shortfallRecords(value);
    const codes = records.map(record => typeof record.code === 'string' ? record.code.trim().toLowerCase() : '').filter(Boolean);
    if (codes.some(code => WALLET_CODES.has(code)) || records.some(record => record.mediaBudgetShortfall === true)) return 'wallet';
    const classified = classifyModelError(value, source ? { source } : {});
    if (classified.kind === 'balance_insufficient') return 'wallet';
    const route = classified.source ?? source;
    const text = [classified.detail, typeof value === 'string' ? value : '',
        ...records.flatMap(record => ['message', 'detail', 'upstreamMessage'].map(key => typeof record[key] === 'string' ? record[key] as string : ''))]
        .join(' ').replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gi, '');
    const ownKey = route === 'own_api' || route === 'local';
    if (classified.kind === 'provider_quota_exhausted') {
        // The relay answers a wallet shortfall with 402 (or with no status, in older shapes): wallet words under any other
        // status (an upstream 429 "insufficient_quota … please top up") are the provider's own message.
        const statuses = [classified.httpStatus, ...records.flatMap(record => ['httpStatus', 'statusCode', 'status'].map(key => Number(record[key])))]
            .filter((status): status is number => Number.isInteger(status) && status! >= 400 && status! <= 599);
        const relayWords = !statuses.length || statuses.includes(402);
        // insufficient_balance is the NextMux gateway's own bare code: the wallet unless the request went to the person's key.
        if (/nextmux/i.test(text) || !ownKey && codes.includes('insufficient_balance')
            // Shortfall words only: NextMux's own advice for a provider's quota ("请检查服务商余额…") must not read as the wallet.
            || route === 'relay' && relayWords && /wallet|top[\s-]*up|充值|儲值|钱包|錢包|余额不足|餘額不足|余额不够/i.test(text)) return 'wallet';
        return 'provider';
    }
    if (classified.kind !== 'unknown') return undefined;
    // Untyped shapes (older persisted turns, plain errors): a 402, the bare code, the old run kind or balance wording.
    const status402 = classified.httpStatus === 402 || records.some(record => Number(record.status ?? record.httpStatus) === 402);
    const legacyKind = records.some(record => typeof record.kind === 'string' && record.kind.trim().toLowerCase() === 'insufficient_balance');
    if (!status402 && !legacyKind && !codes.includes('insufficient_balance') && !BALANCE_WORDS.test(text)) return undefined;
    return ownKey && !/nextmux/i.test(text) ? 'provider' : 'wallet';
}

/** The NextMux wallet ran out (see billingShortfall): the only case that shows the wallet notice and its top-up button. */
export function isInsufficientBalanceFailure(value: unknown, source?: BillingFailureSource): boolean {
    return billingShortfall(value, source) === 'wallet';
}

/** As Continue words a provider's 402 ("Your {provider} account appears to be out of credits"): whose account, what to do. */
const PROVIDER_QUOTA_TEXT: Readonly<Record<NextMuxDesktopLocale, string>> = {
    'zh-CN': '{provider} 账户的余额或额度已用完。请到 {provider} 充值或检查账户限额后再试。',
    'zh-TW': '{provider} 帳戶的餘額或額度已用完。請到 {provider} 儲值或檢查帳戶限額後再試。',
    en: 'Your {provider} account is out of credits or quota. Add credits or check your limits with {provider}, then try again.',
    ja: '{provider} アカウントの残高または利用枠が足りません。{provider} でチャージするか利用上限を確認してから、もう一度お試しください。',
    ko: '{provider} 계정의 잔액 또는 사용 한도가 소진되었습니다. {provider}에서 충전하거나 한도를 확인한 뒤 다시 시도하세요.',
    es: 'Tu cuenta de {provider} se quedó sin saldo o cuota. Recarga o revisa tus límites en {provider} y vuelve a intentarlo.',
    fr: 'Votre compte {provider} n’a plus de crédit ou de quota. Rechargez-le ou vérifiez vos limites chez {provider}, puis réessayez.',
    de: 'Ihr {provider}-Konto hat kein Guthaben oder Kontingent mehr. Laden Sie bei {provider} auf oder prüfen Sie Ihre Limits und versuchen Sie es erneut.',
    'pt-BR': 'Sua conta {provider} ficou sem saldo ou cota. Recarregue ou verifique seus limites em {provider} e tente novamente.',
    ru: 'На счёте {provider} закончились средства или квота. Пополните счёт или проверьте лимиты в {provider} и повторите попытку.',
    ar: 'نفد رصيد حسابك لدى {provider} أو حصته. اشحن الرصيد أو تحقّق من حدودك لدى {provider} ثم حاول مرة أخرى.',
    hi: 'आपके {provider} खाते का बैलेंस या कोटा खत्म हो गया है। {provider} पर रिचार्ज करें या अपनी सीमाएँ जाँचें, फिर दोबारा कोशिश करें।'
};

/** The provider's own balance ran out on the person's key: which provider, in the reader's language, without wallet words. */
export function providerQuotaText(locale: NextMuxDesktopLocale, provider: string): string {
    return (PROVIDER_QUOTA_TEXT[locale] || PROVIDER_QUOTA_TEXT.en).replace(/\{provider\}/g, () => provider);
}
