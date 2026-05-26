import * as vscode from 'vscode';
import { renderWelcomeHtml, WELCOME_SECTION_IDS, type AgentConnectionDescriptor, type WelcomeSectionId } from './welcomeHtml';
import { shouldOfferGitignoreLine } from './needsGitignore';
import {
  getAgentMcpState,
  getAllConfiguredAgents,
  AGENT_DISPLAY_NAMES,
  AGENT_SCOPES,
  scopeDisplayLabel,
  type McpAgent,
} from '../../commands/mcp-install-state';

const COLLAPSED_SECTIONS_KEY = 'agenticBookmarks.welcomeSectionCollapsed';

export class WelcomeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'agenticBookmarks.welcome';

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    subscriptions: vscode.Disposable[],
  ) {
    subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.render()),
    );
  }

  /** Flip a section's collapsed state in globalState and re-render. */
  public async toggleSection(sectionId: string): Promise<void> {
    if (!isWelcomeSectionId(sectionId)) return;
    const current = this.getCollapsedSections();
    const next = { ...current, [sectionId]: !current[sectionId] };
    await this.context.globalState.update(COLLAPSED_SECTIONS_KEY, next);
    this.refresh();
  }

  private getCollapsedSections(): Partial<Record<WelcomeSectionId, boolean>> {
    const raw = this.context.globalState.get<Partial<Record<WelcomeSectionId, boolean>>>(COLLAPSED_SECTIONS_KEY);
    return raw ?? {};
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
      localResourceRoots: [this.context.extensionUri],
    };
    void this.render();
  }

  /** Re-render the view. Safe to call after side effects (e.g. updating .gitignore). */
  public refresh(): void {
    void this.render();
  }

  private currentVersion(): string {
    return (this.context.extension?.packageJSON?.version as string | undefined) ?? '';
  }

  private buildAgentDescriptors(): AgentConnectionDescriptor[] {
    const currentVersion = this.currentVersion();
    return getAllConfiguredAgents().map((agent: McpAgent) => {
      const { installs } = getAgentMcpState(this.context, agent);
      const installedScopes = Object.keys(installs) as Array<keyof typeof installs>;
      const isOutdated = installedScopes.length > 0 && installedScopes.some((s) => {
        const v = installs[s]?.installedVersion;
        return !v || v !== currentVersion;
      });
      return {
        agent,
        displayName: AGENT_DISPLAY_NAMES[agent],
        installs,
        scopes: AGENT_SCOPES[agent],
        scopeLabel: scopeDisplayLabel,
        isOutdated,
      };
    });
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
        .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'icon512.png'))
        .toString(),
      cspSource: webview.cspSource,
      nonce: getNonce(),
      agents: this.buildAgentDescriptors(),
      collapsedSections: this.getCollapsedSections(),
    });
  }
}

function isWelcomeSectionId(value: string): value is WelcomeSectionId {
  return (WELCOME_SECTION_IDS as readonly string[]).includes(value);
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
