use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, State, multipart::MultipartRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use image::{DynamicImage, ImageFormat, RgbImage, codecs::jpeg::JpegEncoder};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Cursor,
    path::{Path as FsPath, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tracing::info;

const MAX_INPUT_CHARS: usize = 20_000;
const MAX_IMAGE_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES: usize = MAX_IMAGE_FILE_BYTES + (256 * 1024);
const JPEG_QUALITY: u8 = 85;
const RUN_TIMEOUT_SECONDS: u64 = 3;
const MAX_PASSWORD_CHARS: usize = 20;
const MIN_PHRASE_CHARS: usize = 3;
const MAX_PHRASE_CHARS: usize = 32;
const CLIPBOARD_RETENTION_SECONDS: i64 = 7 * 24 * 60 * 60;
const CLIPBOARD_API_VERSION: &str = "clipboard-v1";
const MEDIA_API_VERSION: &str = "media-v1";
const DEFAULT_CLIPBOARD_DB_PATH: &str = "./data/clipboard.db";

#[derive(Clone)]
struct AppState {
    tools_by_id: HashMap<String, ToolManifest>,
    clipboard_db_path: PathBuf,
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

#[derive(Debug, Deserialize)]
struct ClipboardGetRequest {
    phrase: String,
    #[serde(default)]
    password: String,
}

#[derive(Debug, Deserialize)]
struct ClipboardSaveRequest {
    phrase: String,
    #[serde(default)]
    password: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct ClipboardClearRequest {
    phrase: String,
    #[serde(default)]
    password: String,
}

#[derive(Debug, Serialize)]
struct ClipboardGetData {
    phrase: String,
    text: String,
    has_password: bool,
    updated_at: String,
    exists: bool,
}

#[derive(Debug, Serialize)]
struct ClipboardMutationData {
    phrase: String,
    has_password: bool,
    updated_at: String,
}

#[derive(Debug)]
struct ClipboardRecord {
    text: String,
    pass_salt: Option<String>,
    pass_hash: Option<String>,
    updated_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TargetImageFormat {
    Png,
    Jpg,
    Webp,
}

impl TargetImageFormat {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpg),
            "webp" => Some(Self::Webp),
            _ => None,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpg => "jpg",
            Self::Webp => "webp",
        }
    }

    fn content_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }
}

pub fn build_app() -> Result<Router, String> {
    let manifests = load_tool_manifests()?;
    let clipboard_db_path = resolve_clipboard_db_path();
    init_clipboard_db(&clipboard_db_path)?;
    Ok(build_router(manifests, clipboard_db_path))
}

fn build_router(tool_manifests: Vec<ToolManifest>, clipboard_db_path: PathBuf) -> Router {
    let app_state = AppState {
        tools_by_id: tool_manifests
            .into_iter()
            .map(|tool| (tool.id.clone(), tool))
            .collect(),
        clipboard_db_path,
    };

    Router::new()
        .route("/api/healthz", get(healthz))
        .route("/api/readyz", get(readyz))
        .route("/api/tools/v1/list", get(list_tools))
        .route("/api/tools/v1/run/{tool_id}", post(run_tool))
        .route("/api/media/v1/convert-image", post(convert_image))
        .route("/api/clipboard/v1/get", post(get_clipboard))
        .route("/api/clipboard/v1/save", post(save_clipboard))
        .route("/api/clipboard/v1/clear", post(clear_clipboard))
        .layer(DefaultBodyLimit::max(MAX_MULTIPART_BODY_BYTES))
        .with_state(app_state)
}

fn resolve_clipboard_db_path() -> PathBuf {
    std::env::var("CLIPBOARD_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(DEFAULT_CLIPBOARD_DB_PATH))
}

fn init_clipboard_db(db_path: &FsPath) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create clipboard db directory {}: {error}", parent.display()))?;
    }

    let connection = Connection::open(db_path)
        .map_err(|error| format!("open clipboard db {}: {error}", db_path.display()))?;

    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS clipboards (
              phrase TEXT PRIMARY KEY,
              text TEXT NOT NULL,
              pass_salt TEXT,
              pass_hash TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              last_accessed_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_clipboards_last_accessed_at
              ON clipboards(last_accessed_at);
            ",
        )
        .map_err(|error| format!("initialize clipboard db schema: {error}"))?;

    Ok(())
}

fn open_clipboard_db(db_path: &FsPath) -> Result<Connection, String> {
    Connection::open(db_path).map_err(|error| format!("open clipboard db {}: {error}", db_path.display()))
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
        Json(success_response(
            started.elapsed().as_millis(),
            ListToolsResponse { tools },
            "v1",
        )),
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
                "v1",
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
                &tool.version,
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
                    &tool.version,
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
                &tool.version,
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
                    &tool.version,
                )),
            );
        }
    };

    match result {
        Ok(data) => (
            StatusCode::OK,
            Json(success_response(
                started.elapsed().as_millis(),
                data,
                &tool.version,
            )),
        ),
        Err(message) => (
            StatusCode::BAD_REQUEST,
            Json(error_response(
                started.elapsed().as_millis(),
                "RUN_FAILED",
                message,
                &tool.version,
            )),
        ),
    }
}

async fn convert_image(multipart_result: Result<Multipart, MultipartRejection>) -> Response {
    let started = Instant::now();

    let mut multipart = match multipart_result {
        Ok(payload) => payload,
        Err(error) => {
            return media_json_error(
                StatusCode::BAD_REQUEST,
                started.elapsed().as_millis(),
                "INVALID_MULTIPART",
                format!("invalid multipart payload: {error}"),
            );
        }
    };

    let mut file_bytes: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut target_format_raw: Option<String> = None;
    let mut background_raw: Option<String> = None;

    loop {
        let maybe_field = match multipart.next_field().await {
            Ok(field) => field,
            Err(error) => {
                return media_json_error(
                    StatusCode::BAD_REQUEST,
                    started.elapsed().as_millis(),
                    "INVALID_MULTIPART",
                    format!("failed reading multipart field: {error}"),
                );
            }
        };

        let Some(field) = maybe_field else {
            break;
        };

        let field_name = field.name().unwrap_or_default().to_string();
        match field_name.as_str() {
            "file" => {
                if file_bytes.is_some() {
                    return media_json_error(
                        StatusCode::BAD_REQUEST,
                        started.elapsed().as_millis(),
                        "INVALID_FIELD",
                        String::from("duplicate file field"),
                    );
                }

                file_name = field.file_name().map(str::to_string);
                let bytes = match field.bytes().await {
                    Ok(bytes) => bytes.to_vec(),
                    Err(error) => {
                        return media_json_error(
                            StatusCode::BAD_REQUEST,
                            started.elapsed().as_millis(),
                            "INVALID_MULTIPART",
                            format!("failed reading uploaded file: {error}"),
                        );
                    }
                };

                if bytes.len() > MAX_IMAGE_FILE_BYTES {
                    return media_json_error(
                        StatusCode::BAD_REQUEST,
                        started.elapsed().as_millis(),
                        "FILE_TOO_LARGE",
                        format!("file exceeds {MAX_IMAGE_FILE_BYTES} bytes"),
                    );
                }

                file_bytes = Some(bytes);
            }
            "target_format" => {
                if target_format_raw.is_some() {
                    return media_json_error(
                        StatusCode::BAD_REQUEST,
                        started.elapsed().as_millis(),
                        "INVALID_FIELD",
                        String::from("duplicate target_format field"),
                    );
                }

                let value = match field.text().await {
                    Ok(text) => text.trim().to_ascii_lowercase(),
                    Err(error) => {
                        return media_json_error(
                            StatusCode::BAD_REQUEST,
                            started.elapsed().as_millis(),
                            "INVALID_MULTIPART",
                            format!("failed reading target_format field: {error}"),
                        );
                    }
                };
                target_format_raw = Some(value);
            }
            "background" => {
                if background_raw.is_some() {
                    return media_json_error(
                        StatusCode::BAD_REQUEST,
                        started.elapsed().as_millis(),
                        "INVALID_FIELD",
                        String::from("duplicate background field"),
                    );
                }

                let value = match field.text().await {
                    Ok(text) => text.trim().to_string(),
                    Err(error) => {
                        return media_json_error(
                            StatusCode::BAD_REQUEST,
                            started.elapsed().as_millis(),
                            "INVALID_MULTIPART",
                            format!("failed reading background field: {error}"),
                        );
                    }
                };

                if !value.is_empty() {
                    background_raw = Some(value);
                }
            }
            _ => {}
        }
    }

    let Some(bytes) = file_bytes else {
        return media_json_error(
            StatusCode::BAD_REQUEST,
            started.elapsed().as_millis(),
            "FILE_REQUIRED",
            String::from("file field is required"),
        );
    };

    if bytes.is_empty() {
        return media_json_error(
            StatusCode::BAD_REQUEST,
            started.elapsed().as_millis(),
            "EMPTY_FILE",
            String::from("uploaded file is empty"),
        );
    }

    let Some(target_format_value) = target_format_raw else {
        return media_json_error(
            StatusCode::BAD_REQUEST,
            started.elapsed().as_millis(),
            "TARGET_FORMAT_REQUIRED",
            String::from("target_format field is required"),
        );
    };

    let Some(target_format) = TargetImageFormat::parse(&target_format_value) else {
        return media_json_error(
            StatusCode::BAD_REQUEST,
            started.elapsed().as_millis(),
            "UNSUPPORTED_TARGET_FORMAT",
            String::from("target_format must be png, jpg, or webp"),
        );
    };

    let background = if target_format == TargetImageFormat::Jpg {
        match background_raw {
            Some(color) => match parse_background_color(&color) {
                Ok(parsed) => Some(parsed),
                Err(message) => {
                    return media_json_error(
                        StatusCode::BAD_REQUEST,
                        started.elapsed().as_millis(),
                        "INVALID_BACKGROUND",
                        message,
                    );
                }
            },
            None => Some([255, 255, 255]),
        }
    } else {
        None
    };

    let output_bytes = match convert_image_bytes(&bytes, target_format, background) {
        Ok(bytes) => bytes,
        Err(MediaConvertError::UnsupportedInputFormat(message)) => {
            return media_json_error(
                StatusCode::BAD_REQUEST,
                started.elapsed().as_millis(),
                "UNSUPPORTED_INPUT_FORMAT",
                message,
            );
        }
        Err(MediaConvertError::InvalidImageData(message)) => {
            return media_json_error(
                StatusCode::BAD_REQUEST,
                started.elapsed().as_millis(),
                "INVALID_IMAGE_DATA",
                message,
            );
        }
        Err(MediaConvertError::EncodeFailed(message)) => {
            return media_json_error(
                StatusCode::BAD_REQUEST,
                started.elapsed().as_millis(),
                "CONVERT_FAILED",
                message,
            );
        }
    };

    let output_name = build_output_filename(file_name.as_deref(), target_format.extension());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(target_format.content_type()),
    );
    let content_disposition = format!("attachment; filename=\"{output_name}\"");
    if let Ok(value) = HeaderValue::from_str(&content_disposition) {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }

    (StatusCode::OK, headers, output_bytes).into_response()
}

async fn get_clipboard(
    State(state): State<AppState>,
    Json(request): Json<ClipboardGetRequest>,
) -> (StatusCode, Json<ApiResponse<ClipboardGetData>>) {
    let started = Instant::now();

    let phrase = match normalize_phrase(&request.phrase) {
        Ok(phrase) => phrase,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "INVALID_PHRASE",
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }
    };

    if let Err(message) = validate_password(&request.password) {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_response(
                started.elapsed().as_millis(),
                "INVALID_PASSWORD",
                message,
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    let phrase_fingerprint = phrase_fingerprint(&phrase);
    info!(%phrase_fingerprint, "clipboard get request received");

    let connection = match open_clipboard_db(&state.clipboard_db_path) {
        Ok(connection) => connection,
        Err(message) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "DB_ERROR",
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }
    };

    let now = now_epoch_seconds();
    if let Err(message) = cleanup_expired(&connection, now) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(error_response(
                started.elapsed().as_millis(),
                "DB_ERROR",
                message,
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    let record = match load_clipboard(&connection, &phrase) {
        Ok(record) => record,
        Err(message) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "DB_ERROR",
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }
    };

    let Some(record) = record else {
        return (
            StatusCode::OK,
            Json(success_response(
                started.elapsed().as_millis(),
                ClipboardGetData {
                    phrase,
                    text: String::new(),
                    has_password: false,
                    updated_at: String::new(),
                    exists: false,
                },
                CLIPBOARD_API_VERSION,
            )),
        );
    };

    if let Some(status) = ensure_authorized(&record, &request.password) {
        let (status_code, code, message) = status;
        return (
            status_code,
            Json(error_response(
                started.elapsed().as_millis(),
                code,
                message,
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    if let Err(message) = touch_last_accessed(&connection, &phrase, now) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(error_response(
                started.elapsed().as_millis(),
                "DB_ERROR",
                message,
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    (
        StatusCode::OK,
        Json(success_response(
            started.elapsed().as_millis(),
            ClipboardGetData {
                phrase,
                text: record.text,
                has_password: record.pass_hash.is_some(),
                updated_at: record.updated_at.to_string(),
                exists: true,
            },
            CLIPBOARD_API_VERSION,
        )),
    )
}

async fn save_clipboard(
    State(state): State<AppState>,
    Json(request): Json<ClipboardSaveRequest>,
) -> (StatusCode, Json<ApiResponse<ClipboardMutationData>>) {
    let started = Instant::now();

    let phrase = match normalize_phrase(&request.phrase) {
        Ok(phrase) => phrase,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "INVALID_PHRASE",
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }
    };

    if let Err(message) = validate_password(&request.password) {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_response(
                started.elapsed().as_millis(),
                "INVALID_PASSWORD",
                message,
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    if request.text.len() > MAX_INPUT_CHARS {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_response(
                started.elapsed().as_millis(),
                "INVALID_INPUT",
                format!("text exceeds {MAX_INPUT_CHARS} characters"),
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    let phrase_fingerprint = phrase_fingerprint(&phrase);
    info!(%phrase_fingerprint, "clipboard save request received");

    let connection = match open_clipboard_db(&state.clipboard_db_path) {
        Ok(connection) => connection,
        Err(message) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "DB_ERROR",
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }
    };

    let now = now_epoch_seconds();
    if let Err(message) = cleanup_expired(&connection, now) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(error_response(
                started.elapsed().as_millis(),
                "DB_ERROR",
                message,
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    let existing = match load_clipboard(&connection, &phrase) {
        Ok(record) => record,
        Err(message) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "DB_ERROR",
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }
    };

    let has_password = if let Some(record) = existing {
        if let Some(status) = ensure_authorized(&record, &request.password) {
            let (status_code, code, message) = status;
            return (
                status_code,
                Json(error_response(
                    started.elapsed().as_millis(),
                    code,
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }

        if record.pass_hash.is_some() {
            if let Err(message) = connection.execute(
                "
                UPDATE clipboards
                SET text = ?1, updated_at = ?2, last_accessed_at = ?3
                WHERE phrase = ?4
                ",
                params![request.text, now, now, phrase],
            ) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_response(
                        started.elapsed().as_millis(),
                        "DB_ERROR",
                        format!("update clipboard: {message}"),
                        CLIPBOARD_API_VERSION,
                    )),
                );
            }

            true
        } else if request.password.is_empty() {
            if let Err(message) = connection.execute(
                "
                UPDATE clipboards
                SET text = ?1, updated_at = ?2, last_accessed_at = ?3
                WHERE phrase = ?4
                ",
                params![request.text, now, now, phrase],
            ) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_response(
                        started.elapsed().as_millis(),
                        "DB_ERROR",
                        format!("update clipboard: {message}"),
                        CLIPBOARD_API_VERSION,
                    )),
                );
            }

            false
        } else {
            let (salt, hash) = create_password_material(&request.password);
            if let Err(message) = connection.execute(
                "
                UPDATE clipboards
                SET text = ?1, pass_salt = ?2, pass_hash = ?3, updated_at = ?4, last_accessed_at = ?5
                WHERE phrase = ?6
                ",
                params![request.text, salt, hash, now, now, phrase],
            ) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_response(
                        started.elapsed().as_millis(),
                        "DB_ERROR",
                        format!("update clipboard with password: {message}"),
                        CLIPBOARD_API_VERSION,
                    )),
                );
            }

            true
        }
    } else {
        let password_material = if request.password.is_empty() {
            None
        } else {
            Some(create_password_material(&request.password))
        };

        let (pass_salt, pass_hash) = match password_material {
            Some((salt, hash)) => (Some(salt), Some(hash)),
            None => (None, None),
        };

        if let Err(message) = connection.execute(
            "
            INSERT INTO clipboards
              (phrase, text, pass_salt, pass_hash, created_at, updated_at, last_accessed_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ",
            params![phrase, request.text, pass_salt, pass_hash, now, now, now],
        ) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "DB_ERROR",
                    format!("insert clipboard: {message}"),
                    CLIPBOARD_API_VERSION,
                )),
            );
        }

        !request.password.is_empty()
    };

    (
        StatusCode::OK,
        Json(success_response(
            started.elapsed().as_millis(),
            ClipboardMutationData {
                phrase,
                has_password,
                updated_at: now.to_string(),
            },
            CLIPBOARD_API_VERSION,
        )),
    )
}

async fn clear_clipboard(
    State(state): State<AppState>,
    Json(request): Json<ClipboardClearRequest>,
) -> (StatusCode, Json<ApiResponse<ClipboardMutationData>>) {
    let started = Instant::now();

    let phrase = match normalize_phrase(&request.phrase) {
        Ok(phrase) => phrase,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "INVALID_PHRASE",
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }
    };

    if let Err(message) = validate_password(&request.password) {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_response(
                started.elapsed().as_millis(),
                "INVALID_PASSWORD",
                message,
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    let phrase_fingerprint = phrase_fingerprint(&phrase);
    info!(%phrase_fingerprint, "clipboard clear request received");

    let connection = match open_clipboard_db(&state.clipboard_db_path) {
        Ok(connection) => connection,
        Err(message) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "DB_ERROR",
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }
    };

    let now = now_epoch_seconds();
    if let Err(message) = cleanup_expired(&connection, now) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(error_response(
                started.elapsed().as_millis(),
                "DB_ERROR",
                message,
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    let Some(record) = (match load_clipboard(&connection, &phrase) {
        Ok(record) => record,
        Err(message) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_response(
                    started.elapsed().as_millis(),
                    "DB_ERROR",
                    message,
                    CLIPBOARD_API_VERSION,
                )),
            );
        }
    }) else {
        return (
            StatusCode::NOT_FOUND,
            Json(error_response(
                started.elapsed().as_millis(),
                "CLIPBOARD_NOT_FOUND",
                String::from("phrase not found"),
                CLIPBOARD_API_VERSION,
            )),
        );
    };

    if let Some(status) = ensure_authorized(&record, &request.password) {
        let (status_code, code, message) = status;
        return (
            status_code,
            Json(error_response(
                started.elapsed().as_millis(),
                code,
                message,
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    if let Err(message) = connection.execute(
        "
        UPDATE clipboards
        SET text = '', updated_at = ?1, last_accessed_at = ?2
        WHERE phrase = ?3
        ",
        params![now, now, phrase],
    ) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(error_response(
                started.elapsed().as_millis(),
                "DB_ERROR",
                format!("clear clipboard: {message}"),
                CLIPBOARD_API_VERSION,
            )),
        );
    }

    (
        StatusCode::OK,
        Json(success_response(
            started.elapsed().as_millis(),
            ClipboardMutationData {
                phrase,
                has_password: record.pass_hash.is_some(),
                updated_at: now.to_string(),
            },
            CLIPBOARD_API_VERSION,
        )),
    )
}

#[derive(Debug)]
enum MediaConvertError {
    UnsupportedInputFormat(String),
    InvalidImageData(String),
    EncodeFailed(String),
}

fn media_json_error(status: StatusCode, duration_ms: u128, code: &'static str, message: String) -> Response {
    (status, Json(error_response::<Value>(duration_ms, code, message, MEDIA_API_VERSION))).into_response()
}

fn parse_background_color(raw: &str) -> Result<[u8; 3], String> {
    if raw.len() != 7 || !raw.starts_with('#') {
        return Err(String::from("background must match #RRGGBB"));
    }

    let red = u8::from_str_radix(&raw[1..3], 16).map_err(|_| String::from("background has invalid red channel"))?;
    let green =
        u8::from_str_radix(&raw[3..5], 16).map_err(|_| String::from("background has invalid green channel"))?;
    let blue =
        u8::from_str_radix(&raw[5..7], 16).map_err(|_| String::from("background has invalid blue channel"))?;

    Ok([red, green, blue])
}

fn build_output_filename(raw_file_name: Option<&str>, extension: &str) -> String {
    let base = raw_file_name
        .and_then(extract_safe_stem)
        .unwrap_or_else(|| String::from("converted"));
    format!("{base}-yixing.{extension}")
}

fn extract_safe_stem(raw_file_name: &str) -> Option<String> {
    let slash_name = raw_file_name.rsplit('/').next().unwrap_or(raw_file_name);
    let file_name = slash_name.rsplit('\\').next().unwrap_or(slash_name);
    let stem = FsPath::new(file_name).file_stem()?.to_str()?.trim();

    if stem.is_empty() {
        return None;
    }

    let mut sanitized = String::with_capacity(stem.len());
    for char in stem.chars() {
        if char.is_ascii_alphanumeric() || char == '-' || char == '_' {
            sanitized.push(char);
        } else {
            sanitized.push('-');
        }
    }

    let normalized = sanitized.trim_matches('-').to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn is_supported_input_format(format: ImageFormat) -> bool {
    matches!(format, ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP)
}

fn convert_image_bytes(
    source_bytes: &[u8],
    target_format: TargetImageFormat,
    background: Option<[u8; 3]>,
) -> Result<Vec<u8>, MediaConvertError> {
    let source_format = image::guess_format(source_bytes).map_err(|error| {
        MediaConvertError::InvalidImageData(format!("failed guessing source image format: {error}"))
    })?;

    if !is_supported_input_format(source_format) {
        return Err(MediaConvertError::UnsupportedInputFormat(format!(
            "unsupported source image format: {source_format:?}"
        )));
    }

    let decoded = image::load_from_memory_with_format(source_bytes, source_format)
        .map_err(|error| MediaConvertError::InvalidImageData(format!("failed decoding source image: {error}")))?;

    match target_format {
        TargetImageFormat::Png => encode_dynamic(&decoded, ImageFormat::Png),
        TargetImageFormat::Webp => encode_dynamic(&decoded, ImageFormat::WebP),
        TargetImageFormat::Jpg => encode_jpeg(&decoded, background.unwrap_or([255, 255, 255])),
    }
}

fn encode_dynamic(image: &DynamicImage, format: ImageFormat) -> Result<Vec<u8>, MediaConvertError> {
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, format)
        .map_err(|error| MediaConvertError::EncodeFailed(format!("failed encoding image: {error}")))?;
    Ok(cursor.into_inner())
}

fn encode_jpeg(image: &DynamicImage, background: [u8; 3]) -> Result<Vec<u8>, MediaConvertError> {
    let flattened = flatten_for_jpeg(image, background);
    let mut cursor = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut cursor, JPEG_QUALITY);
    encoder
        .encode_image(&DynamicImage::ImageRgb8(flattened))
        .map_err(|error| MediaConvertError::EncodeFailed(format!("failed encoding jpeg: {error}")))?;
    Ok(cursor.into_inner())
}

fn flatten_for_jpeg(image: &DynamicImage, background: [u8; 3]) -> RgbImage {
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut rgb = RgbImage::new(width, height);

    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = u16::from(pixel[3]);
        let inv_alpha = 255 - alpha;

        let red = ((u16::from(pixel[0]) * alpha) + (u16::from(background[0]) * inv_alpha) + 127) / 255;
        let green = ((u16::from(pixel[1]) * alpha) + (u16::from(background[1]) * inv_alpha) + 127) / 255;
        let blue = ((u16::from(pixel[2]) * alpha) + (u16::from(background[2]) * inv_alpha) + 127) / 255;

        rgb.put_pixel(x, y, image::Rgb([red as u8, green as u8, blue as u8]));
    }

    rgb
}

fn normalize_phrase(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if !(MIN_PHRASE_CHARS..=MAX_PHRASE_CHARS).contains(&trimmed.len()) {
        return Err(format!(
            "phrase length must be between {MIN_PHRASE_CHARS} and {MAX_PHRASE_CHARS}"
        ));
    }

    if !trimmed
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || char == '_' || char == '-')
    {
        return Err(String::from("phrase must match [A-Za-z0-9_-]"));
    }

    Ok(trimmed.to_ascii_lowercase())
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() > MAX_PASSWORD_CHARS {
        return Err(format!("password length must be <= {MAX_PASSWORD_CHARS}"));
    }
    Ok(())
}

fn ensure_authorized(
    record: &ClipboardRecord,
    candidate_password: &str,
) -> Option<(StatusCode, &'static str, String)> {
    if record.pass_hash.is_none() {
        return None;
    }

    if candidate_password.is_empty() {
        return Some((
            StatusCode::UNAUTHORIZED,
            "AUTH_REQUIRED",
            String::from("password is required for this phrase"),
        ));
    }

    if !verify_password(record, candidate_password) {
        return Some((
            StatusCode::FORBIDDEN,
            "AUTH_FAILED",
            String::from("password is incorrect"),
        ));
    }

    None
}

fn cleanup_expired(connection: &Connection, now: i64) -> Result<(), String> {
    let threshold = now - CLIPBOARD_RETENTION_SECONDS;
    connection
        .execute(
            "DELETE FROM clipboards WHERE last_accessed_at < ?1",
            params![threshold],
        )
        .map_err(|error| format!("cleanup expired clipboards: {error}"))?;
    Ok(())
}

fn load_clipboard(connection: &Connection, phrase: &str) -> Result<Option<ClipboardRecord>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT text, pass_salt, pass_hash, updated_at
            FROM clipboards
            WHERE phrase = ?1
            ",
        )
        .map_err(|error| format!("prepare load clipboard: {error}"))?;

    statement
        .query_row(params![phrase], |row| {
            Ok(ClipboardRecord {
                text: row.get(0)?,
                pass_salt: row.get(1)?,
                pass_hash: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .optional()
        .map_err(|error| format!("query clipboard: {error}"))
}

fn touch_last_accessed(connection: &Connection, phrase: &str, now: i64) -> Result<(), String> {
    connection
        .execute(
            "
            UPDATE clipboards
            SET last_accessed_at = ?1
            WHERE phrase = ?2
            ",
            params![now, phrase],
        )
        .map_err(|error| format!("touch last_accessed_at: {error}"))?;
    Ok(())
}

fn create_password_material(password: &str) -> (String, String) {
    let salt_bytes: [u8; 16] = rand::random();
    let salt = URL_SAFE_NO_PAD.encode(salt_bytes);
    let hash = hash_password(&salt, password);
    (salt, hash)
}

fn hash_password(salt: &str, password: &str) -> String {
    let digest = Sha256::digest(format!("{salt}:{password}").as_bytes());
    format!("{digest:x}")
}

fn verify_password(record: &ClipboardRecord, candidate_password: &str) -> bool {
    match (&record.pass_salt, &record.pass_hash) {
        (Some(salt), Some(hash)) => hash_password(salt, candidate_password) == *hash,
        _ => false,
    }
}

fn phrase_fingerprint(phrase: &str) -> String {
    let digest = Sha256::digest(phrase.as_bytes());
    let text = format!("{digest:x}");
    text.chars().take(10).collect()
}

fn now_epoch_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn success_response<T>(duration_ms: u128, data: T, version: &str) -> ApiResponse<T>
where
    T: Serialize,
{
    ApiResponse {
        success: true,
        data: Some(data),
        error: None,
        meta: ApiMeta {
            duration_ms,
            executor: "server-api",
            version: version.to_string(),
        },
    }
}

fn error_response<T>(duration_ms: u128, code: &'static str, message: String, version: &str) -> ApiResponse<T>
where
    T: Serialize,
{
    ApiResponse {
        success: false,
        data: None,
        error: Some(ApiError { code, message }),
        meta: ApiMeta {
            duration_ms,
            executor: "server-api",
            version: version.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{HeaderMap, Request, header},
    };
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::{io::Cursor, path::PathBuf};
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

    fn temp_db_path() -> PathBuf {
        let id: u64 = rand::random();
        std::env::temp_dir().join(format!("tools_api_test_{id}.db"))
    }

    fn test_app() -> (Router, PathBuf) {
        let db_path = temp_db_path();
        init_clipboard_db(&db_path).unwrap();
        (build_router(sample_manifests(), db_path.clone()), db_path)
    }

    async fn post_json(app: &Router, uri: &str, payload: Value) -> (StatusCode, Value) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&body).unwrap();
        (status, value)
    }

    async fn post_multipart(
        app: &Router,
        uri: &str,
        boundary: &str,
        payload: Vec<u8>,
    ) -> (StatusCode, HeaderMap, Vec<u8>) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .header("content-type", format!("multipart/form-data; boundary={boundary}"))
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        let status = response.status();
        let headers = response.headers().clone();
        let body = response.into_body().collect().await.unwrap().to_bytes().to_vec();
        (status, headers, body)
    }

    async fn post_with_content_type(
        app: &Router,
        uri: &str,
        content_type: &str,
        payload: Vec<u8>,
    ) -> (StatusCode, HeaderMap, Vec<u8>) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .header("content-type", content_type)
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        let status = response.status();
        let headers = response.headers().clone();
        let body = response.into_body().collect().await.unwrap().to_bytes().to_vec();
        (status, headers, body)
    }

    fn append_text_field(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes());
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    fn append_file_field(
        body: &mut Vec<u8>,
        boundary: &str,
        name: &str,
        file_name: &str,
        content_type: &str,
        value: &[u8],
    ) {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"; filename=\"{file_name}\"\r\n").as_bytes(),
        );
        body.extend_from_slice(format!("Content-Type: {content_type}\r\n\r\n").as_bytes());
        body.extend_from_slice(value);
        body.extend_from_slice(b"\r\n");
    }

    fn build_image_convert_body(
        boundary: &str,
        target_format: Option<&str>,
        background: Option<&str>,
        file_name: Option<&str>,
        file_bytes: Option<&[u8]>,
    ) -> Vec<u8> {
        let mut body = Vec::new();

        if let Some(target_format) = target_format {
            append_text_field(&mut body, boundary, "target_format", target_format);
        }

        if let Some(background) = background {
            append_text_field(&mut body, boundary, "background", background);
        }

        if let (Some(file_name), Some(file_bytes)) = (file_name, file_bytes) {
            append_file_field(
                &mut body,
                boundary,
                "file",
                file_name,
                "application/octet-stream",
                file_bytes,
            );
        }

        body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
        body
    }

    fn parse_json_body(body: &[u8]) -> Value {
        serde_json::from_slice(body).unwrap()
    }

    fn encoded_bytes(image: &DynamicImage, format: ImageFormat) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        image.write_to(&mut cursor, format).unwrap();
        cursor.into_inner()
    }

    fn sample_png_with_alpha() -> Vec<u8> {
        let mut rgba = image::RgbaImage::new(2, 2);
        rgba.put_pixel(0, 0, image::Rgba([0, 0, 0, 0]));
        rgba.put_pixel(1, 0, image::Rgba([0, 255, 0, 255]));
        rgba.put_pixel(0, 1, image::Rgba([0, 0, 255, 255]));
        rgba.put_pixel(1, 1, image::Rgba([255, 255, 255, 255]));
        encoded_bytes(&DynamicImage::ImageRgba8(rgba), ImageFormat::Png)
    }

    fn sample_jpeg_rgb() -> Vec<u8> {
        let mut rgb = image::RgbImage::new(2, 2);
        rgb.put_pixel(0, 0, image::Rgb([250, 100, 20]));
        rgb.put_pixel(1, 0, image::Rgb([20, 200, 30]));
        rgb.put_pixel(0, 1, image::Rgb([40, 50, 250]));
        rgb.put_pixel(1, 1, image::Rgb([255, 255, 255]));
        encoded_bytes(&DynamicImage::ImageRgb8(rgb), ImageFormat::Jpeg)
    }

    fn sample_webp_with_alpha() -> Vec<u8> {
        let mut rgba = image::RgbaImage::new(2, 2);
        rgba.put_pixel(0, 0, image::Rgba([255, 0, 0, 255]));
        rgba.put_pixel(1, 0, image::Rgba([0, 255, 0, 255]));
        rgba.put_pixel(0, 1, image::Rgba([0, 0, 255, 255]));
        rgba.put_pixel(1, 1, image::Rgba([0, 0, 0, 0]));
        encoded_bytes(&DynamicImage::ImageRgba8(rgba), ImageFormat::WebP)
    }

    #[tokio::test]
    async fn list_tools_returns_success() {
        let (app, db_path) = test_app();

        let response = app
            .clone()
            .oneshot(Request::builder().uri("/api/tools/v1/list").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(payload["success"], Value::Bool(true));
        assert_eq!(payload["data"]["tools"].as_array().unwrap().len(), 2);

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn run_tool_returns_word_count() {
        let (app, db_path) = test_app();

        let request_body = json!({
            "tool_version": "0.1.0",
            "input": { "text": "ink over paper" }
        })
        .to_string();

        let response = app
            .clone()
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

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn run_tool_rejects_version_mismatch() {
        let (app, db_path) = test_app();

        let request_body = json!({
            "tool_version": "9.9.9",
            "input": { "text": "ink over paper" }
        })
        .to_string();

        let response = app
            .clone()
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

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn run_tool_rejects_invalid_input() {
        let (app, db_path) = test_app();

        let request_body = json!({
            "tool_version": "0.1.0",
            "input": { "not_text": "x" }
        })
        .to_string();

        let response = app
            .clone()
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

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn convert_image_png_to_jpg_returns_binary() {
        let (app, db_path) = test_app();
        let boundary = "----tools-yixing-1";
        let source = sample_png_with_alpha();
        let body = build_image_convert_body(
            boundary,
            Some("jpg"),
            Some("#ff0000"),
            Some("sample.png"),
            Some(&source),
        );

        let (status, headers, payload) =
            post_multipart(&app, "/api/media/v1/convert-image", boundary, body).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers.get(header::CONTENT_TYPE).unwrap(), "image/jpeg");
        let disposition = headers
            .get(header::CONTENT_DISPOSITION)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(disposition.contains("sample-yixing.jpg"));
        assert!(!payload.is_empty());

        let decoded = image::load_from_memory_with_format(&payload, ImageFormat::Jpeg).unwrap();
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 2);
        let pixel = decoded.to_rgb8().get_pixel(0, 0).0;
        assert!(pixel[0] > pixel[1] && pixel[0] > pixel[2]);

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn convert_image_jpg_to_webp_returns_binary() {
        let (app, db_path) = test_app();
        let boundary = "----tools-yixing-2";
        let source = sample_jpeg_rgb();
        let body =
            build_image_convert_body(boundary, Some("webp"), None, Some("photo.jpg"), Some(&source));

        let (status, headers, payload) =
            post_multipart(&app, "/api/media/v1/convert-image", boundary, body).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers.get(header::CONTENT_TYPE).unwrap(), "image/webp");
        let disposition = headers
            .get(header::CONTENT_DISPOSITION)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(disposition.contains("photo-yixing.webp"));
        assert!(!payload.is_empty());

        let decoded = image::load_from_memory_with_format(&payload, ImageFormat::WebP).unwrap();
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 2);

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn convert_image_webp_to_png_returns_binary() {
        let (app, db_path) = test_app();
        let boundary = "----tools-yixing-3";
        let source = sample_webp_with_alpha();
        let body =
            build_image_convert_body(boundary, Some("png"), None, Some("alpha.webp"), Some(&source));

        let (status, headers, payload) =
            post_multipart(&app, "/api/media/v1/convert-image", boundary, body).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers.get(header::CONTENT_TYPE).unwrap(), "image/png");
        let disposition = headers
            .get(header::CONTENT_DISPOSITION)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(disposition.contains("alpha-yixing.png"));
        assert!(!payload.is_empty());

        let decoded = image::load_from_memory_with_format(&payload, ImageFormat::Png).unwrap();
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 2);

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn convert_image_rejects_missing_file() {
        let (app, db_path) = test_app();
        let boundary = "----tools-yixing-4";
        let body = build_image_convert_body(boundary, Some("png"), None, None, None);
        let (status, _headers, payload) =
            post_multipart(&app, "/api/media/v1/convert-image", boundary, body).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        let parsed = parse_json_body(&payload);
        assert_eq!(parsed["error"]["code"], Value::String("FILE_REQUIRED".to_string()));

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn convert_image_rejects_missing_target_format() {
        let (app, db_path) = test_app();
        let boundary = "----tools-yixing-5";
        let source = sample_png_with_alpha();
        let body = build_image_convert_body(boundary, None, None, Some("demo.png"), Some(&source));
        let (status, _headers, payload) =
            post_multipart(&app, "/api/media/v1/convert-image", boundary, body).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        let parsed = parse_json_body(&payload);
        assert_eq!(
            parsed["error"]["code"],
            Value::String("TARGET_FORMAT_REQUIRED".to_string())
        );

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn convert_image_rejects_invalid_target_format() {
        let (app, db_path) = test_app();
        let boundary = "----tools-yixing-6";
        let source = sample_png_with_alpha();
        let body = build_image_convert_body(boundary, Some("gif"), None, Some("demo.png"), Some(&source));
        let (status, _headers, payload) =
            post_multipart(&app, "/api/media/v1/convert-image", boundary, body).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        let parsed = parse_json_body(&payload);
        assert_eq!(
            parsed["error"]["code"],
            Value::String("UNSUPPORTED_TARGET_FORMAT".to_string())
        );

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn convert_image_rejects_oversized_input() {
        let (app, db_path) = test_app();
        let boundary = "----tools-yixing-7";
        let oversized = vec![0_u8; MAX_IMAGE_FILE_BYTES + 1];
        let body = build_image_convert_body(
            boundary,
            Some("jpg"),
            None,
            Some("large.png"),
            Some(&oversized),
        );
        let (status, _headers, payload) =
            post_multipart(&app, "/api/media/v1/convert-image", boundary, body).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        let parsed = parse_json_body(&payload);
        assert_eq!(parsed["error"]["code"], Value::String("FILE_TOO_LARGE".to_string()));

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn convert_image_rejects_invalid_background() {
        let (app, db_path) = test_app();
        let boundary = "----tools-yixing-8";
        let source = sample_png_with_alpha();
        let body = build_image_convert_body(
            boundary,
            Some("jpg"),
            Some("ff00aa"),
            Some("demo.png"),
            Some(&source),
        );
        let (status, _headers, payload) =
            post_multipart(&app, "/api/media/v1/convert-image", boundary, body).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        let parsed = parse_json_body(&payload);
        assert_eq!(
            parsed["error"]["code"],
            Value::String("INVALID_BACKGROUND".to_string())
        );

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn convert_image_rejects_invalid_multipart_payload() {
        let (app, db_path) = test_app();
        let (status, _headers, payload) = post_with_content_type(
            &app,
            "/api/media/v1/convert-image",
            "multipart/form-data",
            b"broken".to_vec(),
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        let parsed = parse_json_body(&payload);
        assert_eq!(
            parsed["error"]["code"],
            Value::String("INVALID_MULTIPART".to_string())
        );

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn clipboard_public_save_and_get() {
        let (app, db_path) = test_app();

        let (status, save_payload) = post_json(
            &app,
            "/api/clipboard/v1/save",
            json!({"phrase": "Alpha_One", "password": "", "text": "hello world"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(save_payload["data"]["phrase"], Value::String("alpha_one".to_string()));

        let (status, get_payload) = post_json(
            &app,
            "/api/clipboard/v1/get",
            json!({"phrase": "ALPHA_ONE", "password": ""}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(get_payload["data"]["exists"], Value::Bool(true));
        assert_eq!(get_payload["data"]["text"], Value::String("hello world".to_string()));

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn clipboard_password_auth_enforced() {
        let (app, db_path) = test_app();

        let (status, _) = post_json(
            &app,
            "/api/clipboard/v1/save",
            json!({"phrase": "secret_box", "password": "1234", "text": "top secret"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, missing_payload) = post_json(
            &app,
            "/api/clipboard/v1/get",
            json!({"phrase": "secret_box", "password": ""}),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            missing_payload["error"]["code"],
            Value::String("AUTH_REQUIRED".to_string())
        );

        let (status, wrong_payload) = post_json(
            &app,
            "/api/clipboard/v1/get",
            json!({"phrase": "secret_box", "password": "9999"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(wrong_payload["error"]["code"], Value::String("AUTH_FAILED".to_string()));

        let (status, ok_payload) = post_json(
            &app,
            "/api/clipboard/v1/get",
            json!({"phrase": "secret_box", "password": "1234"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(ok_payload["data"]["text"], Value::String("top secret".to_string()));

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn clipboard_no_password_phrase_can_be_overwritten() {
        let (app, db_path) = test_app();

        let (status, _) = post_json(
            &app,
            "/api/clipboard/v1/save",
            json!({"phrase": "openbox", "password": "", "text": "first"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, _) = post_json(
            &app,
            "/api/clipboard/v1/save",
            json!({"phrase": "openbox", "password": "", "text": "second"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        let (status, payload) = post_json(
            &app,
            "/api/clipboard/v1/get",
            json!({"phrase": "openbox", "password": ""}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["data"]["text"], Value::String("second".to_string()));

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn clipboard_expired_data_is_cleaned() {
        let (app, db_path) = test_app();
        let connection = Connection::open(&db_path).unwrap();
        let old = now_epoch_seconds() - CLIPBOARD_RETENTION_SECONDS - 10;
        connection
            .execute(
                "
                INSERT INTO clipboards
                  (phrase, text, pass_salt, pass_hash, created_at, updated_at, last_accessed_at)
                VALUES
                  (?1, ?2, NULL, NULL, ?3, ?4, ?5)
                ",
                params!["oldphrase", "stale", old, old, old],
            )
            .unwrap();

        let (status, payload) = post_json(
            &app,
            "/api/clipboard/v1/get",
            json!({"phrase": "oldphrase", "password": ""}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["data"]["exists"], Value::Bool(false));

        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM clipboards WHERE phrase = 'oldphrase'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn clipboard_rejects_invalid_phrase_password_and_text() {
        let (app, db_path) = test_app();

        let (status, phrase_payload) = post_json(
            &app,
            "/api/clipboard/v1/get",
            json!({"phrase": "bad phrase", "password": ""}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            phrase_payload["error"]["code"],
            Value::String("INVALID_PHRASE".to_string())
        );

        let long_password = "x".repeat(MAX_PASSWORD_CHARS + 1);
        let (status, pass_payload) = post_json(
            &app,
            "/api/clipboard/v1/get",
            json!({"phrase": "goodphrase", "password": long_password}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            pass_payload["error"]["code"],
            Value::String("INVALID_PASSWORD".to_string())
        );

        let long_text = "a".repeat(MAX_INPUT_CHARS + 1);
        let (status, text_payload) = post_json(
            &app,
            "/api/clipboard/v1/save",
            json!({"phrase": "goodphrase", "password": "", "text": long_text}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            text_payload["error"]["code"],
            Value::String("INVALID_INPUT".to_string())
        );

        let _ = fs::remove_file(db_path);
    }
}
