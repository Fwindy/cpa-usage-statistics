import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { UsagePayload } from '@/components/usage';
import type { AuthFileItem } from '@/types/authFile';
import type { ConfiguredCredential } from '@/services/api/configuredCredentials';
import {
  buildCredentialUsageRows,
  type CredentialUsageRow
} from '@/utils/credentialUsage';
import { formatCompactNumber, formatUsd, type ModelPrice } from '@/utils/usage';
import styles from '@/pages/CredentialCenterPage.module.scss';

const ALL_FILTER = '__all__';

type SortKey = 'displayName' | 'requests' | 'tokens' | 'successRate' | 'cost';
type SortDir = 'asc' | 'desc';

interface CredentialStatsCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
  authFiles: AuthFileItem[];
  configuredCredentials: ReadonlyMap<string, ConfiguredCredential>;
}

export function CredentialStatsCard({
  usage,
  loading,
  modelPrices,
  authFiles,
  configuredCredentials,
}: CredentialStatsCardProps) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<SortKey>('displayName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [typeFilter, setTypeFilter] = useState(ALL_FILTER);
  const [searchTerm, setSearchTerm] = useState('');

  const rows = useMemo(
    () => buildCredentialUsageRows({ usage, authFiles, modelPrices, configuredCredentials }),
    [authFiles, modelPrices, usage, configuredCredentials]
  );

  const typeOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(rows.map((row) => row.type)))
        .sort((a, b) => a.localeCompare(b))
        .map((type) => ({ value: type, label: type }))
    ],
    [rows, t]
  );

  const typeOptionSet = useMemo(
    () => new Set(typeOptions.map((option) => option.value)),
    [typeOptions]
  );
  const effectiveTypeFilter = typeOptionSet.has(typeFilter) ? typeFilter : ALL_FILTER;
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const typeMatched = effectiveTypeFilter === ALL_FILTER || row.type === effectiveTypeFilter;
        const nameMatched =
          !normalizedSearchTerm || row.displayName.toLowerCase().includes(normalizedSearchTerm);
        return typeMatched && nameMatched;
      }),
    [effectiveTypeFilter, normalizedSearchTerm, rows]
  );

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        return;
      }
      setSortKey(key);
      setSortDir(key === 'displayName' ? 'asc' : 'desc');
    },
    [sortKey]
  );

  const getSortValue = useCallback((row: CredentialUsageRow, key: SortKey) => row[key], []);

  const sortedRows = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const aValue = getSortValue(a, sortKey);
      const bValue = getSortValue(b, sortKey);

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return direction * aValue.localeCompare(bValue);
      }

      return direction * (Number(aValue) - Number(bValue));
    });
  }, [filteredRows, getSortValue, sortDir, sortKey]);

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const ariaSort = (key: SortKey): 'none' | 'ascending' | 'descending' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <Card
      title={t('usage_stats.credential_stats')}
      className={styles.fixedCard}
      extra={
        <div className={styles.cardHeaderControls}>
          <Select
            value={effectiveTypeFilter}
            options={typeOptions}
            onChange={setTypeFilter}
            className={styles.filterSelect}
            ariaLabel={t('monitoring_center.credential_filter_type')}
            fullWidth={false}
          />
          <div className={styles.searchFilterItem}>
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
              placeholder={t('monitoring_center.credential_search_placeholder')}
              aria-label={t('monitoring_center.credential_search_label')}
              className={styles.searchInput}
            />
          </div>
        </div>
      }
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length > 0 ? (
        filteredRows.length > 0 ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.sortableHeader} aria-sort={ariaSort('displayName')}>
                    <button
                      type="button"
                      className={styles.sortHeaderButton}
                      onClick={() => handleSort('displayName')}
                    >
                      {t('usage_stats.credential_name')}{arrow('displayName')}
                    </button>
                  </th>
                  <th className={`${styles.sortableHeader} ${styles.metricColumn}`} aria-sort={ariaSort('requests')}>
                    <button
                      type="button"
                      className={styles.sortHeaderButton}
                      onClick={() => handleSort('requests')}
                    >
                      {t('usage_stats.requests_count')}{arrow('requests')}
                    </button>
                  </th>
                  <th className={`${styles.sortableHeader} ${styles.metricColumn}`} aria-sort={ariaSort('tokens')}>
                    <button
                      type="button"
                      className={styles.sortHeaderButton}
                      onClick={() => handleSort('tokens')}
                    >
                      {t('usage_stats.tokens_count')}{arrow('tokens')}
                    </button>
                  </th>
                  <th className={`${styles.sortableHeader} ${styles.compactMetricColumn}`} aria-sort={ariaSort('successRate')}>
                    <button
                      type="button"
                      className={styles.sortHeaderButton}
                      onClick={() => handleSort('successRate')}
                    >
                      {t('usage_stats.success_rate')}{arrow('successRate')}
                    </button>
                  </th>
                  <th className={`${styles.sortableHeader} ${styles.metricColumn}`} aria-sort={ariaSort('cost')}>
                    <button
                      type="button"
                      className={styles.sortHeaderButton}
                      onClick={() => handleSort('cost')}
                    >
                      {t('usage_stats.total_cost')}{arrow('cost')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.key}>
                    <td className={styles.credentialCell}>
                      <div>
                        <span>{row.displayName}</span>
                        {row.type && <span className={styles.credentialType}>{row.type}</span>}
                      </div>
                    </td>
                    <td>
                      <span className={styles.requestCountCell}>
                        <span>{row.requests.toLocaleString()}</span>
                        <span className={styles.requestBreakdown}>
                          (<span className={styles.statSuccess}>{row.successCount.toLocaleString()}</span>{' '}
                          <span className={styles.statFailure}>{row.failureCount.toLocaleString()}</span>)
                        </span>
                      </span>
                    </td>
                    <td>{formatCompactNumber(row.tokens)}</td>
                    <td>
                      <span
                        className={
                          row.successRate >= 95
                            ? styles.statSuccess
                            : row.successRate >= 80
                              ? styles.statNeutral
                              : styles.statFailure
                        }
                      >
                        {row.successRate.toFixed(1)}%
                      </span>
                    </td>
                    <td>{row.cost > 0 ? formatUsd(row.cost) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={t('monitoring_center.credential_no_result_title')}
            description={t('monitoring_center.credential_no_result_desc')}
          />
        )
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
