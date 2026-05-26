import { ipc } from '@agentic-bookmarks/core';
import type { Logger } from './logger';

export type MessageHandler = (payload: any, message: ipc.QueueMessage) => void;

export interface ConsumerDeps {
  log: Logger;
  handlers: Record<string, MessageHandler>;
}

export class QueueConsumer {
  private offset = 0;

  constructor(
    private readonly queuePath: string,
    private readonly deps: ConsumerDeps,
  ) {}

  /** Drain whatever's available since the last drain. Safe to call repeatedly. */
  async drain(): Promise<void> {
    const { messages, newOffset, parseErrors } = await ipc.consumeQueue(this.queuePath, this.offset);
    this.offset = newOffset;
    for (const err of parseErrors) {
      this.deps.log.error(`[ipc] drop unparseable line: ${err.line.slice(0, 200)}`);
    }
    for (const msg of messages) {
      const h = this.deps.handlers[msg.type];
      if (!h) {
        this.deps.log.debug(() => `[ipc] no handler for type ${msg.type}; dropping`);
        continue;
      }
      try {
        h(msg.payload, msg);
      } catch (e) {
        this.deps.log.error(`[ipc] handler for ${msg.type} threw: ${(e as Error).message}`);
      }
    }
  }

  /** Reset internal offset (e.g. after truncating the queue on activation). */
  resetOffset(): void {
    this.offset = 0;
  }
}
