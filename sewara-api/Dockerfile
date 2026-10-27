# Build di luar VPS: VPS hanya menerima binary. Image ini untuk staging lokal.
FROM golang:1.27-alpine AS build

WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.21

RUN adduser -D -u 10001 app
USER app

COPY --from=build /out/api /usr/local/bin/api

EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/api"]
