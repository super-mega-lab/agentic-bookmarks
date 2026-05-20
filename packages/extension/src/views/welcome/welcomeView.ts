import * as vscode from 'vscode';
import { renderWelcomeHtml } from './welcomeHtml';
import { shouldOfferGitignoreLine } from './needsGitignore';

export class WelcomeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'agenticBookmarks.welcome';

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    subscriptions: vscode.Disposable[],
  ) {
    subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.render()),
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
    void this.render();
  }

  /** Re-render the view. Safe to call after side effects (e.g. updating .gitignore). */
  public refresh(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    if (!this.view) return;
    const webview = this.view.webview;
    const folders = vscode.workspace.workspaceFolders;
    const hasFolder = (folders?.length ?? 0) > 0;
    // The no-folder view is a no-op: do no workspace evaluation when empty.
    const needsGitignore = hasFolder
      ? await shouldOfferGitignoreLine(folders![0].uri.fsPath)
      : false;
    // The view may have been disposed while awaiting; re-check before writing.
    if (!this.view) return;
    webview.html = renderWelcomeHtml({
      hasFolder,
      needsGitignore,
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
