use std::net::SocketAddr;
use tracing::info;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    let app = tools_api::build_app().unwrap_or_else(|error| {
        tracing::error!(%error, "failed building application router");
        std::process::exit(1);
    });

    let addr: SocketAddr = "0.0.0.0:8080".parse().expect("valid listen address");
    info!(%addr, "tools-api listening");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind tools-api listener");

    axum::serve(listener, app)
        .await
        .expect("run axum server");
}
