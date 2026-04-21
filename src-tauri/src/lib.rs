use std::{
    collections::HashMap,
    net::IpAddr,
    path::{Path, PathBuf},
    str::FromStr,
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use futures_util::StreamExt;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::sync::oneshot;
use uuid::Uuid;

const SCHEMA_VERSION: u32 = 2;
const APP_STATE_FILE: &str = "app-state.json";
const LEGACY_SETTINGS_FILE: &str = "settings.json";
const LEGACY_SESSIONS_FILE: &str = "sessions.json";

#[derive(Default, Clone)]
struct RuntimeState {
    active_requests: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl RuntimeState {
    fn insert(&self, request_id: String, sender: oneshot::Sender<()>) -> Result<(), String> {
        let mut guard = self
            .active_requests
            .lock()
            .map_err(|_| "Failed to lock active request registry.".to_string())?;
        if let Some(existing) = guard.insert(request_id, sender) {
            let _ = existing.send(());
        }
        Ok(())
    }

    fn abort(&self, request_id: &str) -> Result<bool, String> {
        let mut guard = self
            .active_requests
            .lock()
            .map_err(|_| "Failed to lock active request registry.".to_string())?;
        Ok(guard
            .remove(request_id)
            .map(|sender| sender.send(()).is_ok())
            .unwrap_or(false))
    }

    fn remove(&self, request_id: &str) -> Result<(), String> {
        let mut guard = self
            .active_requests
            .lock()
            .map_err(|_| "Failed to lock active request registry.".to_string())?;
        guard.remove(request_id);
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppStateSnapshot {
    schema_version: u32,
    endpoints: Vec<EndpointProfile>,
    routes: Vec<RouteRecord>,
    route_targets: Vec<RouteTargetRecord>,
    conversations: Vec<ConversationRecord>,
    discovered_models: Vec<DiscoveredModel>,
    health_reports: Vec<ConnectivityReport>,
}

impl Default for AppStateSnapshot {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            endpoints: Vec::new(),
            routes: Vec::new(),
            route_targets: Vec::new(),
            conversations: Vec::new(),
            discovered_models: Vec::new(),
            health_reports: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndpointProfile {
    id: String,
    name: String,
    provider_kind: String,
    base_url: String,
    api_key: String,
    enabled: bool,
    #[serde(default)]
    default_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouteRecord {
    id: String,
    name: String,
    strategy: String,
    target_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouteTargetRecord {
    id: String,
    endpoint_id: String,
    model: String,
    priority: i32,
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationRecord {
    id: String,
    title: String,
    route_id: String,
    created_at: String,
    updated_at: String,
    messages: Vec<MessageRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageRecord {
    id: String,
    role: String,
    content: String,
    created_at: String,
    status: String,
    included_in_context: bool,
    pinned: bool,
    #[serde(default)]
    summary_anchor: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveredModel {
    id: String,
    endpoint_id: String,
    model_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    context_window: Option<u32>,
    discovered_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectivityReport {
    endpoint_id: String,
    status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    latency_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    first_token_ms: Option<u64>,
    message: String,
    tested_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreamRoutePayload {
    request_id: String,
    route_id: String,
    conversation_id: String,
    message_id: String,
    messages: Vec<RequestMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum StreamEvent {
    Start(StreamStartPayload),
    Meta(StreamMetaPayload),
    Delta(StreamDeltaPayload),
    Error(StreamErrorPayload),
    Stop(StreamStopPayload),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamStartPayload {
    request_id: String,
    message_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamMetaPayload {
    request_id: String,
    message_id: String,
    route_id: String,
    endpoint_id: String,
    model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamDeltaPayload {
    request_id: String,
    message_id: String,
    text_chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamErrorPayload {
    request_id: String,
    message_id: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamStopPayload {
    request_id: String,
    message_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacySettings {
    base_url: String,
    #[serde(default)]
    api_key: String,
    model: String,
    #[serde(default)]
    system_prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacySession {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    messages: Vec<LegacyMessage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMessage {
    id: String,
    role: String,
    content: String,
    created_at: String,
    #[serde(default)]
    status: Option<String>,
}

#[tauri::command]
async fn list_app_state(app: AppHandle) -> Result<AppStateSnapshot, String> {
    load_snapshot_or_migrate(&app).await
}

#[tauri::command]
async fn save_endpoint(app: AppHandle, endpoint: EndpointProfile) -> Result<(), String> {
    validate_endpoint(&endpoint)?;
    let mut snapshot = load_snapshot_or_migrate(&app).await?;
    upsert_by_id(&mut snapshot.endpoints, endpoint, |item| item.id.clone());
    write_snapshot(&app, &snapshot).await
}

#[tauri::command]
async fn delete_endpoint(app: AppHandle, endpoint_id: String) -> Result<(), String> {
    let mut snapshot = load_snapshot_or_migrate(&app).await?;
    snapshot.endpoints.retain(|endpoint| endpoint.id != endpoint_id);
    snapshot
        .route_targets
        .retain(|target| target.endpoint_id != endpoint_id);
    snapshot
        .routes
        .iter_mut()
        .for_each(|route| route.target_ids.retain(|target_id| {
            snapshot
                .route_targets
                .iter()
                .any(|target| target.id == *target_id)
        }));
    snapshot
        .discovered_models
        .retain(|model| model.endpoint_id != endpoint_id);
    snapshot
        .health_reports
        .retain(|report| report.endpoint_id != endpoint_id);
    write_snapshot(&app, &snapshot).await
}

#[tauri::command]
async fn save_route(
    app: AppHandle,
    route: RouteRecord,
    targets: Vec<RouteTargetRecord>,
) -> Result<(), String> {
    validate_route(&route, &targets)?;
    let mut snapshot = load_snapshot_or_migrate(&app).await?;

    if let Some(existing) = snapshot.routes.iter().find(|candidate| candidate.id == route.id) {
        snapshot
            .route_targets
            .retain(|target| !existing.target_ids.contains(&target.id));
    }

    snapshot
        .route_targets
        .retain(|target| !route.target_ids.contains(&target.id));
    snapshot.route_targets.extend(targets);
    upsert_by_id(&mut snapshot.routes, route, |item| item.id.clone());
    write_snapshot(&app, &snapshot).await
}

#[tauri::command]
async fn save_conversation(app: AppHandle, conversation: ConversationRecord) -> Result<(), String> {
    let mut snapshot = load_snapshot_or_migrate(&app).await?;
    upsert_by_id(&mut snapshot.conversations, conversation, |item| item.id.clone());
    snapshot
        .conversations
        .sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    write_snapshot(&app, &snapshot).await
}

#[tauri::command]
async fn discover_endpoint_models(
    app: AppHandle,
    endpoint_id: String,
) -> Result<Vec<DiscoveredModel>, String> {
    let client = Client::new();
    let mut snapshot = load_snapshot_or_migrate(&app).await?;
    let endpoint = find_endpoint(&snapshot, &endpoint_id)?.clone();
    let models = fetch_models(&client, &endpoint).await?;

    snapshot
        .discovered_models
        .retain(|model| model.endpoint_id != endpoint_id);
    snapshot.discovered_models.extend(models.clone());
    write_snapshot(&app, &snapshot).await?;

    Ok(models)
}

#[tauri::command]
async fn test_endpoint_connectivity(
    app: AppHandle,
    endpoint_id: String,
) -> Result<ConnectivityReport, String> {
    let client = Client::new();
    let mut snapshot = load_snapshot_or_migrate(&app).await?;
    let endpoint = find_endpoint(&snapshot, &endpoint_id)?.clone();
    let report = run_connectivity_test(&client, &endpoint).await?;

    snapshot
        .health_reports
        .retain(|candidate| candidate.endpoint_id != endpoint_id);
    snapshot.health_reports.push(report.clone());
    write_snapshot(&app, &snapshot).await?;

    Ok(report)
}

#[tauri::command]
async fn export_data(app: AppHandle, path: String) -> Result<(), String> {
    let mut snapshot = load_snapshot_or_migrate(&app).await?;
    snapshot
        .endpoints
        .iter_mut()
        .for_each(|endpoint| endpoint.api_key.clear());
    write_json_file(PathBuf::from(path), &snapshot).await
}

#[tauri::command]
async fn import_data(app: AppHandle, path: String) -> Result<AppStateSnapshot, String> {
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|error| error.to_string())?;
    let snapshot = parse_snapshot(&content)?;
    write_snapshot(&app, &snapshot).await?;
    Ok(snapshot)
}

#[tauri::command]
async fn stream_chat_via_route(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    payload: StreamRoutePayload,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    validate_stream_payload(&payload)?;
    let snapshot = load_snapshot_or_migrate(&app).await?;
    let route = find_route(&snapshot, &payload.route_id)?.clone();
    let target = select_route_target(&snapshot, &route)?;
    let endpoint = find_endpoint(&snapshot, &target.endpoint_id)?.clone();
    validate_endpoint(&endpoint)?;

    let registry = state.inner().clone();
    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();
    registry.insert(payload.request_id.clone(), abort_tx)?;

    let request_id = payload.request_id.clone();
    let message_id = payload.message_id.clone();
    let route_id = route.id.clone();
    let endpoint_id = endpoint.id.clone();
    let model = target.model.clone();
    let request_url = format!("{}/v1/chat/completions", endpoint.base_url.trim_end_matches('/'));
    let body = json!({
        "model": model,
        "stream": true,
        "messages": payload.messages,
    });

    tauri::async_runtime::spawn(async move {
        let client = Client::new();
        let _ = on_event.send(StreamEvent::Start(StreamStartPayload {
            request_id: request_id.clone(),
            message_id: message_id.clone(),
        }));
        let _ = on_event.send(StreamEvent::Meta(StreamMetaPayload {
            request_id: request_id.clone(),
            message_id: message_id.clone(),
            route_id,
            endpoint_id,
            model: model.clone(),
        }));

        let response = client
            .post(request_url)
            .bearer_auth(endpoint.api_key)
            .json(&body)
            .send()
            .await;

        match response {
            Ok(response) => {
                if !response.status().is_success() {
                    let message = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "Request failed.".to_string());
                    send_stream_error(&on_event, &request_id, &message_id, &message);
                    let _ = registry.remove(&request_id);
                    return;
                }

                let mut buffer = String::new();
                let mut stream = response.bytes_stream();

                loop {
                    tokio::select! {
                        _ = &mut abort_rx => {
                            let _ = on_event.send(StreamEvent::Stop(StreamStopPayload {
                                request_id: request_id.clone(),
                                message_id: message_id.clone(),
                            }));
                            let _ = registry.remove(&request_id);
                            break;
                        }
                        chunk = stream.next() => {
                            match chunk {
                                Some(Ok(bytes)) => {
                                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                                    while let Some(frame) = take_sse_frame(&mut buffer) {
                                        match parse_chat_frame(&frame) {
                                            Ok(FrameResult::Delta(text_chunk)) => {
                                                let _ = on_event.send(StreamEvent::Delta(StreamDeltaPayload {
                                                    request_id: request_id.clone(),
                                                    message_id: message_id.clone(),
                                                    text_chunk,
                                                }));
                                            }
                                            Ok(FrameResult::Done) => {
                                                let _ = on_event.send(StreamEvent::Stop(StreamStopPayload {
                                                    request_id: request_id.clone(),
                                                    message_id: message_id.clone(),
                                                }));
                                                let _ = registry.remove(&request_id);
                                                return;
                                            }
                                            Ok(FrameResult::Ignore) => {}
                                            Err(error) => {
                                                send_stream_error(&on_event, &request_id, &message_id, &error);
                                                let _ = registry.remove(&request_id);
                                                return;
                                            }
                                        }
                                    }
                                }
                                Some(Err(error)) => {
                                    send_stream_error(&on_event, &request_id, &message_id, &error.to_string());
                                    let _ = registry.remove(&request_id);
                                    return;
                                }
                                None => {
                                    let _ = on_event.send(StreamEvent::Stop(StreamStopPayload {
                                        request_id: request_id.clone(),
                                        message_id: message_id.clone(),
                                    }));
                                    let _ = registry.remove(&request_id);
                                    return;
                                }
                            }
                        }
                    }
                }
            }
            Err(error) => {
                send_stream_error(&on_event, &request_id, &message_id, &error.to_string());
                let _ = registry.remove(&request_id);
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn abort_stream(state: State<'_, RuntimeState>, request_id: String) -> Result<(), String> {
    let _ = state.abort(&request_id)?;
    Ok(())
}

async fn load_snapshot_or_migrate(app: &AppHandle) -> Result<AppStateSnapshot, String> {
    ensure_data_dir(app).await?;
    let path = snapshot_path(app)?;

    match tokio::fs::read_to_string(&path).await {
        Ok(content) => match parse_snapshot(&content) {
            Ok(mut snapshot) => {
                normalize_snapshot(&mut snapshot);
                Ok(snapshot)
            }
            Err(error) => {
                recover_corrupted_json_file(&path, &content, &AppStateSnapshot::default()).await?;
                Err(format!("Failed to parse app state: {error}"))
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => migrate_legacy_files(app).await,
        Err(error) => Err(error.to_string()),
    }
}

async fn migrate_legacy_files(app: &AppHandle) -> Result<AppStateSnapshot, String> {
    let settings_path = legacy_settings_path(app)?;
    let sessions_path = legacy_sessions_path(app)?;
    let settings_exists = tokio::fs::try_exists(&settings_path)
        .await
        .map_err(|error| error.to_string())?;
    let sessions_exists = tokio::fs::try_exists(&sessions_path)
        .await
        .map_err(|error| error.to_string())?;

    if !settings_exists && !sessions_exists {
        let snapshot = AppStateSnapshot::default();
        write_snapshot(app, &snapshot).await?;
        return Ok(snapshot);
    }

    let settings_content = if settings_exists {
        Some(tokio::fs::read_to_string(&settings_path).await.map_err(|error| error.to_string())?)
    } else {
        None
    };
    let sessions_content = if sessions_exists {
        Some(tokio::fs::read_to_string(&sessions_path).await.map_err(|error| error.to_string())?)
    } else {
        None
    };

    match migrate_legacy_snapshot(settings_content.as_deref(), sessions_content.as_deref()) {
        Ok(snapshot) => {
            write_snapshot(app, &snapshot).await?;
            Ok(snapshot)
        }
        Err(error) => {
            if let Some(content) = settings_content {
                backup_legacy_file(&settings_path, &content).await?;
            }
            if let Some(content) = sessions_content {
                backup_legacy_file(&sessions_path, &content).await?;
            }
            let snapshot = AppStateSnapshot::default();
            write_snapshot(app, &snapshot).await?;
            Err(error)
        }
    }
}

fn migrate_legacy_snapshot(
    settings_content: Option<&str>,
    sessions_content: Option<&str>,
) -> Result<AppStateSnapshot, String> {
    let legacy_settings = settings_content
        .map(parse_legacy_settings)
        .transpose()?
        .unwrap_or(LegacySettings {
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            system_prompt: String::new(),
        });
    let legacy_sessions = sessions_content
        .map(parse_legacy_sessions)
        .transpose()?
        .unwrap_or_default();

    let mut snapshot = AppStateSnapshot::default();
    let mut route_id = String::new();

    if !legacy_settings.base_url.trim().is_empty() || !legacy_settings.model.trim().is_empty() {
        let endpoint_id = Uuid::new_v4().to_string();
        route_id = Uuid::new_v4().to_string();
        let target_id = Uuid::new_v4().to_string();

        snapshot.endpoints.push(EndpointProfile {
            id: endpoint_id.clone(),
            name: "Migrated endpoint".to_string(),
            provider_kind: "openai-compatible".to_string(),
            base_url: legacy_settings.base_url,
            api_key: legacy_settings.api_key,
            enabled: true,
            default_model: legacy_settings.model.clone(),
        });
        snapshot.route_targets.push(RouteTargetRecord {
            id: target_id.clone(),
            endpoint_id,
            model: legacy_settings.model.clone(),
            priority: 0,
            enabled: true,
        });
        snapshot.routes.push(RouteRecord {
            id: route_id.clone(),
            name: "migrated-default".to_string(),
            strategy: "priority_failover".to_string(),
            target_ids: vec![target_id],
        });
    }

    snapshot.conversations = legacy_sessions
        .into_iter()
        .map(|session| ConversationRecord {
            id: session.id,
            title: session.title,
            route_id: route_id.clone(),
            created_at: session.created_at,
            updated_at: session.updated_at,
            messages: prepend_system_message(
                session
                    .messages
                    .into_iter()
                    .map(|message| MessageRecord {
                        id: message.id,
                        role: message.role,
                        content: message.content,
                        created_at: message.created_at,
                        status: message.status.unwrap_or_else(|| "done".to_string()),
                        included_in_context: true,
                        pinned: false,
                        summary_anchor: false,
                    })
                    .collect(),
                &legacy_settings.system_prompt,
            ),
        })
        .collect();
    snapshot
        .conversations
        .sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(snapshot)
}

fn prepend_system_message(
    mut messages: Vec<MessageRecord>,
    system_prompt: &str,
) -> Vec<MessageRecord> {
    if system_prompt.trim().is_empty() {
        return messages;
    }

    messages.insert(
        0,
        MessageRecord {
            id: Uuid::new_v4().to_string(),
            role: "system".to_string(),
            content: system_prompt.trim().to_string(),
            created_at: now_iso(),
            status: "done".to_string(),
            included_in_context: true,
            pinned: true,
            summary_anchor: false,
        },
    );
    messages
}

async fn run_connectivity_test(
    client: &Client,
    endpoint: &EndpointProfile,
) -> Result<ConnectivityReport, String> {
    let tested_at = now_iso();
    let start = Instant::now();
    let models_result = fetch_models(client, endpoint).await;
    let latency_ms = Some(start.elapsed().as_millis() as u64);

    match models_result {
        Ok(models) => {
            let model_name = if endpoint.default_model.trim().is_empty() {
                models
                    .first()
                    .map(|model| model.model_name.clone())
                    .unwrap_or_default()
            } else {
                endpoint.default_model.trim().to_string()
            };

            if model_name.is_empty() {
                return Ok(ConnectivityReport {
                    endpoint_id: endpoint.id.clone(),
                    status: "partial".to_string(),
                    latency_ms,
                    first_token_ms: None,
                    message: "Endpoint reachable but no model is available for smoke test."
                        .to_string(),
                    tested_at,
                });
            }

            match smoke_test_chat(client, endpoint, &model_name).await {
                Ok(first_token_ms) => Ok(ConnectivityReport {
                    endpoint_id: endpoint.id.clone(),
                    status: "healthy".to_string(),
                    latency_ms,
                    first_token_ms,
                    message: format!("Models listed and chat smoke test passed for {model_name}."),
                    tested_at,
                }),
                Err(error) => Ok(ConnectivityReport {
                    endpoint_id: endpoint.id.clone(),
                    status: "degraded".to_string(),
                    latency_ms,
                    first_token_ms: None,
                    message: error,
                    tested_at,
                }),
            }
        }
        Err(error) => Ok(ConnectivityReport {
            endpoint_id: endpoint.id.clone(),
            status: map_connectivity_error(&error).to_string(),
            latency_ms,
            first_token_ms: None,
            message: error,
            tested_at,
        }),
    }
}

async fn fetch_models(client: &Client, endpoint: &EndpointProfile) -> Result<Vec<DiscoveredModel>, String> {
    let url = format!("{}/v1/models", endpoint.base_url.trim_end_matches('/'));
    let response = client
        .get(url)
        .bearer_auth(&endpoint.api_key)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format_status_error(status, body));
    }

    let value: Value = response.json().await.map_err(|error| error.to_string())?;
    parse_models_response(&value, &endpoint.id)
}

fn parse_models_response(value: &Value, endpoint_id: &str) -> Result<Vec<DiscoveredModel>, String> {
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "Models response did not contain a data array.".to_string())?;

    let models = data
        .iter()
        .filter_map(|item| {
            let model_name = item.get("id").and_then(Value::as_str)?.to_string();
            let context_window = item
                .get("context_window")
                .and_then(Value::as_u64)
                .or_else(|| item.get("contextWindow").and_then(Value::as_u64))
                .or_else(|| item.get("max_context_window").and_then(Value::as_u64))
                .or_else(|| item.get("context_length").and_then(Value::as_u64))
                .map(|value| value as u32);

            Some(DiscoveredModel {
                id: Uuid::new_v4().to_string(),
                endpoint_id: endpoint_id.to_string(),
                model_name,
                context_window,
                discovered_at: now_iso(),
            })
        })
        .collect::<Vec<_>>();

    Ok(models)
}

async fn smoke_test_chat(
    client: &Client,
    endpoint: &EndpointProfile,
    model_name: &str,
) -> Result<Option<u64>, String> {
    let url = format!("{}/v1/chat/completions", endpoint.base_url.trim_end_matches('/'));
    let body = json!({
        "model": model_name,
        "stream": true,
        "messages": [
            { "role": "user", "content": "ping" }
        ]
    });
    let started = Instant::now();
    let response = client
        .post(url)
        .bearer_auth(&endpoint.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format_status_error(status, body));
    }

    let mut buffer = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|error| error.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(frame) = take_sse_frame(&mut buffer) {
            match parse_chat_frame(&frame)? {
                FrameResult::Delta(_) => {
                    return Ok(Some(started.elapsed().as_millis() as u64));
                }
                FrameResult::Done => return Ok(None),
                FrameResult::Ignore => {}
            }
        }
    }

    Ok(None)
}

fn validate_endpoint(endpoint: &EndpointProfile) -> Result<(), String> {
    if endpoint.name.trim().is_empty() {
        return Err("Endpoint name is required.".to_string());
    }
    if endpoint.base_url.trim().is_empty() {
        return Err("Base URL is required.".to_string());
    }
    validate_base_url(endpoint.base_url.trim())?;
    Ok(())
}

fn validate_route(route: &RouteRecord, targets: &[RouteTargetRecord]) -> Result<(), String> {
    if route.name.trim().is_empty() {
        return Err("Route name is required.".to_string());
    }
    if route.strategy != "priority_failover" {
        return Err("Only priority_failover is supported in this MVP.".to_string());
    }
    if targets.is_empty() {
        return Err("At least one route target is required.".to_string());
    }
    if route.target_ids.len() != targets.len() {
        return Err("Route target ids must match the provided targets.".to_string());
    }
    Ok(())
}

fn validate_stream_payload(payload: &StreamRoutePayload) -> Result<(), String> {
    if payload.route_id.trim().is_empty() {
        return Err("Route id is required.".to_string());
    }
    if payload.messages.is_empty() {
        return Err("At least one message is required.".to_string());
    }
    Ok(())
}

fn validate_base_url(base_url: &str) -> Result<(), String> {
    let url = Url::parse(base_url).map_err(|_| "Base URL must be a valid absolute URL.".to_string())?;
    let scheme = url.scheme().to_ascii_lowercase();
    if scheme == "https" {
        return Ok(());
    }

    let host = url.host_str().unwrap_or_default();
    if scheme == "http" && is_loopback_host(host) {
        return Ok(());
    }

    Err("Base URL must use HTTPS unless it targets localhost or another loopback address.".to_string())
}

fn is_loopback_host(host: &str) -> bool {
    let normalized = host.trim_matches(&['[', ']']).to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    if normalized == "localhost" || normalized.ends_with(".localhost") {
        return true;
    }

    IpAddr::from_str(&normalized)
        .map(|address| address.is_loopback())
        .unwrap_or(false)
}

fn parse_snapshot(content: &str) -> Result<AppStateSnapshot, String> {
    let snapshot: AppStateSnapshot = serde_json::from_str(content).map_err(|error| error.to_string())?;
    if snapshot.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "Unsupported schema version {}.",
            snapshot.schema_version
        ));
    }
    Ok(snapshot)
}

fn parse_legacy_settings(content: &str) -> Result<LegacySettings, String> {
    serde_json::from_str(content).map_err(|error| error.to_string())
}

fn parse_legacy_sessions(content: &str) -> Result<Vec<LegacySession>, String> {
    serde_json::from_str(content).map_err(|error| error.to_string())
}

fn normalize_snapshot(snapshot: &mut AppStateSnapshot) {
    snapshot
        .conversations
        .sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
}

fn select_route_target<'a>(
    snapshot: &'a AppStateSnapshot,
    route: &RouteRecord,
) -> Result<&'a RouteTargetRecord, String> {
    route
        .target_ids
        .iter()
        .filter_map(|target_id| snapshot.route_targets.iter().find(|target| target.id == *target_id))
        .filter(|target| target.enabled)
        .min_by_key(|target| target.priority)
        .ok_or_else(|| "The selected route has no enabled target.".to_string())
}

fn find_endpoint<'a>(
    snapshot: &'a AppStateSnapshot,
    endpoint_id: &str,
) -> Result<&'a EndpointProfile, String> {
    snapshot
        .endpoints
        .iter()
        .find(|endpoint| endpoint.id == endpoint_id)
        .ok_or_else(|| format!("Endpoint {endpoint_id} was not found."))
}

fn find_route<'a>(snapshot: &'a AppStateSnapshot, route_id: &str) -> Result<&'a RouteRecord, String> {
    snapshot
        .routes
        .iter()
        .find(|route| route.id == route_id)
        .ok_or_else(|| format!("Route {route_id} was not found."))
}

fn upsert_by_id<T, F>(items: &mut Vec<T>, next: T, mut key: F)
where
    F: FnMut(&T) -> String,
{
    if let Some(index) = items.iter().position(|item| key(item) == key(&next)) {
        items[index] = next;
    } else {
        items.push(next);
    }
}

fn parse_chat_frame(frame: &str) -> Result<FrameResult, String> {
    let normalized = frame.replace("\r\n", "\n");
    let data = normalized
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.trim())
        .collect::<Vec<_>>()
        .join("\n");

    if data.is_empty() {
        return Ok(FrameResult::Ignore);
    }

    if data == "[DONE]" {
        return Ok(FrameResult::Done);
    }

    let chunk: Value = serde_json::from_str(&data).map_err(|error| error.to_string())?;
    let text = chunk
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if text.is_empty() {
        return Ok(FrameResult::Ignore);
    }

    Ok(FrameResult::Delta(text))
}

fn take_sse_frame(buffer: &mut String) -> Option<String> {
    let (index, separator_len) = if let Some(index) = buffer.find("\r\n\r\n") {
        (index, 4)
    } else if let Some(index) = buffer.find("\n\n") {
        (index, 2)
    } else {
        return None;
    };

    Some({
        let frame = buffer[..index].to_string();
        let remaining = buffer[index + separator_len..].to_string();
        *buffer = remaining;
        frame
    })
}

fn send_stream_error(on_event: &Channel<StreamEvent>, request_id: &str, message_id: &str, message: &str) {
    let _ = on_event.send(StreamEvent::Error(StreamErrorPayload {
        request_id: request_id.to_string(),
        message_id: message_id.to_string(),
        message: message.to_string(),
    }));
}

fn format_status_error(status: StatusCode, body: String) -> String {
    let label = match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => "Authentication failed",
        StatusCode::TOO_MANY_REQUESTS => "Rate limited",
        StatusCode::BAD_REQUEST => "Request rejected",
        _ => "Endpoint request failed",
    };

    if body.trim().is_empty() {
        format!("{label} ({status}).")
    } else {
        format!("{label} ({status}): {}", body.trim())
    }
}

fn map_connectivity_error(message: &str) -> &'static str {
    let lowered = message.to_ascii_lowercase();
    if lowered.contains("401") || lowered.contains("403") || lowered.contains("authentication failed")
    {
        "auth_error"
    } else if lowered.contains("429") || lowered.contains("rate limited") {
        "rate_limited"
    } else if lowered.contains("timeout")
        || lowered.contains("dns")
        || lowered.contains("connection")
        || lowered.contains("refused")
    {
        "unreachable"
    } else {
        "degraded"
    }
}

async fn ensure_data_dir(app: &AppHandle) -> Result<(), String> {
    tokio::fs::create_dir_all(data_dir(app)?)
        .await
        .map_err(|error| error.to_string())
}

fn snapshot_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(APP_STATE_FILE))
}

fn legacy_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(LEGACY_SETTINGS_FILE))
}

fn legacy_sessions_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(LEGACY_SESSIONS_FILE))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

async fn write_snapshot(app: &AppHandle, snapshot: &AppStateSnapshot) -> Result<(), String> {
    write_json_file(snapshot_path(app)?, snapshot).await
}

async fn write_json_file<T: Serialize>(path: PathBuf, value: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    tokio::fs::write(path, content)
        .await
        .map_err(|error| error.to_string())
}

async fn recover_corrupted_json_file<T: Serialize>(
    path: &Path,
    content: &str,
    fallback: &T,
) -> Result<(), String> {
    let backup_path = corrupted_backup_path(path)?;
    tokio::fs::write(&backup_path, content)
        .await
        .map_err(|error| error.to_string())?;
    write_json_file(path.to_path_buf(), fallback).await
}

async fn backup_legacy_file(path: &Path, content: &str) -> Result<(), String> {
    let backup_path = corrupted_backup_path(path)?;
    tokio::fs::write(backup_path, content)
        .await
        .map_err(|error| error.to_string())
}

fn corrupted_backup_path(path: &Path) -> Result<PathBuf, String> {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Failed to derive backup filename.".to_string())?;
    let extension = path.extension().and_then(|value| value.to_str());
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let backup_name = match extension {
        Some(extension) => format!("{stem}.corrupt.{timestamp}.{extension}"),
        None => format!("{stem}.corrupt.{timestamp}"),
    };

    Ok(path.with_file_name(backup_name))
}

fn now_iso() -> String {
    chrono_like_now()
}

fn chrono_like_now() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let datetime = time::OffsetDateTime::from_unix_timestamp(now as i64)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    datetime
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

enum FrameResult {
    Delta(String),
    Done,
    Ignore,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_app_state,
            save_endpoint,
            delete_endpoint,
            discover_endpoint_models,
            test_endpoint_connectivity,
            save_route,
            save_conversation,
            export_data,
            import_data,
            stream_chat_via_route,
            abort_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_done_frame() {
        let frame = "data: [DONE]";
        assert!(matches!(
            parse_chat_frame(frame).expect("done frame should parse"),
            FrameResult::Done
        ));
    }

    #[test]
    fn parses_delta_frame() {
        let frame = r#"data: {"choices":[{"delta":{"content":"hello"}}]}"#;
        match parse_chat_frame(frame).expect("delta frame should parse") {
            FrameResult::Delta(chunk) => assert_eq!(chunk, "hello"),
            _ => panic!("expected delta frame"),
        }
    }

    #[test]
    fn splits_sse_frames() {
        let mut buffer =
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\r\n\r\n".to_string();
        let frame = take_sse_frame(&mut buffer).expect("frame should split");
        assert_eq!(
            frame,
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}"
        );
        assert!(buffer.is_empty());
    }

    #[test]
    fn maps_models_response() {
        let value = json!({
            "data": [
                { "id": "gpt-4.1-mini", "context_window": 128000 }
            ]
        });

        let models = parse_models_response(&value, "ep-1").expect("models should parse");
        assert_eq!(models[0].endpoint_id, "ep-1");
        assert_eq!(models[0].model_name, "gpt-4.1-mini");
        assert_eq!(models[0].context_window, Some(128000));
    }

    #[test]
    fn maps_connectivity_errors() {
        assert_eq!(
            map_connectivity_error("Authentication failed (401): bad key"),
            "auth_error"
        );
        assert_eq!(map_connectivity_error("Rate limited (429)"), "rate_limited");
        assert_eq!(map_connectivity_error("connection refused"), "unreachable");
    }

    #[test]
    fn migrates_legacy_files_to_snapshot() {
        let settings = r#"{
            "baseUrl": "https://api.example.com",
            "apiKey": "secret",
            "model": "gpt-4.1-mini",
            "systemPrompt": "Use concise answers."
        }"#;
        let sessions = r#"[
            {
              "id": "conv-1",
              "title": "Legacy chat",
              "createdAt": "2026-01-01T00:00:00Z",
              "updatedAt": "2026-01-01T01:00:00Z",
              "messages": [
                {
                  "id": "msg-1",
                  "role": "user",
                  "content": "Hello",
                  "createdAt": "2026-01-01T00:00:00Z",
                  "status": "done"
                }
              ]
            }
        ]"#;

        let snapshot =
            migrate_legacy_snapshot(Some(settings), Some(sessions)).expect("migration should work");

        assert_eq!(snapshot.schema_version, 2);
        assert_eq!(snapshot.endpoints.len(), 1);
        assert_eq!(snapshot.routes.len(), 1);
        assert_eq!(snapshot.conversations.len(), 1);
        assert_eq!(snapshot.conversations[0].messages[0].role, "system");
        assert!(snapshot.conversations[0].messages[0].pinned);
    }

    #[test]
    fn allows_loopback_http_base_urls() {
        validate_base_url("http://127.0.0.1:11434").expect("loopback should pass");
        validate_base_url("http://localhost:11434").expect("localhost should pass");
    }

    #[test]
    fn rejects_remote_http_base_urls() {
        assert_eq!(
            validate_base_url("http://api.example.com").expect_err("remote http should fail"),
            "Base URL must use HTTPS unless it targets localhost or another loopback address."
        );
    }
}
