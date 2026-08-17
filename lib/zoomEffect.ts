export type ZoomEasing = "easeInOut" | "linear";

export type ZoomKeyframe = {
  id: string;
  pointX: number; // 0-100, focus point across the screen width
  pointY: number; // 0-100, focus point across the screen height
  scale: number; // target zoom scale, e.g. 1.8 = 180%
  start: number; // seconds, relative to the clip's own trimmed playback
  end: number; // seconds, relative to the clip's own trimmed playback
  easeIn: number; // seconds spent ramping from 1x to scale
  easeOut: number; // seconds spent ramping from scale back to 1x
  easing: ZoomEasing;
};

export const MIN_ZOOM_DURATION = 0.2;
export const DEFAULT_ZOOM_DURATION = 2;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `zoom-${Math.random().toString(36).slice(2)}`;
}

export function createZoomKeyframe(overrides: Partial<Omit<ZoomKeyframe, "id">> = {}): ZoomKeyframe {
  return {
    id: createId(),
    pointX: 50,
    pointY: 50,
    scale: 1.8,
    start: 0,
    end: DEFAULT_ZOOM_DURATION,
    easeIn: 0.4,
    easeOut: 0.4,
    easing: "easeInOut",
    ...overrides,
  };
}

function easeValue(easing: ZoomEasing, progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  if (easing === "linear") return p;
  return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
}

function getKeyframeScale(kf: ZoomKeyframe, relativeTime: number): number {
  const start = Math.max(kf.start, 0);
  const end = Math.max(kf.end, start + 0.01);
  if (relativeTime <= start || relativeTime >= end) return 1;

  const easeIn = Math.max(kf.easeIn, 0);
  const easeOut = Math.max(kf.easeOut, 0);
  const rampInEnd = Math.min(start + easeIn, end);
  const rampOutStart = Math.max(end - easeOut, rampInEnd);

  if (relativeTime < rampInEnd) {
    const progress = easeIn > 0 ? (relativeTime - start) / easeIn : 1;
    return 1 + (kf.scale - 1) * easeValue(kf.easing, progress);
  }
  if (relativeTime > rampOutStart) {
    const progress = easeOut > 0 ? (end - relativeTime) / easeOut : 1;
    return 1 + (kf.scale - 1) * easeValue(kf.easing, progress);
  }
  return kf.scale;
}

// Returns the zoom transform that should be applied at `relativeTime` seconds
// into the clip's own trimmed playback (0 = clip start). Keyframes are
// expected not to overlap; the first one covering the time wins.
export function getActiveZoom(keyframes: ZoomKeyframe[], relativeTime: number): { scale: number; pointX: number; pointY: number } {
  for (const kf of keyframes) {
    if (relativeTime > kf.start && relativeTime < kf.end) {
      return { scale: getKeyframeScale(kf, relativeTime), pointX: kf.pointX, pointY: kf.pointY };
    }
  }
  return { scale: 1, pointX: 50, pointY: 50 };
}

// --- Timeline editing helpers -------------------------------------------

export type ZoomDragBounds = { lower: number; upper: number };

// Computes how far a keyframe is allowed to move/resize before it would
// collide with its neighbors, based on their (fixed, non-dragged) positions.
export function computeZoomDragBounds(keyframes: ZoomKeyframe[], id: string, maxDuration: number): ZoomDragBounds {
  const current = keyframes.find((k) => k.id === id);
  if (!current) return { lower: 0, upper: maxDuration };
  let lower = 0;
  let upper = maxDuration;
  for (const k of keyframes) {
    if (k.id === id) continue;
    if (k.end <= current.start) lower = Math.max(lower, k.end);
    if (k.start >= current.end) upper = Math.min(upper, k.start);
  }
  return { lower, upper };
}

export function clampZoomMove(originStart: number, originEnd: number, desiredStart: number, bounds: ZoomDragBounds) {
  const duration = originEnd - originStart;
  const start = Math.min(Math.max(desiredStart, bounds.lower), Math.max(bounds.upper - duration, bounds.lower));
  return { start, end: start + duration };
}

export function clampZoomResizeStart(originEnd: number, desiredStart: number, bounds: ZoomDragBounds) {
  const start = Math.min(Math.max(desiredStart, bounds.lower), originEnd - MIN_ZOOM_DURATION);
  return { start, end: originEnd };
}

export function clampZoomResizeEnd(originStart: number, desiredEnd: number, bounds: ZoomDragBounds) {
  const end = Math.max(Math.min(desiredEnd, bounds.upper), originStart + MIN_ZOOM_DURATION);
  return { start: originStart, end };
}

// Finds a free gap on the timeline (of at least MIN_ZOOM_DURATION) closest to
// `near`, sized up to `desiredDuration`. Returns null if the timeline is full.
export function findFreeZoomSlot(
  keyframes: ZoomKeyframe[],
  maxDuration: number,
  desiredDuration: number,
  near: number,
): { start: number; end: number } | null {
  const sorted = [...keyframes].sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const k of sorted) {
    if (k.start > cursor) gaps.push({ start: cursor, end: k.start });
    cursor = Math.max(cursor, k.end);
  }
  if (cursor < maxDuration) gaps.push({ start: cursor, end: maxDuration });

  const viable = gaps.filter((g) => g.end - g.start >= MIN_ZOOM_DURATION);
  if (viable.length === 0) return null;

  viable.sort((a, b) => Math.abs(a.start - near) - Math.abs(b.start - near));
  const gap = viable[0];
  const duration = Math.min(desiredDuration, gap.end - gap.start);
  const start = Math.min(Math.max(near, gap.start), gap.end - duration);
  return { start, end: start + duration };
}
