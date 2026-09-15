import { defaultAspectRatio, defaultDeviceGapPercent, defaultMockup } from "@/lib/appDefaults";
import { defaultSolidColor } from "@/lib/colorFormat";
import { mockupsDefs } from "@/lib/constants/mockups";
import { aspectRatios } from "@/lib/constants/sizes";
import type { ExportFormat } from "@/lib/hooks/useMediabunny";
import { DEFAULT_ZOOM_DURATION, MIN_ZOOM_DURATION, type ZoomEasing, type ZoomKeyframe } from "@/lib/zoomEffect";

export type DeviceCount = 1 | 2 | 3;
export type BgTab = "color" | "gradient" | "image";
export type ExportPreset = "standard" | "x";
export type Gradient = { from: string; to: string; angle: number };

/**
 * The undoable + persistable slice of the editor. Media files (video/image
 * blobs) are intentionally excluded: they live in IndexedDB and are keyed
 * separately so history snapshots stay small and serializable.
 */
export type EditorDocument = {
  selectedMockupName: string;
  scale: number;
  videoScale: number;
  verticalOffset: number;
  selectedFramerate: number;
  exportFormat: ExportFormat;
  exportPreset: ExportPreset;
  selectedAspectRatioName: string;
  deviceCount: DeviceCount;
  deviceGapPercent: number;
  loopShorter: boolean;
  bgTab: BgTab;
  solidColor: string;
  gradient: Gradient;
  videoStartOffsets: number[];
  videoEndOffsets: number[];
  zoomKeyframes: ZoomKeyframe[];
};

export const EDITOR_DOCUMENT_VERSION = 1;
export const PERSISTED_DOCUMENT_VERSION = 1;

export function createDefaultDocument(deviceCount: DeviceCount = 1): EditorDocument {
  return {
    selectedMockupName: defaultMockup.name,
    scale: 90,
    videoScale: 100,
    verticalOffset: 0,
    selectedFramerate: 30,
    exportFormat: "mp4",
    exportPreset: "standard",
    selectedAspectRatioName: defaultAspectRatio.name,
    deviceCount,
    deviceGapPercent: defaultDeviceGapPercent,
    loopShorter: true,
    bgTab: "color",
    solidColor: defaultSolidColor,
    gradient: { from: "#a5f3fc", to: "#f5d0fe", angle: 135 },
    videoStartOffsets: Array(deviceCount).fill(0),
    videoEndOffsets: Array(deviceCount).fill(0),
    zoomKeyframes: [],
  };
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function asNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asDeviceCount(value: unknown): DeviceCount {
  return value === 2 || value === 3 ? value : 1;
}

function asColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : fallback;
}

function sanitizeGradient(value: unknown, fallback: Gradient): Gradient {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  return {
    from: asColor(raw.from, fallback.from),
    to: asColor(raw.to, fallback.to),
    angle: Math.min(Math.max(asNumber(raw.angle, fallback.angle), 0), 360),
  };
}

function sanitizeOffsets(value: unknown, length: number, fallback: number[]): number[] {
  if (!Array.isArray(value)) return Array.from({ length }, (_, i) => fallback[i] ?? 0);
  return Array.from({ length }, (_, i) => Math.max(asNumber(value[i], fallback[i] ?? 0), 0));
}

function sanitizeZoom(value: unknown): ZoomKeyframe | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string") return null;
  const start = Math.max(asNumber(raw.start, 0), 0);
  const end = Math.max(asNumber(raw.end, start + DEFAULT_ZOOM_DURATION), start + MIN_ZOOM_DURATION);
  const easing: ZoomEasing = raw.easing === "linear" ? "linear" : "easeInOut";
  return {
    id: raw.id,
    pointX: Math.min(Math.max(asNumber(raw.pointX, 50), 0), 100),
    pointY: Math.min(Math.max(asNumber(raw.pointY, 50), 0), 100),
    scale: Math.min(Math.max(asNumber(raw.scale, 1.8), 1), 3),
    start,
    end,
    easeIn: Math.min(Math.max(asNumber(raw.easeIn, 0.4), 0), 2),
    easeOut: Math.min(Math.max(asNumber(raw.easeOut, 0.4), 0), 2),
    easing,
    target: raw.target === "device" ? "device" : "scene",
    offsetX: Math.min(Math.max(asNumber(raw.offsetX, 0), -100), 100),
    offsetY: Math.min(Math.max(asNumber(raw.offsetY, 0), -100), 100),
  };
}

/**
 * Defensive parse of an untrusted document (localStorage, future imports).
 * Unknown/invalid fields fall back to defaults; the result is always a valid
 * EditorDocument.
 */
export function sanitizeDocument(input: unknown, fallbackDeviceCount: DeviceCount = 1): EditorDocument {
  const fallback = createDefaultDocument(fallbackDeviceCount);
  if (!input || typeof input !== "object") return fallback;
  const raw = input as Record<string, unknown>;

  const deviceCount = asDeviceCount(raw.deviceCount);
  const mockupName = mockupsDefs.some((mockup) => mockup.name === raw.selectedMockupName)
    ? (raw.selectedMockupName as string)
    : fallback.selectedMockupName;
  const aspectName = aspectRatios.some((ratio) => ratio.name === raw.selectedAspectRatioName)
    ? (raw.selectedAspectRatioName as string)
    : fallback.selectedAspectRatioName;
  const exportFormat: ExportFormat = raw.exportFormat === "webm-transparent" ? "webm-transparent" : "mp4";
  const exportPreset: ExportPreset = raw.exportPreset === "x" ? "x" : "standard";
  const bgTab: BgTab = raw.bgTab === "gradient" || raw.bgTab === "image" ? raw.bgTab : "color";
  const framerate = asNumber(raw.selectedFramerate, fallback.selectedFramerate) === 60 ? 60 : 30;
  const zoomKeyframes = Array.isArray(raw.zoomKeyframes)
    ? (raw.zoomKeyframes.map(sanitizeZoom).filter((zoom): zoom is ZoomKeyframe => zoom !== null))
    : [];

  return {
    selectedMockupName: mockupName,
    scale: Math.min(Math.max(asNumber(raw.scale, fallback.scale), 30), 150),
    videoScale: Math.min(Math.max(asNumber(raw.videoScale, fallback.videoScale), 50), 200),
    verticalOffset: Math.min(Math.max(asNumber(raw.verticalOffset, fallback.verticalOffset), -100), 100),
    selectedFramerate: framerate,
    exportFormat,
    exportPreset,
    selectedAspectRatioName: aspectName,
    deviceCount,
    deviceGapPercent: Math.min(Math.max(asNumber(raw.deviceGapPercent, fallback.deviceGapPercent), 0), 12),
    loopShorter: asBoolean(raw.loopShorter, fallback.loopShorter),
    bgTab,
    solidColor: asColor(raw.solidColor, fallback.solidColor),
    gradient: sanitizeGradient(raw.gradient, fallback.gradient),
    videoStartOffsets: sanitizeOffsets(raw.videoStartOffsets, deviceCount, fallback.videoStartOffsets),
    videoEndOffsets: sanitizeOffsets(raw.videoEndOffsets, deviceCount, fallback.videoEndOffsets),
    zoomKeyframes,
  };
}

/** Serialize only the persistable fields (drops nothing today, but keeps a stable shape). */
export function serializeDocument(doc: EditorDocument): string {
  return JSON.stringify({ version: PERSISTED_DOCUMENT_VERSION, document: doc });
}
