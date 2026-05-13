export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export interface FixedClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

export function fixedClock(initialMs: number): FixedClock {
  let t = initialMs;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
    set: (ms: number) => { t = ms; },
  };
}
