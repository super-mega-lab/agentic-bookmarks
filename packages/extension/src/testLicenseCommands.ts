import * as vscode from 'vscode';
import { PRO_FEATURES, FREE_FEATURES, type FeatureName, type TrialRecord } from '@agentic-bookmarks/licensing';
import type { LicensingService } from './licensingService';
import { proIntercept } from './proIntercept';
import { showProInterceptModal } from './proInterceptModal';

function syntheticTrial(daysAgo: number): TrialRecord {
  return {
    trialStartedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    trialMachineId: 'simulated',
    version: 1,
  };
}

export function registerTestLicenseCommands(
  context: vscode.ExtensionContext,
  licensing: LicensingService,
  outputChannel: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('agenticBookmarks.testLicense.testFeatureGate', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'test-pro', description: 'fixture (gated)' },
          { label: 'test-free', description: 'fixture (always allowed)' },
        ],
        { placeHolder: 'Pick a feature to gate-check' },
      );
      if (!choice) return;
      const access = licensing.check(choice.label as FeatureName);
      const summary = access.allowed
        ? `ALLOWED: ${choice.label}`
        : `DENIED: ${choice.label} (reason=${access.reason}, tier=${access.tier})`;
      const status = licensing.status();
      const vis = licensing.visibility();
      void vscode.window.showInformationMessage(
        `${summary} — tier=${status.tier}, visibility=${vis}`,
      );
    }),

    vscode.commands.registerCommand('agenticBookmarks.testLicense.testIntercept', async () => {
      const outcome = await proIntercept('test-pro', {
        licensing,
        showModal: showProInterceptModal,
        openCheckout: async () => {
          // SML-1347 owns the real checkout / upsell surface.
          void vscode.window.showInformationMessage(
            '[stub] Would open checkout. Real surface ships in SML-1347.',
          );
        },
      });
      void vscode.window.showInformationMessage(`Intercept outcome: ${outcome}`);
    }),

    vscode.commands.registerCommand('agenticBookmarks.testLicense.getState', async () => {
      const status = licensing.status();
      const vis = licensing.visibility();
      const record = licensing.getTrialRecord();
      let trialLine: string;
      if (status.tier === 'trial' && status.expiresAt) {
        trialLine = `Trial: active, expires ${status.expiresAt}`;
      } else if (record) {
        trialLine = `Trial: expired (started ${record.trialStartedAt})`;
      } else {
        trialLine = 'Trial: none';
      }
      const lines = [
        `Tier: ${status.tier}${status.valid ? '' : ' (invalid)'}`,
        `Repo visibility: ${vis}`,
        trialLine,
        '',
        `Pro features: ${PRO_FEATURES.length}`,
        `Free features: ${FREE_FEATURES.length}`,
      ];
      void vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
    }),

    vscode.commands.registerCommand('agenticBookmarks.testLicense.simulateTrialActive', async () => {
      await licensing.setTrialRecordForTesting(syntheticTrial(5));
      void vscode.window.showInformationMessage('Trial simulated: active (~9 days left).');
    }),

    vscode.commands.registerCommand('agenticBookmarks.testLicense.simulateTrialExpiringSoon', async () => {
      await licensing.setTrialRecordForTesting(syntheticTrial(12));
      void vscode.window.showInformationMessage('Trial simulated: ~2 days left.');
    }),

    vscode.commands.registerCommand('agenticBookmarks.testLicense.simulateTrialExpired', async () => {
      await licensing.setTrialRecordForTesting(syntheticTrial(15));
      void vscode.window.showInformationMessage('Trial simulated: expired.');
    }),

    vscode.commands.registerCommand('agenticBookmarks.testLicense.clearTrial', async () => {
      await licensing.resetTrial();
      void vscode.window.showInformationMessage('Trial cleared.');
    }),

    vscode.commands.registerCommand('agenticBookmarks.testLicense.refreshVisibility', async () => {
      await licensing.detect(true);
      licensing.pushContext();
      const v = licensing.visibility();
      void vscode.window.showInformationMessage(`Repo visibility refreshed: ${v}`);
    }),

    vscode.commands.registerCommand('agenticBookmarks.testLicense.diagnoseStatus', async () => {
      outputChannel.show(true);
      const ts = new Date().toISOString();
      outputChannel.appendLine('');
      outputChannel.appendLine('═══════════════════════════════════════════════════════════════');
      outputChannel.appendLine(`License diagnosis @ ${ts}`);
      outputChannel.appendLine('═══════════════════════════════════════════════════════════════');

      const override = licensing.getOverride();
      const folders = licensing.getWorkspaceFolderPaths();
      outputChannel.appendLine(`Workspace folders (${folders.length}):`);
      if (folders.length === 0) {
        outputChannel.appendLine('  (none)');
      } else {
        for (const f of folders) outputChannel.appendLine(`  - ${f}`);
      }
      outputChannel.appendLine('');

      if (override) {
        outputChannel.appendLine(`Test override: bookmarks.licensing.testVisibility = ${override}`);
        outputChannel.appendLine('Detection skipped (override fully short-circuits).');
      } else {
        outputChannel.appendLine('Test override: not set');
        outputChannel.appendLine('Running detection (force=true, bypassing TTL cache)...');
        const result = await licensing.detect(true);
        if (result) {
          outputChannel.appendLine(`Workspace visibility (raw):    ${result.visibility}`);
          const mapped = result.visibility === 'mixed' ? 'private' : result.visibility;
          outputChannel.appendLine(`Workspace visibility (mapped): ${mapped}`);
          outputChannel.appendLine('');
          outputChannel.appendLine(`Per-root breakdown (${result.perRoot.length}):`);
          for (const root of result.perRoot) {
            outputChannel.appendLine(`  ${root.workspaceRoot}`);
            outputChannel.appendLine(`    visibility:    ${root.visibility}`);
            outputChannel.appendLine(`    graceFallback: ${root.graceFallback}`);
            outputChannel.appendLine(`    remotes (${root.remotes.length}):`);
            for (const r of root.remotes) {
              const platform = r.normalized?.platform ?? 'n/a';
              const httpsUrl = r.normalized?.httpsUrl ?? 'n/a';
              const httpStatus = r.httpStatus ?? 'n/a';
              const stale = r.stale ? ' (stale)' : '';
              const reason = r.reason ? `, reason=${r.reason}` : '';
              outputChannel.appendLine(
                `      ${r.remote.name} → ${r.visibility} [source=${r.source}, platform=${platform}, http=${httpStatus}${stale}${reason}]`,
              );
              outputChannel.appendLine(`        url: ${r.remote.url}`);
              if (httpsUrl !== 'n/a') {
                outputChannel.appendLine(`        probe: ${httpsUrl}`);
              }
            }
          }
        }
      }

      licensing.pushContext();

      const status = licensing.status();
      const vis = licensing.visibility();
      outputChannel.appendLine('');
      outputChannel.appendLine('Resolved licensing state:');
      outputChannel.appendLine(`  tier:       ${status.tier}${status.valid ? '' : ' (invalid)'}`);
      outputChannel.appendLine(`  visibility: ${vis}`);
      outputChannel.appendLine('');

      const proCheck = licensing.check('test-pro');
      const freeCheck = licensing.check('test-free');
      outputChannel.appendLine('Gate checks:');
      outputChannel.appendLine(
        `  checkFeature('test-pro')  → ${proCheck.allowed ? 'ALLOWED' : `DENIED (reason=${proCheck.reason}, tier=${proCheck.tier})`}`,
      );
      outputChannel.appendLine(
        `  checkFeature('test-free') → ${freeCheck.allowed ? 'ALLOWED' : `DENIED (reason=${freeCheck.reason}, tier=${freeCheck.tier})`}`,
      );
      outputChannel.appendLine('═══════════════════════════════════════════════════════════════');
    }),
  );
}
