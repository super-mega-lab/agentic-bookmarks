// ABOUTME: WebviewViewProvider for the "Agents" panel — renders agent connection
// ABOUTME: status and skill playbook pill buttons. Dynamic; refreshes on MCP state changes.
import * as vscode from 'vscode';
import { renderAgentsHtml, AGENTS_SECTION_IDS, type AgentConnectionDescriptor, type AgentsSectionId } from './agentsHtml';
import {
  getAgentMcpState,
  getAllConfiguredAgents,
  AGENT_DISPLAY_NAMES,
  AGENT_SCOPES,
  scopeDisplayLabel,
  type McpAgent,
} from '../../commands/mcp-install-state';

export { type AgentConnectionDescriptor } from './agentsHtml';

const COLLAPSED_SECTIONS_KEY = 'agenticBookmarks.agentsSectionCollapsed';

export class AgentsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'agenticBookmarks.agents';

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
  ) {
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.render()),
    );
  }

  /** Flip a section's collapsed state in globalState and re-render. */
  public async toggleSection(sectionId: string): Promise<void> {
    if (!isAgentsSectionId(sectionId)) return;
    const current = this.getCollapsedSections();
    const next = { ...current, [sectionId]: !current[sectionId] };
    await this.context.globalState.update(COLLAPSED_SECTIONS_KEY, next);
    this.refresh();
  }

  private getCollapsedSections(): Partial<Record<AgentsSectionId, boolean>> {
    const raw = this.context.globalState.get<Partial<Record<AgentsSectionId, boolean>>>(COLLAPSED_SECTIONS_KEY);
    return raw ?? {};
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: false,
      enableCommandUris: true,
      localResourceRoots: [this.context.extensionUri],
    };
    this.render();
  }

  /** Re-render the view. Call after MCP install/update/uninstall state changes. */
  public refresh(): void {
    this.render();
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

  private render(): void {
    if (!this.view) return;
    const webview = this.view.webview;
    const hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    webview.html = renderAgentsHtml({
      cspSource: webview.cspSource,
      nonce: getNonce(),
      agents: hasFolder ? this.buildAgentDescriptors() : [],
      collapsedSections: this.getCollapsedSections(),
      hasFolder,
    });
  }
}

function isAgentsSectionId(value: string): value is AgentsSectionId {
  return (AGENTS_SECTION_IDS as readonly string[]).includes(value);
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
