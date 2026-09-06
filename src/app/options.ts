import type { ConvertOptions } from '../types';
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

export function resolveRequest(source: SourceImage, settings: UiSettings): ResolvedRequest {
  const { gridMode, longEdge, boardSide, maxColorsEnabled, maxColors } = settings;
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
      adjust: settings.adjust
    }
  };
}

export function gridCellCount(resolved: ResolvedRequest): number {
  return resolved.options.width * resolved.options.height;
}
