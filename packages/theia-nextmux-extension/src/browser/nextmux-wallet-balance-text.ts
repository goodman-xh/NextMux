import type { NextMuxDesktopLocale } from './nextmux-locale';
import { totalCopy } from './nextmux-copy-fallback';

const keys = ['balance', 'available', 'reserved', 'debt', 'lowTitle', 'lowBody'] as const;
type Key = typeof keys[number];
const copy: Record<NextMuxDesktopLocale, readonly string[]> = {
    'zh-CN': ['账户余额', '可用金额', '预留金额', '消费欠款', '余额较低', '{currency} 账户余额不足 1.00，请及时充值。'],
    'zh-TW': ['帳戶餘額', '可用金額', '預留金額', '消費欠款', '餘額偏低', '{currency} 帳戶餘額不足 1.00，請及時儲值。'],
    en: ['Account balance', 'Available funds', 'Reserved funds', 'Usage debt', 'Low balance', 'Your {currency} account balance is below 1.00. Please top up.'],
    ja: ['アカウント残高', '利用可能額', '予約済み金額', '利用料金の未払額', '残高不足', '{currency} の残高が 1.00 未満です。チャージしてください。'],
    ko: ['계정 잔액', '사용 가능 금액', '예약 금액', '사용 요금 미납액', '잔액 부족', '{currency} 계정 잔액이 1.00 미만입니다. 충전해 주세요.'],
    es: ['Saldo de la cuenta', 'Fondos disponibles', 'Fondos reservados', 'Deuda por uso', 'Saldo bajo', 'El saldo de tu cuenta en {currency} es inferior a 1,00. Recarga tu saldo.'],
    fr: ['Solde du compte', 'Fonds disponibles', 'Fonds réservés', 'Dette liée à l’utilisation', 'Solde faible', 'Le solde du compte en {currency} est inférieur à 1,00. Veuillez le recharger.'],
    de: ['Kontostand', 'Verfügbares Guthaben', 'Reserviertes Guthaben', 'Offene Nutzungskosten', 'Niedriger Kontostand', 'Ihr Kontostand in {currency} liegt unter 1,00. Bitte laden Sie Guthaben auf.'],
    'pt-BR': ['Saldo da conta', 'Saldo disponível', 'Saldo reservado', 'Débito por uso', 'Saldo baixo', 'O saldo da sua conta em {currency} está abaixo de 1,00. Faça uma recarga.'],
    ru: ['Баланс счёта', 'Доступные средства', 'Зарезервированные средства', 'Задолженность за использование', 'Низкий баланс', 'Баланс счёта в {currency} ниже 1,00. Пополните счёт.'],
    ar: ['رصيد الحساب', 'الأموال المتاحة', 'الأموال المحجوزة', 'دين الاستخدام', 'رصيد منخفض', 'رصيد حسابك بعملة {currency} أقل من 1.00. يُرجى شحن الرصيد.'],
    hi: ['खाते की शेष राशि', 'उपलब्ध राशि', 'आरक्षित राशि', 'उपयोग का बकाया', 'कम शेष राशि', 'आपके {currency} खाते की शेष राशि 1.00 से कम है। कृपया राशि जोड़ें।']
};

export function walletBalanceText(locale: NextMuxDesktopLocale, key: Key): string {
    return totalCopy(locale, key, language => copy[language][keys.indexOf(key)]);
}
