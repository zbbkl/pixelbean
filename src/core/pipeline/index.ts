import type { CellImage, ConvertOptions, Pattern } from '../../types';
import type { LoadedPalette } from '../palette/types';
import { placeContain } from './contain';
import { ditherFloydSteinberg } from './dither';
import { downsample } from './downsample';
import { limitColors } from './colorLimit';
import { matchGridDetailed } from './match';

export function convertPipeline(
  source: CellImage,
  options: ConvertOptions,
  palette: LoadedPalette
): Pattern {
  const contentWidth = options.contain?.contentWidth ?? options.width;
  const contentHeight = options.contain?.contentHeight ?? options.height;
  const contentOptions: ConvertOptions = {
    ...options,
    width: contentWidth,
    height: contentHeight,
    contain: undefined
  };

  const sampled = downsample(
    source,
    contentWidth,
    contentHeight,
    options.mode,
    options.bg,
    options.adjust
  );
  const cellImage: CellImage = {
    width: contentWidth,
    height: contentHeight,
    data: sampled
  };

  let pattern: Pattern;
  if (options.dither === 'floyd-steinberg' && options.maxColors === null) {
    pattern = ditherFloydSteinberg(cellImage, palette, contentOptions);
  } else {
    const matched = matchGridDetailed(cellImage, palette, contentOptions);
    pattern = matched.pattern;
    if (options.maxColors !== null) {
      pattern = limitColors(pattern, palette, options.maxColors, matched.details);
    }
  }

  if (options.contain) {
    pattern = placeContain(pattern, options.width, options.height);
  }
  return pattern;
}

export * from './geometry';
export * from './downsample';
export * from './match';
export * from './dither';
export * from './colorLimit';
export * from './contain';
