import type { ColorNorm } from './color.js';
import { transparent } from './color.js';
import { splitTopLevel } from './util.js';

export // `inset` layers (sharp or blurred); null never — kept nullable for callers.
const parseInsetShadows = (value: string, norm: ColorNorm) => {
  if (!value || value === 'none') return [];
  const out: { offsetX: number; offsetY: number; spread: number; color: string; blur?: number }[] = [];
  const COLOR_FN = /((?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)/;
  for (const part of splitTopLevel(value)) {
    if (!part.includes('inset')) continue;
    const body = part.replace(/\binset\b/, '');
    const colorMatch = body.match(COLOR_FN);
    const color = norm(colorMatch ? colorMatch[0] : 'rgba(0,0,0,0.2)');
    const v = (body.replace(COLOR_FN, '').match(/-?\d*\.?\d+px/g) || []).map((x) => parseFloat(x));
    if (!transparent(color)) out.push({ offsetX: v[0] || 0, offsetY: v[1] || 0, spread: v[3] || 0, color, blur: v[2] || undefined });
  }
  return out;
};

export const parseShadows = (value: string, norm: ColorNorm) => {
  if (!value || value === 'none') return [];
  // Only emit outset layers; inset layers are handled as raster by needsBoxRaster.
  // Filter before parsing so a mix of outset + inset keeps the outset shadows.
  const parts = splitTopLevel(value).filter((p) => !p.includes('inset'));
  if (parts.length === 0) return [];
  const out: { offsetX: number; offsetY: number; blur: number; spread: number; color: string }[] = [];
  const COLOR_FN = /((?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)/;
  for (const part of parts) {
    const colorMatch = part.match(COLOR_FN);
    const color = norm(colorMatch ? colorMatch[0] : 'rgba(0,0,0,0.2)');
    const nums = part.replace(COLOR_FN, '').match(/-?\d*\.?\d+px/g) || [];
    const v = nums.map((s) => parseFloat(s));
    out.push({ offsetX: v[0] || 0, offsetY: v[1] || 0, blur: v[2] || 0, spread: v[3] || 0, color });
  }
  return out;
};
