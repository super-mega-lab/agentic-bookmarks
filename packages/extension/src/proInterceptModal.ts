import * as vscode from 'vscode';
import type { ModalChoice } from './proIntercept';

/**
 * Default proIntercept modal: showInformationMessage with two custom buttons.
 * The OS-provided X / Esc gives the third (dismiss) outcome — no Cancel
 * button needed. macOS shows the first-passed button rightmost (primary);
 * Windows shows it leftmost. Either way, "Get Pro Now" is the primary CTA.
 */
export async function showProInterceptModal(): Promise<ModalChoice> {
  const BUY = 'Get Pro Now';
  const TRIAL = 'Start Free Trial';
  const pick = await vscode.window.showInformationMessage(
    'Smart anchors require Pro for private repos. Start a 14-day free trial — no payment method needed.',
    { modal: true },
    BUY,
    TRIAL,
  );
  if (pick === BUY) return 'buy';
  if (pick === TRIAL) return 'trial';
  return 'dismiss';
}
