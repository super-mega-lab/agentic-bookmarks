import { describe, it, expect, vi } from 'vitest';
import { createLogger, type LogLevel } from './logger';

function makeOutput() {
  return { appendLine: vi.fn() };
}

describe('createLogger', () => {
  it('logs error at every level', () => {
    for (const level of ['error', 'info', 'debug', 'trace'] as LogLevel[]) {
      const out = makeOutput();
      const log = createLogger(out as any, level);
      log.error('boom');
      expect(out.appendLine).toHaveBeenCalledOnce();
    }
  });

  it('suppresses debug when level is info', () => {
    const out = makeOutput();
    const log = createLogger(out as any, 'info');
    log.debug('ignored');
    expect(out.appendLine).not.toHaveBeenCalled();
  });

  it('suppresses trace when level is debug', () => {
    const out = makeOutput();
    const log = createLogger(out as any, 'debug');
    log.trace('ignored');
    expect(out.appendLine).not.toHaveBeenCalled();
  });

  it('allows debug when level is debug', () => {
    const out = makeOutput();
    const log = createLogger(out as any, 'debug');
    log.debug('shown');
    expect(out.appendLine).toHaveBeenCalledOnce();
  });

  it('accepts lazy message functions and does not call them when suppressed', () => {
    const out = makeOutput();
    const log = createLogger(out as any, 'info');
    const expensive = vi.fn(() => 'expensive');
    log.trace(expensive);
    expect(expensive).not.toHaveBeenCalled();
    expect(out.appendLine).not.toHaveBeenCalled();
  });

  it('calls lazy message function when level allows', () => {
    const out = makeOutput();
    const log = createLogger(out as any, 'trace');
    const expensive = vi.fn(() => 'result');
    log.trace(expensive);
    expect(expensive).toHaveBeenCalledOnce();
    expect(out.appendLine).toHaveBeenCalledWith('result');
  });

  it('setLevel changes threshold at runtime', () => {
    const out = makeOutput();
    const log = createLogger(out as any, 'info');
    log.debug('ignored');
    expect(out.appendLine).not.toHaveBeenCalled();
    log.setLevel('debug');
    log.debug('shown');
    expect(out.appendLine).toHaveBeenCalledOnce();
  });
});
