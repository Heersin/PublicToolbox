FROM rust:1.93-bookworm AS builder
WORKDIR /app
COPY . .
RUN cargo build --release -p tools-api

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=builder /app/target/release/tools-api /usr/local/bin/tools-api
COPY --from=builder /app/registry /app/registry
ENV TOOLS_REGISTRY_DIR=/app/registry/tools
ENV RUST_LOG=info
EXPOSE 8080
USER app
CMD ["/usr/local/bin/tools-api"]
