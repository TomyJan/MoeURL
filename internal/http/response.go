package http

import (
	"encoding/json"
	nethttp "net/http"
)

const CodeOK = 0

type Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Meta    any    `json:"meta"`
}

func WriteJSON(w nethttp.ResponseWriter, status int, response Response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(response)
}

func OK(w nethttp.ResponseWriter, data any) {
	WriteJSON(w, nethttp.StatusOK, Response{
		Code:    CodeOK,
		Message: "OK",
		Data:    data,
		Meta:    map[string]any{},
	})
}

func BusinessError(w nethttp.ResponseWriter, code int, message string) {
	WriteJSON(w, nethttp.StatusOK, Response{
		Code:    code,
		Message: message,
		Data:    nil,
		Meta:    map[string]any{},
	})
}
