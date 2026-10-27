import { classifyModelError } from '@nextmux/model-runtime/errors';
import type { OfficialModelConnection } from '../common/nextmux-platform-protocol';

/** A model permission/refusal or provider credit error does not invalidate the
 * connection's credential. Some transports use AUTH_FAILED for every 403. */
export function isOfficialPickerCredentialFailure(value: unknown): boolean {
    const failure = classifyModelError(value, { source: 'own_api' });
    if (failure.kind !== 'auth_invalid' && failure.kind !== 'auth_missing') return false;
    if (failure.httpStatus === 401) return true;
    if (/^(?:invalid_api_key|api_key_(?:missing|required)|discovery_credentials_missing|authentication_error)$/i.test(failure.code || '')) return true;
    return /\binvalid[_ -](?:api[_ -]?)?key\b|\bapi[_ -]?key\b.{0,30}\b(?:invalid|expired|revoked|missing|required)\b/i
        .test(failure.providerReason || failure.detail);
}

/** The backend may return an older cached validation. Only an exact model's
 * new successful generation proves authentication for this probe batch. */
export function hasFreshOfficialPickerValidation(connection: Pick<OfficialModelConnection, 'discoveredModels'>,
    model: string, startedAt: number, observedAt = Date.now()): boolean {
    const validation = connection.discoveredModels.find(candidate => candidate.id === model)?.validation;
    const checkedAt = Date.parse(validation?.checkedAt || '');
    return Number.isFinite(checkedAt) && checkedAt >= startedAt && checkedAt <= observedAt;
}
