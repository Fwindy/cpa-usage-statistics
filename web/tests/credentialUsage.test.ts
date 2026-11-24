import { expect, test } from 'bun:test';
import { indexConfiguredCredentials } from '@/services/api/configuredCredentials';
import { buildCredentialUsageRows } from '@/utils/credentialUsage';
import { normalizeUsageData } from '@/utils/usage';

const providers = ['vertex', 'gemini', 'interactions', 'claude', 'codex', 'xai', 'meta', 'openai-compatibility'];
const timestamp = '2026-11-24T02:00:00Z';

test('uses the v8 provider key name, then the group name, across configured providers', () => {
  const groups: Record<string, Array<{ name: string; auth_index?: string; keys: unknown[] }>> =
    Object.fromEntries(providers.map((provider) => [
    provider,
    [{
      name: `${provider} group`,
      keys: [
        { auth_index: `${provider}-one`, name: `${provider} key`, 'api-key': 'not-a-display-name' },
        { 'auth-index': `${provider}-two`, 'api-key': 'not-a-display-name' },
      ],
    }],
    ]));
  groups['openai-compatibility'].push({
    name: 'Local models',
    auth_index: 'keyless',
    keys: [],
  });
  const configuredCredentials = indexConfiguredCredentials(groups);
  const details = [...configuredCredentials.keys()].map((auth_index) => ({
    timestamp, auth_index, tokens: { total_tokens: 12 },
  }));
  const usage = normalizeUsageData({ client: { model: details } });
  const rows = buildCredentialUsageRows({ usage, authFiles: [], modelPrices: {}, configuredCredentials });
  const names = new Map(rows.map((row) => [row.authIndex, [row.displayName, row.type]]));

  for (const provider of providers) {
    expect(names.get(`${provider}-one`)).toEqual([`${provider} key`, provider]);
    expect(names.get(`${provider}-two`)).toEqual([`${provider} group`, provider]);
  }
  expect(names.get('keyless')).toEqual(['Local models', 'openai-compatibility']);
  expect(JSON.stringify(rows)).not.toContain('not-a-display-name');
});

test('preserves OAuth file matching and keeps distinct configured indexes independent', () => {
  const configuredCredentials = indexConfiguredCredentials({
    vertex: [{
      name: 'Vertex project',
      keys: [{ auth_index: 'one' }, { auth_index: 'two' }],
    }],
  });
  const details = [
    { timestamp, auth_index: 'oauth', source: '', tokens: {} },
    { timestamp, auth_index: null, source: 't:account.json', tokens: {} },
    { timestamp, auth_index: 'one', source: 'account.json', tokens: {} },
    { timestamp, auth_index: 'two', source: '', tokens: {}, failed: true },
    { timestamp, auth_index: 'removed-key', source: 'account.json', auth_type: 'apikey', provider: 'vertex', tokens: {} },
  ];
  const usage = normalizeUsageData({ client: { model: details } });
  const rows = buildCredentialUsageRows({
    usage, authFiles: [{ name: 'account.json', auth_index: 'oauth', type: 'codex' }],
    modelPrices: {}, configuredCredentials,
  });

  expect(rows.map(({ key, displayName, type, requests, failureCount }) =>
    [key, displayName, type, requests, failureCount]
  )).toEqual([
    ['file:account.json', 'account.json', 'codex', 2, 0],
    ['auth:one', 'Vertex project', 'vertex', 1, 0],
    ['auth:two', 'Vertex project', 'vertex', 1, 1],
    ['auth:removed-key', 'removed-key', 'vertex', 1, 0],
  ]);
});
