#!/usr/bin/env node

/**
 * Smoke test runner — runs each smoke test sequentially, captures output,
 * and prints a summary table at the end.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tests = [
  { name: 'multi-workspace', script: 'test-multi-workspace.mjs' },
  { name: 'group-lazy-init', script: 'test-group-lazy-init.mjs' },
  { name: 'multi-workspace-same-name', script: 'test-multi-workspace-same-name.mjs' },
  { name: 'anchor-path-normalization', script: 'test-anchor-path-normalization.mjs' },
  { name: 'line-basis-1based', script: 'test-line-basis-1based.mjs' },
  { name: 'bookmark-tools-1based', script: 'test-bookmark-tools-1based.mjs' },
];

function runScript(scriptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const output = [];
    child.stdout.on('data', (d) => output.push(d.toString()));
    child.stderr.on('data', (d) => output.push(d.toString()));

    const start = Date.now();

    child.on('error', (err) => {
      output.push(`spawn error: ${err.message}\n`);
      resolve({ passed: false, duration: Date.now() - start, output: output.join('') });
    });

    child.on('close', (code) => {
      resolve({ passed: code === 0, duration: Date.now() - start, output: output.join('') });
    });
  });
}

async function main() {
  const results = [];
  const maxNameLen = Math.max(...tests.map((t) => t.name.length));

  console.log('');

  const isTTY = process.stdout.isTTY;

  for (const test of tests) {
    if (isTTY) {
      process.stdout.write(`  ◦ ${test.name} ...`);
    }

    const scriptPath = path.join(__dirname, test.script);
    const result = await runScript(scriptPath);
    results.push({ ...test, ...result });

    const secs = (result.duration / 1000).toFixed(1);
    const icon = result.passed ? '✓' : '✗';

    if (isTTY) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    }
    console.log(`  ${icon} ${test.name.padEnd(maxNameLen)}  ${secs}s`);
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const totalTime = (results.reduce((s, r) => s + r.duration, 0) / 1000).toFixed(1);

  console.log('  ' + '─'.repeat(maxNameLen + 12));
  console.log(`  ${passed}/${total} passed  (${totalTime}s)`);

  // Show output for failures
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log('');
    for (const f of failures) {
      console.log(`  ─── FAILED: ${f.name} ${'─'.repeat(Math.max(0, 40 - f.name.length))}`);
      const lines = f.output.trimEnd().split('\n');
      const tail = lines.slice(-20);
      for (const line of tail) {
        console.log(`  │ ${line}`);
      }
      console.log('');
    }
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('Runner error:', err);
  process.exit(1);
});
