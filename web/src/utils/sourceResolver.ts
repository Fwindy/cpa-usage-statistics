import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { ConfiguredCredential } from '@/services/api/configuredCredentials';
import type { SourceInfo } from '@/types/sourceInfo';
import { resolveCredentialMatch, type AuthFileLookup } from '@/utils/credentialUsage';
import { buildCandidateUsageSourceIds, type UsageDetail } from '@/utils/usage';

export interface SourceInfoMapInput {
  geminiApiKeys?: GeminiKeyConfig[];
  claudeApiKeys?: ProviderKeyConfig[];
  codexApiKeys?: ProviderKeyConfig[];
  vertexApiKeys?: ProviderKeyConfig[];
  openaiCompatibility?: OpenAIProviderConfig[];
}

export type SourceInfoMap = ReadonlyMap<string, SourceInfo | null>;

const buildProviderIdentityKey = (type: string, index: number) => `${type}:${index}`;

const registerIdentity = (
  map: Map<string, SourceInfo | null>,
  key: string,
  entry: SourceInfo
) => {
  if (!key) return;

  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, entry);
    return;
  }

  if (existing === null) {
    return;
  }

  if (existing.identityKey === entry.identityKey) {
    return;
  }

  map.set(key, null);
};

const formatRawSourceDisplayName = (source: string) => {
  if (!source) return '-';
  return source.startsWith('t:') ? source.slice(2) : source;
};

export function buildSourceInfoMap(input: SourceInfoMapInput): SourceInfoMap {
  const bySource = new Map<string, SourceInfo | null>();

  const registerProvider = (entry: SourceInfo, candidates: Iterable<string>) => {
    for (const candidate of candidates) {
      registerIdentity(bySource, candidate, entry);
    }
  };

  const providers: Array<{
    items: Array<{ apiKey?: string; prefix?: string }>;
    type: string;
    label: string;
  }> = [
    { items: input.geminiApiKeys || [], type: 'gemini', label: 'Gemini' },
    { items: input.claudeApiKeys || [], type: 'claude', label: 'Claude' },
    { items: input.codexApiKeys || [], type: 'codex', label: 'Codex' },
    { items: input.vertexApiKeys || [], type: 'vertex', label: 'Vertex' },
  ];

  providers.forEach(({ items, type, label }) => {
    items.forEach((item, index) => {
      registerProvider(
        {
          displayName: item.prefix?.trim() || `${label} #${index + 1}`,
          type,
          identityKey: buildProviderIdentityKey(type, index),
        },
        buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix })
      );
    });
  });

  (input.openaiCompatibility || []).forEach((provider, providerIndex) => {
    const candidates = new Set<string>();
    buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((id) => candidates.add(id));
    (provider.apiKeyEntries || []).forEach((entry) => {
      buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id));
    });

    registerProvider(
      {
        displayName: provider.prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`,
        type: 'openai',
        identityKey: buildProviderIdentityKey('openai', providerIndex),
      },
      candidates
    );
  });

  return bySource;
}

export function resolveSourceDisplay(
  detail: UsageDetail,
  sourceInfoMap: SourceInfoMap,
  authFileLookup: AuthFileLookup,
  configuredCredentials: ReadonlyMap<string, ConfiguredCredential>
): SourceInfo {
  const credential = resolveCredentialMatch(detail, authFileLookup, configuredCredentials);
  if (credential) {
    return {
      displayName: credential.displayName,
      type: credential.type,
      identityKey: credential.authIndex ? `auth:${credential.authIndex}` : credential.rowKey,
    };
  }

  const source = String(detail.source ?? '').trim();
  return sourceInfoMap.get(source) ?? {
    displayName: formatRawSourceDisplayName(source),
    type: '',
    identityKey: `source:${source || '-'}`,
  };
}
