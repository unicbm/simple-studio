export type MessageRole = "system" | "user" | "assistant";
export type MessageStatus = "done" | "streaming" | "error";

export interface AppSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemInstruction: string;
  temperature: number;
  maxOutputTokens: number;
  stream: boolean;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface BootstrapPayload {
  settings: AppSettings;
  conversations: Conversation[];
}

export type StreamEvent =
  | {
      event: "start";
      data: {
        conversationId: string;
        userMessageId: string;
        assistantMessageId: string;
      };
    }
  | {
      event: "delta";
      data: {
        conversationId: string;
        messageId: string;
        textChunk: string;
      };
    }
  | {
      event: "error";
      data: {
        conversationId: string;
        messageId: string;
        message: string;
      };
    }
  | {
      event: "done";
      data: {
        conversationId: string;
        messageId: string;
      };
    };
