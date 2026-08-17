export type ZoomEasing = "easeInOut" | "linear";

export type ZoomEffect = {
  enabled: boolean;
  pointX: number; // 0-100, focus point across the screen width
  pointY: number; // 0-100, focus point across the screen height
  scale: number; // target zoom scale, e.g. 1.8 = 180%
  start: number; // seconds, relative to the clip's own trimmed playback
  end: number; // seconds, relative to the clip's own trimmed playback
  easeIn: number; // seconds spent ramping from 1x to scale
  easeOut: number; // seconds spent ramping from scale back to 1x
  easing: ZoomEasing;
};

export const defaultZoomEffect: ZoomEffect = {
  enabled: false,
  pointX: 50,
  pointY: 50,
  scale: 1.8,
  start: 0,
  end: 2,
  easeIn: 0.5,
  easeOut: 0.5,
  easing: "easeInOut",
};

function easeValue(easing: ZoomEasing, progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  if (easing === "linear") return p;
  return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
}

// Returns the zoom scale that should be applied at `relativeTime` seconds
// into the clip's own trimmed playback (0 = clip start).
export function getZoomScale(zoom: ZoomEffect, relativeTime: number): number {
  if (!zoom.enabled) return 1;

  const start = Math.max(zoom.start, 0);
  const end = Math.max(zoom.end, start + 0.01);
  if (relativeTime <= start || relativeTime >= end) return 1;

  const easeIn = Math.max(zoom.easeIn, 0);
  const easeOut = Math.max(zoom.easeOut, 0);
  const rampInEnd = Math.min(start + easeIn, end);
  const rampOutStart = Math.max(end - easeOut, rampInEnd);

  if (relativeTime < rampInEnd) {
    const progress = easeIn > 0 ? (relativeTime - start) / easeIn : 1;
    return 1 + (zoom.scale - 1) * easeValue(zoom.easing, progress);
  }
  if (relativeTime > rampOutStart) {
    const progress = easeOut > 0 ? (end - relativeTime) / easeOut : 1;
    return 1 + (zoom.scale - 1) * easeValue(zoom.easing, progress);
  }
  return zoom.scale;
}

export function scaleRectAroundPoint(
  rect: { x: number; y: number; width: number; height: number },
  pivotX: number,
  pivotY: number,
  scale: number,
) {
  if (scale === 1) return rect;
  return {
    x: pivotX + (rect.x - pivotX) * scale,
    y: pivotY + (rect.y - pivotY) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}
