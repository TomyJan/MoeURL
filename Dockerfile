FROM golang:1.27.1 AS web-build
ARG NODE_VERSION=26.5.1
ARG TARGETARCH
WORKDIR /workspace/web
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && case "${TARGETARCH}" in \
        amd64) node_arch="linux-x64" ;; \
        arm64) node_arch="linux-arm64" ;; \
        *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${node_arch}.tar.xz" -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm -f /tmp/node.tar.xz \
    && node -v \
    && npm -v
COPY web/package.json web/pnpm-lock.yaml ./
RUN npm install -g $(node -p "require('./package.json').packageManager")
RUN pnpm install --frozen-lockfile --config.dangerously-allow-all-builds=true
COPY web/ ./
RUN pnpm build

FROM golang:1.27.1 AS go-build
WORKDIR /workspace
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/moeurl ./cmd/server
RUN CGO_ENABLED=0 go install github.com/pressly/goose/v3/cmd/goose@v3.27.3

FROM alpine:3.24
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
