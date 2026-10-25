/** Unknown measurements remain absent, including null, empty strings and invalid numbers. */
export function measuredRelayLatency(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Catalog latency is the latest probe, not a percentile or a new runtime measurement. */
export function latestRelayLatency(network: { readonly lastLatencyMs?: number | null }): number | undefined {
    return measuredRelayLatency(network.lastLatencyMs);
}

export function averageRelayLatency(values: readonly (number | null | undefined)[]): number | undefined {
    const measured = values.map(measuredRelayLatency).filter((value): value is number => value !== undefined);
    return measured.length ? Math.round(measured.reduce((total, value) => total + value, 0) / measured.length) : undefined;
}

/** A routing prior is not an observation; only networks with measured samples contribute. */
export function averageRelayAvailability(networks: readonly {
    readonly availability?: number | null; readonly sampleCount?: number | null;
}[]): number | undefined {
    const measured = networks.filter(network => Number.isSafeInteger(network.sampleCount) && (network.sampleCount ?? 0) > 0
        && typeof network.availability === 'number' && Number.isFinite(network.availability)
        && network.availability >= 0 && network.availability <= 1).map(network => network.availability as number);
    return measured.length ? measured.reduce((total, value) => total + value, 0) / measured.length : undefined;
}

/** A store nobody has rated yet starts here (the platform directory's `quality ?? 100`); it is not a measurement. */
export const INITIAL_RELAY_QUALITY = 100;

/**
 * Virtual positive votes behind every approval rating, the same constant as the platform (approval-rating.js) and
 * the website: 100% before any vote, 100% while every vote is positive, about −2 points per early negative vote.
 */
export const RELAY_APPROVAL_PRIOR_VOTES = 50;

/** 0–100 approval from vote counts, multiplied before dividing exactly like the platform's SQL so both round alike. */
export function relayApprovalRating(likes: number, votes: number): number {
    return Math.round((likes + RELAY_APPROVAL_PRIOR_VOTES) * 100 / (votes + RELAY_APPROVAL_PRIOR_VOTES));
}

const voteCount = (value: number | undefined): number => Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value! : 0;

/** Completed-request votes (likes + dislikes) behind a relay's quality; zero means it still has its initial rating. */
export function relayFeedbackVotes(values: readonly { readonly likes?: number; readonly dislikes?: number }[]): number {
    return values.reduce((total, value) => total + voteCount(value.likes) + voteCount(value.dislikes), 0);
}

/**
 * Public quality is the smoothed approval of completed-request votes (relayApprovalRating), never the marketplace's
 * internal recommendation prior; with no votes it is the initial 100%, and one negative vote only takes it to 98%.
 */
export function measuredRelayQuality(values: readonly { readonly likes?: number; readonly dislikes?: number }[]): number {
    const likes = values.reduce((total, value) => total + voteCount(value.likes), 0);
    const votes = relayFeedbackVotes(values);
    return votes > 0 ? relayApprovalRating(likes, votes) : INITIAL_RELAY_QUALITY;
}

/**
 * A relay's authenticity: the mean of its models' identity scores. Models without evidence are left out
 * (unknown is not zero), so one tested model does not stand in for the rest and untested ones do not drag it down.
 */
export function measuredRelayAuthenticity(values: readonly ({ readonly index?: number; readonly sampleCount?: number } | undefined)[]): number | undefined {
    const scores = values.map(value => measuredModelFidelity(value)).filter((score): score is number => score !== undefined);
    return scores.length ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length) : undefined;
}

export function measuredModelFidelity(value: { readonly index?: number; readonly sampleCount?: number } | undefined): number | undefined {
    return value && Number.isSafeInteger(value.sampleCount) && (value.sampleCount ?? 0) > 0
        && typeof value.index === 'number' && Number.isFinite(value.index) && value.index >= 0 && value.index <= 100
        ? value.index : undefined;
}
