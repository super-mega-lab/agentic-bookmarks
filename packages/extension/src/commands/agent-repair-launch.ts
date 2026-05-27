// ABOUTME: VS Code glue registering Repair All (agent launch) + its gear settings.
// ABOUTME: Decision logic lives in agent-repair-helpers; launch flow in agent-launch.
import * as vscode from 'vscode';
import type { BookmarkNode } from '../treeProvider';
import {
  AGENT_DISPLAY_NAMES,
  getMcpInstallRecords,
  type McpAgent,
} from './mcp-install-state';
import { buildRepairPrompt, type RepairTarget } from './agent-repair-helpers';
import {
  getRepairAgentDefault,
  setRepairAgentDefault,
} from './repair-agent-state';
import { launchAgentWithPrompt, type AgentLaunchDeps } from './agent-launch';

export interface AgentRepairDeps {
  context: vscode.ExtensionContext;
  workspaceRoot: string;
  log: { info(m: string): void; error(m: string): void };
  getBrokenCount: () => number;
}

function connectedAgents(context: vscode.ExtensionContext): McpAgent[] {
  return Array.from(new Set(getMcpInstallRecords(context).map((e) => e.agent)));
}

const SETUP_COMMAND: Record<McpAgent, string> = {
  claude: 'agenticBookmarks.setupClaude',
  cursor: 'agenticBookmarks.setupCursor',
  codex: 'agenticBookmarks.setupCodex',
};

async function offerConnect(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    (['claude', 'codex', 'cursor'] as McpAgent[]).map((a) => ({ label: `Connect ${AGENT_DISPLAY_NAMES[a]}`, agent: a })),
    { placeHolder: 'No agent connected — connect one to enable repair' },
  );
  if (pick) await vscode.commands.executeCommand(SETUP_COMMAND[pick.agent]);
}

export function registerAgentRepairCommands(deps: AgentRepairDeps): vscode.Disposable[] {
  const { context } = deps;
  const launchDeps: AgentLaunchDeps = { context, workspaceRoot: deps.workspaceRoot, log: deps.log };

  async function runAgentRepair(target: RepairTarget, opts: { force: boolean }): Promise<void> {
    if (target.kind === 'all' && !opts.force && deps.getBrokenCount() === 0) {
      vscode.window.showInformationMessage(
        'No broken bookmarks in the current scan. You can rescan all or force-repair-all from the repair context menu.',
      );
      return;
    }
    await launchAgentWithPrompt(launchDeps, buildRepairPrompt(target));
  }

  return [
    vscode.commands.registerCommand('agenticBookmarks.repairAll', () => runAgentRepair({ kind: 'all' }, { force: false })),
    vscode.commands.registerCommand('agenticBookmarks.repairAllForce', () => runAgentRepair({ kind: 'all' }, { force: true })),
    vscode.commands.registerCommand('agenticBookmarks.autoRepairBookmark', async (node: BookmarkNode) => {
      if (!node) {
        vscode.window.showWarningMessage('Select a broken bookmark first.');
        return;
      }
      await runAgentRepair({ kind: 'ids', ids: [node.id] }, { force: true });
    }),
    vscode.commands.registerCommand('agenticBookmarks.repairAllSettings', async () => {
      const connected = connectedAgents(context);
      const current = getRepairAgentDefault(context);
      const items: Array<vscode.QuickPickItem & { agent?: McpAgent; connect?: boolean }> = [];
      for (const a of connected) {
        items.push({
          label: `${current === a ? '$(check) ' : ''}Use ${AGENT_DISPLAY_NAMES[a]}`,
          agent: a,
        });
      }
      items.push({ label: '$(plus) Connect another agent…', connect: true });
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: current
          ? `Default repair agent: ${AGENT_DISPLAY_NAMES[current]}`
          : 'No default repair agent set',
      });
      if (!pick) return;
      if (pick.connect) { await offerConnect(); return; }
      if (pick.agent) {
        await setRepairAgentDefault(context, pick.agent);
        vscode.window.showInformationMessage(`Repair agent set to ${AGENT_DISPLAY_NAMES[pick.agent]}.`);
      }
    }),
  ];
}
