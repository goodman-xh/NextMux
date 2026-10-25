export interface ThreadMarkerCandidate {
    readonly id: string;
    readonly top: number;
}

/**
 * Selects the conversation rail marker without coupling it to virtualization.
 * At the true bottom, the last logical turn wins even when that turn is not a
 * currently mounted DOM item. Away from the bottom, the nearest reading anchor
 * among mounted turns is used.
 */
export function selectActiveThreadMarker(
    candidates: readonly ThreadMarkerCandidate[],
    anchorTop: number,
    atBottom: boolean,
    latestTurnId: string
): string {
    if (atBottom && latestTurnId) return latestTurnId;
    if (!candidates.length) return latestTurnId;
    return candidates.reduce((selected, candidate) =>
        Math.abs(candidate.top - anchorTop) < Math.abs(selected.top - anchorTop)
            ? candidate : selected).id || latestTurnId;
}
