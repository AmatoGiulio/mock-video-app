export type RulerTick = {
  time: number;
  label: string;
};

const STEP_CANDIDATES = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function formatClock(seconds: number, withHundredths = false): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const base = `${minutes}:${String(wholeSeconds).padStart(2, "0")}`;
  if (!withHundredths) return base;
  const hundredths = Math.floor((safe % 1) * 100);
  return `${base}.${String(hundredths).padStart(2, "0")}`;
}

// Picks a "nice" tick interval so the ruler shows roughly `target` labels,
// then returns the ticks that fit inside the timeline duration.
export function getRulerTicks(duration: number, target = 8): RulerTick[] {
  if (!Number.isFinite(duration) || duration <= 0) return [{ time: 0, label: "0:00" }];
  const raw = duration / Math.max(target, 1);
  const step = STEP_CANDIDATES.find((candidate) => candidate >= raw) ?? STEP_CANDIDATES[STEP_CANDIDATES.length - 1];
  const withHundredths = step < 1;
  const ticks: RulerTick[] = [];
  const count = Math.floor(duration / step + 1e-6);
  for (let i = 0; i <= count; i++) {
    const time = i * step;
    ticks.push({ time, label: formatClock(time, withHundredths) });
  }
  return ticks;
}
