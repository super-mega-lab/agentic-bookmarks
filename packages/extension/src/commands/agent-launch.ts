// ABOUTME: Shared agent-launch flow — pick a connected agent, get consent,
// ABOUTME: and launch it in a terminal (or copy prompt to clipboard).
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

export interface AgentLaunchDeps {
  context: vscode.ExtensionContext;
  workspaceRoot: string;
  log: { info(m: string): void; error(m: string): void };
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
  const proceed = 'Continue';
  const choice = await vscode.window.showInformationMessage(
    "This runs a local AI agent of your choice — you'll see it in a terminal. " +
      "It uses your agent's own billing. Agentic Bookmarks sends no code or telemetry to the cloud.",
    { modal: true },
    proceed,
  );
  if (choice !== proceed) return false;
  await recordRepairConsent(context);
  return true;
}

async function chooseAgent(agents: McpAgent[]): Promise<McpAgent | undefined> {
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({ label: AGENT_DISPLAY_NAMES[a], agent: a })),
    { placeHolder: 'Choose an agent' },
  );
  return pick?.agent;
}

async function offerConnect(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    (['claude', 'codex', 'cursor'] as McpAgent[]).map((a) => ({ label: `Connect ${AGENT_DISPLAY_NAMES[a]}`, agent: a })),
    { placeHolder: 'No agent connected — connect one first' },
  );
  if (pick) await vscode.commands.executeCommand(SETUP_COMMAND[pick.agent]);
}

export async function launchAgentWithPrompt(deps: AgentLaunchDeps, prompt: string): Promise<void> {
  const { context } = deps;
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
    if (agent) await setRepairAgentDefault(context, agent);
  }
  if (!agent) return;
  const launch = buildAgentLaunch(agent, prompt);
  if (launch.method === 'terminal') {
    const terminal = vscode.window.createTerminal({
      name: `Agentic Bookmarks (${AGENT_DISPLAY_NAMES[agent]})`,
      cwd: deps.workspaceRoot,
    });
    terminal.show();
    terminal.sendText(launch.command, true);
    deps.log.info(`[agentLaunch] launched ${agent} in terminal`);
  } else {
    await vscode.env.clipboard.writeText(launch.text);
    vscode.window.showInformationMessage(
      `Prompt copied to clipboard — paste it into ${AGENT_DISPLAY_NAMES[agent]}.`,
    );
  }
}
