import { FromWebviewMessage, MessageHandler, ToWebviewMessage } from "../../shared/messaging";

type SessionData = { zoom?: number; openStateId?: number | null };

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): SessionData | undefined;
    setState(value: SessionData): void;
};

const vscode = acquireVsCodeApi();

export const session = {
    read: () => vscode.getState() ?? {},
    save: (values: SessionData) => vscode.setState({ ...vscode.getState(), ...values })
};

const listeners = new Set<(message: ToWebviewMessage) => void>();

export function listen(listener: (message: ToWebviewMessage) => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export const messageHandler = new MessageHandler<FromWebviewMessage, ToWebviewMessage>(
    async message => {
        for (const listener of listeners) listener(message);
        return undefined;
    },
    message => vscode.postMessage(message)
);

window.addEventListener("message", event => messageHandler.handleMessage(event.data));
