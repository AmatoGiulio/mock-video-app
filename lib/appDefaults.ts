import { mockupsDefs, type Mockup } from "@/lib/constants/mockups";
import { aspectRatios } from "@/lib/constants/sizes";

export const mockupGroups = Array.from(new Set(mockupsDefs.map((mockup) => mockup.group)));

export const defaultAspectRatio = aspectRatios.find((ratio) => ratio.name.startsWith("4:3")) ?? aspectRatios[0];

export const defaultMockup = mockupsDefs.find((mockup) => mockup.name === "iPhone 15 Pro") ?? mockupsDefs[0];

export const defaultDeviceGapPercent = 2;

export function getMockupPreviewInnerX(mockup: Mockup): number {
  return mockup.innerX ?? (mockup.width - mockup.innerWidth) / 2;
}

export function getMockupPreviewInnerY(mockup: Mockup): number {
  return mockup.innerY ?? (mockup.height - mockup.innerHeight) * 0.4;
}

export function widthFractionForDevices(deviceCount: number, deviceGapPercent: number): number {
  if (deviceCount <= 1) return 1;
  return (1 - ((deviceCount - 1) * deviceGapPercent) / 100) / deviceCount;
}
