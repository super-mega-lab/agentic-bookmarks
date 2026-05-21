// ABOUTME: VS Code glue registering Repair All (agent launch) + its gear settings.
// ABOUTME: Decision logic lives in agent-repair-helpers; persistence in repair-agent-state.
import * as vscode from 'vscode';
import {
  AGENT_DISPLAY_NAMES,
  getMcpInstallRecords,
  type McpAgent,
} from './mcp-install-state';
import {
  pickAgentToLaunch,
  buildAgentLaunch,
} from './agent-repair-helpers';
import {
  getRepairAgentDefault,
  setRepairAgentDefault,
  hasRepairConsent,
  recordRepairConsent,
} from './repair-agent-state';

export interface AgentRepairDeps {
  context: vscode.ExtensionContext;
  workspaceRoot: string;
  log: { info(m: string): void; error(m: string): void };
  /** Current count of known-broken anchors (drives the no-broken guard). */
  getBrokenCount: () => number;
}

const SETUP_COMMAND: Record<McpAgent, string> = {
  claude: 'agenticBookmarks.setupClaude',
  cursor: 'agenticBookmarks.setupCursor',
  codex: 'agenticBookmarks.setupCodex',
};

function connectedAgents(context: vscode.ExtensionContext): McpAgent[] {
  return Array.from(new Set(getMcpInstallRecords(context).map((e) => e.agent)));
}

async function ensureConsent(context: vscode.ExtensionContext): Promise<boolean> {
  if (hasRepairConsent(context)) return true;
  const proceed = 'Run repair';
  const choice = await vscode.window.showInformationMessage(
    'Repairing broken bookmarks runs a local AI agent of your choice — you’ll see it run in a terminal. ' +
      'It uses your agent’s own billing. Agentic Bookmarks sends no code or telemetry to the cloud.',
    { modal: true },
    proceed,
  );
  if (choice !== proceed) return false;
  await recordRepairConsent(context);
  return true;
}

async function launchAgent(deps: AgentRepairDeps, agent: McpAgent): Promise<void> {
  const launch = buildAgentLaunch(agent);
  if (launch.method === 'terminal') {
    const terminal = vscode.window.createTerminal({
      name: `Repair Bookmarks (${AGENT_DISPLAY_NAMES[agent]})`,
      cwd: deps.workspaceRoot, // so the agent's MCP stdio discovery finds .bookmarks
    });
    terminal.show();
    terminal.sendText(launch.command, true);
    deps.log.info(`[repairAll] launched ${agent} in terminal`);
  } else {
    await vscode.env.clipboard.writeText(launch.text);
    vscode.window.showInformationMessage(
      `Repair prompt copied to clipboard — paste it into ${AGENT_DISPLAY_NAMES[agent]}.`,
    );
  }
}

async function chooseAgent(agents: McpAgent[]): Promise<McpAgent | undefined> {
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({ label: AGENT_DISPLAY_NAMES[a], agent: a })),
    { placeHolder: 'Choose an agent to repair broken bookmarks' },
  );
  return pick?.agent;
}

async function offerConnect(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    (['claude', 'codex', 'cursor'] as McpAgent[]).map((a) => ({ label: `Connect ${AGENT_DISPLAY_NAMES[a]}`, agent: a })),
    { placeHolder: 'No agent connected — connect one to enable repair' },
  );
  if (pick) await vscode.commands.executeCommand(SETUP_COMMAND[pick.agent]);
}

export function registerAgentRepairCommands(deps: AgentRepairDeps): vscode.Disposable[] {
  const { context } = deps;

  // Run the agent-repair launch flow. When force=false, bail with a hint if the
  // current scan shows no broken bookmarks.
  async function runRepairAll(force: boolean): Promise<void> {
    if (!force && deps.getBrokenCount() === 0) {
      vscode.window.showInformationMessage(
        'No broken bookmarks in the current scan. You can rescan all or force-repair-all from the repair context menu.',
      );
      return;
    }
    const decision = pickAgentToLaunch({
      connected: connectedAgents(context),
      preferred: getRepairAgentDefault(context),
    });
    if (decision.action === 'connect') { await offerConnect(); return; }
    if (!(await ensureConsent(context))) return;
    let agent: McpAgent | undefined;
    if (decision.action === 'launch') {
      agent = decision.agent;
    } else {
      agent = await chooseAgent(decision.agents);
      if (agent) await setRepairAgentDefault(context, agent); // remember the choice
    }
    if (agent) await launchAgent(deps, agent);
  }

  return [
    vscode.commands.registerCommand('agenticBookmarks.repairAll', () => runRepairAll(false)),
    vscode.commands.registerCommand('agenticBookmarks.repairAllForce', () => runRepairAll(true)),

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
