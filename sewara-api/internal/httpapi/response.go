package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// Kode error disalin dari sewara-backend/lib/api/constants.ts.
// Frontend mempercabangkan berdasarkan nilai string ini (api-client.js), jadi
// nilainya TIDAK boleh berubah saat port. Golden fixture yang menegakkannya.
const (
	CodeUnauthorized         = "UNAUTHORIZED"
	CodeForbidden            = "FORBIDDEN"
	CodeInvalidCredentials   = "INVALID_CREDENTIALS"
	CodeEmailNotVerified     = "EMAIL_NOT_VERIFIED"
	CodeAccountLocked        = "ACCOUNT_LOCKED"
	CodeAccountCooldown      = "ACCOUNT_COOLDOWN"
	CodeSubscriptionExpired  = "SUBSCRIPTION_EXPIRED"
	CodeValidationError      = "VALIDATION_ERROR"
	CodeInvalidInput         = "INVALID_INPUT"
	CodeRateLimitExceeded    = "RATE_LIMIT_EXCEEDED"
	CodeNotFound             = "NOT_FOUND"
	CodeAlreadyExists        = "ALREADY_EXISTS"
	CodeInternalError        = "INTERNAL_ERROR"
	CodeDatabaseError        = "DATABASE_ERROR"
	CodeExternalServiceError = "EXTERNAL_SERVICE_ERROR"
)

// Bentuk amplop mengikuti lib/api/response.ts: {ok:true, data?} dan
// {ok:false, error:{code, message, details?}}. Frontend meng-unwrap `data`.
type successBody struct {
	OK   bool `json:"ok"`
	Data any  `json:"data,omitempty"`
}

type errorBody struct {
	OK    bool      `json:"ok"`
	Error errorInfo `json:"error"`
}

type errorInfo struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func writeSuccess(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, successBody{OK: true, Data: data})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{OK: false, Error: errorInfo{Code: code, Message: message}})
}

func writeValidationError(w http.ResponseWriter, message string, details any) {
	writeJSON(w, http.StatusBadRequest, errorBody{
		OK:    false,
		Error: errorInfo{Code: CodeValidationError, Message: message, Details: details},
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// Header sudah terkirim; tidak ada respons yang bisa diperbaiki.
		slog.Error("gagal menulis respons JSON", "err", err)
	}
}
