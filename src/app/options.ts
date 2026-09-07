import type { ConvertOptions, PostOptions } from '../types';
import { deriveContainContent, deriveLongEdgeGrid } from '../core/pipeline/geometry';
import type { SourceImage, UiSettings } from './types';

export const MAX_CELLS = 150_000;
export const MAX_SOURCE_EDGE = 4096;
export const MAX_SOURCE_PIXELS = 16_000_000;

export interface ResolvedRequest {
  options: ConvertOptions;
  contentWidth: number;
  contentHeight: number;
}

export function postFromSettings(settings: UiSettings): PostOptions | undefined {
  const maxColors = settings.maxColorsEnabled ? settings.maxColors : null;
  const post: PostOptions = {
    speckleClean: settings.speckleClean,
    speckleMax: settings.speckleMax,
    speckleDeltaE: settings.speckleDeltaE,
    shadowSimplify: settings.shadowSimplify,
    maxColors,
    outline: settings.outline,
    outlineTau: settings.outlineTau
  };
  const active = post.speckleClean || post.shadowSimplify > 0 || maxColors !== null || post.outline;
  return active ? post : undefined;
}

export function resolveRequest(source: SourceImage, settings: UiSettings): ResolvedRequest {
  const { gridMode, longEdge, boardSide, maxColorsEnabled, maxColors } = settings;
  const post = postFromSettings(settings);
  const features = settings.protectFeatures ? { features: { enabled: true } } : {};
  if (gridMode === 'square-board') {
    const content = deriveContainContent(source.naturalWidth, source.naturalHeight, boardSide, boardSide);
    return {
      contentWidth: content.width,
      contentHeight: content.height,
      options: {
        paletteId: settings.paletteId,
        width: boardSide,
        height: boardSide,
        bg: settings.bg,
        mode: settings.mode,
        maxColors: maxColorsEnabled ? maxColors : null,
        dither: settings.dither,
        adjust: settings.adjust,
        post,
        ...features,
        contain: {
          contentWidth: content.width,
          contentHeight: content.height
        }
      }
    };
  }
  const grid = deriveLongEdgeGrid(source.naturalWidth, source.naturalHeight, longEdge);
  return {
    contentWidth: grid.width,
    contentHeight: grid.height,
    options: {
      paletteId: settings.paletteId,
      width: grid.width,
      height: grid.height,
      bg: settings.bg,
      mode: settings.mode,
      maxColors: maxColorsEnabled ? maxColors : null,
      dither: settings.dither,
      adjust: settings.adjust,
      post,
      ...features
    }
  };
}

export function gridCellCount(resolved: ResolvedRequest): number {
  return resolved.options.width * resolved.options.height;
}
