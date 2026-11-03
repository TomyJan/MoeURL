let revision = 0

/** Allocates a list snapshot generation that survives route component remounts. */
export function nextShortLinkListRevision() { return ++revision }
