import * as vscode from 'vscode';
import {FlintDebugSession} from './flint_debug_session';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    let factory = new InlineDebugAdapterFactory();
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('flint-debug', factory));
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(new FlintDebugSession());
    }
}

export function deactivate() {

}
