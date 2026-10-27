package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestResponseModelUsageRoundTrip(t *testing.T) {
	for _, tc := range []struct {
		name     string
		response any
		want     string
	}{
		{name: "reported", response: " upstream-model-20261027 ", want: "upstream-model-20261027"},
		{name: "missing"},
		{name: "empty", response: ""},
		{name: "whitespace", response: "  "},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("USAGE_STATISTICS_DIR", t.TempDir())
			t.Cleanup(closeStore)
			if _, err := handleMethod("plugin.register", []byte(`{}`)); err != nil {
				t.Fatalf("register: %v", err)
			}
			payload := map[string]any{
				"APIKey": "fixture-key", "Model": "requested-model", "Alias": "client-alias",
				"RequestedAt": "2026-10-27T10:00:00Z", "Detail": map[string]int{"InputTokens": 5},
			}
			if tc.response != nil {
				payload["ResponseModel"] = tc.response
			}
			raw, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			stored, err := handleMethod("usage.handle", raw)
			if err != nil {
				t.Fatalf("usage.handle: %v", err)
			}
			var storedEnvelope envelope
			if err := json.Unmarshal(stored, &storedEnvelope); err != nil || !storedEnvelope.OK {
				t.Fatalf("usage response: %s (%v)", stored, err)
			}

			// Reopen the same database to verify persistence, not just an in-memory mapping.
			closeStore()
			if err := configurePlugin([]byte(`{}`)); err != nil {
				t.Fatalf("reopen: %v", err)
			}
			request, err := json.Marshal(managementRequest{Method: "GET", Path: managementUsagePath})
			if err != nil {
				t.Fatal(err)
			}
			raw, err = handleMethod("management.handle", request)
			if err != nil {
				t.Fatalf("management.handle: %v", err)
			}
			var result envelope
			if err := json.Unmarshal(raw, &result); err != nil || !result.OK {
				t.Fatalf("management envelope: %s (%v)", raw, err)
			}
			var response managementResponse
			if err := json.Unmarshal(result.Result, &response); err != nil || response.StatusCode != 200 {
				t.Fatalf("management response: %s (%v)", result.Result, err)
			}
			var usage map[string]map[string][]map[string]any
			if err := json.Unmarshal(response.Body, &usage); err != nil {
				t.Fatalf("usage JSON: %v", err)
			}
			details := usage["fixture-key"]["requested-model"]
			if len(details) != 1 {
				t.Fatalf("request model grouping changed: %s", response.Body)
			}
			detail := details[0]
			if detail["model"] != "requested-model" || detail["alias"] != "client-alias" {
				t.Fatalf("request model or alias changed: %+v", detail)
			}
			got, present := detail["response_model"]
			if tc.want == "" {
				if present {
					t.Fatalf("unknown response model must stay omitted, got %v", got)
				}
			} else if got != tc.want {
				t.Fatalf("response_model = %v, want %q", got, tc.want)
			}
		})
	}
}

func TestResponseModelMigrationPreservesHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	old, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(`CREATE TABLE usage_records (
		id TEXT PRIMARY KEY, timestamp TEXT NOT NULL,
		api_key TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '',
		model TEXT NOT NULL DEFAULT ''
	)`); err != nil {
		_ = old.Close()
		t.Fatal(err)
	}
	if _, err := old.Exec(`INSERT INTO usage_records (id, timestamp, api_key, model)
		VALUES ('legacy', '2026-10-27T10:00:00.000000000Z', 'fixture-key', 'requested-model')`); err != nil {
		_ = old.Close()
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}

	for attempt := 0; attempt < 2; attempt++ {
		store, err := NewSQLiteStore(path)
		if err != nil {
			t.Fatalf("open migrated database: %v", err)
		}
		usage, err := store.Query(context.Background(), QueryRange{})
		if err != nil {
			_ = store.Close()
			t.Fatalf("query migrated history: %v", err)
		}
		history := usage["fixture-key"]["requested-model"]
		if len(history) != 1 || history[0].ID != "legacy" || history[0].ResponseModel != "" {
			_ = store.Close()
			t.Fatalf("history changed: %+v", history)
		}
		if err := store.Close(); err != nil {
			t.Fatal(err)
		}
	}

	store, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	if err := store.Insert(context.Background(), Record{
		ID: "new", Timestamp: time.Date(2026, 10, 27, 11, 0, 0, 0, time.UTC),
		APIKey: "fixture-key", Model: "requested-model", ResponseModel: " upstream-model ",
	}); err != nil {
		t.Fatalf("insert after migration: %v", err)
	}
	usage, err := store.Query(context.Background(), QueryRange{})
	if err != nil {
		t.Fatal(err)
	}
	details := usage["fixture-key"]["requested-model"]
	if len(details) != 2 || details[1].ResponseModel != "upstream-model" {
		t.Fatalf("new response model not preserved after migration: %+v", details)
	}
}
