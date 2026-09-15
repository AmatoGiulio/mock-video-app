import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { formatClock, getRulerTicks } from "@/lib/timeline";
import { MIN_REMAINING_SECONDS, snapToFrame } from "@/lib/videoTrim";
import {
  clampZoomMove,
  clampZoomResizeEnd,
  clampZoomResizeStart,
  computeZoomDragBounds,
  type ZoomKeyframe,
} from "@/lib/zoomEffect";

export type TimelineClip = {
  idx: number;
  label: string;
  sourceDuration: number;
  startOffset: number;
  endOffset: number;
  effectiveDuration: number;
};

type TimelineProps = {
  duration: number;
  frameRate: number;
  playhead: number;
  playing: boolean;
  clips: TimelineClip[];
  zoomKeyframes: ZoomKeyframe[];
  selectedZoomId: string | null;
  selectedClipIdx: number | null;
  canAddZoom: boolean;
  onScrub: (time: number) => void;
  onTogglePlay: () => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
  onTrim: (idx: number, startOffset: number, endOffset: number) => void;
  onResetTrim: (idx: number) => void;
  onSelectClip: (idx: number) => void;
  onAddZoom: () => void;
  onSelectZoom: (id: string | null) => void;
  onDeleteZoom: (id: string) => void;
  onUpdateZoom: (id: string, patch: Partial<ZoomKeyframe>) => void;
  getLiveTime?: () => number;
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1";

export function Timeline({
  duration: rawDuration,
  frameRate,
  playhead,
  playing,
  clips,
  zoomKeyframes,
  selectedZoomId,
  selectedClipIdx,
  canAddZoom,
  onScrub,
  onTogglePlay,
  onJumpStart,
  onJumpEnd,
  onTrim,
  onResetTrim,
  onSelectClip,
  onAddZoom,
  onSelectZoom,
  onDeleteZoom,
  onUpdateZoom,
  getLiveTime,
}: TimelineProps) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const duration = Math.max(Number.isFinite(rawDuration) ? rawDuration : 0, 1 / 60);
  const ticks = useMemo(() => getRulerTicks(duration), [duration]);
  const playheadPct = Math.min(Math.max(playhead / duration, 0), 1) * 100;
  const frameStep = 1 / Math.max(frameRate, 1);

  useEffect(() => {
    if (!playing || !getLiveTime) return;
    let raf = 0;
    const tick = () => {
      const time = getLiveTime();
      const pct = Math.min(Math.max(time / duration, 0), 1) * 100;
      containerRef.current?.querySelectorAll<HTMLElement>("[data-playhead]").forEach((el) => {
        el.style.left = `${pct}%`;
      });
      const label = containerRef.current?.querySelector<HTMLElement>("[data-playhead-time]");
      if (label) label.textContent = formatClock(time, true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, getLiveTime, playing]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const rect = laneRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const time = ((clientX - rect.left) / rect.width) * duration;
      onScrub(Math.min(Math.max(time, 0), duration));
    },
    [duration, onScrub],
  );

  const beginScrub = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      seekFromClientX(event.clientX);
      const onMove = (moveEvent: PointerEvent) => seekFromClientX(moveEvent.clientX);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [seekFromClientX],
  );

  const beginTrim = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, clip: TimelineClip, mode: "start" | "end") => {
      event.stopPropagation();
      event.preventDefault();
      const rect = laneRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const originStart = clip.startOffset;
      const originEnd = clip.endOffset;
      const originClientX = event.clientX;

      const onMove = (moveEvent: PointerEvent) => {
        const delta = ((moveEvent.clientX - originClientX) / rect.width) * duration;
        if (mode === "end") {
          const end = Math.min(
            Math.max(snapToFrame(originEnd + delta, frameRate), originStart + MIN_REMAINING_SECONDS),
            clip.sourceDuration,
          );
          onTrim(clip.idx, originStart, end);
        } else {
          const start = Math.min(
            Math.max(snapToFrame(originStart + delta, frameRate), 0),
            originEnd - MIN_REMAINING_SECONDS,
          );
          onTrim(clip.idx, start, originEnd);
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [duration, frameRate, onTrim],
  );

  const beginZoomDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, keyframe: ZoomKeyframe, mode: "move" | "resize-start" | "resize-end") => {
      event.stopPropagation();
      event.preventDefault();
      const rect = laneRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      onSelectZoom(keyframe.id);
      const originStart = keyframe.start;
      const originEnd = keyframe.end;
      const originClientX = event.clientX;
      const bounds = computeZoomDragBounds(zoomKeyframes, keyframe.id, duration);

      const onMove = (moveEvent: PointerEvent) => {
        const delta = ((moveEvent.clientX - originClientX) / rect.width) * duration;
        const next =
          mode === "move"
            ? clampZoomMove(originStart, originEnd, originStart + delta, bounds)
            : mode === "resize-start"
              ? clampZoomResizeStart(originEnd, originStart + delta, bounds)
              : clampZoomResizeEnd(originStart, originEnd + delta, bounds);
        onUpdateZoom(keyframe.id, next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [duration, onSelectZoom, onUpdateZoom, zoomKeyframes],
  );

  const handleRulerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 1 : frameStep;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onScrub(Math.max(playhead - step, 0));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onScrub(Math.min(playhead + step, duration));
      } else if (event.key === "Home") {
        event.preventDefault();
        onScrub(0);
      } else if (event.key === "End") {
        event.preventDefault();
        onScrub(duration);
      }
    },
    [duration, frameStep, onScrub, playhead],
  );

  const handleTrimKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, clip: TimelineClip, mode: "start" | "end") => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : frameStep);
      if (mode === "end") {
        const end = Math.min(Math.max(clip.endOffset + delta, clip.startOffset + MIN_REMAINING_SECONDS), clip.sourceDuration);
        onTrim(clip.idx, clip.startOffset, end);
      } else {
        const start = Math.min(Math.max(clip.startOffset + delta, 0), clip.endOffset - MIN_REMAINING_SECONDS);
        onTrim(clip.idx, start, clip.endOffset);
      }
    },
    [frameStep, onTrim],
  );

  const handleZoomKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, keyframe: ZoomKeyframe) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        onDeleteZoom(keyframe.id);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        onSelectZoom(keyframe.id);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : frameStep);
      const bounds = computeZoomDragBounds(zoomKeyframes, keyframe.id, duration);
      const next = event.altKey
        ? clampZoomResizeStart(keyframe.end, keyframe.start + delta, bounds)
        : event.ctrlKey || event.metaKey
          ? clampZoomResizeEnd(keyframe.start, keyframe.end + delta, bounds)
          : clampZoomMove(keyframe.start, keyframe.end, keyframe.start + delta, bounds);
      onSelectZoom(keyframe.id);
      onUpdateZoom(keyframe.id, next);
    },
    [duration, frameStep, onDeleteZoom, onSelectZoom, onUpdateZoom, zoomKeyframes],
  );

  return (
    <footer ref={containerRef} data-timeline-root className="shrink-0 border-t border-black/10 bg-white/70 backdrop-blur-xl" aria-label="Timeline">
      <div className="flex h-11 items-center gap-1.5 border-b border-black/5 px-3">
        <TransportButton label="Go to start" onClick={onJumpStart}>
          <SkipStartIcon />
        </TransportButton>
        <button
          type="button"
          className={cn(
            "flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black text-white shadow-sm transition-transform hover:scale-105 active:scale-95",
            FOCUS_RING,
          )}
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : "Play"}
          title={`${playing ? "Pause" : "Play"} (Space)`}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <TransportButton label="Go to end" onClick={onJumpEnd}>
          <SkipEndIcon />
        </TransportButton>
        <span data-playhead-time className="ml-2 font-mono text-xs tabular-nums text-black/70">
          {formatClock(playhead, true)}
        </span>
        <span className="font-mono text-xs tabular-nums text-black/30">/ {formatClock(duration, true)}</span>

        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] text-black/40">{frameRate}fps</span>
          <button
            type="button"
            className={cn(
              "flex h-7 cursor-pointer items-center gap-1 rounded-md bg-white/80 px-2 text-xs font-semibold text-black/70 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-white disabled:cursor-default disabled:opacity-40",
              FOCUS_RING,
            )}
            onClick={onAddZoom}
            disabled={!canAddZoom}
            title="Add a zoom effect at the playhead"
          >
            <PlusIcon />
            <span>Zoom</span>
          </button>
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto overflow-x-hidden">
        <div className="grid grid-cols-[8rem_1fr]">
          <div className="flex items-center border-b border-black/5 px-3 text-[10px] font-semibold uppercase tracking-wide text-black/35">
            Timeline
          </div>
          <div
            ref={laneRef}
            role="slider"
            tabIndex={0}
            aria-label="Playhead position"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration * 100) / 100}
            aria-valuenow={Math.round(Math.min(playhead, duration) * 100) / 100}
            aria-valuetext={formatClock(Math.min(playhead, duration), true)}
            className={cn("relative h-7 cursor-pointer select-none rounded-sm border-b border-black/5", FOCUS_RING)}
            onPointerDown={beginScrub}
            onKeyDown={handleRulerKeyDown}
          >
            {ticks.map((tick) => (
              <div key={tick.time} className="absolute bottom-0 top-0" style={{ left: `${(tick.time / duration) * 100}%` }}>
                <div className="absolute bottom-0 h-2 w-px bg-black/15" />
                <span className="absolute top-0.5 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-black/40">
                  {tick.label}
                </span>
              </div>
            ))}
            <Playhead pct={playheadPct} head />
          </div>

          {clips.map((clip) => {
            const widthPct = Math.max((clip.effectiveDuration / duration) * 100, 0);
            const selected = clip.idx === selectedClipIdx;
            return (
              <Fragment key={clip.idx}>
                <div className="flex items-center gap-2 border-b border-black/5 px-3">
                  <span className="flex-1 truncate text-[11px] font-medium text-black/70" title={clip.label}>
                    {clip.label}
                  </span>
                  <button
                    type="button"
                    className={cn(
                      "shrink-0 cursor-pointer rounded text-black/35 transition-colors hover:text-black/70 disabled:cursor-default disabled:opacity-30",
                      FOCUS_RING,
                    )}
                    onClick={() => onResetTrim(clip.idx)}
                    disabled={clip.startOffset <= 0 && clip.endOffset >= clip.sourceDuration}
                    aria-label={`Reset trim for ${clip.label}`}
                    title="Reset trim"
                  >
                    <ResetIcon />
                  </button>
                </div>
                <div className="relative h-12 cursor-pointer border-b border-black/5" onPointerDown={beginScrub}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`Select ${clip.label}`}
                    className={cn(
                      "absolute inset-y-1.5 left-0 rounded-md bg-amber-400/85 shadow-sm ring-1 ring-amber-500/40",
                      selected && "ring-2 ring-amber-600",
                      FOCUS_RING,
                    )}
                    style={{ width: `${widthPct}%` }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onSelectClip(clip.idx);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectClip(clip.idx);
                      }
                    }}
                  >
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 truncate font-mono text-[10px] font-semibold text-amber-950/80">
                      {formatClock(clip.effectiveDuration, true)}
                    </span>
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label={`Trim start of ${clip.label}`}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(clip.sourceDuration * 100) / 100}
                      aria-valuenow={Math.round(clip.startOffset * 100) / 100}
                      aria-valuetext={formatClock(clip.startOffset, true)}
                      className={cn("absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize rounded-sm", FOCUS_RING)}
                      onPointerDown={(event) => {
                        onSelectClip(clip.idx);
                        beginTrim(event, clip, "start");
                      }}
                      onKeyDown={(event) => handleTrimKeyDown(event, clip, "start")}
                      title="Trim start"
                    >
                      <div className="absolute left-1/2 top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85 shadow-sm" />
                    </div>
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label={`Trim end of ${clip.label}`}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(clip.sourceDuration * 100) / 100}
                      aria-valuenow={Math.round(clip.endOffset * 100) / 100}
                      aria-valuetext={formatClock(clip.endOffset, true)}
                      className={cn("absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize rounded-sm", FOCUS_RING)}
                      onPointerDown={(event) => {
                        onSelectClip(clip.idx);
                        beginTrim(event, clip, "end");
                      }}
                      onKeyDown={(event) => handleTrimKeyDown(event, clip, "end")}
                      title="Trim end"
                    >
                      <div className="absolute left-1/2 top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85 shadow-sm" />
                    </div>
                  </div>
                  <Playhead pct={playheadPct} />
                </div>
              </Fragment>
            );
          })}

          <div className="flex items-center gap-2 px-3">
            <span className="flex-1 truncate text-[11px] font-medium text-black/70">Zoom</span>
            {zoomKeyframes.length > 0 && <span className="font-mono text-[10px] text-black/35">{zoomKeyframes.length}</span>}
          </div>
          <div className="relative h-12 cursor-pointer" onPointerDown={beginScrub}>
            {zoomKeyframes.map((keyframe) => {
              const selected = keyframe.id === selectedZoomId;
              return (
                <div
                  key={keyframe.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`Zoom ${keyframe.scale.toFixed(2)} times, from ${formatClock(keyframe.start, true)} to ${formatClock(keyframe.end, true)}`}
                  className={cn(
                    "absolute inset-y-1.5 flex cursor-grab items-center gap-1 rounded-md bg-blue-500/85 px-2 shadow-sm active:cursor-grabbing",
                    selected && "ring-2 ring-blue-600",
                    FOCUS_RING,
                  )}
                  style={{
                    left: `${(keyframe.start / duration) * 100}%`,
                    width: `${Math.max(((keyframe.end - keyframe.start) / duration) * 100, 1)}%`,
                  }}
                  onPointerDown={(event) => beginZoomDrag(event, keyframe, "move")}
                  onKeyDown={(event) => handleZoomKeyDown(event, keyframe)}
                >
                  <div
                    className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize"
                    onPointerDown={(event) => beginZoomDrag(event, keyframe, "resize-start")}
                    title="Resize zoom start"
                  />
                  <span className="pointer-events-none truncate font-mono text-[10px] font-semibold text-white">
                    {keyframe.scale.toFixed(2)}x
                  </span>
                  {selected && (
                    <button
                      type="button"
                      className={cn(
                        "pointer-events-auto ml-auto shrink-0 cursor-pointer rounded p-0.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white",
                        FOCUS_RING,
                      )}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteZoom(keyframe.id);
                      }}
                      aria-label="Delete zoom"
                      title="Delete zoom"
                    >
                      <TrashIcon />
                    </button>
                  )}
                  <div
                    className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize"
                    onPointerDown={(event) => beginZoomDrag(event, keyframe, "resize-end")}
                    title="Resize zoom end"
                  />
                </div>
              );
            })}
            <Playhead pct={playheadPct} />
          </div>
        </div>
      </div>
    </footer>
  );
}

function Playhead({ pct, head = false }: { pct: number; head?: boolean }) {
  return (
    <div
      data-playhead
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 -translate-x-1/2 bg-red-500"
      style={{ left: `${pct}%` }}
    >
      {head && <div className="absolute -left-[5px] top-0 h-2.5 w-3 rounded-b-[3px] rounded-t-sm bg-red-500" />}
    </div>
  );
}

function TransportButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-black/60 transition-colors hover:bg-black/5 hover:text-black/80",
        FOCUS_RING,
      )}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M4.25 3.14v9.72c0 .64.7 1.03 1.24.68l7.08-4.86a.82.82 0 0 0 0-1.36L5.49 2.46a.82.82 0 0 0-1.24.68Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M4.75 2.5A1.25 1.25 0 0 0 3.5 3.75v8.5a1.25 1.25 0 1 0 2.5 0v-8.5A1.25 1.25 0 0 0 4.75 2.5Zm6.5 0A1.25 1.25 0 0 0 10 3.75v8.5a1.25 1.25 0 1 0 2.5 0v-8.5A1.25 1.25 0 0 0 11.25 2.5Z" />
    </svg>
  );
}

function SkipStartIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M4 3.5a.75.75 0 0 1 1.5 0v9a.75.75 0 0 1-1.5 0v-9Z" />
      <path d="M12.5 4.14v7.72c0 .64-.7 1.03-1.24.68L6.6 8.68a.82.82 0 0 1 0-1.36l4.66-3.86a.82.82 0 0 1 1.24.68Z" />
    </svg>
  );
}

function SkipEndIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M12 3.5a.75.75 0 0 0-1.5 0v9a.75.75 0 0 0 1.5 0v-9Z" />
      <path d="M3.5 4.14v7.72c0 .64.7 1.03 1.24.68l4.66-3.86a.82.82 0 0 0 0-1.36L4.74 3.46a.82.82 0 0 0-1.24.68Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
      <path d="M8.75 2.75a.75.75 0 0 0-1.5 0V7.25H2.75a.75.75 0 0 0 0 1.5H7.25v4.5a.75.75 0 0 0 1.5 0V8.75h4.5a.75.75 0 0 0 0-1.5H8.75V2.75Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
      <path
        fillRule="evenodd"
        d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.712Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
      <path
        fillRule="evenodd"
        d="M12.5 9.75A2.75 2.75 0 0 0 9.75 7H4.56l2.22 2.22a.75.75 0 1 1-1.06 1.06l-3.5-3.5a.75.75 0 0 1 0-1.06l3.5-3.5a.75.75 0 0 1 1.06 1.06L4.56 5.5h5.19a4.25 4.25 0 0 1 0 8.5h-1a.75.75 0 0 1 0-1.5h1a2.75 2.75 0 0 0 2.75-2.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
