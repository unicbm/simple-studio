use std::{convert::Infallible, net::SocketAddr, path::PathBuf, sync::Arc};

use async_stream::stream;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderValue, StatusCode},
    response::Response,
    routing::{get, patch, post},
    Json, Router,
};
use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{net::TcpListener, sync::Mutex};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

const DATA_DIR_NAME: &str = ".simple-studio-data";
const SETTINGS_FILE: &str = "settings.json";
const CONVERSATIONS_FILE: &str = "conversations.json";
const LEGACY_APP_STATE_FILE: &str = "app-state.json";

#[derive(Clone)]
struct AppState {
    client: Client,
    store: Arc<Mutex<PersistedState>>,
    data_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    base_url: String,
    api_key: String,
    model: String,
    system_instruction: String,
    temperature: f32,
    max_output_tokens: u32,
    stream: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            api_key: String::new(),
            model: "gpt-4.1-mini".to_string(),
            system_instruction: String::new(),
            temperature: 1.0,
            max_output_tokens: 4096,
            stream: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageRecord {
    id: String,
    role: String,
    content: String,
    created_at: String,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationRecord {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    messages: Vec<MessageRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistedState {
    settings: AppSettings,
    conversations: Vec<ConversationRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapPayload {
    settings: AppSettings,
    conversations: Vec<ConversationRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameConversationInput {
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    conversation_id: String,
    input: String,
    #[serde(default)]
    settings: Option<AppSettings>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum StreamEvent {
    Start(StreamStartPayload),
    Delta(StreamDeltaPayload),
    Error(StreamErrorPayload),
    Done(StreamDonePayload),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamStartPayload {
    conversation_id: String,
    user_message_id: String,
    assistant_message_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamDeltaPayload {
    conversation_id: String,
    message_id: String,
    text_chunk: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamErrorPayload {
    conversation_id: String,
    message_id: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamDonePayload {
    conversation_id: String,
    message_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAppStateSnapshot {
    #[serde(default)]
    endpoints: Vec<LegacyEndpoint>,
    #[serde(default)]
    route_targets: Vec<LegacyRouteTarget>,
    #[serde(default)]
    conversations: Vec<LegacyConversation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyEndpoint {
    #[serde(rename = "id")]
    _id: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    default_model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRouteTarget {
    #[serde(rename = "endpointId")]
    _endpoint_id: String,
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyConversation {
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

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let root_dir = std::env::current_dir().map_err(|error| error.to_string())?;
    let data_dir = root_dir.join(DATA_DIR_NAME);
    let store = load_or_migrate_state(&data_dir).await?;

    let app_state = AppState {
        client: Client::new(),
        store: Arc::new(Mutex::new(store)),
        data_dir,
    };

    let app = Router::new()
        .route("/api/bootstrap", get(get_bootstrap))
        .route("/api/settings", get(get_settings).put(put_settings))
        .route(
            "/api/conversations",
            get(get_conversations).post(post_conversation),
        )
        .route(
            "/api/conversations/:id",
            patch(patch_conversation).delete(delete_conversation),
        )
        .route("/api/chat/stream", post(post_chat_stream))
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    let address: SocketAddr = "127.0.0.1:7878"
        .parse()
        .map_err(|error: std::net::AddrParseError| error.to_string())?;
    let listener = TcpListener::bind(address)
        .await
        .map_err(|error| error.to_string())?;

    println!("Simple Studio API listening at http://127.0.0.1:7878");
    axum::serve(listener, app)
        .await
        .map_err(|error| error.to_string())
}

async fn get_bootstrap(State(state): State<AppState>) -> Json<BootstrapPayload> {
    let store = state.store.lock().await;
    Json(BootstrapPayload {
        settings: store.settings.clone(),
        conversations: sorted_conversations(store.conversations.clone()),
    })
}

async fn get_settings(State(state): State<AppState>) -> Json<AppSettings> {
    let store = state.store.lock().await;
    Json(store.settings.clone())
}

async fn put_settings(
    State(state): State<AppState>,
    Json(input): Json<AppSettings>,
) -> Result<Json<AppSettings>, (StatusCode, String)> {
    validate_settings(&input).map_err(bad_request)?;

    let settings = {
        let mut store = state.store.lock().await;
        store.settings = input.clone();
        persist_state(&state.data_dir, &store)
            .await
            .map_err(internal_error)?;
        store.settings.clone()
    };

    Ok(Json(settings))
}

async fn get_conversations(State(state): State<AppState>) -> Json<Vec<ConversationRecord>> {
    let store = state.store.lock().await;
    Json(sorted_conversations(store.conversations.clone()))
}

async fn post_conversation(
    State(state): State<AppState>,
) -> Result<Json<ConversationRecord>, (StatusCode, String)> {
    let conversation = ConversationRecord {
        id: Uuid::new_v4().to_string(),
        title: "New chat".to_string(),
        created_at: now_iso(),
        updated_at: now_iso(),
        messages: Vec::new(),
    };

    {
        let mut store = state.store.lock().await;
        store.conversations.insert(0, conversation.clone());
        persist_state(&state.data_dir, &store)
            .await
            .map_err(internal_error)?;
    }

    Ok(Json(conversation))
}

async fn patch_conversation(
    State(state): State<AppState>,
    Path(conversation_id): Path<String>,
    Json(input): Json<RenameConversationInput>,
) -> Result<Json<ConversationRecord>, (StatusCode, String)> {
    if input.title.trim().is_empty() {
        return Err(bad_request("Conversation title is required.".to_string()));
    }

    let updated = {
        let mut store = state.store.lock().await;
        let conversation = store
            .conversations
            .iter_mut()
            .find(|conversation| conversation.id == conversation_id)
            .ok_or_else(|| not_found("Conversation not found.".to_string()))?;
        conversation.title = input.title.trim().to_string();
        conversation.updated_at = now_iso();
        let updated = conversation.clone();
        persist_state(&state.data_dir, &store)
            .await
            .map_err(internal_error)?;
        updated
    };

    Ok(Json(updated))
}

async fn delete_conversation(
    State(state): State<AppState>,
    Path(conversation_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut store = state.store.lock().await;
    let original_len = store.conversations.len();
    store
        .conversations
        .retain(|conversation| conversation.id != conversation_id);

    if store.conversations.len() == original_len {
        return Err(not_found("Conversation not found.".to_string()));
    }

    persist_state(&state.data_dir, &store)
        .await
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn post_chat_stream(
    State(state): State<AppState>,
    Json(input): Json<ChatRequest>,
) -> Result<Response, (StatusCode, String)> {
    if input.input.trim().is_empty() {
        return Err(bad_request("Prompt is required.".to_string()));
    }

    let request_settings = if let Some(settings) = input.settings {
        validate_settings(&settings).map_err(bad_request)?;
        settings
    } else {
        let store = state.store.lock().await;
        validate_settings(&store.settings).map_err(bad_request)?;
        store.settings.clone()
    };

    let conversation_id = input.conversation_id.clone();
    let prompt = input.input.trim().to_string();
    let user_message_id = Uuid::new_v4().to_string();
    let assistant_message_id = Uuid::new_v4().to_string();

    {
        let mut store = state.store.lock().await;
        let conversation = store
            .conversations
            .iter_mut()
            .find(|conversation| conversation.id == conversation_id)
            .ok_or_else(|| not_found("Conversation not found.".to_string()))?;

        conversation.updated_at = now_iso();
        if conversation.title == "New chat" {
            conversation.title = make_conversation_title(&prompt);
        }
        conversation.messages.push(MessageRecord {
            id: user_message_id.clone(),
            role: "user".to_string(),
            content: prompt.clone(),
            created_at: now_iso(),
            status: "done".to_string(),
        });
        conversation.messages.push(MessageRecord {
            id: assistant_message_id.clone(),
            role: "assistant".to_string(),
            content: String::new(),
            created_at: now_iso(),
            status: "streaming".to_string(),
        });

        persist_state(&state.data_dir, &store)
            .await
            .map_err(internal_error)?;
    }

    let client = state.client.clone();
    let shared_state = state.clone();
    let stream_response = stream! {
        yield Ok::<Bytes, Infallible>(encode_sse(StreamEvent::Start(StreamStartPayload {
            conversation_id: conversation_id.clone(),
            user_message_id: user_message_id.clone(),
            assistant_message_id: assistant_message_id.clone(),
        })));

        let request_messages = {
            let store = shared_state.store.lock().await;
            let conversation = store
                .conversations
                .iter()
                .find(|conversation| conversation.id == conversation_id);

            build_request_messages(conversation, &request_settings)
        };

        match request_openai_stream(&client, &request_settings, request_messages).await {
            Ok(mut remote_stream) => {
                let mut collected = String::new();
                let mut failed = false;

                while let Some(frame_result) = remote_stream.next().await {
                    match frame_result {
                        Ok(FrameResult::Delta(text_chunk)) => {
                            collected.push_str(&text_chunk);
                            yield Ok(encode_sse(StreamEvent::Delta(StreamDeltaPayload {
                                conversation_id: conversation_id.clone(),
                                message_id: assistant_message_id.clone(),
                                text_chunk,
                            })));
                        }
                        Ok(FrameResult::Done) => {
                            if let Err(error) = finalize_assistant_message(&shared_state, &conversation_id, &assistant_message_id, collected.clone(), "done").await {
                                yield Ok(encode_sse(StreamEvent::Error(StreamErrorPayload {
                                    conversation_id: conversation_id.clone(),
                                    message_id: assistant_message_id.clone(),
                                    message: error,
                                })));
                            } else {
                                yield Ok(encode_sse(StreamEvent::Done(StreamDonePayload {
                                    conversation_id: conversation_id.clone(),
                                    message_id: assistant_message_id.clone(),
                                })));
                            }
                            failed = true;
                            break;
                        }
                        Ok(FrameResult::Ignore) => {}
                        Err(error) => {
                            let _ = finalize_assistant_message(&shared_state, &conversation_id, &assistant_message_id, error.clone(), "error").await;
                            yield Ok(encode_sse(StreamEvent::Error(StreamErrorPayload {
                                conversation_id: conversation_id.clone(),
                                message_id: assistant_message_id.clone(),
                                message: error,
                            })));
                            failed = true;
                            break;
                        }
                    }
                }

                if !failed {
                    if let Err(error) = finalize_assistant_message(&shared_state, &conversation_id, &assistant_message_id, collected, "done").await {
                        yield Ok(encode_sse(StreamEvent::Error(StreamErrorPayload {
                            conversation_id: conversation_id.clone(),
                            message_id: assistant_message_id.clone(),
                            message: error,
                        })));
                    } else {
                        yield Ok(encode_sse(StreamEvent::Done(StreamDonePayload {
                            conversation_id: conversation_id.clone(),
                            message_id: assistant_message_id.clone(),
                        })));
                    }
                }
            }
            Err(error) => {
                let _ = finalize_assistant_message(&shared_state, &conversation_id, &assistant_message_id, error.clone(), "error").await;
                yield Ok(encode_sse(StreamEvent::Error(StreamErrorPayload {
                    conversation_id: conversation_id.clone(),
                    message_id: assistant_message_id.clone(),
                    message: error,
                })));
            }
        }
    };

    let mut response = Response::new(Body::from_stream(stream_response));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("text/event-stream"));
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    Ok(response)
}

async fn finalize_assistant_message(
    state: &AppState,
    conversation_id: &str,
    message_id: &str,
    content: String,
    status: &str,
) -> Result<(), String> {
    let mut store = state.store.lock().await;
    let conversation = store
        .conversations
        .iter_mut()
        .find(|conversation| conversation.id == conversation_id)
        .ok_or_else(|| "Conversation not found while finalizing message.".to_string())?;

    if let Some(message) = conversation
        .messages
        .iter_mut()
        .find(|message| message.id == message_id)
    {
        message.content = content;
        message.status = status.to_string();
    }
    conversation.updated_at = now_iso();

    persist_state(&state.data_dir, &store).await
}

type RemoteFrameStream =
    std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<FrameResult, String>> + Send>>;

async fn request_openai_stream(
    client: &Client,
    settings: &AppSettings,
    messages: Vec<Value>,
) -> Result<RemoteFrameStream, String> {
    if !settings.stream {
        let response = client
            .post(format!(
                "{}/v1/chat/completions",
                settings.base_url.trim_end_matches('/')
            ))
            .bearer_auth(&settings.api_key)
            .json(&json!({
                "model": settings.model,
                "stream": false,
                "temperature": settings.temperature,
                "max_tokens": settings.max_output_tokens,
                "messages": messages,
            }))
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(if body.is_empty() {
                format!("Model request failed with {status}")
            } else {
                body
            });
        }

        let value: Value = response.json().await.map_err(|error| error.to_string())?;
        let content = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        let single_response_stream = stream! {
            if !content.is_empty() {
                yield Ok(FrameResult::Delta(content));
            }
            yield Ok(FrameResult::Done);
        };

        return Ok(Box::pin(single_response_stream));
    }

    let response = client
        .post(format!(
            "{}/v1/chat/completions",
            settings.base_url.trim_end_matches('/')
        ))
        .bearer_auth(&settings.api_key)
        .json(&json!({
            "model": settings.model,
            "stream": settings.stream,
            "temperature": settings.temperature,
            "max_tokens": settings.max_output_tokens,
            "messages": messages,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(if body.is_empty() {
            format!("Model request failed with {status}")
        } else {
            body
        });
    }

    let stream = response.bytes_stream();
    let framed = stream! {
      let mut buffer = String::new();
      futures_util::pin_mut!(stream);
      while let Some(chunk) = stream.next().await {
        match chunk {
          Ok(bytes) => {
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            while let Some(frame) = take_sse_frame(&mut buffer) {
              yield parse_openai_frame(&frame);
            }
          }
          Err(error) => {
            yield Err(error.to_string());
            break;
          }
        }
      }
    };

    Ok(Box::pin(framed))
}

fn encode_sse(event: StreamEvent) -> Bytes {
    Bytes::from(format!(
        "data: {}\n\n",
        serde_json::to_string(&event).unwrap_or_else(|_| "{\"event\":\"error\"}".to_string())
    ))
}

fn build_request_messages(
    conversation: Option<&ConversationRecord>,
    settings: &AppSettings,
) -> Vec<Value> {
    let mut messages = Vec::new();

    if !settings.system_instruction.trim().is_empty() {
        messages.push(json!({
            "role": "system",
            "content": settings.system_instruction.trim(),
        }));
    }

    if let Some(conversation) = conversation {
        messages.extend(conversation.messages.iter().map(|message| {
            json!({
                "role": message.role,
                "content": message.content,
            })
        }));
    }

    messages
}

fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    if settings.base_url.trim().is_empty() {
        return Err("Base URL is required.".to_string());
    }
    if settings.api_key.trim().is_empty() {
        return Err("API key is required.".to_string());
    }
    if settings.model.trim().is_empty() {
        return Err("Model is required.".to_string());
    }
    if settings.temperature < 0.0 || settings.temperature > 2.0 {
        return Err("Temperature must be between 0 and 2.".to_string());
    }
    if settings.max_output_tokens == 0 {
        return Err("Max output tokens must be greater than 0.".to_string());
    }
    Ok(())
}

async fn load_or_migrate_state(data_dir: &PathBuf) -> Result<PersistedState, String> {
    tokio::fs::create_dir_all(data_dir)
        .await
        .map_err(|error| error.to_string())?;

    let settings_path = data_dir.join(SETTINGS_FILE);
    let conversations_path = data_dir.join(CONVERSATIONS_FILE);

    let settings_exists = tokio::fs::try_exists(&settings_path)
        .await
        .map_err(|error| error.to_string())?;
    let conversations_exists = tokio::fs::try_exists(&conversations_path)
        .await
        .map_err(|error| error.to_string())?;

    if settings_exists || conversations_exists {
        let settings = if settings_exists {
            serde_json::from_str::<AppSettings>(
                &tokio::fs::read_to_string(&settings_path)
                    .await
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?
        } else {
            AppSettings::default()
        };

        let conversations = if conversations_exists {
            serde_json::from_str::<Vec<ConversationRecord>>(
                &tokio::fs::read_to_string(&conversations_path)
                    .await
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?
        } else {
            Vec::new()
        };

        return Ok(PersistedState {
            settings,
            conversations: sorted_conversations(conversations),
        });
    }

    let legacy_snapshot_path = data_dir.join(LEGACY_APP_STATE_FILE);
    let legacy_exists = tokio::fs::try_exists(&legacy_snapshot_path)
        .await
        .map_err(|error| error.to_string())?;

    let state = if legacy_exists {
        let content = tokio::fs::read_to_string(&legacy_snapshot_path)
            .await
            .map_err(|error| error.to_string())?;
        migrate_legacy_snapshot(&content)?
    } else {
        PersistedState::default()
    };

    persist_state(data_dir, &state).await?;
    Ok(state)
}

async fn persist_state(data_dir: &PathBuf, state: &PersistedState) -> Result<(), String> {
    tokio::fs::create_dir_all(data_dir)
        .await
        .map_err(|error| error.to_string())?;
    tokio::fs::write(
        data_dir.join(SETTINGS_FILE),
        serde_json::to_string_pretty(&state.settings).map_err(|error| error.to_string())?,
    )
    .await
    .map_err(|error| error.to_string())?;
    tokio::fs::write(
        data_dir.join(CONVERSATIONS_FILE),
        serde_json::to_string_pretty(&sorted_conversations(state.conversations.clone()))
            .map_err(|error| error.to_string())?,
    )
    .await
    .map_err(|error| error.to_string())
}

fn migrate_legacy_snapshot(content: &str) -> Result<PersistedState, String> {
    let legacy: LegacyAppStateSnapshot =
        serde_json::from_str(content).map_err(|error| error.to_string())?;
    let endpoint = legacy.endpoints.first();
    let route_target = legacy.route_targets.first();

    let settings = AppSettings {
        base_url: endpoint.map(|item| item.base_url.clone()).unwrap_or_default(),
        api_key: endpoint.map(|item| item.api_key.clone()).unwrap_or_default(),
        model: route_target
            .map(|item| item.model.clone())
            .or_else(|| endpoint.map(|item| item.default_model.clone()))
            .unwrap_or_else(|| AppSettings::default().model),
        system_instruction: String::new(),
        temperature: 1.0,
        max_output_tokens: 4096,
        stream: true,
    };

    let conversations = legacy
        .conversations
        .into_iter()
        .map(|conversation| ConversationRecord {
            id: conversation.id,
            title: conversation.title,
            created_at: conversation.created_at,
            updated_at: conversation.updated_at,
            messages: conversation
                .messages
                .into_iter()
                .map(|message| MessageRecord {
                    id: message.id,
                    role: message.role,
                    content: message.content,
                    created_at: message.created_at,
                    status: message.status.unwrap_or_else(|| "done".to_string()),
                })
                .collect(),
        })
        .collect();

    Ok(PersistedState {
        settings,
        conversations,
    })
}

fn sorted_conversations(mut conversations: Vec<ConversationRecord>) -> Vec<ConversationRecord> {
    conversations.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    conversations
}

fn make_conversation_title(input: &str) -> String {
    let compact = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        "New chat".to_string()
    } else {
        compact.chars().take(42).collect()
    }
}

fn parse_openai_frame(frame: &str) -> Result<FrameResult, String> {
    let payload = frame
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.trim())
        .collect::<Vec<_>>()
        .join("\n");

    if payload.is_empty() {
        return Ok(FrameResult::Ignore);
    }
    if payload == "[DONE]" {
        return Ok(FrameResult::Done);
    }

    let value: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    let text = value
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

    let frame = buffer[..index].to_string();
    let rest = buffer[index + separator_len..].to_string();
    *buffer = rest;
    Some(frame)
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn bad_request(message: String) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, message)
}

fn not_found(message: String) -> (StatusCode, String) {
    (StatusCode::NOT_FOUND, message)
}

fn internal_error(message: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, message)
}

enum FrameResult {
    Delta(String),
    Done,
    Ignore,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openai_delta_frames() {
        let frame = r#"data: {"choices":[{"delta":{"content":"hello"}}]}"#;
        match parse_openai_frame(frame).expect("frame should parse") {
            FrameResult::Delta(text) => assert_eq!(text, "hello"),
            _ => panic!("expected delta"),
        }
    }

    #[test]
    fn parses_openai_done_frames() {
        let frame = "data: [DONE]";
        assert!(matches!(
            parse_openai_frame(frame).expect("frame should parse"),
            FrameResult::Done
        ));
    }

    #[test]
    fn migrates_legacy_snapshot() {
        let content = r#"{
          "endpoints": [
            {
              "id": "ep-1",
              "baseUrl": "https://api.example.com",
              "apiKey": "secret",
              "defaultModel": "gpt-4.1-mini"
            }
          ],
          "routeTargets": [
            {
              "endpointId": "ep-1",
              "model": "gpt-4.1-mini"
            }
          ],
          "conversations": [
            {
              "id": "conv-1",
              "title": "Legacy",
              "createdAt": "2026-01-01T00:00:00Z",
              "updatedAt": "2026-01-01T00:10:00Z",
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
          ]
        }"#;

        let migrated = migrate_legacy_snapshot(content).expect("migration should succeed");
        assert_eq!(migrated.settings.base_url, "https://api.example.com");
        assert_eq!(migrated.settings.model, "gpt-4.1-mini");
        assert_eq!(migrated.conversations.len(), 1);
        assert_eq!(migrated.conversations[0].messages[0].content, "Hello");
    }

    #[test]
    fn validates_required_settings() {
        let result = validate_settings(&AppSettings::default());
        assert_eq!(result.expect_err("settings should fail"), "Base URL is required.");
    }
}
