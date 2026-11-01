import { describe, expect, test } from 'bun:test';
import { redactSecrets, redactUrlCredentials } from '../src/features/dashboard/logic/redact';
import { readableStatusReason } from '../src/features/dashboard/logic/statusMessage';

describe('redactSecrets', () => {
  test('masks provider keys while keeping enough to recognise them', () => {
    expect(redactSecrets('Incorrect API key provided: sk-proj-abcdefghijklmnop1234')).toBe(
      'Incorrect API key provided: sk-…1234'
    );
    expect(redactSecrets('key AIzaSyA1234567890abcdefghijklmnop')).toBe('key AIza…mnop');
  });

  test('masks bearer tokens, JWTs, and key=value secrets', () => {
    expect(redactSecrets('Authorization: Bearer abc.def-ghi_jkl')).toBe(
      'Authorization: Bearer ***'
    );
    expect(
      redactSecrets(
        'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop expired'
      )
    ).toBe('token *** expired');
    expect(redactSecrets('GET /v1?api_key=supersecretvalue&x=1')).toBe('GET /v1?api_key=***&x=1');
    expect(redactSecrets('{"access_token": "abcdef123456"}')).toBe('{"access_token": "***"}');
  });

  test('masks labelled secrets regardless of length and consumes complete quoted values', () => {
    expect(redactSecrets('api_key=abc12&token=x')).toBe('api_key=***&token=***');
    expect(redactSecrets('{"password":"correct horse battery staple"}')).toBe('{"password":"***"}');
    expect(redactSecrets("password='two words' next=visible")).toBe("password='***' next=visible");
    const escaped = JSON.stringify({ client_secret: 'short "quoted" secret \\ tail' });
    expect(JSON.parse(redactSecrets(escaped))).toEqual({ client_secret: '***' });
  });

  test('masks quoted secrets truncated at any point, including an escape character', () => {
    const raw = JSON.stringify({ password: 'correct "quoted" words \\ tail' });
    for (let end = '{"password":"'.length; end < raw.length; end += 1) {
      expect(redactSecrets(raw.slice(0, end))).toBe('{"password":"***"');
    }
    expect(redactSecrets("token='short secret")).toBe("token='***'");
  });

  test('masks URL credentials and long opaque tokens', () => {
    expect(redactSecrets('dial http://bob:hunter22@proxy:8080 failed')).toBe(
      'dial http://bob:***@proxy:8080 failed'
    );
    expect(redactSecrets(`session ${'a1B2'.repeat(12)} rejected`)).toBe('session *** rejected');
  });

  test('leaves ordinary messages alone', () => {
    const message = 'The requested model was not found. (model_not_found, HTTP 404)';
    expect(redactSecrets(message)).toBe(message);
    expect(redactSecrets('token expired')).toBe('token expired');
    expect(redactSecrets('claude-3-5-sonnet-20241022 overloaded')).toBe(
      'claude-3-5-sonnet-20241022 overloaded'
    );
  });
});

describe('redactUrlCredentials', () => {
  test('hides the password and keeps the user and host', () => {
    expect(redactUrlCredentials('socks5://alice:p4ss@10.0.0.2:1080')).toBe(
      'socks5://alice:***@10.0.0.2:1080'
    );
  });

  test('hides a bare userinfo token and ignores credential-free URLs', () => {
    expect(redactUrlCredentials('https://ghp_token@proxy.example.com')).toBe(
      'https://***@proxy.example.com'
    );
    expect(redactUrlCredentials('http://proxy.example.com:3128')).toBe(
      'http://proxy.example.com:3128'
    );
  });
});

describe('readableStatusReason redaction', () => {
  test('masks secrets inside provider error bodies', () => {
    expect(
      readableStatusReason(
        '{"error":{"message":"Incorrect API key provided: sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}}'
      )
    ).toBe('Incorrect API key provided: sk-…wxyz');
  });
});
