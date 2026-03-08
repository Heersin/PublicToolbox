use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};
use tracing::info;

const MAX_INPUT_CHARS: usize = 20_000;
const RUN_TIMEOUT_SECONDS: u64 = 3;

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
    #[serde(default)]
    external_href: Option<String>,
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

pub fn build_app() -> Result<Router, String> {
    let manifests = load_tool_manifests()?;
    Ok(build_router(manifests))
}

fn build_router(tool_manifests: Vec<ToolManifest>) -> Router {
    let app_state = AppState {
        tools_by_id: tool_manifests
            .into_iter()
            .map(|tool| (tool.id.clone(), tool))
            .collect(),
    };

    Router::new()
        .route("/api/healthz", get(healthz))
        .route("/api/readyz", get(readyz))
        .route("/api/tools/v1/list", get(list_tools))
        .route("/api/tools/v1/run/{tool_id}", post(run_tool))
        .layer(DefaultBodyLimit::max(1_048_576))
        .with_state(app_state)
}

fn load_tool_manifests() -> Result<Vec<ToolManifest>, String> {
    let registry_dir = std::env::var("TOOLS_REGISTRY_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("registry/tools"));

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

    let text = match request.input.get("text").and_then(Value::as_str) {
        Some(value) => value,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "INVALID_INPUT",
                    String::from("input.text must be a string"),
                    tool.version.clone(),
                )),
            );
        }
    };

    if text.len() > MAX_INPUT_CHARS {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_response(
                started.elapsed().as_millis(),
                "INPUT_TOO_LARGE",
                format!("input text exceeds {MAX_INPUT_CHARS} characters"),
                tool.version.clone(),
            )),
        );
    }

    let execution = tokio::time::timeout(Duration::from_secs(RUN_TIMEOUT_SECONDS), async {
        match tool.id.as_str() {
            "subb-server-sample" => Ok(json!({ "word_count": tool_core::count_words(text) })),
            "subc-hybrid-sample" => Ok(json!({ "result": tool_core::reverse_text(text) })),
            _ => Err(String::from("tool has no server runtime implementation")),
        }
    })
    .await;

    let result = match execution {
        Ok(inner) => inner,
        Err(_) => {
            return (
                StatusCode::REQUEST_TIMEOUT,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "RUN_TIMEOUT",
                    format!("tool execution exceeded {RUN_TIMEOUT_SECONDS} seconds"),
                    tool.version.clone(),
                )),
            );
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    fn sample_manifests() -> Vec<ToolManifest> {
        vec![
            ToolManifest {
                id: "subb-server-sample".to_string(),
                slug: "subB".to_string(),
                name: "SubB".to_string(),
                description: "server tool".to_string(),
                tags: vec!["server".to_string()],
                version: "0.1.0".to_string(),
                execution_mode: "server-api".to_string(),
                input_schema: "schemas/subB-input.json".to_string(),
                output_schema: "schemas/subB-output.json".to_string(),
                wasm_entry: None,
                api_endpoint: Some("/api/tools/v1/run/subb-server-sample".to_string()),
                external_href: None,
            },
            ToolManifest {
                id: "subc-hybrid-sample".to_string(),
                slug: "subC".to_string(),
                name: "SubC".to_string(),
                description: "hybrid tool".to_string(),
                tags: vec!["hybrid".to_string()],
                version: "0.1.0".to_string(),
                execution_mode: "hybrid".to_string(),
                input_schema: "schemas/subC-input.json".to_string(),
                output_schema: "schemas/subC-output.json".to_string(),
                wasm_entry: Some("reverse_text".to_string()),
                api_endpoint: Some("/api/tools/v1/run/subc-hybrid-sample".to_string()),
                external_href: None,
            },
        ]
    }

    #[tokio::test]
    async fn list_tools_returns_success() {
        let app = build_router(sample_manifests());

        let response = app
            .oneshot(Request::builder().uri("/api/tools/v1/list").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(payload["success"], Value::Bool(true));
        assert_eq!(payload["data"]["tools"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn run_tool_returns_word_count() {
        let app = build_router(sample_manifests());

        let request_body = json!({
            "tool_version": "0.1.0",
            "input": { "text": "ink over paper" }
        })
        .to_string();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tools/v1/run/subb-server-sample")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["data"]["word_count"], Value::from(3));
    }

    #[tokio::test]
    async fn run_tool_rejects_version_mismatch() {
        let app = build_router(sample_manifests());

        let request_body = json!({
            "tool_version": "9.9.9",
            "input": { "text": "ink over paper" }
        })
        .to_string();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tools/v1/run/subb-server-sample")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["error"]["code"], Value::String("VERSION_MISMATCH".to_string()));
    }

    #[tokio::test]
    async fn run_tool_rejects_invalid_input() {
        let app = build_router(sample_manifests());

        let request_body = json!({
            "tool_version": "0.1.0",
            "input": { "not_text": "x" }
        })
        .to_string();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tools/v1/run/subb-server-sample")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["error"]["code"], Value::String("INVALID_INPUT".to_string()));
    }
}
