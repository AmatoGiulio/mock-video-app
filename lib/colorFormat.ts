import { colors } from "@/lib/constants/colors";

export function normalizeColorHex(hex: string): string {
  const trimmed = hex.trim();
  const m6 = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (m6) return `#${m6[1].toLowerCase()}`;
  const m3 = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (m3) {
    const [r, g, b] = m3[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return colors[0];
}

export const defaultSolidColor = normalizeColorHex(colors[0]);

export const colorPickerSwatchInputClassName =
  "h-6 w-6 flex-shrink-0 cursor-pointer rounded-full border border-black/10 shadow-sm overflow-hidden p-0 bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none";
