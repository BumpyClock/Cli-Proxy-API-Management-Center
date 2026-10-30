/** When an evidence source last delivered, and whether it is still updating. */
export interface EvidenceReceipt {
  receivedAt: number | null;
  live: boolean;
}

/** Credential files carry status and per-file requests; API-key traffic carries key requests. */
export interface EvidenceReceipts {
  credentials: EvidenceReceipt;
  traffic: EvidenceReceipt;
}

/**
 * The age to state on a provider item: once a loaded source behind its evidence stopped
 * updating, the oldest receipt among them (never a fresher, unrelated source's). API-key
 * traffic is behind the evidence when the provider has keys, or when its key inventory is
 * still unknown. A source that never loaded has no age; the item says it is missing.
 */
export function evidenceAsOf(
  provider: { credentials: { total: number }; apiKeys: number; apiKeysKnown?: boolean },
  evidence: EvidenceReceipts | undefined
): number | null {
  if (!evidence) return null;
  const used = [
    provider.credentials.total > 0 ? evidence.credentials : null,
    provider.apiKeys > 0 || provider.apiKeysKnown === false ? evidence.traffic : null,
  ].filter((receipt): receipt is EvidenceReceipt => receipt !== null);
  const sources = used.length > 0 ? used : [evidence.credentials, evidence.traffic];
  const loaded = sources.filter((receipt) => receipt.receivedAt !== null);
  if (loaded.every((receipt) => receipt.live)) return null;
  return Math.min(...loaded.map((receipt) => receipt.receivedAt as number));
}
