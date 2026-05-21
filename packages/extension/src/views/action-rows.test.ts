// ABOUTME: Tests for pure label/icon descriptors of the Scan All / Repair All rows.
import { describe, it, expect } from 'vitest';
import { scanRowDescriptor, repairRowDescriptor } from './action-rows';

describe('scanRowDescriptor', () => {
  it('shows coverage at rest', () => {
    const d = scanRowDescriptor({ scanned: 3, total: 43, phase: 'idle' });
    expect(d.label).toBe('Scan All — 3/43 scanned');
    expect(d.icon).toBe('search-sparkle');
    expect(d.spin).toBe(false);
  });
  it('shows progress + spinner while scanning', () => {
    const d = scanRowDescriptor({ scanned: 18, total: 43, phase: 'scanning' });
    expect(d.label).toBe('Scanning… 18/43');
    expect(d.icon).toBe('sync');
    expect(d.spin).toBe(true);
  });
  it('shows finalizing while auto-repair drains', () => {
    const d = scanRowDescriptor({ scanned: 43, total: 43, phase: 'finalizing' });
    expect(d.label).toBe('Finalizing… 43/43');
    expect(d.icon).toBe('sync');
    expect(d.spin).toBe(true);
  });
  it('handles zero bookmarked files', () => {
    const d = scanRowDescriptor({ scanned: 0, total: 0, phase: 'idle' });
    expect(d.label).toBe('Scan All — 0/0 scanned');
  });
});

describe('repairRowDescriptor', () => {
  it('reports no errors when nothing is broken (green check)', () => {
    const d = repairRowDescriptor({ broken: 0, total: 12 });
    expect(d.label).toBe('Repair All — no errors');
    expect(d.icon).toBe('pass-filled');
    expect(d.themeColor).toBe('charts.green');
  });
  it('reports broken count with red styling', () => {
    const d = repairRowDescriptor({ broken: 4, total: 43 });
    expect(d.label).toBe('Repair All — 4/43 broken');
    expect(d.icon).toBe('error');
    expect(d.themeColor).toBe('charts.red');
  });
});
