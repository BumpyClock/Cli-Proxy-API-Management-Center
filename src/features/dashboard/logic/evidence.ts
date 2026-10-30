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
 * The age to state on a provider item: once any source behind its evidence stopped
 * updating, the oldest receipt among them (never a fresher, unrelated source's).
 */
export function evidenceAsOf(
  provider: { credentials: { total: number }; apiKeys: number },
  evidence: EvidenceReceipts | undefined
): number | null {
  if (!evidence) return null;
  const used = [
    provider.credentials.total > 0 ? evidence.credentials : null,
    provider.apiKeys > 0 ? evidence.traffic : null,
  ].filter((receipt): receipt is EvidenceReceipt => receipt !== null);
  const sources = used.length > 0 ? used : [evidence.credentials, evidence.traffic];
  if (sources.every((receipt) => receipt.live)) return null;
  const receipts = sources
    .map((receipt) => receipt.receivedAt)
    .filter((receivedAt): receivedAt is number => receivedAt !== null);
  return receipts.length > 0 ? Math.min(...receipts) : null;
}
