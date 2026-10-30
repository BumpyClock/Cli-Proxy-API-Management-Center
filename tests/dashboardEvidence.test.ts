import { describe, expect, test } from 'bun:test';
import { evidenceAsOf, type EvidenceReceipts } from '../src/features/dashboard/logic/evidence';

const NOW = 1_000_000;
const receipts = (credentialsLive: boolean, trafficLive: boolean): EvidenceReceipts => ({
  credentials: { receivedAt: NOW - (credentialsLive ? 5_000 : 120_000), live: credentialsLive },
  traffic: { receivedAt: NOW - (trafficLive ? 5_000 : 60_000), live: trafficLive },
});

const apiKeyProvider = { credentials: { total: 0 }, apiKeys: 1 };
const credentialProvider = { credentials: { total: 2 }, apiKeys: 0 };
const mixedProvider = { credentials: { total: 1 }, apiKeys: 1 };

describe('evidenceAsOf', () => {
  test('an API-key provider states the age of stale traffic, not of fresh credentials', () => {
    expect(evidenceAsOf(apiKeyProvider, receipts(true, false))).toBe(NOW - 60_000);
  });

  test('a credential provider is unaffected by stale traffic', () => {
    expect(evidenceAsOf(credentialProvider, receipts(true, false))).toBeNull();
    expect(evidenceAsOf(credentialProvider, receipts(false, true))).toBe(NOW - 120_000);
  });

  test('unknown key inventory: traffic that never loaded has no age to state', () => {
    const unknownKeys = { credentials: { total: 1 }, apiKeys: 0, apiKeysKnown: false };
    const neverLoaded: EvidenceReceipts = {
      credentials: { receivedAt: NOW - 5_000, live: true },
      traffic: { receivedAt: null, live: false },
    };
    expect(evidenceAsOf(unknownKeys, neverLoaded)).toBeNull();
    expect(
      evidenceAsOf(unknownKeys, {
        ...neverLoaded,
        credentials: { receivedAt: NOW - 120_000, live: false },
      })
    ).toBe(NOW - 120_000);
  });

  test('evidence from both sources states the oldest receipt once either is stale', () => {
    expect(evidenceAsOf(mixedProvider, receipts(true, false))).toBe(NOW - 60_000);
    expect(evidenceAsOf(mixedProvider, receipts(false, false))).toBe(NOW - 120_000);
    expect(evidenceAsOf(mixedProvider, receipts(true, true))).toBeNull();
  });
});
