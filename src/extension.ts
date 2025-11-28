import * as vscode from 'vscode';
import { FlintDebugSession } from './flint_debug_session';
import { ProviderResult } from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    vscode.debug.registerDebugAdapterDescriptorFactory('flint-debug', {
        createDebugAdapterDescriptor(session) {
            return new vscode.DebugAdapterInlineImplementation(new FlintDebugSession());
        }
    });
}

export function deactivate() {

}
