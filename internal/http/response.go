package http

import (
	"bytes"
	"encoding/json"
	"log/slog"
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
	var buffer bytes.Buffer
	if err := json.NewEncoder(&buffer).Encode(response); err != nil {
		slog.Error("encoding response", "error", err, "response", response)
		nethttp.Error(w, "Internal server error", nethttp.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buffer.Bytes())
}

func OK(w nethttp.ResponseWriter, data any) {
	WriteJSON(w, nethttp.StatusOK, Response{
		Code:    CodeOK,
		Message: "OK",
		Data:    data,
		Meta:    nil,
	})
}

func BusinessError(w nethttp.ResponseWriter, code int, message string) {
	WriteJSON(w, nethttp.StatusOK, Response{
		Code:    code,
		Message: message,
		Data:    nil,
		Meta:    nil,
	})
}
