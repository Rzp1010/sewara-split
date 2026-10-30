# Image API Go (staging lokal + nanti VPS). Binary statis: CGO_ENABLED=0.
FROM golang:1.27-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.21

# ca-certificates: HTTPS keluar (R2, Telegram, SMTP). tzdata: format jam lokal.
# wget: healthcheck container (aplikasi sendiri tidak pernah memanggil shell).
RUN apk add --no-cache ca-certificates tzdata wget

RUN adduser -D -u 10001 app
USER app

COPY --from=build /out/api /usr/local/bin/api

EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/api"]
