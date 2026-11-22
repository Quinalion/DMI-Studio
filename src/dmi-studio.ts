import * as vscode from "vscode";
import { Dmi, DmiSnapshot } from "../shared/dmi";
import {
    EditorInput,
    ExtensionHostMessageHandler,
    FromWebviewMessage,
    MessageHandler,
    MessageType,
    ToWebviewMessage
} from "../shared/messaging";
import { Disposable } from "./dispose";
import { getNonce } from "./util";

const extensionNamespace = "DMI-Studio";

async function readSnapshot(uri: vscode.Uri): Promise<DmiSnapshot> {
    if (uri.scheme === "untitled") return { document: new Dmi(32, 32).toData() };
    const bytes = await vscode.workspace.fs.readFile(uri);
    return { file: Uint8Array.from(bytes).buffer };
}

// Assign session IDs once, including the version restored by the very first undo.
async function readEditorSnapshot(uri: vscode.Uri): Promise<DmiSnapshot> {
    const snapshot = await readSnapshot(uri);
    return "file" in snapshot
        ? { document: (await Dmi.fromSnapshot(snapshot)).toData() }
        : snapshot;
}

class DmiDocument extends Disposable implements vscode.CustomDocument {
    static async create(uri: vscode.Uri, backupId?: string, readOnly = false) {
        if (!readOnly && uri.scheme !== "untitled") {
            readOnly = vscode.workspace.fs.isWritableFileSystem(uri.scheme) === false;
            if (!readOnly && !backupId) {
                const stat = await vscode.workspace.fs.stat(uri);
                readOnly = Boolean((stat.permissions ?? 0) & vscode.FilePermission.Readonly);
            }
        }
        const snapshot = await readEditorSnapshot(backupId ? vscode.Uri.parse(backupId) : uri);
        return new DmiDocument(uri, snapshot, readOnly);
    }

    private readonly changes = this._register(
        new vscode.EventEmitter<{
            label: string;
            undo(): void;
            redo(): void;
        }>()
    );
    readonly onDidChange = this.changes.event;

    private readonly resets = this._register(new vscode.EventEmitter<DmiSnapshot>());
    readonly onDidReset = this.resets.event;

    private constructor(
        readonly uri: vscode.Uri,
        private content: DmiSnapshot,
        readonly readOnly: boolean
    ) {
        super();
    }

    get snapshot() {
        return this.content;
    }

    edit(data: DmiSnapshot, label: string) {
        if (this.readOnly) return;
        const previous = this.content;
        this.content = data;
        this.changes.fire({
            label,
            undo: () => {
                this.reset(previous);
                void vscode.window.showInformationMessage("Undid: " + label);
            },
            redo: () => {
                this.reset(data);
                void vscode.window.showInformationMessage("Redid: " + label);
            }
        });
    }

    private reset(content: DmiSnapshot) {
        this.content = content;
        this.resets.fire(content);
    }

    async saveAs(target: vscode.Uri, cancellation: vscode.CancellationToken) {
        if (this.readOnly) return;
        const dmi = await Dmi.fromSnapshot(this.content);
        try {
            const onDisk = await Dmi.fromSnapshot(await readSnapshot(target));
            if (dmi.isSame(onDisk)) return;
        } catch {
            // A new destination or a file of a different type needs to be written.
        }
        if (cancellation.isCancellationRequested) return;
        const bytes = await dmi.getFileData();
        if (!cancellation.isCancellationRequested)
            await vscode.workspace.fs.writeFile(target, bytes);
    }

    async revert(cancellation: vscode.CancellationToken) {
        const snapshot = await readEditorSnapshot(this.uri);
        if (!cancellation.isCancellationRequested) this.reset(snapshot);
    }
}

export class DmiEditorProvider
    extends Disposable
    implements vscode.CustomEditorProvider<DmiDocument>
{
    private static readonly editor = extensionNamespace + ".editor";
    private static readonly preview = extensionNamespace + ".preview";
    private nextUntitled = 1;

    private readonly changes = this._register(
        new vscode.EventEmitter<vscode.CustomDocumentEditEvent<DmiDocument>>()
    );
    readonly onDidChangeCustomDocument = this.changes.event;

    private readonly editors = new Set<{
        document: DmiDocument;
        panel: vscode.WebviewPanel;
        messaging: ExtensionHostMessageHandler;
    }>();

    public static register(context: vscode.ExtensionContext) {
        const provider = new DmiEditorProvider(context);
        provider._register(
            vscode.window.registerCustomEditorProvider(DmiEditorProvider.editor, provider)
        );
        const preview: vscode.CustomReadonlyEditorProvider<DmiDocument> = {
            openCustomDocument: (uri, options) => DmiDocument.create(uri, options.backupId, true),
            resolveCustomEditor: (document, panel) => provider.resolveCustomEditor(document, panel)
        };
        provider._register(
            vscode.window.registerCustomEditorProvider(DmiEditorProvider.preview, preview)
        );
        provider._register(
            vscode.commands.registerCommand(extensionNamespace + ".new", () => provider.newDmi())
        );
        provider._register(
            vscode.commands.registerCommand(extensionNamespace + ".sort", () => {
                const active = provider.activeEditor();
                if (active && !active.document.readOnly)
                    active.messaging.sendEvent({ type: MessageType.SortEvent });
            })
        );
        provider._register(
            vscode.commands.registerCommand(extensionNamespace + ".compare", (uri?: vscode.Uri) =>
                provider.compareCommand(uri)
            )
        );
        return provider;
    }

    private constructor(private readonly context: vscode.ExtensionContext) {
        super();
    }

    private async newDmi() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            await vscode.window.showErrorMessage("Open a workspace to create a DMI file.");
            return;
        }
        const uri = vscode.Uri.joinPath(folder.uri, "new-" + this.nextUntitled++ + ".dmi").with({
            scheme: "untitled"
        });
        await vscode.commands.executeCommand("vscode.openWith", uri, DmiEditorProvider.editor);
    }

    private activeEditor() {
        return [...this.editors].find(entry => entry.panel.active);
    }

    async openCustomDocument(uri: vscode.Uri, options: vscode.CustomDocumentOpenContext) {
        const document = await DmiDocument.create(uri, options.backupId);
        document.onDidChange(event => this.changes.fire({ document, ...event }));
        return document;
    }

    async resolveCustomEditor(document: DmiDocument, panel: vscode.WebviewPanel) {
        const messaging = this.setup(
            panel,
            () => ({
                mode: "editor",
                snapshot: document.snapshot,
                readOnly: document.readOnly
            }),
            document
        );
        const entry = { document, panel, messaging };
        this.editors.add(entry);
        const subscription = document.onDidReset(snapshot =>
            messaging.sendEvent({ type: MessageType.DocumentChangedEvent, snapshot })
        );
        panel.onDidDispose(() => {
            subscription.dispose();
            this.editors.delete(entry);
        });
    }

    private async pickFile(label: string) {
        const files = await vscode.window.showOpenDialog({
            openLabel: label,
            filters: { DMI: ["dmi"] }
        });
        return files?.[0];
    }

    private async compareCommand(resource?: vscode.Uri) {
        try {
            const active = this.activeEditor()?.document;
            const original = resource ?? active?.uri ?? (await this.pickFile("Select original"));
            if (!original) return;
            await this.compare(
                original,
                active?.uri.toString() === original.toString() ? active : undefined
            );
        } catch (error) {
            await vscode.window.showErrorMessage("Could not compare DMI files. " + String(error));
        }
    }

    private async compare(original: vscode.Uri, document?: DmiDocument) {
        const modified = await this.pickFile("Compare");
        if (!modified) return;
        const [left, right] = await Promise.all([
            document?.snapshot ?? readSnapshot(original),
            readSnapshot(modified)
        ]);
        const name = (uri: vscode.Uri) => uri.path.split("/").pop() || uri.toString();
        const panel = vscode.window.createWebviewPanel(
            extensionNamespace + ".comparison",
            name(original) + " ↔ " + name(modified),
            vscode.ViewColumn.Active
        );
        this.setup(panel, () => ({
            mode: "comparison",
            original: { name: name(original), snapshot: left },
            modified: { name: name(modified), snapshot: right }
        }));
    }

    private setup(panel: vscode.WebviewPanel, input: () => EditorInput, document?: DmiDocument) {
        const webview = panel.webview;
        const messaging: ExtensionHostMessageHandler = new MessageHandler(
            message => this.onMessage(input, message, document),
            message => webview.postMessage(message)
        );
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")]
        };
        webview.onDidReceiveMessage(message => messaging.handleMessage(message));
        webview.html = this.getHtml(webview);
        return messaging;
    }

    private async onMessage(
        input: () => EditorInput,
        message: FromWebviewMessage,
        document?: DmiDocument
    ): Promise<ToWebviewMessage | undefined> {
        switch (message.type) {
            case MessageType.ReadyRequest:
                return {
                    type: MessageType.ReadyResponse,
                    input: input(),
                    defaultZoom:
                        vscode.workspace
                            .getConfiguration(extensionNamespace)
                            .get<number>("defaultZoom") || 2
                };
            case MessageType.EditEvent:
                document?.edit({ document: message.data }, message.label);
                break;
            case MessageType.CompareRequest:
                if (document) {
                    try {
                        await this.compare(document.uri, document);
                    } catch (error) {
                        await vscode.window.showErrorMessage(
                            "Could not compare DMI files. " + String(error)
                        );
                    }
                }
                break;
            case MessageType.ClipboardRead:
            case MessageType.ClipboardWrite:
                try {
                    if (message.type === MessageType.ClipboardWrite) {
                        await vscode.env.clipboard.writeText(message.text);
                        return { type: MessageType.ClipboardResult, text: "" };
                    }
                    return {
                        type: MessageType.ClipboardResult,
                        text: await vscode.env.clipboard.readText()
                    };
                } catch (error) {
                    return { type: MessageType.ClipboardResult, text: "", error: String(error) };
                }
            case MessageType.ClipboardSuccess:
                void vscode.window.showInformationMessage(message.text);
                break;
            case MessageType.Alert:
                await vscode.window.showErrorMessage(message.text);
                break;
        }
    }

    saveCustomDocument(document: DmiDocument, cancellation: vscode.CancellationToken) {
        return document.saveAs(document.uri, cancellation);
    }

    saveCustomDocumentAs(
        document: DmiDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ) {
        return document.saveAs(destination, cancellation);
    }

    revertCustomDocument(document: DmiDocument, cancellation: vscode.CancellationToken) {
        return document.revert(cancellation);
    }

    async backupCustomDocument(
        document: DmiDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken
    ) {
        await document.saveAs(context.destination, cancellation);
        return {
            id: context.destination.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(context.destination);
                } catch {
                    // The backup may already have been removed.
                }
            }
        };
    }

    private getHtml(webview: vscode.Webview) {
        const asset = (file: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", file));
        const nonce = getNonce();
        return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src ${
        webview.cspSource
    }; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="${asset("editor.css")}">
    <script nonce="${nonce}" src="${asset("editor.js")}" defer></script>
    <title>DMI Studio</title>
</head>
<body></body>
</html>`;
    }
}
