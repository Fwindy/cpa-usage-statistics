package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const sqliteTimestampLayout = "2006-01-02T15:04:05.000000000Z07:00"

// SQLiteStore persists usage records in a pure-Go SQLite database.
type SQLiteStore struct {
	db *sql.DB
}

// NewSQLiteStore opens (creating if needed) the usage database at path.
func NewSQLiteStore(path string) (*SQLiteStore, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("usage sqlite path is empty")
	}
	if err := prepareSQLitePath(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("usage sqlite open: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &SQLiteStore{db: db}
	if err := store.initSchema(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func prepareSQLitePath(path string) error {
	dir := filepath.Clean(filepath.Dir(path))
	if dir != "." && filepath.Dir(dir) != dir {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("usage sqlite mkdir: %w", err)
		}
	}
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return fmt.Errorf("usage sqlite create: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("usage sqlite close created file: %w", err)
	}
	return nil
}

// initSchema creates the table and indexes. Column names are aligned with
// upstream usage.Record / usage.Detail; there is no legacy migration path.
func (s *SQLiteStore) initSchema(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS usage_records (
	id TEXT PRIMARY KEY,
	timestamp TEXT NOT NULL,
	api_key TEXT NOT NULL DEFAULT '',
	provider TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	response_model TEXT NOT NULL DEFAULT '',
	alias TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT '',
	auth_id TEXT NOT NULL DEFAULT '',
	auth_index TEXT NOT NULL DEFAULT '',
	auth_type TEXT NOT NULL DEFAULT '',
	executor_type TEXT NOT NULL DEFAULT '',
	reasoning_effort TEXT NOT NULL DEFAULT '',
	service_tier TEXT NOT NULL DEFAULT '',
	latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
	ttft_ms INTEGER NOT NULL DEFAULT 0 CHECK (ttft_ms >= 0),
	input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
	output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
	reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
	cached_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
	cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
	cache_creation_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_creation_tokens >= 0),
	total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
	failed INTEGER NOT NULL DEFAULT 0 CHECK (failed IN (0, 1)),
	failure_status_code INTEGER NOT NULL DEFAULT 0 CHECK (failure_status_code >= 0),
	failure_body TEXT NOT NULL DEFAULT ''
)`,
		`CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records(timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_usage_records_api_model ON usage_records(api_key, provider, model)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("usage sqlite init schema: %w", err)
		}
	}
	return s.migrateSchema(ctx)
}

// migrateSchema adds missing columns without changing existing records.
// SQLite cannot add a column twice, so inspect the table before each upgrade.
// Added numeric columns use defaults; writes enforce nonnegative values.
func (s *SQLiteStore) migrateSchema(ctx context.Context) error {
	existing, err := s.existingColumns(ctx)
	if err != nil {
		return err
	}
	additions := []struct {
		name string
		ddl  string
	}{
		{"api_key", `ALTER TABLE usage_records ADD COLUMN api_key TEXT NOT NULL DEFAULT ''`},
		{"provider", `ALTER TABLE usage_records ADD COLUMN provider TEXT NOT NULL DEFAULT ''`},
		{"model", `ALTER TABLE usage_records ADD COLUMN model TEXT NOT NULL DEFAULT ''`},
		{"response_model", `ALTER TABLE usage_records ADD COLUMN response_model TEXT NOT NULL DEFAULT ''`},
		{"alias", `ALTER TABLE usage_records ADD COLUMN alias TEXT NOT NULL DEFAULT ''`},
		{"source", `ALTER TABLE usage_records ADD COLUMN source TEXT NOT NULL DEFAULT ''`},
		{"auth_id", `ALTER TABLE usage_records ADD COLUMN auth_id TEXT NOT NULL DEFAULT ''`},
		{"auth_index", `ALTER TABLE usage_records ADD COLUMN auth_index TEXT NOT NULL DEFAULT ''`},
		{"auth_type", `ALTER TABLE usage_records ADD COLUMN auth_type TEXT NOT NULL DEFAULT ''`},
		{"executor_type", `ALTER TABLE usage_records ADD COLUMN executor_type TEXT NOT NULL DEFAULT ''`},
		{"reasoning_effort", `ALTER TABLE usage_records ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''`},
		{"service_tier", `ALTER TABLE usage_records ADD COLUMN service_tier TEXT NOT NULL DEFAULT ''`},
		{"latency_ms", `ALTER TABLE usage_records ADD COLUMN latency_ms INTEGER NOT NULL DEFAULT 0`},
		{"ttft_ms", `ALTER TABLE usage_records ADD COLUMN ttft_ms INTEGER NOT NULL DEFAULT 0`},
		{"input_tokens", `ALTER TABLE usage_records ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0`},
		{"output_tokens", `ALTER TABLE usage_records ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0`},
		{"reasoning_tokens", `ALTER TABLE usage_records ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0`},
		{"cached_tokens", `ALTER TABLE usage_records ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0`},
		{"cache_read_tokens", `ALTER TABLE usage_records ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0`},
		{"cache_creation_tokens", `ALTER TABLE usage_records ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0`},
		{"total_tokens", `ALTER TABLE usage_records ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0`},
		{"failed", `ALTER TABLE usage_records ADD COLUMN failed INTEGER NOT NULL DEFAULT 0`},
		{"failure_status_code", `ALTER TABLE usage_records ADD COLUMN failure_status_code INTEGER NOT NULL DEFAULT 0`},
		{"failure_body", `ALTER TABLE usage_records ADD COLUMN failure_body TEXT NOT NULL DEFAULT ''`},
	}
	for _, addition := range additions {
		if _, ok := existing[addition.name]; ok {
			continue
		}
		if _, err := s.db.ExecContext(ctx, addition.ddl); err != nil {
			return fmt.Errorf("usage sqlite migrate add %s: %w", addition.name, err)
		}
	}
	return nil
}

// existingColumns returns the set of column names in usage_records.
func (s *SQLiteStore) existingColumns(ctx context.Context) (map[string]struct{}, error) {
	rows, err := s.db.QueryContext(ctx, "PRAGMA table_info(usage_records)")
	if err != nil {
		return nil, fmt.Errorf("usage sqlite table_info: %w", err)
	}
	defer func() { _ = rows.Close() }()
	columns := make(map[string]struct{})
	for rows.Next() {
		var (
			cid       int
			name      string
			ctype     string
			notNull   int
			dfltValue sql.NullString
			pk        int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dfltValue, &pk); err != nil {
			return nil, fmt.Errorf("usage sqlite table_info scan: %w", err)
		}
		columns[name] = struct{}{}
	}
	return columns, rows.Err()
}

// Insert stores one usage record.
func (s *SQLiteStore) Insert(ctx context.Context, record Record) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("usage sqlite store is nil")
	}
	if strings.TrimSpace(record.ID) == "" {
		return fmt.Errorf("usage record id is empty")
	}

	tokens := nonNegativeTokenStats(record.Tokens)
	tokens.TotalTokens = normalizeTotalTokens(tokens)

	_, err := s.db.ExecContext(ctx, `
INSERT INTO usage_records (
	id, timestamp, api_key, provider, model, response_model, alias, source, auth_id, auth_index, auth_type, executor_type,
	reasoning_effort, service_tier, latency_ms, ttft_ms,
	input_tokens, output_tokens, reasoning_tokens, cached_tokens, cache_read_tokens, cache_creation_tokens, total_tokens,
	failed, failure_status_code, failure_body
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
		strings.TrimSpace(record.ID),
		formatRecordTimestamp(record.Timestamp),
		strings.TrimSpace(record.APIKey),
		strings.TrimSpace(record.Provider),
		normalizeModel(record.Model),
		strings.TrimSpace(record.ResponseModel),
		strings.TrimSpace(record.Alias),
		strings.TrimSpace(record.Source),
		strings.TrimSpace(record.AuthID),
		strings.TrimSpace(record.AuthIndex),
		strings.TrimSpace(record.AuthType),
		strings.TrimSpace(record.ExecutorType),
		strings.TrimSpace(record.ReasoningEffort),
		strings.TrimSpace(record.ServiceTier),
		nonNegative(record.LatencyMs),
		nonNegative(record.TTFTMs),
		tokens.InputTokens,
		tokens.OutputTokens,
		tokens.ReasoningTokens,
		tokens.CachedTokens,
		tokens.CacheReadTokens,
		tokens.CacheCreationTokens,
		tokens.TotalTokens,
		boolToInt(record.Failed),
		nonNegativeInt(record.FailureStatusCode),
		strings.TrimSpace(record.FailureBody),
	)
	if err != nil {
		return fmt.Errorf("usage sqlite insert: %w", err)
	}
	return nil
}

// Query returns usage grouped by api_key (or provider) then model.
func (s *SQLiteStore) Query(ctx context.Context, rng QueryRange) (APIUsage, error) {
	if s == nil || s.db == nil {
		return APIUsage{}, nil
	}
	query := `
SELECT id, timestamp, api_key, provider, model, response_model, alias, source, auth_id, auth_index, auth_type, executor_type,
       reasoning_effort, service_tier, latency_ms, ttft_ms,
       input_tokens, output_tokens, reasoning_tokens, cached_tokens, cache_read_tokens, cache_creation_tokens, total_tokens,
       failed, failure_status_code, failure_body
FROM usage_records`
	args := make([]any, 0, 2)
	where := make([]string, 0, 2)
	if rng.Start != nil && !rng.Start.IsZero() {
		where = append(where, "timestamp >= ?")
		args = append(args, formatTimestamp(*rng.Start))
	}
	if rng.End != nil && !rng.End.IsZero() {
		where = append(where, "timestamp < ?")
		args = append(args, formatTimestamp(*rng.End))
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY timestamp ASC, id ASC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("usage sqlite query: %w", err)
	}
	defer func() { _ = rows.Close() }()

	result := APIUsage{}
	for rows.Next() {
		var timestampText string
		var apiKey string
		var failedInt int
		detail := RequestDetail{}
		if err := rows.Scan(
			&detail.ID,
			&timestampText,
			&apiKey,
			&detail.Provider,
			&detail.Model,
			&detail.ResponseModel,
			&detail.Alias,
			&detail.Source,
			&detail.AuthID,
			&detail.AuthIndex,
			&detail.AuthType,
			&detail.ExecutorType,
			&detail.ReasoningEffort,
			&detail.ServiceTier,
			&detail.LatencyMs,
			&detail.TTFTMs,
			&detail.Tokens.InputTokens,
			&detail.Tokens.OutputTokens,
			&detail.Tokens.ReasoningTokens,
			&detail.Tokens.CachedTokens,
			&detail.Tokens.CacheReadTokens,
			&detail.Tokens.CacheCreationTokens,
			&detail.Tokens.TotalTokens,
			&failedInt,
			&detail.FailureStatusCode,
			&detail.FailureBody,
		); err != nil {
			return nil, fmt.Errorf("usage sqlite scan: %w", err)
		}
		parsed, err := time.Parse(time.RFC3339Nano, timestampText)
		if err != nil {
			return nil, fmt.Errorf("usage sqlite parse timestamp: %w", err)
		}
		detail.Timestamp = parsed.UTC()
		detail.LatencyMs = nonNegative(detail.LatencyMs)
		detail.TTFTMs = nonNegative(detail.TTFTMs)
		detail.Failed = failedInt != 0

		key := groupingKey(apiKey, detail.Provider)
		modelKey := normalizeModel(detail.Model)
		if result[key] == nil {
			result[key] = map[string][]RequestDetail{}
		}
		result[key][modelKey] = append(result[key][modelKey], detail)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("usage sqlite rows: %w", err)
	}
	return result, nil
}

// Delete removes records by id and reports which ids were absent.
func (s *SQLiteStore) Delete(ctx context.Context, ids []string) (DeleteResult, error) {
	result := DeleteResult{Missing: []string{}}
	if s == nil || s.db == nil {
		result.Missing = append(result.Missing, ids...)
		return result, nil
	}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		res, err := s.db.ExecContext(ctx, "DELETE FROM usage_records WHERE id = ?", id)
		if err != nil {
			return result, fmt.Errorf("usage sqlite delete %s: %w", id, err)
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return result, fmt.Errorf("usage sqlite rows affected: %w", err)
		}
		if rows == 0 {
			result.Missing = append(result.Missing, id)
			continue
		}
		result.Deleted += rows
	}
	return result, nil
}

// DeleteBefore removes records older than cutoff and returns the deleted count.
func (s *SQLiteStore) DeleteBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	if s == nil || s.db == nil {
		return 0, nil
	}
	res, err := s.db.ExecContext(ctx, "DELETE FROM usage_records WHERE timestamp < ?", formatTimestamp(cutoff))
	if err != nil {
		return 0, fmt.Errorf("usage sqlite delete before: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("usage sqlite rows affected: %w", err)
	}
	return rows, nil
}

// Close closes the underlying database.
func (s *SQLiteStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func formatTimestamp(timestamp time.Time) string {
	return timestamp.UTC().Format(sqliteTimestampLayout)
}

func formatRecordTimestamp(timestamp time.Time) string {
	if timestamp.IsZero() {
		timestamp = time.Now()
	}
	return formatTimestamp(timestamp)
}

func groupingKey(apiKey, provider string) string {
	if trimmed := strings.TrimSpace(apiKey); trimmed != "" {
		return trimmed
	}
	if trimmed := strings.TrimSpace(provider); trimmed != "" {
		return trimmed
	}
	return "unknown"
}

func normalizeModel(model string) string {
	if trimmed := strings.TrimSpace(model); trimmed != "" {
		return trimmed
	}
	return "unknown"
}

func normalizeTotalTokens(tokens TokenStats) int64 {
	if tokens.TotalTokens != 0 {
		return tokens.TotalTokens
	}
	total := tokens.InputTokens + tokens.OutputTokens + tokens.ReasoningTokens
	if total != 0 {
		return total
	}
	return tokens.InputTokens + tokens.OutputTokens + tokens.ReasoningTokens + tokens.CachedTokens
}

func nonNegativeTokenStats(tokens TokenStats) TokenStats {
	tokens.InputTokens = nonNegative(tokens.InputTokens)
	tokens.OutputTokens = nonNegative(tokens.OutputTokens)
	tokens.ReasoningTokens = nonNegative(tokens.ReasoningTokens)
	tokens.CachedTokens = nonNegative(tokens.CachedTokens)
	tokens.CacheReadTokens = nonNegative(tokens.CacheReadTokens)
	tokens.CacheCreationTokens = nonNegative(tokens.CacheCreationTokens)
	tokens.TotalTokens = nonNegative(tokens.TotalTokens)
	return tokens
}

func nonNegative(value int64) int64 {
	if value < 0 {
		return 0
	}
	return value
}

func nonNegativeInt(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
