import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

async function main() {
  const bundle = path.resolve(process.cwd(), 'packages/extension/server-bundle/index.js');
  try {
    await fs.access(bundle);
  } catch {
    console.error(`Smoke failed: bundle not found at ${bundle}. Run "pnpm build" first.`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [bundle], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let started = false;
  let stderrBuf = '';

  child.stderr.on('data', (d) => {
    const s = d.toString();
    stderrBuf += s;
    if (s.includes('Bookmarks MCP Server started')) {
      started = true;
    }
  });

  child.on('error', (err) => {
    console.error('Smoke failed: spawn error:', err);
    cleanup(1);
  });

  const timeoutMs = 3000;
  const timeout = setTimeout(() => {
    if (started) {
      console.log('Smoke passed: server started.');
      cleanup(0);
    } else {
      console.error('Smoke failed: no start signal within timeout.');
      if (stderrBuf) {
        console.error('Stderr:\n' + stderrBuf);
      }
      cleanup(1);
    }
  }, timeoutMs);

  child.on('exit', (code) => {
    if (!started) {
      console.error(`Smoke failed: server exited early with code ${code}.`);
      if (stderrBuf) {
        console.error('Stderr:\n' + stderrBuf);
      }
      clearTimeout(timeout);
      process.exit(code ?? 1);
    }
  });

  function cleanup(code) {
    clearTimeout(timeout);
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => process.exit(code), 200);
  }
}

main().catch((e) => {
  console.error('Smoke failed:', e);
  process.exit(1);
});

