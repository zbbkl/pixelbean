import type { AdjustOptions } from '../../types';

export function adjustRgb(
  rgb: readonly [number, number, number],
  options: AdjustOptions
): [number, number, number] {
  const brightness = options.brightness / 100;
  const contrast = 1 + options.contrast / 100;
  const saturation = 1 + options.saturation / 100;

  let channels = rgb.map((v) => v / 255) as [number, number, number];
  channels = channels.map((c) => c + brightness) as [number, number, number];
  channels = channels.map((c) => (c - 0.5) * contrast + 0.5) as [number, number, number];
  const luma = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  channels = channels.map((c) => luma + (c - luma) * saturation) as [number, number, number];

  return channels.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255)) as [number, number, number];
}
