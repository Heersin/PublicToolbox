use axum::{Json, Router, routing::get};
use serde::Serialize;
use std::net::SocketAddr;
use tracing::info;

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    let app = Router::new()
        .route("/api/healthz", get(healthz))
        .route("/api/readyz", get(readyz));

    let addr: SocketAddr = "0.0.0.0:8080".parse().expect("valid listen address");
    info!(%addr, "tools-api listening");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind tools-api listener");

    axum::serve(listener, app)
        .await
        .expect("run axum server");
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn readyz() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ready" })
}
