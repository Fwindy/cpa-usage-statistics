package main

import (
	"bytes"
	_ "embed"
	"net/http"
	"strings"
)

const (
	pluginResourcePrefix = "/v0/resource/plugins/" + pluginID + "/"
	monitorPagePath      = "monitor"
	credentialPagePath   = "credential-center"
)

//go:embed web/dist/index.html
var monitorPage []byte

var credentialPage = bytes.Replace(monitorPage, []byte(`data-center="monitor"`), []byte(`data-center="credentials"`), 1)

type resourceRoute struct {
	Path        string `json:"Path"`
	Menu        string `json:"Menu"`
	Description string `json:"Description"`
}

func pageResources() []resourceRoute {
	return []resourceRoute{
		{Path: "/" + monitorPagePath, Menu: "监控中心", Description: "Usage trends, model prices and request history"},
		{Path: "/" + credentialPagePath, Menu: "凭证中心", Description: "Credential statistics and quotas"},
	}
}

// Resource routes are public. The pages make their data requests separately
// through the host's authenticated management routes.
func servePage(req managementRequest) managementResponse {
	if req.Method != http.MethodGet {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
	var body []byte
	switch strings.TrimPrefix(req.Path, pluginResourcePrefix) {
	case monitorPagePath:
		body = monitorPage
	case credentialPagePath:
		body = credentialPage
	default:
		return jsonManagementResponse(http.StatusNotFound, map[string]string{"error": "page not found"})
	}
	return managementResponse{
		StatusCode: http.StatusOK,
		Headers: map[string][]string{
			"Content-Type":            {"text/html; charset=utf-8"},
			"Cache-Control":           {"no-store"},
			"Referrer-Policy":         {"no-referrer"},
			"X-Content-Type-Options":  {"nosniff"},
			"Content-Security-Policy": {"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://models.dev; base-uri 'none'; form-action 'none'"},
		},
		Body: body,
	}
}
