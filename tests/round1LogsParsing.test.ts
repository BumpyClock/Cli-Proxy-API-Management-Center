import { describe, expect, test } from 'bun:test';
import { parseLogLine } from '../src/pages/hooks/logParsing';

// Exact lines served by design-review/council/capture.mjs for /logs.
const FIXTURE_LINES = [
  '2026-10-20T09:42:10Z INFO Management API ready',
  '2026-10-20T09:42:12Z INFO Provider pool synchronized',
  '2026-10-20T09:42:18Z INFO Request completed model=claude-sonnet-4-5 status=200 duration=842ms',
];

describe('RFC3339 log lines', () => {
  test('fixture lines keep the zone in the timestamp and drop it and the level from the message', () => {
    expect(FIXTURE_LINES.map((line) => parseLogLine(line))).toEqual([
      {
        raw: FIXTURE_LINES[0],
        timestamp: '2026-10-20T09:42:10Z',
        level: 'info',
        source: undefined,
        requestId: undefined,
        statusCode: undefined,
        latency: undefined,
        ip: undefined,
        method: undefined,
        path: undefined,
        message: 'Management API ready',
      },
      {
        raw: FIXTURE_LINES[1],
        timestamp: '2026-10-20T09:42:12Z',
        level: 'info',
        source: undefined,
        requestId: undefined,
        statusCode: undefined,
        latency: undefined,
        ip: undefined,
        method: undefined,
        path: undefined,
        message: 'Provider pool synchronized',
      },
      {
        raw: FIXTURE_LINES[2],
        timestamp: '2026-10-20T09:42:18Z',
        level: 'info',
        source: undefined,
        requestId: undefined,
        statusCode: 200,
        latency: '842ms',
        ip: undefined,
        method: undefined,
        path: undefined,
        message: 'Request completed model=claude-sonnet-4-5 status=200 duration=842ms',
      },
    ]);
  });

  test('numeric offsets and fractions longer than milliseconds are consumed', () => {
    const offset = parseLogLine('2025-01-02T03:04:05.123456789+08:00 ERROR upstream failed');
    expect(offset.timestamp).toBe('2025-01-02T03:04:05.123456789+08:00');
    expect(offset.level).toBe('error');
    expect(offset.message).toBe('upstream failed');

    const compact = parseLogLine('2025-01-02T03:04:05,123456-0500 warn slow upstream');
    expect(compact.timestamp).toBe('2025-01-02T03:04:05,123456-0500');
    expect(compact.level).toBe('warn');
    expect(compact.message).toBe('slow upstream');
  });

  test('a spaced dash after the time is message text, not a zone offset', () => {
    const line = parseLogLine('2025-01-02 03:04:05 - started');
    expect(line.timestamp).toBe('2025-01-02 03:04:05');
    expect(line.message).toBe('- started');
  });
});

describe('status detection', () => {
  test.each([
    ['status=200', 200],
    ['status: 500', 500],
    ['status_code=404', 404],
    ['http_status=503', 503],
    ['{"status":502,"msg":"bad gateway"}', 502],
    ['HTTP 200 ok', 200],
    ['code 429 rate limited', 429],
  ])('%s', (text, expected) => {
    expect(parseLogLine(`2025-01-02T03:04:05Z INFO ${text}`).statusCode).toBe(expected);
  });

  test('a keyed status wins over loose digits elsewhere in the line', () => {
    expect(parseLogLine('status=404 model=x-500-y').statusCode).toBe(404);
  });

  test('model names and durations are not read as status codes', () => {
    const line = parseLogLine('2025-01-02T03:04:05Z INFO routed model=claude-sonnet-4-5 in 120ms');
    expect(line.statusCode).toBeUndefined();
    expect(line.latency).toBe('120ms');
  });
});

describe('existing formats keep parsing', () => {
  test('backend bracketed GIN access line', () => {
    expect(
      parseLogLine(
        '[2025-01-02 03:04:05] [a1b2c3d4] [info ] [gin_logger.go:94] 200 |      1.234ms |   127.0.0.1 | GET     "/v1/models"'
      )
    ).toMatchObject({
      timestamp: '2025-01-02 03:04:05',
      requestId: 'a1b2c3d4',
      level: 'info',
      source: 'gin_logger.go:94',
      statusCode: 200,
      latency: '1.234ms',
      ip: '127.0.0.1',
      method: 'GET',
      path: '"/v1/models"',
      message: '',
    });
  });

  test('backend bracketed line with an empty request id and fields', () => {
    expect(
      parseLogLine(
        '[2025-01-02 03:04:05] [--------] [warn ] [auth.go:12] token refresh failed provider=claude'
      )
    ).toMatchObject({
      timestamp: '2025-01-02 03:04:05',
      requestId: undefined,
      level: 'warn',
      source: 'auth.go:12',
      message: 'token refresh failed provider=claude',
    });
  });

  test('millisecond timestamp with bracketed level', () => {
    expect(
      parseLogLine('2025-01-02 03:04:05.123 [WARN] [auth.go:12] token refresh failed')
    ).toMatchObject({
      timestamp: '2025-01-02 03:04:05.123',
      level: 'warn',
      source: 'auth.go:12',
      message: 'token refresh failed',
    });
  });
});
