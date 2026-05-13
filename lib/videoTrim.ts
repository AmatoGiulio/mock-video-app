export type VideoDimensions = { width: number; height: number };

export const MIN_REMAINING_SECONDS = 1 / 60;

export function getMaxStartOffset(duration: number): number {
  if (!Number.isFinite(duration) || duration <= MIN_REMAINING_SECONDS) return 0;
  return Math.max(duration - MIN_REMAINING_SECONDS, 0);
}

export function clampStartOffset(value: number, duration: number): number {
  return Math.min(Math.max(value, 0), getMaxStartOffset(duration));
}

export function clampEndOffset(value: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(value, MIN_REMAINING_SECONDS), duration);
}

export function getEffectiveTrimWindow(startOffset: number, endOffset: number, duration: number) {
  const start = clampStartOffset(startOffset, duration);
  const end = clampEndOffset(endOffset || duration, duration);
  if (end > start) return { start, end };
  return {
    start: Math.max(Math.min(start, duration - MIN_REMAINING_SECONDS), 0),
    end: Math.min(Math.max(start + MIN_REMAINING_SECONDS, MIN_REMAINING_SECONDS), duration),
  };
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00.00";
  const totalHundredths = Math.round(seconds * 100);
  const minutes = Math.floor(totalHundredths / 6000);
  const wholeSeconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function formatFrameTimestamp(seconds: number, frameRate: number): string {
  const frame = Math.max(Math.round(seconds * frameRate), 0);
  return `${formatTimestamp(seconds)} f${frame}`;
}

export function snapToFrame(seconds: number, frameRate: number): number {
  if (!Number.isFinite(seconds) || frameRate <= 0) return 0;
  return Math.max(Math.round(seconds * frameRate) / frameRate, 0);
}
