use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashMap, fs, net::SocketAddr, path::PathBuf, time::Instant};
use tracing::{error, info};

#[derive(Clone)]
struct AppState {
    tools_by_id: HashMap<String, ToolManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolManifest {
    id: String,
    slug: String,
    name: String,
    description: String,
    tags: Vec<String>,
    version: String,
    execution_mode: String,
    input_schema: String,
    output_schema: String,
    #[serde(default)]
    wasm_entry: Option<String>,
    #[serde(default)]
    api_endpoint: Option<String>,
}

#[derive(Debug, Serialize)]
struct ApiError {
    code: &'static str,
    message: String,
}

#[derive(Debug, Serialize)]
struct ApiMeta {
    duration_ms: u128,
    executor: &'static str,
    version: String,
}

#[derive(Debug, Serialize)]
struct ApiResponse<T>
where
    T: Serialize,
{
    success: bool,
    data: Option<T>,
    error: Option<ApiError>,
    meta: ApiMeta,
}

#[derive(Debug, Deserialize)]
struct RunToolRequest {
    tool_version: String,
    input: Value,
    #[serde(default)]
    trace_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ListToolsResponse {
    tools: Vec<ToolManifest>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    let tool_manifests = load_tool_manifests().unwrap_or_else(|error| {
        error!(%error, "failed loading tool manifests");
        std::process::exit(1);
    });

    let app_state = AppState {
        tools_by_id: tool_manifests
            .into_iter()
            .map(|tool| (tool.id.clone(), tool))
            .collect(),
    };

    let app = Router::new()
        .route("/api/healthz", get(healthz))
        .route("/api/readyz", get(readyz))
        .route("/api/tools/v1/list", get(list_tools))
        .route("/api/tools/v1/run/{tool_id}", post(run_tool))
        .with_state(app_state);

    let addr: SocketAddr = "0.0.0.0:8080".parse().expect("valid listen address");
    info!(%addr, "tools-api listening");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind tools-api listener");

    axum::serve(listener, app)
        .await
        .expect("run axum server");
}

fn load_tool_manifests() -> Result<Vec<ToolManifest>, String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .map_err(|error| format!("resolve repo root: {error}"))?;
    let registry_dir = repo_root.join("registry/tools");

    let entries = fs::read_dir(&registry_dir)
        .map_err(|error| format!("read registry directory {}: {error}", registry_dir.display()))?;

    let mut manifests = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("read registry entry: {error}"))?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default();
        if extension != "yaml" && extension != "yml" {
            continue;
        }

        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("read manifest {}: {error}", path.display()))?;

        let manifest: ToolManifest = serde_yaml::from_str(&raw)
            .map_err(|error| format!("parse manifest {}: {error}", path.display()))?;
        manifests.push(manifest);
    }

    manifests.sort_by(|left, right| left.slug.cmp(&right.slug));
    Ok(manifests)
}

async fn healthz() -> Json<Value> {
    Json(json!({"status": "ok"}))
}

async fn readyz() -> Json<Value> {
    Json(json!({"status": "ready"}))
}

async fn list_tools(State(state): State<AppState>) -> (StatusCode, Json<ApiResponse<ListToolsResponse>>) {
    let started = Instant::now();
    let mut tools = state.tools_by_id.values().cloned().collect::<Vec<_>>();
    tools.sort_by(|left, right| left.slug.cmp(&right.slug));

    (
        StatusCode::OK,
        Json(ApiResponse {
            success: true,
            data: Some(ListToolsResponse { tools }),
            error: None,
            meta: ApiMeta {
                duration_ms: started.elapsed().as_millis(),
                executor: "server-api",
                version: "v1".to_string(),
            },
        }),
    )
}

async fn run_tool(
    State(state): State<AppState>,
    Path(tool_id): Path<String>,
    Json(request): Json<RunToolRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    let started = Instant::now();

    if let Some(trace_id) = request.trace_id.as_deref() {
        info!(%trace_id, %tool_id, "run request received");
    }

    let Some(tool) = state.tools_by_id.get(&tool_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(error_response(
                started.elapsed().as_millis(),
                "TOOL_NOT_FOUND",
                format!("tool id not found: {tool_id}"),
                "v1".to_string(),
            )),
        );
    };

    if request.tool_version != tool.version {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_response(
                started.elapsed().as_millis(),
                "VERSION_MISMATCH",
                format!(
                    "tool version mismatch, expected {}, got {}",
                    tool.version, request.tool_version
                ),
                tool.version.clone(),
            )),
        );
    }

    let result = match tool.id.as_str() {
        "subb-server-sample" => run_word_count_tool(&request.input),
        _ => Err(String::from("tool has no server runtime implementation")),
    };

    match result {
        Ok(data) => (
            StatusCode::OK,
            Json(ApiResponse {
                success: true,
                data: Some(data),
                error: None,
                meta: ApiMeta {
                    duration_ms: started.elapsed().as_millis(),
                    executor: "server-api",
                    version: tool.version.clone(),
                },
            }),
        ),
        Err(message) => (
            StatusCode::BAD_REQUEST,
            Json(error_response(
                started.elapsed().as_millis(),
                "RUN_FAILED",
                message,
                tool.version.clone(),
            )),
        ),
    }
}

fn run_word_count_tool(input: &Value) -> Result<Value, String> {
    let text = input
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| String::from("input.text must be a string"))?;

    let word_count = tool_core::count_words(text);
    Ok(json!({ "word_count": word_count }))
}

fn error_response(duration_ms: u128, code: &'static str, message: String, version: String) -> ApiResponse<Value> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(ApiError { code, message }),
        meta: ApiMeta {
            duration_ms,
            executor: "server-api",
            version,
        },
    }
}
