import { Timeline, type TimelineClip } from "@/components/editor/Timeline";
import { Toaster } from "@/components/editor/Toaster";
import { Slider } from "@/components/ui/slider";
import {
  defaultAspectRatio,
  defaultDeviceGapPercent,
  defaultMockup,
  getMockupPreviewInnerX,
  getMockupPreviewInnerY,
  mockupGroups,
  widthFractionForDevices,
} from "@/lib/appDefaults";
import {
  colorPickerSwatchInputClassName,
  defaultSolidColor,
  normalizeColorHex,
} from "@/lib/colorFormat";
import { colors } from "@/lib/constants/colors";
import { gradientPresets } from "@/lib/constants/gradientPresets";
import { mockupsDefs } from "@/lib/constants/mockups";
import { aspectRatios } from "@/lib/constants/sizes";
import {
  type BgTab,
  type DeviceCount,
  type EditorDocument,
  type ExportPreset,
  type Gradient,
} from "@/lib/editorDocument";
import { useHistory } from "@/lib/history";
import useMediabunny, { type Background, type ExportFormat } from "@/lib/hooks/useMediabunny";
import { useToasts } from "@/lib/hooks/useToasts";
import { clearDocument, clearMedia, loadDocument, loadMedia, saveDocument, saveMedia } from "@/lib/persistence";
import { buildPreviewSurfaceStyle } from "@/lib/previewSurfaceStyle";
import { cn } from "@/lib/utils";
import { smartTrim } from "@/lib/utils/utils";
import {
  clampEndOffset,
  clampStartOffset,
  formatTimestamp,
  getEffectiveTrimWindow,
  snapToFrame,
  type VideoDimensions,
} from "@/lib/videoTrim";
import {
  createZoomKeyframe,
  DEFAULT_ZOOM_DURATION,
  findFreeZoomSlot,
  getActiveZoom,
  type ZoomKeyframe,
} from "@/lib/zoomEffect";
import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type MediaMode = "video" | "image";
type PanelTab = "design" | "clip" | "zoom" | "export";
type PanelSectionKey = "canvas" | "background" | "device" | "zoom" | "export";

export default function App() {
  const { generateVideo, generateImage, progress, reset, transpilingFinished, finishedVideoUrl, transpilingStarted } = useMediabunny();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const hydratedRef = useRef(false);
  const [mediaMode, setMediaMode] = useState<MediaMode>("video");
  const [selectedMockup, setSelectedMockup] = useState(defaultMockup);
  const [scale, setScale] = useState(90);
  const [videoScale, setVideoScale] = useState(100);
  const [verticalOffset, setVerticalOffset] = useState(0);
  const [selectedFramerate, setSelectedFramerate] = useState(30);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
  const [exportPreset, setExportPreset] = useState<ExportPreset>("standard");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(defaultAspectRatio);
  const [deviceCount, setDeviceCount] = useState<DeviceCount>(1);
  const [deviceGapPercent, setDeviceGapPercent] = useState(defaultDeviceGapPercent);
  const [loopShorter, setLoopShorter] = useState(true);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewCompleted, setPreviewCompleted] = useState(false);
  const [previewScrubTime, setPreviewScrubTime] = useState(0);
  const [zoomKeyframes, setZoomKeyframes] = useState<ZoomKeyframe[]>([]);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);

  const [panelTab, setPanelTab] = useState<PanelTab>("design");
  const [selectedClipIdx, setSelectedClipIdx] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<Exclude<PanelSectionKey, "export">>("canvas");
  const canvasSectionRef = useRef<HTMLDivElement | null>(null);
  const backgroundSectionRef = useRef<HTMLDivElement | null>(null);
  const deviceSectionRef = useRef<HTMLDivElement | null>(null);
  const zoomSectionRef = useRef<HTMLDivElement | null>(null);
  const exportSectionRef = useRef<HTMLDivElement | null>(null);

  const [videoFiles, setVideoFiles] = useState<(File | null)[]>([null]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [videoDurations, setVideoDurations] = useState<number[]>([0]);
  const [videoDimensions, setVideoDimensions] = useState<(VideoDimensions | null)[]>([null]);
  const [videoStartOffsets, setVideoStartOffsets] = useState<number[]>([0]);
  const [videoEndOffsets, setVideoEndOffsets] = useState<number[]>([0]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const sceneZoomRef = useRef<HTMLDivElement | null>(null);
  const devicesZoomRef = useRef<HTMLDivElement | null>(null);
  const [activeDragIdx, setActiveDragIdx] = useState<number | null>(null);

  const [bgTab, setBgTab] = useState<BgTab>("color");
  const [solidColor, setSolidColor] = useState(defaultSolidColor);
  const [gradient, setGradient] = useState<Gradient>({ from: "#a5f3fc", to: "#f5d0fe", angle: 135 });
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [bgImageUrl, setBgImageUrl] = useState<string>("");

  const background: Background = useMemo(() => {
    if (bgTab === "gradient") return { type: "gradient", ...gradient };
    if (bgTab === "image" && bgImageFile) return { type: "image", file: bgImageFile };
    return { type: "color", color: solidColor };
  }, [bgTab, gradient, bgImageFile, solidColor]);

  const isTransparentExport = mediaMode === "video" && exportFormat === "webm-transparent";
  const previewSurfaceStyle = useMemo(
    () =>
      buildPreviewSurfaceStyle({
        background,
        solidColor,
        isTransparentExport,
        aspectWidth: selectedAspectRatio.width,
        aspectHeight: selectedAspectRatio.height,
      }),
    [background, isTransparentExport, selectedAspectRatio.height, selectedAspectRatio.width, solidColor],
  );
  const outputDimensions = useMemo(
    () => ({
      width: exportPreset === "x" ? selectedAspectRatio.xWidth : selectedAspectRatio.width,
      height: exportPreset === "x" ? selectedAspectRatio.xHeight : selectedAspectRatio.height,
    }),
    [exportPreset, selectedAspectRatio],
  );

  const frameDuration = 1 / selectedFramerate;

  const editorDocument = useMemo<EditorDocument>(
    () => ({
      selectedMockupName: selectedMockup.name,
      scale,
      videoScale,
      verticalOffset,
      selectedFramerate,
      exportFormat,
      exportPreset,
      selectedAspectRatioName: selectedAspectRatio.name,
      deviceCount,
      deviceGapPercent,
      loopShorter,
      bgTab,
      solidColor,
      gradient,
      videoStartOffsets,
      videoEndOffsets,
      zoomKeyframes,
    }),
    [
      bgTab,
      deviceCount,
      deviceGapPercent,
      exportFormat,
      exportPreset,
      gradient,
      loopShorter,
      scale,
      selectedAspectRatio.name,
      selectedFramerate,
      selectedMockup.name,
      solidColor,
      verticalOffset,
      videoEndOffsets,
      videoScale,
      videoStartOffsets,
      zoomKeyframes,
    ],
  );

  const applyDocument = useCallback((next: EditorDocument) => {
    setSelectedMockup(mockupsDefs.find((mockup) => mockup.name === next.selectedMockupName) ?? defaultMockup);
    setSelectedAspectRatio(aspectRatios.find((ratio) => ratio.name === next.selectedAspectRatioName) ?? defaultAspectRatio);
    setScale(next.scale);
    setVideoScale(next.videoScale);
    setVerticalOffset(next.verticalOffset);
    setSelectedFramerate(next.selectedFramerate);
    setExportFormat(next.exportFormat);
    setExportPreset(next.exportPreset);
    setDeviceCount(next.deviceCount);
    setDeviceGapPercent(next.deviceGapPercent);
    setLoopShorter(next.loopShorter);
    setBgTab(next.bgTab);
    setSolidColor(next.solidColor);
    setGradient(next.gradient);
    setVideoStartOffsets(next.videoStartOffsets);
    setVideoEndOffsets(next.videoEndOffsets);
    setZoomKeyframes(next.zoomKeyframes);
    setPreviewPlaying(false);
    setPreviewCompleted(false);
  }, []);

  const history = useHistory(editorDocument, applyDocument, { delayMs: 350 });
  const { undo: undoEdit, redo: redoEdit, canUndo, canRedo, reset: resetHistory } = history;

  // Restore the previous session (settings + media) once on mount.
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const stored = loadDocument();
      if (stored && !cancelled) {
        applyDocument(stored);
        const media = await loadMedia();
        if (cancelled) return;
        const restored = Array.from({ length: stored.deviceCount }, (_, idx) => media?.[idx] ?? null);
        if (restored.some(Boolean)) {
          setVideoFiles(restored);
          pushToast("Restored your last project.", "success");
        } else {
          pushToast("Restored your last settings. Re-add your recording to continue.", "info");
        }
      }
      if (!cancelled) {
        hydratedRef.current = true;
        resetHistory();
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("VideoEncoder" in window) || !("VideoDecoder" in window)) {
      pushToast("This browser can't encode video (WebCodecs missing). Try Chrome, Edge or Safari 17+.", "error");
    }
  }, [pushToast]);

  // Autosave the document (debounced).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const timer = setTimeout(() => {
      if (saveDocument(editorDocument)) {
        setSavedAt(Date.now());
      } else {
        pushToast("Couldn't autosave your project (storage blocked or full).", "error");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [editorDocument, pushToast]);

  // Autosave media blobs (debounced).
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (!videoFiles.some(Boolean)) {
      void clearMedia();
      return;
    }
    const timer = setTimeout(() => {
      void saveMedia(videoFiles);
    }, 800);
    return () => clearTimeout(timer);
  }, [videoFiles]);

  const trimmedDurations = useMemo(() => {
    return videoFiles.map((file, idx) => {
      if (!file) return 0;
      const duration = videoDurations[idx] ?? 0;
      if (!Number.isFinite(duration) || duration <= 0) return 0;
      const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
      return Math.max(end - start, 0);
    });
  }, [videoDurations, videoEndOffsets, videoFiles, videoStartOffsets]);

  const finalPreviewDuration = useMemo(() => Math.max(...trimmedDurations, 0), [trimmedDurations]);

  useEffect(() => {
    const resize = <T,>(prev: T[], fill: T) => {
      const next = prev.slice(0, deviceCount);
      while (next.length < deviceCount) next.push(fill);
      return next;
    };
    setVideoFiles((prev) => resize(prev, null));
    setVideoDurations((prev) => resize(prev, 0));
    setVideoDimensions((prev) => resize(prev, null));
    setVideoStartOffsets((prev) => resize(prev, 0));
    setVideoEndOffsets((prev) => resize(prev, 0));
    videoRefs.current = videoRefs.current.slice(0, deviceCount);
  }, [deviceCount]);

  useEffect(() => {
    const urls = videoFiles.map((f) => (f ? URL.createObjectURL(f) : ""));
    setVideoUrls(urls);
    return () => {
      urls.forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, [videoFiles]);

  useEffect(() => {
    if (!bgImageFile) {
      setBgImageUrl("");
      return;
    }
    const url = URL.createObjectURL(bgImageFile);
    setBgImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bgImageFile]);

  useEffect(() => {
    if (!transpilingStarted) return;
    const outputDuration = Math.max(
      ...videoRefs.current.map((video, idx) => {
        const duration = videoDurations[idx] || video?.duration || 0;
        const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
        return Math.max(end - start, 0);
      }),
      0,
    );
    if (!Number.isFinite(outputDuration) || outputDuration <= 0) return;

    const t = (progress / 100) * outputDuration;
    videoRefs.current.forEach((vv, idx) => {
      if (!vv) return;
      const duration = videoDurations[idx] || vv.duration || 0;
      if (!Number.isFinite(duration) || duration <= 0) return;

      const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
      const remainingDuration = Math.max(end - start, 0);
      const relativeTime = loopShorter && remainingDuration > 0
        ? t % remainingDuration
        : Math.min(t, Math.max(remainingDuration - 1 / selectedFramerate, 0));
      vv.currentTime = Math.min(start + relativeTime, Math.max(end - 0.001, 0));
    });
  }, [loopShorter, progress, selectedFramerate, transpilingStarted, videoDurations, videoEndOffsets, videoStartOffsets]);

  useEffect(() => {
    videoRefs.current.forEach((v) => {
      if (!v) return;
      if (transpilingStarted) v.pause();
    });
  }, [transpilingStarted]);

  useEffect(() => {
    if (transpilingStarted || transpilingFinished) return;

    videoRefs.current.forEach((video, idx) => {
      if (!video) return;
      if (!previewPlaying) {
        video.pause();
        return;
      }

      const duration = videoDurations[idx] || video.duration || 0;
      if (Number.isFinite(duration) && duration > 0 && video.ended) {
        const { start } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
        video.currentTime = start;
      }
      video.play().catch(() => {});
    });
  }, [previewPlaying, transpilingFinished, transpilingStarted, videoDurations, videoEndOffsets, videoStartOffsets]);

  const setVideoAt = useCallback((idx: number, file: File | null) => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    setPreviewScrubTime(0);
    setVideoFiles((prev) => {
      const next = prev.slice();
      next[idx] = file;
      return next;
    });
    setVideoDurations((prev) => {
      const next = prev.slice();
      next[idx] = 0;
      return next;
    });
    setVideoDimensions((prev) => {
      const next = prev.slice();
      next[idx] = null;
      return next;
    });
    setVideoStartOffsets((prev) => {
      const next = prev.slice();
      next[idx] = 0;
      return next;
    });
    setVideoEndOffsets((prev) => {
      const next = prev.slice();
      next[idx] = 0;
      return next;
    });
  }, []);

  const handleMediaModeChange = useCallback((nextMode: MediaMode) => {
    if (nextMode === mediaMode) return;
    setMediaMode(nextMode);
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    setPreviewScrubTime(0);
    setVideoFiles(Array(deviceCount).fill(null));
    setVideoDurations(Array(deviceCount).fill(0));
    setVideoDimensions(Array(deviceCount).fill(null));
    setVideoStartOffsets(Array(deviceCount).fill(0));
    setVideoEndOffsets(Array(deviceCount).fill(0));
    setZoomKeyframes([]);
    setSelectedZoomId(null);
    videoRefs.current = [];
    setExportFormat("mp4");
    reset();
  }, [deviceCount, mediaMode, reset]);

  const setVideoDurationAt = useCallback((idx: number, duration: number) => {
    const safeDuration = Number.isFinite(duration) ? duration : 0;
    setVideoDurations((prev) => {
      const next = prev.slice();
      next[idx] = safeDuration;
      return next;
    });
    setVideoStartOffsets((prev) => {
      const next = prev.slice();
      next[idx] = clampStartOffset(next[idx] ?? 0, safeDuration);
      return next;
    });
    setVideoEndOffsets((prev) => {
      const next = prev.slice();
      next[idx] = clampEndOffset(next[idx] || safeDuration, safeDuration);
      return next;
    });
  }, []);

  const setVideoDimensionsAt = useCallback((idx: number, dimensions: VideoDimensions) => {
    setVideoDimensions((prev) => {
      const next = prev.slice();
      next[idx] = dimensions;
      return next;
    });
  }, []);

  const getTrimStartForVideo = useCallback((idx: number) => {
    const video = videoRefs.current[idx];
    const duration = videoDurations[idx] || video?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration).start;
  }, [videoDurations, videoEndOffsets, videoStartOffsets]);

  const getTrimEndForVideo = useCallback((idx: number) => {
    const video = videoRefs.current[idx];
    const duration = videoDurations[idx] || video?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const endOffset = clampEndOffset(videoEndOffsets[idx] || duration, duration);
    return Math.max(endOffset - 0.001, 0);
  }, [videoDurations, videoEndOffsets]);

  const getVideoTimeAtPreviewTime = useCallback((idx: number, previewTime: number) => {
    const video = videoRefs.current[idx];
    const duration = videoDurations[idx] || video?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) return 0;

    const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
    const trimDuration = Math.max(end - start, 0);
    if (trimDuration <= 0) return start;

    if (loopShorter) {
      const relativeTime = previewTime >= finalPreviewDuration ? trimDuration : previewTime % trimDuration;
      return Math.min(start + relativeTime, Math.max(end - 0.001, start));
    }

    const relativeTime = Math.min(previewTime, Math.max(trimDuration - 0.001, 0));
    return Math.min(start + relativeTime, Math.max(end - 0.001, start));
  }, [finalPreviewDuration, loopShorter, videoDurations, videoEndOffsets, videoStartOffsets]);

  const zoomTimelineDuration = Math.max(finalPreviewDuration, 1);
  const selectedZoom = zoomKeyframes.find((k) => k.id === selectedZoomId) ?? null;

  const updateSelectedZoom = useCallback((patch: Partial<ZoomKeyframe>) => {
    if (!selectedZoomId) return;
    setZoomKeyframes((prev) => prev.map((k) => (k.id === selectedZoomId ? { ...k, ...patch } : k)));
  }, [selectedZoomId]);

  const updateZoom = useCallback((id: string, patch: Partial<ZoomKeyframe>) => {
    setZoomKeyframes((prev) => prev.map((k) => (k.id === id ? { ...k, ...patch } : k)));
  }, []);

  const handleAddZoom = useCallback(() => {
    const slot = findFreeZoomSlot(zoomKeyframes, zoomTimelineDuration, DEFAULT_ZOOM_DURATION, previewScrubTime);
    if (!slot) return;
    const kf = createZoomKeyframe(slot);
    setZoomKeyframes((prev) => [...prev, kf]);
    setSelectedZoomId(kf.id);
    setSelectedClipIdx(null);
    setPanelTab("zoom");
  }, [previewScrubTime, zoomKeyframes, zoomTimelineDuration]);

  const handleSelectClip = useCallback((idx: number) => {
    setSelectedClipIdx(idx);
    setSelectedZoomId(null);
    setPanelTab("clip");
  }, []);

  const handleRemoveClip = useCallback((idx: number) => {
    setVideoAt(idx, null);
    setSelectedClipIdx(null);
    setPanelTab("design");
  }, [setVideoAt]);

  const handleDeleteZoom = useCallback((id: string) => {
    setZoomKeyframes((prev) => prev.filter((k) => k.id !== id));
    setSelectedZoomId((prev) => (prev === id ? null : prev));
  }, []);

  const applyZoomStyle = useCallback((relativeTime: number) => {
    const sceneEl = sceneZoomRef.current;
    const devicesEl = devicesZoomRef.current;
    if (!sceneEl && !devicesEl) return;
    const { scale, pointX, pointY, target, offsetX, offsetY } = getActiveZoom(zoomKeyframes, relativeTime);
    const origin = `${pointX}% ${pointY}%`;
    const transform = scale !== 1 ? `translate(${offsetX}%, ${offsetY}%) scale(${scale})` : "";
    const applyTo = (el: HTMLDivElement | null, active: boolean) => {
      if (!el) return;
      el.style.transformOrigin = origin;
      el.style.transform = active ? transform : "";
    };
    applyTo(sceneEl, target === "scene");
    applyTo(devicesEl, target === "device");
  }, [zoomKeyframes]);

  useEffect(() => {
    if (mediaMode !== "video" || zoomKeyframes.length === 0 || !previewPlaying) return;
    let raf: number;
    const tick = () => {
      const idx = videoRefs.current.findIndex((video) => video !== null);
      const video = idx >= 0 ? videoRefs.current[idx] : null;
      if (video) {
        applyZoomStyle(video.currentTime - getTrimStartForVideo(idx));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [applyZoomStyle, getTrimStartForVideo, mediaMode, previewPlaying, zoomKeyframes.length]);

  useEffect(() => {
    if (mediaMode !== "video" || previewPlaying) return;
    applyZoomStyle(previewScrubTime);
  }, [applyZoomStyle, mediaMode, previewPlaying, previewScrubTime]);

  const seekAllVideosToPreviewTime = useCallback((previewTime: number) => {
    videoRefs.current.forEach((video, idx) => {
      if (!video) return;
      video.pause();
      video.currentTime = getVideoTimeAtPreviewTime(idx, previewTime);
    });
  }, [getVideoTimeAtPreviewTime]);

  useEffect(() => {
    if (previewScrubTime <= finalPreviewDuration) return;
    const nextTime = Math.max(finalPreviewDuration, 0);
    setPreviewScrubTime(nextTime);
    seekAllVideosToPreviewTime(nextTime);
  }, [finalPreviewDuration, previewScrubTime, seekAllVideosToPreviewTime]);

  const pausePreviewAt = useCallback((idx: number, time: number, alignOthersTo: "start" | "end" = "start") => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    videoRefs.current.forEach((video, videoIdx) => {
      if (!video) return;
      const duration = videoDurations[videoIdx] || video.duration || 0;
      if (!Number.isFinite(duration) || duration <= 0) {
        video.pause();
        return;
      }
      video.currentTime = videoIdx === idx
        ? time
        : alignOthersTo === "end"
          ? getTrimEndForVideo(videoIdx)
          : getTrimStartForVideo(videoIdx);
      video.pause();
    });
  }, [getTrimEndForVideo, getTrimStartForVideo, videoDurations]);

  const seekAllVideosToTrimStart = useCallback(() => {
    videoRefs.current.forEach((video, idx) => {
      if (!video) return;
      const duration = videoDurations[idx] || video.duration || 0;
      if (!Number.isFinite(duration) || duration <= 0) return;
      video.currentTime = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration).start;
    });
  }, [videoDurations, videoEndOffsets, videoStartOffsets]);

  const pauseCompletedPreview = useCallback(() => {
    setPreviewPlaying(false);
    setPreviewCompleted(true);
    setPreviewScrubTime(finalPreviewDuration);
    videoRefs.current.forEach((video) => video?.pause());
  }, [finalPreviewDuration]);

  const getLivePreviewTime = useCallback(() => {
    const idx = videoRefs.current.findIndex((video) => video !== null);
    if (idx < 0) return 0;
    const video = videoRefs.current[idx];
    if (!video) return 0;
    return Math.max(video.currentTime - getTrimStartForVideo(idx), 0);
  }, [getTrimStartForVideo]);

  const handleStartOffsetChange = useCallback((idx: number, value: number) => {
    const duration = videoDurations[idx] ?? 0;
    const nextOffset = clampStartOffset(snapToFrame(value, selectedFramerate), duration);
    setVideoStartOffsets((prev) => {
      const next = prev.slice();
      next[idx] = nextOffset;
      return next;
    });

    pausePreviewAt(idx, nextOffset, "start");
  }, [pausePreviewAt, selectedFramerate, videoDurations]);

  const handleEndOffsetChange = useCallback((idx: number, value: number) => {
    const duration = videoDurations[idx] ?? 0;
    const nextOffset = clampEndOffset(snapToFrame(value, selectedFramerate), duration);
    setVideoEndOffsets((prev) => {
      const next = prev.slice();
      next[idx] = nextOffset;
      return next;
    });

    pausePreviewAt(idx, Math.max(nextOffset - 0.001, 0), "end");
  }, [pausePreviewAt, selectedFramerate, videoDurations]);

  const handleTrim = useCallback((idx: number, startOffset: number, endOffset: number) => {
    const duration = videoDurations[idx] ?? 0;
    const nextStart = clampStartOffset(snapToFrame(startOffset, selectedFramerate), duration);
    const nextEnd = clampEndOffset(snapToFrame(endOffset, selectedFramerate), duration);
    setVideoStartOffsets((prev) => {
      const next = prev.slice();
      next[idx] = nextStart;
      return next;
    });
    setVideoEndOffsets((prev) => {
      const next = prev.slice();
      next[idx] = nextEnd;
      return next;
    });
    pausePreviewAt(idx, nextStart, "start");
  }, [pausePreviewAt, selectedFramerate, videoDurations]);

  const handleResetTrimAt = useCallback((idx: number) => {
    setPreviewCompleted(false);
    const duration = videoDurations[idx] ?? 0;
    setVideoStartOffsets((prev) => {
      const next = prev.slice();
      next[idx] = 0;
      return next;
    });
    setVideoEndOffsets((prev) => {
      const next = prev.slice();
      next[idx] = duration;
      return next;
    });

    const video = videoRefs.current[idx];
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = 0;
      if (previewPlaying) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }, [previewPlaying, videoDurations]);

  const handleTogglePreviewPlayback = useCallback(() => {
    if (previewPlaying) {
      setPreviewPlaying(false);
      const idx = videoRefs.current.findIndex((video) => video !== null);
      if (idx >= 0) {
        const video = videoRefs.current[idx];
        if (video) setPreviewScrubTime(Math.max(video.currentTime - getTrimStartForVideo(idx), 0));
      }
      return;
    }

    if (previewCompleted) {
      seekAllVideosToTrimStart();
      setPreviewScrubTime(0);
      setPreviewCompleted(false);
    }
    setPreviewPlaying(true);
  }, [getTrimStartForVideo, previewCompleted, previewPlaying, seekAllVideosToTrimStart]);

  const handlePreviewScrubChange = useCallback((value: number) => {
    const nextTime = Math.min(Math.max(snapToFrame(value, selectedFramerate), 0), finalPreviewDuration);
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    setPreviewScrubTime(nextTime);
    seekAllVideosToPreviewTime(nextTime);
  }, [finalPreviewDuration, seekAllVideosToPreviewTime, selectedFramerate]);

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id);
    if (id) {
      setSelectedClipIdx(null);
      setPanelTab("zoom");
    }
  }, []);

  const handleFocusZoom = useCallback((id: string) => {
    setSelectedZoomId(id);
    setSelectedClipIdx(null);
    setPanelTab("zoom");
    const keyframe = zoomKeyframes.find((k) => k.id === id);
    if (keyframe) handlePreviewScrubChange((keyframe.start + keyframe.end) / 2);
  }, [handlePreviewScrubChange, zoomKeyframes]);

  const handleJumpToStart = useCallback(() => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    setPreviewScrubTime(0);
    seekAllVideosToTrimStart();
  }, [seekAllVideosToTrimStart]);

  const handleJumpToEnd = useCallback(() => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    const end = Math.max(finalPreviewDuration, 0);
    setPreviewScrubTime(end);
    seekAllVideosToPreviewTime(end);
  }, [finalPreviewDuration, seekAllVideosToPreviewTime]);

  const handleFileChangeAt = useCallback((idx: number) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    const file = files?.[0];
    if (file && file.type.startsWith(`${mediaMode}/`)) setVideoAt(idx, file);
    setTimeout(() => { event.target.value = ""; }, 50);
  }, [mediaMode, setVideoAt]);

  const handleDropAt = useCallback((idx: number) => (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setActiveDragIdx(null);
    const files = event.dataTransfer.files;
    const file = files?.[0];
    if (file && file.type.startsWith(`${mediaMode}/`)) setVideoAt(idx, file);
  }, [mediaMode, setVideoAt]);

  const handleBgImageChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) setBgImageFile(files[0]);
    setTimeout(() => { event.target.value = ""; }, 50);
  }, []);

  const cellWidthFraction = useMemo(
    () => widthFractionForDevices(deviceCount, deviceGapPercent),
    [deviceCount, deviceGapPercent],
  );

  const allVideosLoaded = videoFiles.every((f) => f !== null);
  const anyVideoLoaded = videoFiles.some((f) => f !== null);

  const timelineClips = useMemo<TimelineClip[]>(
    () =>
      videoFiles.reduce<TimelineClip[]>((acc, file, idx) => {
        if (!file) return acc;
        const sourceDuration = videoDurations[idx] ?? 0;
        const { start, end } = getEffectiveTrimWindow(
          videoStartOffsets[idx] ?? 0,
          videoEndOffsets[idx] || sourceDuration,
          sourceDuration,
        );
        acc.push({
          idx,
          label: deviceCount > 1 ? `Video ${idx + 1}` : smartTrim(file.name, 28),
          sourceDuration,
          startOffset: start,
          endOffset: end,
          effectiveDuration: Math.max(end - start, 0),
        });
        return acc;
      }, []),
    [deviceCount, videoDurations, videoEndOffsets, videoFiles, videoStartOffsets],
  );

  const focusSection = useCallback((section: PanelSectionKey) => {
    if (section === "export") {
      setPanelTab("export");
    } else if (section === "zoom") {
      setPanelTab("zoom");
    } else {
      setPanelTab("design");
      setActiveSection(section);
    }
    requestAnimationFrame(() => {
      const refMap: Record<PanelSectionKey, { current: HTMLDivElement | null }> = {
        canvas: canvasSectionRef,
        background: backgroundSectionRef,
        device: deviceSectionRef,
        zoom: zoomSectionRef,
        export: exportSectionRef,
      };
      refMap[section].current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const handleGenerate = async () => {
    const filledFiles = videoFiles.filter((f): f is File => f !== null);
    if (filledFiles.length !== deviceCount) return;
    setPreviewPlaying(false);
    try {
      if (mediaMode === "image") {
        await generateImage({
          imageFiles: filledFiles,
          mockup: selectedMockup,
          background,
          canvasWidth: selectedAspectRatio.width,
          canvasHeight: selectedAspectRatio.height,
          phoneSizePercentage: scale,
          videoSizePercentage: videoScale,
          mockupBackgroundColor: "black",
          verticalOffset,
          deviceGapPercent,
        });
        pushToast("Image ready to download.", "success");
        return;
      }
      await generateVideo({
        videoFiles: filledFiles,
        mockup: selectedMockup,
        background,
        canvasWidth: outputDimensions.width,
        canvasHeight: outputDimensions.height,
        phoneSizePercentage: scale,
        videoSizePercentage: videoScale,
        mockupBackgroundColor: "black",
        verticalOffset,
        frameRate: exportPreset === "x" ? 30 : selectedFramerate,
        videoBitrate: exportPreset === "x" ? 8_000_000 : undefined,
        exportFormat,
        loopShorter,
        videoStartTimes: videoStartOffsets.slice(0, deviceCount),
        videoEndTimes: videoEndOffsets.slice(0, deviceCount),
        deviceGapPercent,
        zoomKeyframes,
      });
      pushToast("Video ready to download.", "success");
    } catch (error) {
      reset();
      pushToast(error instanceof Error ? error.message : "Something went wrong while generating.", "error");
    }
  };

  const handleReset = () => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    setPreviewScrubTime(0);
    setVideoFiles(Array(deviceCount).fill(null));
    setScale(90);
    setVideoScale(100);
    setBgTab("color");
    setSolidColor(defaultSolidColor);
    setGradient({ from: "#a5f3fc", to: "#f5d0fe", angle: 135 });
    setBgImageFile(null);
    setVideoDurations(Array(deviceCount).fill(0));
    setVideoDimensions(Array(deviceCount).fill(null));
    setVideoStartOffsets(Array(deviceCount).fill(0));
    setVideoEndOffsets(Array(deviceCount).fill(0));
    setDeviceGapPercent(defaultDeviceGapPercent);
    setSelectedMockup(defaultMockup);
    setSelectedAspectRatio(defaultAspectRatio);
    setExportFormat("mp4");
    setExportPreset("standard");
    setZoomKeyframes([]);
    setSelectedZoomId(null);
    clearDocument();
    void clearMedia();
    resetHistory();
    setSavedAt(null);
    reset();
  };

  const handleContinueEditing = () => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    seekAllVideosToTrimStart();
    reset();
  };

  const renderZoomPropertiesPanel = () => {
    if (!selectedZoom) return null;
    return (
      <>
        <PanelSection title="Target Layers">
          <label className="flex items-center gap-2 rounded-md bg-white/70 px-2 py-1 ring-1 ring-black/5">
            <span className="shrink-0 text-[11px] text-black/45">Apply to</span>
            <select
              className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-right text-[11px] font-medium text-black/75 focus-visible:outline-none"
              value={selectedZoom.target}
              onChange={(event) =>
                updateSelectedZoom({ target: event.target.value === "device" ? "device" : "scene" })
              }
            >
              <option value="scene">Whole scene</option>
              <option value="device">Device only</option>
            </select>
          </label>
        </PanelSection>

        <PanelSection title="Zoom Point">
          <div className="mx-auto w-full max-w-[200px]">
            <ZoomPointPad
              x={selectedZoom.pointX}
              y={selectedZoom.pointY}
              onChange={(x, y) => updateSelectedZoom({ pointX: x, pointY: y })}
            />
          </div>
          <p className="mt-2 text-center text-[10px] text-black/40">Click to set zoom point</p>
        </PanelSection>

        <PanelSection title="Animation">
          <div className="flex gap-2">
            <NumberField
              label="In"
              value={selectedZoom.easeIn}
              min={0}
              max={2}
              step={0.05}
              suffix="s"
              onChange={(value) => updateSelectedZoom({ easeIn: value })}
            />
            <NumberField
              label="Out"
              value={selectedZoom.easeOut}
              min={0}
              max={2}
              step={0.05}
              suffix="s"
              onChange={(value) => updateSelectedZoom({ easeOut: value })}
            />
          </div>
          <label className="mt-2 flex items-center gap-2 rounded-md bg-white/70 px-2 py-1 ring-1 ring-black/5">
            <select
              className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-[11px] font-medium text-black/75 focus-visible:outline-none"
              value={selectedZoom.easing}
              onChange={(event) =>
                updateSelectedZoom({ easing: event.target.value === "linear" ? "linear" : "easeInOut" })
              }
            >
              <option value="easeInOut">Ease In Out</option>
              <option value="linear">Linear</option>
            </select>
          </label>
        </PanelSection>

        <PanelSection title="Zoomed">
          <NumberField
            label="Scale"
            value={selectedZoom.scale}
            min={1}
            max={3}
            step={0.05}
            suffix="x"
            onChange={(value) => updateSelectedZoom({ scale: value })}
          />
          <div className="mt-2 flex gap-2">
            <NumberField
              label="X"
              value={selectedZoom.pointX}
              min={0}
              max={100}
              step={1}
              suffix="%"
              onChange={(value) => updateSelectedZoom({ pointX: Math.round(value) })}
            />
            <NumberField
              label="Y"
              value={selectedZoom.pointY}
              min={0}
              max={100}
              step={1}
              suffix="%"
              onChange={(value) => updateSelectedZoom({ pointY: Math.round(value) })}
            />
          </div>
          <div className="mt-3">
            <label className="mb-1 flex items-center justify-between text-[11px] text-black/60">
              <span>Scale</span>
              <span className="font-mono text-black/50">{selectedZoom.scale.toFixed(2)}x</span>
            </label>
            <Slider max={3} step={0.05} min={1} value={[selectedZoom.scale]} onValueChange={(value) => updateSelectedZoom({ scale: value[0] })} />
          </div>
        </PanelSection>

        <PanelSection title="Translation">
          <div className="flex gap-2">
            <NumberField
              label="X"
              value={selectedZoom.offsetX}
              min={-100}
              max={100}
              step={1}
              suffix="%"
              onChange={(value) => updateSelectedZoom({ offsetX: value })}
            />
            <NumberField
              label="Y"
              value={selectedZoom.offsetY}
              min={-100}
              max={100}
              step={1}
              suffix="%"
              onChange={(value) => updateSelectedZoom({ offsetY: value })}
            />
          </div>
          <button
            type="button"
            className="mt-2 w-full cursor-pointer rounded-md bg-white/70 px-2 py-1 text-[10px] font-semibold text-black/45 ring-1 ring-black/5 transition-colors hover:text-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            onClick={() => updateSelectedZoom({ offsetX: 0, offsetY: 0 })}
          >
            Reset translation
          </button>
        </PanelSection>

        <PanelSection title="Timing">
          <PanelRow label="Start" value={formatTimestamp(selectedZoom.start)} />
          <PanelRow label="End" value={formatTimestamp(selectedZoom.end)} />
          <p className="mt-1 text-[10px] leading-4 text-black/40">
            Drag the zoom block on the timeline to retime it.
          </p>
        </PanelSection>

        <button
          type="button"
          className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-white/70 text-xs font-semibold text-red-600 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
          onClick={() => handleDeleteZoom(selectedZoom.id)}
        >
          <TrashIcon />
          <span>Remove zoom</span>
        </button>
      </>
    );
  };

  const renderClipPanel = (idx: number) => {
    const file = videoFiles[idx];
    if (!file) {
      return (
        <div className="flex flex-col gap-3">
          <PanelSection title="Video">
            <p className="text-[11px] leading-4 text-black/45">
              This slot is empty. Drop a {mediaMode === "video" ? "screen recording" : "screenshot"} on the device, or
              click it to browse.
            </p>
          </PanelSection>
        </div>
      );
    }
    const duration = videoDurations[idx] ?? 0;
    const startOffset = clampStartOffset(videoStartOffsets[idx] ?? 0, duration);
    const endOffset = clampEndOffset(videoEndOffsets[idx] || duration, duration);
    const dimensions = videoDimensions[idx];
    const trimmedDuration = Math.max(endOffset - startOffset, 0);
    const canTrim = duration > 0;

    return (
      <div className="flex flex-col gap-3">
        <PanelSection title="Video">
          <div className="flex flex-col gap-1 text-[11px] text-black/60">
            <div className="truncate font-medium text-black/75" title={file.name}>
              {file.name}
            </div>
            <PanelRow label="Duration" value={formatTimestamp(duration)} />
            <PanelRow label="Trimmed" value={formatTimestamp(trimmedDuration)} />
            {dimensions && dimensions.width > 0 && (
              <PanelRow label="Resolution" value={`${dimensions.width}×${dimensions.height}`} />
            )}
            <PanelRow label="Size" value={`${Math.fround(file.size / 1_000_000).toPrecision(3)} MB`} />
          </div>
        </PanelSection>

        <PanelSection
          title="Trim"
          action={
            <button
              type="button"
              className="cursor-pointer text-black/45 transition-colors hover:text-black/70 disabled:cursor-default disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
              onClick={() => handleResetTrimAt(idx)}
              disabled={startOffset <= 0 && endOffset >= duration}
              aria-label="Reset trim"
              title="Reset trim"
            >
              <ResetIcon />
            </button>
          }
        >
          <div className="flex items-center gap-2">
            <label className="w-8 shrink-0 text-[11px] text-black/60" htmlFor={`clip-start-${idx}`}>
              In
            </label>
            <input
              id={`clip-start-${idx}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={duration}
              step={0.01}
              value={Number(startOffset.toFixed(2))}
              disabled={!canTrim}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value)) handleStartOffsetChange(idx, value);
              }}
              className="h-7 w-20 rounded-md border border-black/10 bg-white/70 px-1.5 text-right font-mono text-[11px] text-black/70 shadow-sm disabled:opacity-40"
            />
            <span className="font-mono text-[10px] text-black/40">{formatTimestamp(startOffset)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="w-8 shrink-0 text-[11px] text-black/60" htmlFor={`clip-end-${idx}`}>
              Out
            </label>
            <input
              id={`clip-end-${idx}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={duration}
              step={0.01}
              value={Number(endOffset.toFixed(2))}
              disabled={!canTrim}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value)) handleEndOffsetChange(idx, value);
              }}
              className="h-7 w-20 rounded-md border border-black/10 bg-white/70 px-1.5 text-right font-mono text-[11px] text-black/70 shadow-sm disabled:opacity-40"
            />
            <span className="font-mono text-[10px] text-black/40">{formatTimestamp(endOffset)}</span>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-black/40">Tip: drag the clip edges on the timeline for quick trims.</p>
        </PanelSection>

        <PanelSection title="Layout">
          <label className="mb-1 flex items-center justify-between text-[11px] text-black/60">
            <span>Frame Size</span>
            <button className="cursor-pointer text-black/50" onClick={() => setScale(90)} aria-label="Reset frame size">
              <ResetIcon />
            </button>
          </label>
          <Slider max={150} step={1} min={30} value={[scale]} onValueChange={(value) => setScale(value[0])} />
          <label className="mt-3 mb-1 flex items-center justify-between text-[11px] text-black/60">
            <span>Video Size</span>
            <button className="cursor-pointer text-black/50" onClick={() => setVideoScale(100)} aria-label="Reset video size">
              <ResetIcon />
            </button>
          </label>
          <Slider max={200} step={1} min={50} value={[videoScale]} onValueChange={(value) => setVideoScale(value[0])} />
          <label className="mt-3 mb-1 flex items-center justify-between text-[11px] text-black/60">
            <span>Vertical Position</span>
            <button className="cursor-pointer text-black/50" onClick={() => setVerticalOffset(0)} aria-label="Reset vertical position">
              <ResetIcon />
            </button>
          </label>
          <Slider max={100} step={1} min={-100} value={[verticalOffset]} onValueChange={(value) => setVerticalOffset(value[0])} />
        </PanelSection>

        {deviceCount > 1 && mediaMode === "video" && (
          <PanelSection title="Behavior">
            <label className="mb-1 block text-[11px] text-black/60">Shorter video behavior</label>
            <div className="bg-stone-900/5 rounded-lg text-black/70" style={{ padding: 2 }}>
              <div className="relative flex items-center">
                <div
                  className={cn(
                    "absolute left-0 inset-y-0 w-1/2 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow",
                    loopShorter ? "translate-x-0" : "translate-x-full",
                  )}
                />
                <button className="relative flex-1 text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5" onClick={() => setLoopShorter(true)}>
                  Loop
                </button>
                <button className="relative flex-1 text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5" onClick={() => setLoopShorter(false)}>
                  Freeze
                </button>
              </div>
            </div>
          </PanelSection>
        )}

        <button
          type="button"
          className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-white/70 text-xs font-semibold text-red-600 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
          onClick={() => handleRemoveClip(idx)}
        >
          <TrashIcon />
          <span>Remove video</span>
        </button>
      </div>
    );
  };

  const handleStep = useCallback((delta: number) => {
    handlePreviewScrubChange(previewScrubTime + delta);
  }, [handlePreviewScrubChange, previewScrubTime]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const isFormControl =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true;
      const isButtonLike = tag === "BUTTON" || tag === "A";
      const mod = event.metaKey || event.ctrlKey;

      if (isFormControl) return;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoEdit();
        else undoEdit();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoEdit();
        return;
      }

      if (isButtonLike && (event.key === " " || event.key === "Enter")) return;

      if (event.key === " ") {
        event.preventDefault();
        handleTogglePreviewPlayback();
        return;
      }
      if (event.key === "Escape") {
        setSelectedZoomId(null);
        return;
      }

      const inTimeline = Boolean(target?.closest("[data-timeline-root]"));
      if (event.key === "Delete" || event.key === "Backspace") {
        if (inTimeline) return;
        if (selectedZoomId) {
          event.preventDefault();
          handleDeleteZoom(selectedZoomId);
        }
        return;
      }
      if (inTimeline) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleStep(event.shiftKey ? -1 : -frameDuration);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handleStep(event.shiftKey ? 1 : frameDuration);
      } else if (event.key === "Home") {
        event.preventDefault();
        handleJumpToStart();
      } else if (event.key === "End") {
        event.preventDefault();
        handleJumpToEnd();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    frameDuration,
    handleDeleteZoom,
    handleJumpToEnd,
    handleJumpToStart,
    handleStep,
    handleTogglePreviewPlayback,
    redoEdit,
    selectedZoomId,
    undoEdit,
  ]);

  const showTimeline = mediaMode === "video" && anyVideoLoaded && !transpilingStarted && !transpilingFinished;
  const effectiveTab: PanelTab = panelTab === "clip" && selectedClipIdx === null ? "design" : panelTab;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-stone-100 text-black/80">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-black/10 bg-white/70 px-3 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black text-white">
            <LogoIcon />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-semibold text-black/80">Mockup Generator</span>
            <span className="text-[10px] text-black/40">Runs locally · nothing is uploaded</span>
          </div>
          <div className="ml-1 flex items-center gap-0.5">
            <HeaderIconButton label="Undo (Ctrl+Z)" onClick={undoEdit} disabled={!canUndo}>
              <UndoIcon />
            </HeaderIconButton>
            <HeaderIconButton label="Redo (Ctrl+Shift+Z)" onClick={redoEdit} disabled={!canRedo}>
              <RedoIcon />
            </HeaderIconButton>
            {savedAt !== null && (
              <span className="ml-1 hidden items-center gap-1 text-[10px] font-medium text-black/35 sm:flex" aria-live="polite">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Saved
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-stone-900/5 p-0.5 text-black/70">
            <div className="relative flex w-32 items-center">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 w-1/2 rounded-md bg-white shadow transition-transform duration-200",
                  mediaMode === "image" && "translate-x-full",
                )}
              />
              {(["video", "image"] as MediaMode[]).map((mode) => (
                <button
                  key={mode}
                  className="relative flex-1 cursor-pointer py-1 text-xs font-semibold capitalize"
                  onClick={() => handleMediaModeChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <button
            className="h-8 cursor-pointer rounded-md px-3 text-xs font-semibold text-black/60 transition-colors hover:bg-black/5"
            onClick={handleReset}
          >
            Reset
          </button>
          {allVideosLoaded && !transpilingStarted && !transpilingFinished && (
            <button
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-black px-3.5 text-xs font-semibold text-white shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
              onClick={handleGenerate}
            >
              <span>Generate {mediaMode === "video" ? "Video" : "Image"}</span>
              <BoltIcon />
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-black/10 bg-white/60 py-2">
          <RailButton active={panelTab === "design" && activeSection === "canvas"} label="Canvas" onClick={() => focusSection("canvas")}>
            <FrameIcon />
          </RailButton>
          <RailButton active={panelTab === "design" && activeSection === "background"} label="Background" onClick={() => focusSection("background")}>
            <ImageIcon />
          </RailButton>
          <RailButton active={panelTab === "design" && activeSection === "device"} label="Device" onClick={() => focusSection("device")}>
            <DeviceIcon />
          </RailButton>
          <RailButton active={panelTab === "zoom"} label="Zoom" onClick={() => focusSection("zoom")}>
            <ZoomIcon />
          </RailButton>
          <div className="my-1 h-px w-6 bg-black/10" />
          <RailButton active={panelTab === "export"} label="Export" onClick={() => focusSection("export")}>
            <DownloadIcon />
          </RailButton>
        </nav>

        <section className="relative flex min-w-0 flex-1 items-center justify-center bg-stone-100 p-5">
          <div className="relative flex h-full w-full items-center justify-center">
            <div
              className="border border-black/5 rounded-xl shadow-2xl shadow-black/5 relative flex justify-center items-center transition-all ease-in-out duration-300 overflow-hidden"
              style={previewSurfaceStyle}
            >
              <div ref={sceneZoomRef} className="absolute inset-0 h-full w-full">
                {!isTransparentExport && bgTab === "image" && bgImageUrl && (
                  <img
                    src={bgImageUrl}
                    alt="background"
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  />
                )}

                <div
                  ref={devicesZoomRef}
                  className="absolute inset-0 flex flex-row items-center justify-center h-full w-full min-w-0"
                  style={deviceCount > 1 ? { columnGap: `${deviceGapPercent}%` } : undefined}
                >
                  {Array.from({ length: deviceCount }).map((_, idx) => {
                    const file = videoFiles[idx];
                    const url = videoUrls[idx];
                    const isDragOver = activeDragIdx === idx;
                    const cellAspect = (selectedAspectRatio.width / selectedAspectRatio.height) * cellWidthFraction;
                    const mockupAspect = selectedMockup.width / selectedMockup.height;
                    const screenAspect = selectedMockup.innerWidth / selectedMockup.innerHeight;
                    const dimensions = videoDimensions[idx];
                    const videoAspect = dimensions && dimensions.width > 0 && dimensions.height > 0
                      ? dimensions.width / dimensions.height
                      : screenAspect;
                    const mediaSizing = videoAspect > screenAspect
                      ? { height: `${videoScale}%`, width: "auto" }
                      : { width: `${videoScale}%`, height: "auto" };
                    const maxScaleByColumn = (cellAspect * 0.97 / mockupAspect) * 100;
                    const sizingScale = Math.min(scale, maxScaleByColumn);
                    return (
                      <div
                        key={idx}
                        className="group/phone relative flex shrink-0 cursor-pointer items-center justify-center"
                        style={{
                          height: `${sizingScale}%`,
                          marginTop: `${verticalOffset}%`,
                          aspectRatio: `${selectedMockup.width}/${selectedMockup.height}`,
                        }}
                      >
                        <div className="h-full w-full flex items-center justify-center cursor-pointer">
                          <div className={cn(
                            "absolute w-full h-full bg-white/5 rounded-[20%] flex flex-col items-center justify-center p-[5%] transition-colors transform-gpu",
                            !file && "group-hover/phone:bg-white/30",
                            isDragOver && "bg-white/40",
                          )}>
                            {!file && (
                              <div
                                className="flex flex-col items-center gap-2"
                                style={{
                                  transform: `scale(${Math.max(Math.min(sizingScale / 100, 1), 0.5)})`,
                                  width: "90%",
                                }}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 16 16"
                                  fill="currentColor"
                                  className="w-4 h-4 opacity-20 lg:w-5 lg:h-5"
                                >
                                  <path d="M7.25 11.5a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5Z" />
                                  <path
                                    fillRule="evenodd"
                                    d="M6 1a2.5 2.5 0 0 0-2.5 2.5v9A2.5 2.5 0 0 0 6 15h4a2.5 2.5 0 0 0 2.5-2.5v-9A2.5 2.5 0 0 0 10 1H6Zm4 1.5h-.5V3a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5v-.5H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1Z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                                <p className="text-xs lg:text-sm text-center text-black/50 max-w-full">
                                  {deviceCount > 1
                                    ? `Add ${mediaMode} ${idx + 1}`
                                    : `Click or drag here to add ${mediaMode === "video" ? "a screen recording" : "an image"} of your app`}
                                </p>
                              </div>
                            )}
                          </div>
                          <div
                            className={cn(
                              "absolute overflow-hidden bg-black transition-all duration-200",
                              !file && "group-hover/phone:opacity-30 group-hover/phone:blur-sm",
                            )}
                            style={{
                              left: `${(getMockupPreviewInnerX(selectedMockup) / selectedMockup.width) * 100}%`,
                              top: `${(getMockupPreviewInnerY(selectedMockup) / selectedMockup.height) * 100}%`,
                              width: `${(selectedMockup.innerWidth / selectedMockup.width) * 100}%`,
                              height: `${(selectedMockup.innerHeight / selectedMockup.height) * 100}%`,
                              borderRadius: `${(selectedMockup.cornerRadius / selectedMockup.innerWidth) * 100}% / ${(selectedMockup.cornerRadius / selectedMockup.innerHeight) * 100}%`,
                            }}
                          >
                            {file && url && mediaMode === "video" && (
                              <video
                                controls={false}
                                muted
                                className="absolute left-1/2 top-1/2 max-w-none transition-transform duration-200"
                                style={{
                                  ...mediaSizing,
                                  transform: "translate(-50%, -50%)",
                                }}
                                key={url}
                                playsInline
                                unselectable="on"
                                ref={(el) => { videoRefs.current[idx] = el; }}
                                onLoadedMetadata={(event) => {
                                  const duration = event.currentTarget.duration;
                                  setVideoDurationAt(idx, duration);
                                  setVideoDimensionsAt(idx, {
                                    width: event.currentTarget.videoWidth,
                                    height: event.currentTarget.videoHeight,
                                  });
                                  const { start } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
                                  event.currentTarget.currentTime = start;
                                  if (previewPlaying) {
                                    event.currentTarget.play().catch(() => {});
                                  } else {
                                    event.currentTarget.pause();
                                  }
                                }}
                                onTimeUpdate={(event) => {
                                  if (!previewPlaying || transpilingStarted) return;
                                  const duration = event.currentTarget.duration;
                                  const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
                                  if (event.currentTarget.currentTime >= end) {
                                    if (loopShorter) {
                                      event.currentTarget.currentTime = start;
                                      event.currentTarget.play().catch(() => {});
                                    } else {
                                      event.currentTarget.currentTime = Math.max(end - 0.001, start);
                                      pauseCompletedPreview();
                                    }
                                  }
                                }}
                                onEnded={(event) => {
                                  if (transpilingStarted || !previewPlaying) return;
                                  const duration = event.currentTarget.duration;
                                  const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
                                  if (loopShorter) {
                                    event.currentTarget.currentTime = start;
                                    event.currentTarget.play().catch(() => {});
                                  } else {
                                    event.currentTarget.currentTime = Math.max(end - 0.001, start);
                                    pauseCompletedPreview();
                                  }
                                }}
                              >
                                <source src={url} />
                              </video>
                            )}
                            {file && url && mediaMode === "image" && (
                              <img
                                src={url}
                                alt={`Uploaded screen ${idx + 1}`}
                                className="absolute left-1/2 top-1/2 max-w-none transition-transform duration-200"
                                style={{
                                  ...mediaSizing,
                                  transform: "translate(-50%, -50%)",
                                }}
                                onLoad={(event) => {
                                  setVideoDimensionsAt(idx, {
                                    width: event.currentTarget.naturalWidth,
                                    height: event.currentTarget.naturalHeight,
                                  });
                                }}
                                draggable={false}
                              />
                            )}
                          </div>

                          <img
                            src={selectedMockup.imageRelative}
                            alt={selectedMockup.name + " mockup"}
                            width={selectedMockup.width}
                            height={selectedMockup.height}
                            className="h-full w-full relative object-contain pointer-events-none"
                            draggable={false}
                          />
                          <label
                            className="w-full h-full absolute cursor-pointer top-0"
                            onDragOver={(e) => { e.preventDefault(); setActiveDragIdx(idx); }}
                            onDragLeave={(e) => { e.preventDefault(); setActiveDragIdx(null); }}
                            onDrop={handleDropAt(idx)}
                          >
                            <input
                              type="file"
                              className="hidden"
                              accept={`${mediaMode}/*`}
                              onChange={handleFileChangeAt(idx)}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {transpilingStarted && !transpilingFinished && (
                <>
                  <div className="absolute transition-all h-full w-full left-0" />
                  <div
                    className="absolute transition-all h-full left-0 bg-black/5"
                    style={{ width: `${progress}%` }}
                  />
                  <div className="w-full h-full absolute pointer-events-none" />
                  <div className="text-xs bottom-3 left-4 text-black/50 font-mono absolute">
                    <span>Generating {mediaMode}... {Math.min(Math.round(progress), 100)}%</span>
                  </div>
                </>
              )}

              {transpilingFinished && finishedVideoUrl && (
                <div className="bg-white/20 backdrop-blur-md absolute transition-all h-full flex items-center justify-center w-full left-0 z-20">
                  <div className="flex flex-col items-center">
                    <button
                      className="cursor-pointer flex items-center text-black/70 bg-white/90 hover:scale-105 transition-all ease-in-out shadow-md border-black/10 border backdrop-blur-3xl px-3.5 gap-1 text-sm font-medium py-1 rounded-md"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = finishedVideoUrl;
                        a.download = mediaMode === "image"
                          ? "mockup.png"
                          : isTransparentExport
                            ? "mockup.webm"
                            : exportPreset === "x"
                              ? "mockup-x.mp4"
                              : "mockup.mp4";
                        a.click();
                      }}
                    >
                      <span>Download {mediaMode === "video" ? "Video" : "Image"}</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="w-4 h-4"
                      >
                        <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
                        <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
                      </svg>
                    </button>
                    <hr className="my-1 border-none" />
                    <button
                      className="cursor-pointer flex items-center font-semibold text-black/60 hover:underline underline-offset-2 group/edit drop-shadow-sm shadow-black gap-1 text-xs hover:scale-105 ease-in-out"
                      onClick={handleContinueEditing}
                    >
                      <span>Continue Editing</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="w-3.5 h-3.5 group-hover/edit:-translate-y-0.5 ease-in-out transition-all duration-300"
                      >
                        <path d="M11.94 1.94a1.5 1.5 0 0 1 2.12 2.12l-.88.88-2.12-2.12.88-.88Z" />
                        <path d="M10 3.88 2.75 11.13A2.75 2.75 0 0 0 2 12.56V14h1.44a2.75 2.75 0 0 0 1.43-.75L12.12 6 10 3.88Z" />
                      </svg>
                    </button>
                    <hr className="my-1 border-none" />
                    <button
                      className="cursor-pointer flex items-center font-semibold text-black/60 hover:underline underline-offset-2 group/retry drop-shadow-sm shadow-black gap-1 text-xs hover:scale-105 ease-in-out"
                      onClick={handleReset}
                    >
                      <span>Start Over</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="w-3.5 h-3.5 group-hover/retry:rotate-180 ease-in-out transition-all duration-300"
                      >
                        <path
                          fillRule="evenodd"
                          d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.241l-.84-.84v1.371a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.932.75.75 0 0 1 1.025-.273Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="flex w-80 shrink-0 flex-col border-l border-black/10 bg-white/60">
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-black/10 px-2">
            {effectiveTab === "clip" && selectedClipIdx !== null ? (
              <>
                <ContextChip onClick={() => setPanelTab("design")}>
                  <BackIcon />
                  <span>Canvas</span>
                </ContextChip>
                <span className="min-w-0 truncate text-xs font-semibold text-black/75">
                  Video {selectedClipIdx + 1}
                </span>
                <button
                  type="button"
                  className="ml-auto shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold text-black/45 transition-colors hover:bg-black/5 hover:text-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                  onClick={() => setPanelTab("export")}
                >
                  Export
                </button>
              </>
            ) : effectiveTab === "zoom" ? (
              <>
                <ContextChip onClick={() => setPanelTab("design")}>
                  <BackIcon />
                  <span>Canvas</span>
                </ContextChip>
                <span className="min-w-0 truncate text-xs font-semibold text-black/75">Zoom</span>
                <button
                  type="button"
                  className="ml-auto shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold text-black/45 transition-colors hover:bg-black/5 hover:text-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                  onClick={() => setPanelTab("export")}
                >
                  Export
                </button>
              </>
            ) : (
              <>
                <PanelTabButton active={effectiveTab === "design"} onClick={() => setPanelTab("design")}>
                  Design
                </PanelTabButton>
                <PanelTabButton active={false} onClick={() => setPanelTab("zoom")}>
                  Zoom{zoomKeyframes.length > 0 ? ` · ${zoomKeyframes.length}` : ""}
                </PanelTabButton>
                <PanelTabButton active={effectiveTab === "export"} onClick={() => setPanelTab("export")}>
                  Export
                </PanelTabButton>
              </>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {effectiveTab === "design" ? (
              <div className="flex flex-col gap-3">
                <PanelSection innerRef={canvasSectionRef} title="Canvas">
                  <label className="mb-1 block text-[11px] text-black/60">Devices</label>
                  <div className="bg-stone-900/5 rounded-lg text-black/70" style={{ padding: 2 }}>
                    <div className="relative flex items-center">
                      <div
                        className="absolute inset-y-0 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow"
                        style={{ width: `${100 / 3}%`, left: `${((deviceCount - 1) * 100) / 3}%` }}
                      />
                      {[1, 2, 3].map((n) => (
                        <button
                          key={n}
                          className="relative flex-1 flex text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5"
                          onClick={() => setDeviceCount(n as DeviceCount)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {deviceCount > 1 && mediaMode === "video" && (
                    <>
                      <label className="mt-3 mb-1 block text-[11px] text-black/60">Shorter video behavior</label>
                      <div className="bg-stone-900/5 rounded-lg text-black/70" style={{ padding: 2 }}>
                        <div className="relative flex items-center">
                          <div
                            className={cn(
                              "absolute left-0 inset-y-0 w-1/2 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow",
                              loopShorter ? "translate-x-0" : "translate-x-full",
                            )}
                          />
                          <button
                            className="relative flex-1 text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5"
                            onClick={() => setLoopShorter(true)}
                          >
                            Loop
                          </button>
                          <button
                            className="relative flex-1 text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5"
                            onClick={() => setLoopShorter(false)}
                          >
                            Freeze
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {deviceCount > 1 && (
                    <>
                      <label className="mt-3 mb-1 flex items-center justify-between text-[11px] text-black/60">
                        <span>Gap</span>
                        <span className="font-mono text-black/50">{deviceGapPercent}%</span>
                      </label>
                      <Slider
                        max={12}
                        step={0.5}
                        min={0}
                        value={[deviceGapPercent]}
                        onValueChange={(v) => setDeviceGapPercent(v[0])}
                      />
                    </>
                  )}

                  <label className="mt-3 mb-1 block text-[11px] text-black/60">Aspect Ratio</label>
                  <div className="flex relative items-center w-full">
                    <select
                      value={selectedAspectRatio.name}
                      tabIndex={-1}
                      className="appearance-none bg-white/70 rounded-md px-3 py-1 w-full text-xs font-normal text-black/80 cursor-pointer ring-1 ring-black/5"
                      onChange={(event) => {
                        setSelectedAspectRatio(aspectRatios.find((ratio) => ratio.name === event.target.value)!);
                      }}
                    >
                      {aspectRatios.map((ratio) => (
                        <option key={ratio.name} value={ratio.name}>
                          {ratio.name}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-1 text-black/70 pointer-events-none">
                      <ChevronDown />
                    </div>
                  </div>

                  <label className="mt-3 mb-1 flex items-center justify-between text-[11px] text-black/60">
                    <span>Frame Size</span>
                    <button className="cursor-pointer text-black/50" onClick={() => setScale(90)} aria-label="Reset size">
                      <ResetIcon />
                    </button>
                  </label>
                  <Slider max={150} step={1} min={30} value={[scale]} onValueChange={(value) => setScale(value[0])} />

                  <label className="mt-3 mb-1 flex items-center justify-between text-[11px] text-black/60">
                    <span>{mediaMode === "video" ? "Video" : "Image"} Size</span>
                    <button className="cursor-pointer text-black/50" onClick={() => setVideoScale(100)} aria-label="Reset media size">
                      <ResetIcon />
                    </button>
                  </label>
                  <Slider max={200} step={1} min={50} value={[videoScale]} onValueChange={(value) => setVideoScale(value[0])} />

                  <label className="mt-3 mb-1 flex items-center justify-between text-[11px] text-black/60">
                    <span>Vertical Position</span>
                    <button className="cursor-pointer text-black/50" onClick={() => setVerticalOffset(0)} aria-label="Reset vertical position">
                      <ResetIcon />
                    </button>
                  </label>
                  <Slider max={100} step={1} min={-100} value={[verticalOffset]} onValueChange={(value) => setVerticalOffset(value[0])} />
                </PanelSection>

                <PanelSection innerRef={backgroundSectionRef} title="Background">
                  {isTransparentExport ? (
                    <p className="text-[11px] leading-4 text-black/45">
                      Transparent WebM export ignores the background. Switch the output to MP4 to use a color, gradient or image.
                    </p>
                  ) : (
                    <>
                      <div className="bg-stone-900/5 rounded-lg text-black/70 mb-2" style={{ padding: 2 }}>
                        <div className="relative flex items-center">
                          <div
                            className="absolute inset-y-0 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow"
                            style={{ width: `${100 / 3}%`, left: `${["color", "gradient", "image"].indexOf(bgTab) * (100 / 3)}%` }}
                          />
                          {(["color", "gradient", "image"] as BgTab[]).map((t) => (
                            <button
                              key={t}
                              className="relative flex-1 text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5"
                              onClick={() => setBgTab(t)}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>

                      {bgTab === "color" && (
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2 overflow-auto pb-1">
                            {colors.map((color) => (
                              <button
                                key={color}
                                className={cn(
                                  "w-6 h-6 rounded-full cursor-pointer flex items-center justify-center border border-black/10 shadow-sm flex-shrink-0",
                                )}
                                style={{ backgroundColor: color }}
                                onClick={() => setSolidColor(normalizeColorHex(color))}
                                aria-label={`Color ${color}`}
                              >
                                {solidColor === color && <div className="bg-white shadow-sm rounded-full h-2.5 w-2.5" />}
                              </button>
                            ))}
                          </div>
                          <label className="flex items-center gap-2 text-xs text-black/70">
                            <span className="flex-1">Custom</span>
                            <input
                              type="color"
                              autoComplete="off"
                              value={solidColor}
                              onChange={(e) => setSolidColor(normalizeColorHex(e.target.value))}
                              className={colorPickerSwatchInputClassName}
                            />
                          </label>
                        </div>
                      )}

                      {bgTab === "gradient" && (
                        <div className="flex flex-col gap-2">
                          <div
                            className="h-8 w-full rounded-md border border-black/10"
                            style={{ background: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})` }}
                          />
                          <div className="flex items-center gap-2 text-xs text-black/70">
                            <span className="w-12">From</span>
                            <input
                              type="color"
                              autoComplete="off"
                              value={gradient.from}
                              onChange={(e) => setGradient((g) => ({ ...g, from: e.target.value }))}
                              className={colorPickerSwatchInputClassName}
                            />
                            <span className="w-8 text-right">To</span>
                            <input
                              type="color"
                              autoComplete="off"
                              value={gradient.to}
                              onChange={(e) => setGradient((g) => ({ ...g, to: e.target.value }))}
                              className={colorPickerSwatchInputClassName}
                            />
                          </div>
                          <label className="text-xs text-black/70 flex justify-between items-center">
                            <span>Angle</span>
                            <span className="font-mono text-black/50">{gradient.angle}°</span>
                          </label>
                          <Slider
                            max={360}
                            step={1}
                            min={0}
                            value={[gradient.angle]}
                            onValueChange={(v) => setGradient((g) => ({ ...g, angle: v[0] }))}
                          />
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {gradientPresets.map((p) => (
                              <button
                                key={p.from + p.to}
                                className="h-6 w-6 rounded-full border border-black/10 cursor-pointer flex-shrink-0"
                                style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                                onClick={() => setGradient((g) => ({ ...g, from: p.from, to: p.to }))}
                                aria-label="Gradient preset"
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {bgTab === "image" && (
                        <div className="flex flex-col gap-2">
                          {bgImageUrl ? (
                            <div className="relative">
                              <img src={bgImageUrl} alt="Background preview" className="h-20 w-full object-cover rounded-md border border-black/10" />
                              <button
                                className="absolute top-1 right-1 bg-white/90 rounded-full px-2 py-0.5 text-[10px] font-medium text-black/70 cursor-pointer shadow"
                                onClick={() => setBgImageFile(null)}
                              >
                                Remove
                              </button>
                            </div>
                          ) : null}
                          <label className="cursor-pointer text-center text-xs text-black/70 bg-white/60 hover:bg-white rounded-md py-2 border border-dashed border-black/15">
                            {bgImageFile ? "Replace image" : "Upload image"}
                            <input type="file" className="hidden" accept="image/*" onChange={handleBgImageChange} />
                          </label>
                        </div>
                      )}
                    </>
                  )}
                </PanelSection>

                <PanelSection innerRef={deviceSectionRef} title="Device">
                  <div className="flex relative items-center w-full">
                    <select
                      tabIndex={-1}
                      className="appearance-none bg-white/70 rounded-md px-3 py-1 w-full text-xs font-normal text-black/80 cursor-pointer ring-1 ring-black/5"
                      value={selectedMockup.name}
                      onChange={(event) => {
                        setSelectedMockup(mockupsDefs.find((mockup) => mockup.name === event.target.value)!);
                      }}
                    >
                      {mockupGroups.map((group) => (
                        <optgroup key={group} label={group}>
                          {mockupsDefs
                            .filter((mockup) => mockup.group === group)
                            .map((mockup) => (
                              <option key={mockup.name} value={mockup.name}>
                                {mockup.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                    <div className="absolute right-1 text-black/70 pointer-events-none">
                      <ChevronDown />
                    </div>
                  </div>
                </PanelSection>

                {mediaMode === "video" && anyVideoLoaded && (
                  <PanelSection title="Duration">
                    <div className="flex items-center justify-between text-[11px] text-black/60">
                      <span>Output</span>
                      <span className="font-mono text-black/70">{formatTimestamp(finalPreviewDuration)}</span>
                    </div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {videoFiles.map((file, idx) => {
                        if (!file) return null;
                        const duration = videoDurations[idx] ?? 0;
                        const { start, end } = getEffectiveTrimWindow(
                          videoStartOffsets[idx] ?? 0,
                          videoEndOffsets[idx] || duration,
                          duration,
                        );
                        return (
                          <button
                            key={`${idx}-${file.name}`}
                            type="button"
                            className="flex items-center gap-2 rounded-md bg-stone-900/5 px-2 py-1.5 text-left text-[11px] text-black/60 transition-colors hover:bg-stone-900/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                            onClick={() => handleSelectClip(idx)}
                            aria-label={`Select ${deviceCount > 1 ? `Video ${idx + 1}` : file.name}`}
                          >
                            <span className="shrink-0 font-semibold text-black/70">
                              {deviceCount > 1 ? `V${idx + 1}` : "Clip"}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-black/45">
                              {formatTimestamp(Math.max(end - start, 0))}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-black/35">{formatTimestamp(duration)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </PanelSection>
                )}
              </div>
            ) : effectiveTab === "clip" && selectedClipIdx !== null ? (
              renderClipPanel(selectedClipIdx)
            ) : effectiveTab === "zoom" ? (
              <div className="flex flex-col gap-3">
                <PanelSection
                  innerRef={zoomSectionRef}
                  title="Zoom effects"
                  action={
                    <button
                      type="button"
                      className="flex h-6 cursor-pointer items-center gap-1 rounded-md bg-white/80 px-2 text-[11px] font-semibold text-black/70 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-white disabled:cursor-default disabled:opacity-40"
                      onClick={handleAddZoom}
                      disabled={!findFreeZoomSlot(zoomKeyframes, zoomTimelineDuration, DEFAULT_ZOOM_DURATION, previewScrubTime)}
                    >
                      <PlusIcon />
                      <span>Add</span>
                    </button>
                  }
                >
                  {zoomKeyframes.length === 0 ? (
                    <p className="text-[11px] leading-4 text-black/45">
                      No zoom effects yet. Add one to punch in on part of your recording, then drag the block on the
                      timeline to place it.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {[...zoomKeyframes]
                        .sort((a, b) => a.start - b.start)
                        .map((keyframe, index) => {
                          const selected = keyframe.id === selectedZoomId;
                          return (
                            <div
                              key={keyframe.id}
                              className={cn(
                                "flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
                                selected ? "bg-blue-50 ring-1 ring-blue-300" : "bg-stone-900/5 hover:bg-stone-900/10",
                              )}
                            >
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                                onClick={() => handleFocusZoom(keyframe.id)}
                                aria-pressed={selected}
                                aria-label={`Focus Zoom ${index + 1}`}
                              >
                                <span className="shrink-0 text-[11px] font-semibold text-black/70">Zoom {index + 1}</span>
                                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-black/45">
                                  {formatTimestamp(keyframe.start)}–{formatTimestamp(keyframe.end)} · {keyframe.scale.toFixed(2)}x
                                </span>
                              </button>
                              <button
                                type="button"
                                className="shrink-0 cursor-pointer rounded p-0.5 text-black/35 transition-colors hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                                onClick={() => handleDeleteZoom(keyframe.id)}
                                aria-label={`Delete Zoom ${index + 1}`}
                                title="Delete zoom"
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </PanelSection>

                {selectedZoom ? (
                  renderZoomPropertiesPanel()
                ) : (
                  <p className="px-1 text-[11px] leading-4 text-black/45">
                    Select a zoom on the timeline or in the list above to edit its focus point, scale and easing.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <PanelSection innerRef={exportSectionRef} title="Export">
                  <label className="mb-1 block text-[11px] text-black/60">Output</label>
                  <div className="bg-stone-900/5 rounded-lg text-black/70" style={{ padding: 2 }}>
                    <div className="relative flex items-center">
                      <div
                        className={cn(
                          "absolute left-0 inset-y-0 w-1/2 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow",
                          exportFormat === "mp4" && "translate-x-0",
                          exportFormat === "webm-transparent" && "translate-x-full",
                        )}
                      />
                      <button className="relative flex-1 text-xs font-semibold items-center justify-center cursor-pointer m-px p-px py-0.5" onClick={() => setExportFormat("mp4")}>MP4</button>
                      <button
                        className="relative flex-1 text-xs font-semibold items-center justify-center cursor-pointer m-px p-px py-0.5"
                        onClick={() => {
                          setExportFormat("webm-transparent");
                          setExportPreset("standard");
                        }}
                      >
                        WebM
                      </button>
                    </div>
                  </div>

                  {mediaMode === "video" && (
                    <>
                      <label className="mt-3 mb-1 block text-[11px] text-black/60">Framerate</label>
                      <div className="bg-stone-900/5 rounded-lg text-black/70" style={{ padding: 2 }}>
                        <div className="relative flex items-center">
                          <div
                            className={cn(
                              "absolute left-0 inset-y-0 w-1/2 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow",
                              selectedFramerate === 30 && "translate-x-0",
                              selectedFramerate === 60 && "translate-x-full",
                            )}
                          />
                          <button className="relative flex-1 text-xs font-semibold items-center justify-center cursor-pointer m-px p-px py-0.5" onClick={() => setSelectedFramerate(30)}>30</button>
                          <button
                            className={cn(
                              "relative m-px flex flex-1 items-center justify-center p-px py-0.5 text-xs font-semibold",
                              exportPreset === "x" ? "cursor-not-allowed text-black/25" : "cursor-pointer",
                            )}
                            onClick={() => setSelectedFramerate(60)}
                            disabled={exportPreset === "x"}
                            title={exportPreset === "x" ? "The X preset uses 30fps for a clean 60→30 conversion" : undefined}
                          >
                            60
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {mediaMode === "video" && exportFormat === "mp4" && (
                    <>
                      <label className="mt-3 mb-1 block text-[11px] text-black/60">Export preset</label>
                      <div className="bg-stone-900/5 rounded-xl text-black/70 p-0.5">
                        <div className="relative flex items-center">
                          <div
                            className={cn(
                              "absolute left-0 inset-y-0 w-1/2 flex bg-white transition-transform ease-in-out duration-200 rounded-[10px] shadow",
                              exportPreset === "standard" && "translate-x-0",
                              exportPreset === "x" && "translate-x-full",
                            )}
                          />
                          <button
                            className="relative flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-[10px] px-2 text-xs font-semibold transition-transform duration-150 ease-out active:scale-[0.96]"
                            onClick={() => setExportPreset("standard")}
                          >
                            Standard
                          </button>
                          <button
                            className="relative flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-[10px] px-2 text-xs font-semibold transition-transform duration-150 ease-out active:scale-[0.96]"
                            onClick={() => {
                              setExportPreset("x");
                              setSelectedFramerate(30);
                            }}
                          >
                            X · HQ
                          </button>
                        </div>
                      </div>
                      {exportPreset === "x" && (
                        <p className="mt-1.5 text-left font-mono text-[10px] leading-4 text-black/45">
                          {outputDimensions.width}×{outputDimensions.height} · 30fps · H.264 · 8Mbps
                        </p>
                      )}
                    </>
                  )}

                  <p className="mt-3 text-left font-mono text-[10px] leading-4 text-black/45">
                    {mediaMode === "video"
                      ? isTransparentExport
                        ? "WebM · VP9 · alpha preserved"
                        : `MP4 · H.264 · ${outputDimensions.width}×${outputDimensions.height}`
                      : `PNG · ${selectedAspectRatio.width}×${selectedAspectRatio.height}`}
                  </p>

                  <button
                    className="mt-3 flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-black text-xs font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={handleGenerate}
                    disabled={!allVideosLoaded || transpilingStarted || transpilingFinished}
                  >
                    <span>Generate {mediaMode === "video" ? "Video" : "Image"}</span>
                    <BoltIcon />
                  </button>
                </PanelSection>
              </div>
            )}
          </div>
        </aside>
      </div>

      {showTimeline ? (
        <Timeline
          duration={finalPreviewDuration}
          frameRate={selectedFramerate}
          playhead={Math.min(previewScrubTime, finalPreviewDuration)}
          playing={previewPlaying}
          clips={timelineClips}
          zoomKeyframes={zoomKeyframes}
          selectedZoomId={selectedZoomId}
          selectedClipIdx={selectedClipIdx}
          canAddZoom={Boolean(findFreeZoomSlot(zoomKeyframes, zoomTimelineDuration, DEFAULT_ZOOM_DURATION, previewScrubTime))}
          onScrub={handlePreviewScrubChange}
          onTogglePlay={handleTogglePreviewPlayback}
          onJumpStart={handleJumpToStart}
          onJumpEnd={handleJumpToEnd}
          onTrim={handleTrim}
          onResetTrim={handleResetTrimAt}
          onSelectClip={handleSelectClip}
          onAddZoom={handleAddZoom}
          onSelectZoom={handleSelectZoom}
          onDeleteZoom={handleDeleteZoom}
          onUpdateZoom={updateZoom}
          getLiveTime={getLivePreviewTime}
        />
      ) : mediaMode === "video" && !transpilingStarted && !transpilingFinished ? (
        <div className="flex h-11 shrink-0 items-center justify-center gap-2 border-t border-black/10 bg-white/60 px-4 text-center text-xs text-black/40">
          Add a video to start editing — drag a screen recording onto the device, or click it to browse.
        </div>
      ) : null}

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function ContextChip({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-black/45 transition-colors hover:bg-black/5 hover:text-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="font-mono text-black/70">{value}</span>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white/70 px-2 py-1 ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-blue-500">
      <span className="shrink-0 text-[11px] text-black/45">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(2))}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
        className="min-w-0 flex-1 bg-transparent text-right font-mono text-[11px] text-black/75 outline-none"
      />
      {suffix && <span className="shrink-0 text-[10px] text-black/35">{suffix}</span>}
    </label>
  );
}

function PanelTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={cn(
        "relative h-7 cursor-pointer rounded-md px-3 text-xs font-semibold transition-colors",
        active ? "bg-black/5 text-black/80" : "text-black/45 hover:text-black/70",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PanelSection({
  title,
  action,
  innerRef,
  children,
}: {
  title: string;
  action?: ReactNode;
  innerRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <section ref={innerRef} className="scroll-mt-3 rounded-lg bg-white/70 p-2.5 shadow-sm ring-1 ring-black/5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-black/40">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function HeaderIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-black/55 transition-colors hover:bg-black/5 hover:text-black/80 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
      )}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function BackIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
      <path
        fillRule="evenodd"
        d="M10.28 3.22a.75.75 0 0 1 0 1.06L6.56 8l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M6.22 3.22a.75.75 0 0 1 0 1.06L4.56 6h5.19a4.25 4.25 0 0 1 0 8.5h-1a.75.75 0 0 1 0-1.5h1a2.75 2.75 0 0 0 0-5.5H4.56l1.66 1.72a.75.75 0 1 1-1.06 1.06l-3-3a.75.75 0 0 1 0-1.06l3-3a.75.75 0 0 1 1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M9.78 3.22a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06L11.44 7.5H6.25a2.75 2.75 0 0 0 0 5.5h1a.75.75 0 0 1 0 1.5h-1a4.25 4.25 0 0 1 0-8.5h5.19L9.78 4.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function RailButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={cn(
        "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-colors",
        active ? "bg-black text-white shadow-sm" : "text-black/45 hover:bg-black/5 hover:text-black/70",
      )}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function ZoomPointPad({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const padRef = useRef<HTMLDivElement | null>(null);

  const updateFromPoint = useCallback((clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const nextX = Math.min(Math.max(((clientX - rect.left) / rect.width) * 100, 0), 100);
    const nextY = Math.min(Math.max(((clientY - rect.top) / rect.height) * 100, 0), 100);
    onChange(Math.round(nextX), Math.round(nextY));
  }, [onChange]);

  return (
    <div
      ref={padRef}
      className="relative aspect-square w-full rounded-md bg-stone-900/5 cursor-crosshair select-none"
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPoint(event.clientX, event.clientY);
      }}
      onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.buttons !== 1) return;
        updateFromPoint(event.clientX, event.clientY);
      }}
    >
      <div className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2">
        <div className="border-r border-b border-black/10" />
        <div className="border-b border-black/10" />
        <div className="border-r border-black/10" />
        <div />
      </div>
      <div
        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 shadow ring-2 ring-white"
        style={{ left: `${x}%`, top: `${y}%` }}
      />
    </div>
  );
}

function LogoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h4A1.5 1.5 0 0 1 10 3.5v9A1.5 1.5 0 0 1 8.5 14h-4A1.5 1.5 0 0 1 3 12.5v-9Z" />
      <path d="M11.2 5.4a.75.75 0 0 1 1.02-.3l1.3.75a1.5 1.5 0 0 1 .73 1.29v1.72a1.5 1.5 0 0 1-.73 1.29l-1.3.75a.75.75 0 0 1-1.02-.3.75.75 0 0 1 .3-1.02l1.25-.72V7.14L11.5 6.42a.75.75 0 0 1-.3-1.02Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path
        fillRule="evenodd"
        d="M9.58 1.077a.75.75 0 0 1 .405.82L9.165 6h4.085a.75.75 0 0 1 .567 1.241l-6.5 7.5a.75.75 0 0 1-1.302-.638L6.835 10H2.75a.75.75 0 0 1-.567-1.241l6.5-7.5a.75.75 0 0 1 .897-.182Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M4.25 2a.75.75 0 0 1 .75.75V4h6V2.75a.75.75 0 0 1 1.5 0V4h1.25a.75.75 0 0 1 0 1.5H12.5v5h1.25a.75.75 0 0 1 0 1.5H12.5v1.25a.75.75 0 0 1-1.5 0V12h-6v1.25a.75.75 0 0 1-1.5 0V12H2.25a.75.75 0 0 1 0-1.5H3.5v-5H2.25a.75.75 0 0 1 0-1.5H3.5V2.75A.75.75 0 0 1 4.25 2ZM5 5.5v5h6v-5H5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M2.75 3A1.75 1.75 0 0 0 1 4.75v6.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 15 11.25v-6.5A1.75 1.75 0 0 0 13.25 3H2.75ZM2.5 4.75a.25.25 0 0 1 .25-.25h10.5a.25.25 0 0 1 .25.25v6.5a.25.25 0 0 1-.25.25h-1.19l-2.53-2.53a1.75 1.75 0 0 0-2.47 0L4.06 11.5H2.75a.25.25 0 0 1-.25-.25v-6.5Zm3.5 1.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M5 2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5v11A1.5 1.5 0 0 1 9.5 15h-3A1.5 1.5 0 0 1 5 13.5v-11ZM6.5 2.5v11h3v-11h-3Z"
        clipRule="evenodd"
      />
      <path d="M7.25 12.25a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5Z" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M7 2.5a4.5 4.5 0 1 0 2.6 8.173l3.364 3.363a.75.75 0 1 0 1.06-1.06l-3.363-3.364A4.5 4.5 0 0 0 7 2.5ZM4 7a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
      <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
      <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
      <path
        fillRule="evenodd"
        d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
      <path
        fillRule="evenodd"
        d="M12.5 9.75A2.75 2.75 0 0 0 9.75 7H4.56l2.22 2.22a.75.75 0 1 1-1.06 1.06l-3.5-3.5a.75.75 0 0 1 0-1.06l3.5-3.5a.75.75 0 0 1 1.06 1.06L4.56 5.5h5.19a4.25 4.25 0 0 1 0 8.5h-1a.75.75 0 0 1 0-1.5h1a2.75 2.75 0 0 0 2.75-2.75Z"
        clipRule="evenodd"
      />
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
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path
        fillRule="evenodd"
        d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.712Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
