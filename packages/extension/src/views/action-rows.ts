// ABOUTME: Pure descriptors for the Scan All / Repair All action rows. No VS Code
// ABOUTME: dependency — the tree provider maps these to TreeItems + ThemeIcons.

export type ScanPhase = 'idle' | 'scanning' | 'finalizing';

export interface ScanRowDescriptor {
  label: string;
  icon: string;        // ThemeIcon id
  spin: boolean;       // append ~spin when true
  contextValue: 'scanAllRow';
}

export interface RepairRowDescriptor {
  label: string;
  icon: string;            // ThemeIcon id
  themeColor: string;      // ThemeColor id
  actionable: boolean;     // false when nothing is broken (click is a no-op)
  contextValue: 'repairAllRow';
}

export function scanRowDescriptor(s: { scanned: number; total: number; phase: ScanPhase }): ScanRowDescriptor {
  switch (s.phase) {
    case 'scanning':
      return { label: `Scanning… ${s.scanned}/${s.total}`, icon: 'sync', spin: true, contextValue: 'scanAllRow' };
    case 'finalizing':
      return { label: `Finalizing… ${s.scanned}/${s.total}`, icon: 'sync', spin: true, contextValue: 'scanAllRow' };
    case 'idle':
    default:
      return { label: `Scan All — ${s.scanned}/${s.total} scanned`, icon: 'run-all', spin: false, contextValue: 'scanAllRow' };
  }
}

export function repairRowDescriptor(s: { broken: number; total: number }): RepairRowDescriptor {
  return s.broken === 0
    ? { label: 'Repair All — no errors', icon: 'pass-filled', themeColor: 'charts.green', actionable: false, contextValue: 'repairAllRow' }
    : { label: `Repair All — ${s.broken}/${s.total} broken`, icon: 'error', themeColor: 'charts.red', actionable: true, contextValue: 'repairAllRow' };
}
