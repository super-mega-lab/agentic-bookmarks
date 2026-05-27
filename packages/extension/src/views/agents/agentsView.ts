// ABOUTME: WebviewViewProvider for the "Agents" panel — renders skill playbook
// ABOUTME: pill buttons. Static content, no refresh triggers needed.
import * as vscode from 'vscode';
import { renderAgentsHtml } from './agentsHtml';

export class AgentsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'agenticBookmarks.agents';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: false,
      enableCommandUris: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = renderAgentsHtml({
      cspSource: webviewView.webview.cspSource,
      nonce: getNonce(),
    });
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
