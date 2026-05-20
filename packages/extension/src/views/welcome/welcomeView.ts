import * as vscode from 'vscode';
import { renderWelcomeHtml } from './welcomeHtml';

export class WelcomeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'agenticBookmarks.welcome';

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    subscriptions: vscode.Disposable[],
  ) {
    subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.render()),
    );
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: [this.extensionUri],
    };
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    const webview = this.view.webview;
    webview.html = renderWelcomeHtml({
      hasFolder: (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
      iconUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'icon512.png'))
        .toString(),
      cspSource: webview.cspSource,
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
