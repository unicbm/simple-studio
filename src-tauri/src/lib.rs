use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::sync::oneshot;

const SCHEMA_VERSION: u32 = 1;
const SETTINGS_FILE: &str = "settings.json";
const SESSIONS_FILE: &str = "sessions.json";

#[derive(Default, Clone)]
struct AppState {
    active_requests: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl AppState {
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    base_url: String,
    api_key: String,
    model: String,
    #[serde(default)]
    system_prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    id: String,
    role: String,
    content: String,
    created_at: String,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatSession {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreamRequestPayload {
    request_id: String,
    message_id: String,
    settings: AppSettings,
    messages: Vec<RequestMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportBlob {
    schema_version: u32,
    settings: AppSettings,
    sessions: Vec<ChatSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedData {
    settings: AppSettings,
    sessions: Vec<ChatSession>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum StreamEvent {
    Started(StreamStartedPayload),
    Delta(StreamDeltaPayload),
    Done(StreamDonePayload),
    Error(StreamErrorPayload),
    Aborted(StreamAbortedPayload),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamStartedPayload {
    request_id: String,
    message_id: String,
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
struct StreamDonePayload {
    request_id: String,
    message_id: String,
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
struct StreamAbortedPayload {
    request_id: String,
    message_id: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChunk {
    choices: Vec<ChunkChoice>,
}

#[derive(Debug, Deserialize)]
struct ChunkChoice {
    delta: ChunkDelta,
}

#[derive(Debug, Deserialize)]
struct ChunkDelta {
    content: Option<String>,
}

#[tauri::command]
async fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    match tokio::fs::read_to_string(settings_path(&app)?).await {
        Ok(content) => serde_json::from_str(&content).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AppSettings::default()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
async fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    ensure_data_dir(&app).await?;
    write_json_file(settings_path(&app)?, &settings).await
}

#[tauri::command]
async fn load_sessions(app: AppHandle) -> Result<Vec<ChatSession>, String> {
    read_sessions(&app).await
}

#[tauri::command]
async fn save_session(app: AppHandle, session: ChatSession) -> Result<(), String> {
    ensure_data_dir(&app).await?;
    let mut sessions = read_sessions(&app).await?;
    if let Some(index) = sessions.iter().position(|item| item.id == session.id) {
        sessions[index] = session;
    } else {
        sessions.push(session);
    }
    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    write_json_file(sessions_path(&app)?, &sessions).await
}

#[tauri::command]
async fn delete_session(app: AppHandle, session_id: String) -> Result<(), String> {
    ensure_data_dir(&app).await?;
    let sessions = read_sessions(&app)
        .await?
        .into_iter()
        .filter(|session| session.id != session_id)
        .collect::<Vec<_>>();
    write_json_file(sessions_path(&app)?, &sessions).await
}

#[tauri::command]
async fn export_data(app: AppHandle, path: String) -> Result<(), String> {
    let export = ExportBlob {
        schema_version: SCHEMA_VERSION,
        settings: load_settings(app.clone()).await?,
        sessions: read_sessions(&app).await?,
    };
    write_json_file(PathBuf::from(path), &export).await
}

#[tauri::command]
async fn import_data(app: AppHandle, path: String) -> Result<ImportedData, String> {
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|error| error.to_string())?;
    let export = parse_export_blob(&content)?;

    ensure_data_dir(&app).await?;
    write_json_file(settings_path(&app)?, &export.settings).await?;
    write_json_file(sessions_path(&app)?, &export.sessions).await?;

    Ok(ImportedData {
        settings: export.settings,
        sessions: export.sessions,
    })
}

#[tauri::command]
async fn start_chat_stream(
    state: State<'_, AppState>,
    payload: StreamRequestPayload,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    validate_stream_payload(&payload)?;
    let registry = state.inner().clone();
    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();
    registry.insert(payload.request_id.clone(), abort_tx)?;

    let request_id = payload.request_id.clone();
    let message_id = payload.message_id.clone();
    let request_url = format!(
        "{}/v1/chat/completions",
        payload.settings.base_url.trim_end_matches('/')
    );
    let request_body = build_chat_request_body(&payload);

    tauri::async_runtime::spawn(async move {
        let client = Client::new();
        let _ = on_event.send(StreamEvent::Started(StreamStartedPayload {
            request_id: request_id.clone(),
            message_id: message_id.clone(),
        }));

        let response = client
            .post(request_url)
            .bearer_auth(payload.settings.api_key)
            .json(&request_body)
            .send()
            .await;

        match response {
            Ok(response) => {
                if !response.status().is_success() {
                    let message = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "Request failed.".to_string());
                    send_error(&on_event, &request_id, &message_id, &message);
                    let _ = registry.remove(&request_id);
                    return;
                }

                let mut stream = response.bytes_stream();
                let mut buffer = String::new();
                let mut finished = false;

                loop {
                    tokio::select! {
                        _ = &mut abort_rx => {
                            let _ = on_event.send(StreamEvent::Aborted(StreamAbortedPayload {
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
                                        match parse_frame(&frame) {
                                            Ok(FrameResult::Delta(text_chunk)) => {
                                                let _ = on_event.send(StreamEvent::Delta(StreamDeltaPayload {
                                                    request_id: request_id.clone(),
                                                    message_id: message_id.clone(),
                                                    text_chunk,
                                                }));
                                            }
                                            Ok(FrameResult::Done) => {
                                                let _ = on_event.send(StreamEvent::Done(StreamDonePayload {
                                                    request_id: request_id.clone(),
                                                    message_id: message_id.clone(),
                                                }));
                                                finished = true;
                                                break;
                                            }
                                            Ok(FrameResult::Ignore) => {}
                                            Err(error) => {
                                                send_error(&on_event, &request_id, &message_id, &error);
                                                finished = true;
                                                break;
                                            }
                                        }
                                    }
                                    if finished {
                                        let _ = registry.remove(&request_id);
                                        break;
                                    }
                                }
                                Some(Err(error)) => {
                                    send_error(&on_event, &request_id, &message_id, &error.to_string());
                                    let _ = registry.remove(&request_id);
                                    break;
                                }
                                None => {
                                    if !finished {
                                        let _ = on_event.send(StreamEvent::Done(StreamDonePayload {
                                            request_id: request_id.clone(),
                                            message_id: message_id.clone(),
                                        }));
                                    }
                                    let _ = registry.remove(&request_id);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            Err(error) => {
                send_error(&on_event, &request_id, &message_id, &error.to_string());
                let _ = registry.remove(&request_id);
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn abort_stream(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    let _ = state.abort(&request_id)?;
    Ok(())
}

fn validate_stream_payload(payload: &StreamRequestPayload) -> Result<(), String> {
    if payload.settings.base_url.trim().is_empty() {
        return Err("Base URL is required.".to_string());
    }
    if payload.settings.api_key.trim().is_empty() {
        return Err("API key is required.".to_string());
    }
    if payload.settings.model.trim().is_empty() {
        return Err("Model is required.".to_string());
    }
    if payload.messages.is_empty() {
        return Err("At least one message is required.".to_string());
    }
    Ok(())
}

fn build_chat_request_body(payload: &StreamRequestPayload) -> serde_json::Value {
    json!({
        "model": payload.settings.model,
        "stream": true,
        "messages": payload.messages,
    })
}

enum FrameResult {
    Delta(String),
    Done,
    Ignore,
}

fn parse_frame(frame: &str) -> Result<FrameResult, String> {
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

    let chunk: ChatCompletionChunk =
        serde_json::from_str(&data).map_err(|error| error.to_string())?;
    let text = chunk
        .choices
        .into_iter()
        .find_map(|choice| choice.delta.content)
        .unwrap_or_default();

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

fn send_error(on_event: &Channel<StreamEvent>, request_id: &str, message_id: &str, message: &str) {
    let _ = on_event.send(StreamEvent::Error(StreamErrorPayload {
        request_id: request_id.to_string(),
        message_id: message_id.to_string(),
        message: message.to_string(),
    }));
}

async fn read_sessions(app: &AppHandle) -> Result<Vec<ChatSession>, String> {
    match tokio::fs::read_to_string(sessions_path(app)?).await {
        Ok(content) => {
            let mut sessions = serde_json::from_str::<Vec<ChatSession>>(&content)
                .map_err(|error| error.to_string())?;
            sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
            Ok(sessions)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

async fn ensure_data_dir(app: &AppHandle) -> Result<(), String> {
    tokio::fs::create_dir_all(data_dir(app)?)
        .await
        .map_err(|error| error.to_string())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(SETTINGS_FILE))
}

fn sessions_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(SESSIONS_FILE))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

async fn write_json_file<T: Serialize>(path: PathBuf, value: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    tokio::fs::write(path, content)
        .await
        .map_err(|error| error.to_string())
}

fn parse_export_blob(content: &str) -> Result<ExportBlob, String> {
    let export: ExportBlob = serde_json::from_str(content).map_err(|error| error.to_string())?;
    if export.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "Unsupported schema version {}.",
            export.schema_version
        ));
    }
    Ok(export)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            load_sessions,
            save_session,
            delete_session,
            start_chat_stream,
            abort_stream,
            export_data,
            import_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> StreamRequestPayload {
        StreamRequestPayload {
            request_id: "req-1".to_string(),
            message_id: "msg-1".to_string(),
            settings: AppSettings {
                base_url: "https://api.example.com".to_string(),
                api_key: "secret".to_string(),
                model: "demo".to_string(),
                system_prompt: String::new(),
            },
            messages: vec![RequestMessage {
                role: "user".to_string(),
                content: "Hi".to_string(),
            }],
        }
    }

    #[test]
    fn builds_request_body() {
        let body = build_chat_request_body(&sample_payload());
        assert_eq!(body["model"], "demo");
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["content"], "Hi");
    }

    #[test]
    fn parses_delta_frame() {
        let frame = r#"data: {"choices":[{"delta":{"content":"Hello"}}]}"#;
        match parse_frame(frame).expect("delta frame should parse") {
            FrameResult::Delta(chunk) => assert_eq!(chunk, "Hello"),
            _ => panic!("expected delta frame"),
        }
    }

    #[test]
    fn parses_done_frame() {
        let frame = "data: [DONE]";
        assert!(matches!(
            parse_frame(frame).expect("done frame should parse"),
            FrameResult::Done
        ));
    }

    #[test]
    fn abort_registry_removes_request() {
        let state = AppState::default();
        let (sender, receiver) = oneshot::channel();
        state
            .insert("req-1".to_string(), sender)
            .expect("insert should succeed");
        assert!(state.abort("req-1").expect("abort should succeed"));
        assert!(receiver.blocking_recv().is_ok());
    }

    #[test]
    fn validates_import_schema() {
        let content = r#"{
            "schemaVersion": 1,
            "settings": {
                "baseUrl": "https://api.example.com",
                "apiKey": "secret",
                "model": "demo",
                "systemPrompt": ""
            },
            "sessions": []
        }"#;
        let parsed = parse_export_blob(content).expect("export should parse");
        assert_eq!(parsed.schema_version, 1);
    }

    #[test]
    fn serializes_stream_event_payload_fields_as_camel_case() {
        let event = StreamEvent::Delta(StreamDeltaPayload {
            request_id: "req-1".to_string(),
            message_id: "msg-1".to_string(),
            text_chunk: "Hello".to_string(),
        });

        let value = serde_json::to_value(event).expect("stream event should serialize");

        assert_eq!(value["event"], "delta");
        assert_eq!(value["data"]["requestId"], "req-1");
        assert_eq!(value["data"]["messageId"], "msg-1");
        assert_eq!(value["data"]["textChunk"], "Hello");
    }

    #[test]
    fn splits_crlf_sse_frames() {
        let mut buffer =
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\r\n\r\n".to_string();
        let frame = take_sse_frame(&mut buffer).expect("frame should split");
        assert_eq!(
            frame,
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}"
        );
        assert!(buffer.is_empty());
    }
}
