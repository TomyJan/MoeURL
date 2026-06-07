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
		slog.Error("encoding response", "error", err)
		writeInternalServerError(w)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buffer.Bytes())
}

func writeInternalServerError(w nethttp.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(nethttp.StatusInternalServerError)
	_, _ = w.Write([]byte(`{"code":500,"message":"Internal server error","data":null,"meta":null}` + "\n"))
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
