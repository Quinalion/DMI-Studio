import * as vscode from "vscode";
import { DmiEditorProvider } from "./dmi-studio";

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(DmiEditorProvider.register(context));
}
