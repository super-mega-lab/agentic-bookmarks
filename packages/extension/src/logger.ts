export type LogLevel = 'error' | 'info' | 'debug' | 'trace';

type Message = string | (() => string);

export interface Logger {
  error: (msg: Message) => void;
  info: (msg: Message) => void;
  debug: (msg: Message) => void;
  trace: (msg: Message) => void;
  setLevel: (level: LogLevel) => void;
}

const PRIORITY: Record<LogLevel, number> = {
  error: 0,
  info: 1,
  debug: 2,
  trace: 3,
};

export function createLogger(
  outputChannel: { appendLine(value: string): void },
  initialLevel: LogLevel = 'error'
): Logger {
  let threshold = PRIORITY[initialLevel];

  function emit(level: LogLevel, msg: Message): void {
    if (PRIORITY[level] > threshold) return;
    const text = typeof msg === 'function' ? msg() : msg;
    outputChannel.appendLine(text);
  }

  return {
    error: (msg) => emit('error', msg),
    info: (msg) => emit('info', msg),
    debug: (msg) => emit('debug', msg),
    trace: (msg) => emit('trace', msg),
    setLevel: (level) => { threshold = PRIORITY[level]; },
  };
}
