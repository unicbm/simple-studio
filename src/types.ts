export type MessageRole = "system" | "user" | "assistant";
export type MessageStatus = "done" | "streaming" | "error";

export interface AppSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: MessageStatus;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface RequestMessage {
  role: MessageRole;
  content: string;
}

export type StreamEvent =
  | {
      event: "started";
      data: { requestId: string; messageId: string };
    }
  | {
      event: "delta";
      data: { requestId: string; messageId: string; textChunk: string };
    }
  | {
      event: "done";
      data: { requestId: string; messageId: string };
    }
  | {
      event: "error";
      data: { requestId: string; messageId: string; message: string };
    }
  | {
      event: "aborted";
      data: { requestId: string; messageId: string };
    };

export interface ImportedData {
  settings: AppSettings;
  sessions: ChatSession[];
}

export interface StartChatStreamInput {
  requestId: string;
  messageId: string;
  settings: AppSettings;
  messages: RequestMessage[];
  onEvent: (event: StreamEvent) => void;
}
