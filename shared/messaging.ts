import { DmiData, DmiSnapshot } from "./dmi";

export const enum MessageType {
    ReadyRequest,
    ReadyResponse,
    EditEvent,
    DocumentChangedEvent,
    ClipboardRead,
    ClipboardWrite,
    ClipboardResult,
    ClipboardSuccess,
    Alert,
    SortEvent,
    CompareRequest
}

export interface WebviewMessage<T> {
    messageId: number;
    inReplyTo?: number;
    body: T;
}

type ComparisonSide = { name: string; snapshot: DmiSnapshot };

export type EditorInput =
    | { mode: "editor"; snapshot: DmiSnapshot; readOnly: boolean }
    | { mode: "comparison"; original: ComparisonSide; modified: ComparisonSide };

export interface ReadyResponseMessage {
    type: MessageType.ReadyResponse;
    input: EditorInput;
    defaultZoom: number;
}

export interface DocumentChangedEventMessage {
    type: MessageType.DocumentChangedEvent;
    snapshot: DmiSnapshot;
}

export interface ClipboardResult {
    type: MessageType.ClipboardResult;
    text: string;
    error?: string;
}

export type ToWebviewMessage =
    | ReadyResponseMessage
    | DocumentChangedEventMessage
    | ClipboardResult
    | { type: MessageType.SortEvent };

export type FromWebviewMessage =
    | { type: MessageType.ReadyRequest }
    | { type: MessageType.EditEvent; data: DmiData; label: string }
    | { type: MessageType.ClipboardRead }
    | { type: MessageType.ClipboardWrite; text: string }
    | { type: MessageType.ClipboardSuccess; text: string }
    | { type: MessageType.Alert; text: string }
    | { type: MessageType.CompareRequest };

export type ExtensionHostMessageHandler = MessageHandler<ToWebviewMessage, FromWebviewMessage>;

export class MessageHandler<TTo, TFrom> {
    private messageId = 0;
    private readonly requests = new Map<number, (message: TFrom) => void>();

    constructor(
        private readonly onMessage: (message: TFrom) => Promise<TTo | undefined>,
        private readonly postMessage: (message: WebviewMessage<TTo>) => void
    ) {}

    sendEvent(body: TTo) {
        this.postMessage({ body, messageId: this.messageId++ });
    }

    sendRequest<TResponse extends TFrom>(body: TTo) {
        const id = this.messageId++;
        return new Promise<TResponse>(resolve => {
            this.requests.set(id, resolve as (message: TFrom) => void);
            this.postMessage({ body, messageId: id });
        });
    }

    handleMessage(message: WebviewMessage<TFrom>) {
        if (message.inReplyTo !== undefined) {
            const request = this.requests.get(message.inReplyTo);
            this.requests.delete(message.inReplyTo);
            request?.(message.body);
        } else {
            void this.onMessage(message.body).then(reply => {
                if (reply) {
                    this.postMessage({
                        body: reply,
                        messageId: this.messageId++,
                        inReplyTo: message.messageId
                    });
                }
            });
        }
    }
}
