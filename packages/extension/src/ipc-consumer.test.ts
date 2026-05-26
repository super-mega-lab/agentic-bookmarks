import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ipc } from '@agentic-bookmarks/core';
import { QueueConsumer } from './ipc-consumer';

const noopLog = {
  error: () => {}, info: () => {}, debug: () => {}, trace: () => {},
  setLevel: () => {},
};

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ext-ipc-consumer-'));
}

describe('QueueConsumer', () => {
  it('dispatches messages by type and advances offset between drains', async () => {
    const dir = await tmpDir();
    const q = path.join(dir, 'q.jsonl');
    const p = path.join(dir, 'q.pulse');

    const seen: string[] = [];
    const consumer = new QueueConsumer(q, {
      log: noopLog,
      handlers: {
        'bookmark-repaired': (payload) => seen.push(payload.bookmarkId),
      },
    });

    await ipc.appendQueueMessage(q, p, 'bookmark-repaired', { bookmarkId: 'A' });
    await ipc.appendQueueMessage(q, p, 'bookmark-repaired', { bookmarkId: 'B' });
    await consumer.drain();
    expect(seen).toEqual(['A', 'B']);

    await ipc.appendQueueMessage(q, p, 'bookmark-repaired', { bookmarkId: 'C' });
    await consumer.drain();
    expect(seen).toEqual(['A', 'B', 'C']);
  });

  it('drops messages with unknown types silently', async () => {
    const dir = await tmpDir();
    const q = path.join(dir, 'q.jsonl');
    const p = path.join(dir, 'q.pulse');

    const seen: string[] = [];
    const consumer = new QueueConsumer(q, {
      log: noopLog,
      handlers: { 'known': (p) => seen.push(p.x) },
    });

    await ipc.appendQueueMessage(q, p, 'unknown', { x: 'A' });
    await ipc.appendQueueMessage(q, p, 'known', { x: 'B' });
    await consumer.drain();
    expect(seen).toEqual(['B']);
  });

  it('isolates a throwing handler from other messages in the batch', async () => {
    const dir = await tmpDir();
    const q = path.join(dir, 'q.jsonl');
    const p = path.join(dir, 'q.pulse');

    const seen: string[] = [];
    const consumer = new QueueConsumer(q, {
      log: noopLog,
      handlers: {
        'a': (payload) => {
          if (payload.bad) throw new Error('boom');
          seen.push(payload.x);
        },
      },
    });

    await ipc.appendQueueMessage(q, p, 'a', { x: '1' });
    await ipc.appendQueueMessage(q, p, 'a', { bad: true });
    await ipc.appendQueueMessage(q, p, 'a', { x: '2' });
    await consumer.drain();
    expect(seen).toEqual(['1', '2']);
  });

  it('integrates with a broken-ID set: removes by bookmarkId on bookmark-repaired', async () => {
    const dir = await tmpDir();
    const q = path.join(dir, 'q.jsonl');
    const p = path.join(dir, 'q.pulse');

    let brokenIds = new Set(['A', 'B', 'C']);
    let refreshCount = 0;

    const consumer = new QueueConsumer(q, {
      log: noopLog,
      handlers: {
        'bookmark-repaired': (payload: any) => {
          if (typeof payload?.bookmarkId !== 'string') return;
          if (brokenIds.delete(payload.bookmarkId)) refreshCount++;
        },
      },
    });

    await ipc.appendQueueMessage(q, p, 'bookmark-repaired', { bookmarkId: 'A' });
    await ipc.appendQueueMessage(q, p, 'bookmark-repaired', { bookmarkId: 'Z' }); // not in set
    await ipc.appendQueueMessage(q, p, 'bookmark-repaired', { bookmarkId: 'C' });
    await consumer.drain();

    expect([...brokenIds].sort()).toEqual(['B']);
    expect(refreshCount).toBe(2);
  });
});
