# syntax=docker/dockerfile:1

FROM node:24-alpine AS web-build
WORKDIR /workspace/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --config.dangerously-allow-all-builds=true
COPY web/ ./
RUN pnpm build

FROM golang:1.25-alpine AS go-build
WORKDIR /workspace
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/moeurl ./cmd/server
RUN go install github.com/pressly/goose/v3/cmd/goose@v3.26.0

FROM alpine:3.23
WORKDIR /app
RUN apk add --no-cache ca-certificates && addgroup -S moeurl && adduser -S -G moeurl moeurl
COPY --from=go-build /out/moeurl /app/moeurl
COPY --from=go-build /go/bin/goose /app/goose
COPY --from=web-build /workspace/web/dist /app/web
COPY migrations /app/migrations
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh && chown -R moeurl:moeurl /app
ENV MOEURL_ENV=production
ENV MOEURL_HTTP_ADDR=:8080
ENV MOEURL_STATIC_DIR=/app/web
EXPOSE 8080
USER moeurl
ENTRYPOINT ["/app/entrypoint.sh"]
