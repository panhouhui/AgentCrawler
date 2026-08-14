export type ChannelName = "telegram" | "web" | "whatsapp";

export interface InlineButton {
  readonly label: string;
  readonly callbackData: string;
}

export interface MessageContent {
  readonly text?: string;
  readonly media?: MediaContent;
  readonly mentions?: readonly string[];
  /** Inline keyboard buttons (rows of buttons). */
  readonly inlineButtons?: readonly (readonly InlineButton[])[];
  /** When true, text is already HTML — skip markdown conversion. */
  readonly parseAsHtml?: boolean;
}

export interface MediaContent {
  readonly type: "image" | "audio" | "video" | "document";
  readonly url?: string;
  readonly buffer?: Buffer;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly caption?: string;
}

export interface GroupParticipant {
  readonly jid: string;
  readonly name: string | null;
}

export interface IncomingMessage {
  readonly id: string;
  readonly channel: ChannelName;
  readonly chatId: string;
  readonly senderId: string;
  readonly senderName?: string;
  readonly content: MessageContent;
  readonly timestamp: number;
  readonly raw?: unknown;
  readonly mentioned?: boolean;
  readonly groupParticipants?: readonly GroupParticipant[];
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;

export interface Channel {
  readonly name: ChannelName;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(chatId: string, content: MessageContent): Promise<number | void>;
  editMessage?(chatId: string, messageId: number, text: string): Promise<void>;
  deleteMessage?(chatId: string, messageId: number): Promise<void>;
  sendTyping?(chatId: string): Promise<void>;
  sendReaction?(chatId: string, messageKey: unknown, emoji: string): Promise<void>;
  markRead?(rawMessage: unknown): Promise<void>;
  onMessage(handler: MessageHandler): void;
  isConnected(): boolean;
}
