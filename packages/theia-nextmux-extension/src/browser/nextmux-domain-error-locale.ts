import validationTranslations from './nextmux-validation-domain-translations.json';
import scheduleTranslations from './nextmux-schedule-domain-translations.json';
import { redactModelErrorDetail } from '@nextmux/model-runtime/errors';
import { domainMessageFromError, type DomainMessage } from '../common/nextmux-domain-errors';
import { desktopStatus } from '../common/nextmux-desktop-status';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { desktopStatusMessage } from './nextmux-desktop-status-locale';
import { skillDomainMessage } from './nextmux-skill-domain-locale';
import { conversationDomainMessage } from './nextmux-conversation-domain-locale';
import { componentDomainMessage } from './nextmux-component-domain-locale';

/** Only stable domain identities choose copy. User prose and raw diagnostics are not templates. */
export function desktopDomainMessage(locale: NextMuxDesktopLocale, message: DomainMessage): string {
    return translated(locale, message) ?? desktopStatusMessage(locale, desktopStatus('DESKTOP_OPERATION_FAILED'))!;
}

function translated(locale: NextMuxDesktopLocale, message: DomainMessage): string | undefined {
    const schedule = Object.prototype.hasOwnProperty.call(scheduleTranslations, message.code)
        ? scheduleTranslations[message.code as keyof typeof scheduleTranslations][locale] : undefined;
    const validation = Object.prototype.hasOwnProperty.call(validationTranslations, message.code)
        ? validationTranslations[message.code as keyof typeof validationTranslations][locale] : undefined;
    const text = validation ?? schedule ?? desktopStatusMessage(locale, message) ?? skillDomainMessage(locale, message)
        ?? conversationDomainMessage(locale, message) ?? componentDomainMessage(locale, message);
    return text && [...text.matchAll(/\{(\w+)\}/g)].some(match => !Object.prototype.hasOwnProperty.call(message.params || {}, match[1]))
        ? desktopStatusMessage(locale, desktopStatus('DESKTOP_OPERATION_FAILED')) : text;
}

export function knownDesktopDomainText(locale: NextMuxDesktopLocale, value: unknown): string | undefined {
    const message = domainMessageFromError(value);
    if (message) return desktopDomainMessage(locale, message);
    // Older RPC senders may retain only the top-level code. Unknown messages never select a translation.
    const record = value && typeof value === 'object' ? value as { code?: unknown } : undefined;
    return typeof record?.code === 'string' ? translated(locale, { code: record.code, fallbackEnglish: '' }) : undefined;
}

export function desktopDomainFailure(locale: NextMuxDesktopLocale, value: unknown): { text: string; detail: string; code?: string } {
    const message = domainMessageFromError(value);
    const record = value && typeof value === 'object' ? value as { message?: unknown; code?: unknown } : undefined;
    const raw = message?.technicalDetails || (typeof record?.message === 'string' ? record.message : typeof value === 'string' ? value : '');
    return {
        text: knownDesktopDomainText(locale, value) ?? desktopDomainMessage(locale, desktopStatus('DESKTOP_OPERATION_FAILED')),
        detail: redactModelErrorDetail(raw),
        code: message?.code || (typeof record?.code === 'string' ? record.code : undefined)
    };
}

export function desktopDomainErrorText(locale: NextMuxDesktopLocale, value: unknown): string {
    return desktopDomainFailure(locale, value).text;
}

export function officialCredentialHint(locale: NextMuxDesktopLocale, connection: {
    readonly providerId?: string; readonly credentialSource?: string;
    readonly providerSettings?: { readonly credentialSource?: string }; readonly keyHint: string;
}): string {
    const source = connection.credentialSource ?? connection.providerSettings?.credentialSource
        ?? (connection.providerId === 'ollama' ? 'none' : 'api_key');
    if (source === 'none') return desktopDomainMessage(locale, desktopStatus('CREDENTIAL_LOCAL'));
    if (source === 'environment') return desktopDomainMessage(locale, desktopStatus('CREDENTIAL_ENVIRONMENT'));
    return connection.keyHint.startsWith('•••• ') ? connection.keyHint : desktopDomainMessage(locale, desktopStatus('CREDENTIAL_SAVED'));
}
