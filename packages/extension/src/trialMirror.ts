import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { TrialRecord } from '@agentic-bookmarks/licensing';
import type { MirrorIO } from './trialStore';

export function createTrialMirror(workspaceRoot: string): MirrorIO {
  const file = path.join(workspaceRoot, '.bookmarks', 'local', 'license', 'trial.json');

  return {
    async read() {
      try {
        const buf = await fs.readFile(file, 'utf8');
        const parsed = JSON.parse(buf) as TrialRecord;
        if (
          parsed && typeof parsed === 'object' &&
          typeof parsed.trialStartedAt === 'string' &&
          typeof parsed.trialMachineId === 'string' &&
          parsed.version === 1
        ) return parsed;
        return undefined;
      } catch {
        return undefined;
      }
    },
    async write(record) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
      await fs.rename(tmp, file);
    },
    async clear() {
      try { await fs.unlink(file); } catch { /* idempotent */ }
    },
  };
}
