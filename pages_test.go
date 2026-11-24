package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestEmbeddedPages(t *testing.T) {
	registration := managementRegistration()
	if len(registration.Routes) != 2 || len(registration.Resources) != 2 {
		t.Fatalf("expected two usage routes and two pages, got %+v", registration)
	}
	for _, tc := range []struct {
		path   string
		marker string
	}{
		{"/monitor", `data-center="monitor"`},
		{"/credential-center", `data-center="credentials"`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			req, err := json.Marshal(managementRequest{
				Method: http.MethodGet,
				Path:   strings.TrimSuffix(pluginResourcePrefix, "/") + tc.path,
			})
			if err != nil {
				t.Fatal(err)
			}
			raw, err := handleMethod("management.handle", req)
			if err != nil {
				t.Fatal(err)
			}
			var response struct {
				OK     bool               `json:"ok"`
				Result managementResponse `json:"result"`
			}
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatal(err)
			}
			if !response.OK || response.Result.StatusCode != http.StatusOK {
				t.Fatalf("resource ABI returned HTTP %d", response.Result.StatusCode)
			}
			if !bytes.Contains(response.Result.Body, []byte(tc.marker)) ||
				!bytes.Contains(response.Result.Body, []byte("<script type=\"module\"")) {
				t.Fatalf("resource response is missing its page marker or embedded app")
			}
			if got := response.Result.Headers["Content-Type"]; len(got) != 1 || got[0] != "text/html; charset=utf-8" {
				t.Fatalf("unexpected resource content type: %v", got)
			}
		})
	}
}

func TestPublicResourcesDoNotServeUsage(t *testing.T) {
	response := servePage(managementRequest{Method: http.MethodGet, Path: pluginResourcePrefix + "usage"})
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("GET public usage resource returned HTTP %d", response.StatusCode)
	}
	response = servePage(managementRequest{Method: http.MethodDelete, Path: pluginResourcePrefix + monitorPagePath})
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE public resource returned HTTP %d", response.StatusCode)
	}
}
