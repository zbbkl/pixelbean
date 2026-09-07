import type { CellImage, ConvertOptions, Pattern } from '../../types';
import type { LoadedPalette } from '../palette/types';
import { placeContain } from './contain';
import { ditherFloydSteinberg } from './dither';
import { downsample } from './downsample';
import { downsampleWithFeatures, placeProtectMask } from './features';
import { limitColors } from './colorLimit';
import { matchGridDetailed } from './match';
import { isPostActive, runPostPipeline } from '../post';
import { regionClean } from '../post/regionClean';

export function convertPipeline(
  source: CellImage,
  options: ConvertOptions,
  palette: LoadedPalette,
  regionCleanEnabled = false
): Pattern {
  const contentWidth = options.contain?.contentWidth ?? options.width;
  const contentHeight = options.contain?.contentHeight ?? options.height;
  const contentOptions: ConvertOptions = {
    ...options,
    width: contentWidth,
    height: contentHeight,
    contain: undefined
  };

  const featuresEnabled = options.features?.enabled === true;
  let sampled: Uint8ClampedArray;
  let protect: Uint8Array | null = null;
  if (featuresEnabled) {
    const featured = downsampleWithFeatures(
      source,
      contentWidth,
      contentHeight,
      options.mode,
      options.bg,
      options.adjust
    );
    sampled = featured.cells;
    protect = featured.protect;
  } else {
    sampled = downsample(
      source,
      contentWidth,
      contentHeight,
      options.mode,
      options.bg,
      options.adjust
    );
  }
  const post = options.post;
  const postActive = isPostActive(post);
  const ditherRequested = options.dither === 'floyd-steinberg';
  const ditherPostConflict = ditherRequested && postActive && post !== undefined &&
    (post.shadowSimplify > 0 || post.maxColors !== null);
  const cellImage: CellImage = {
    width: contentWidth,
    height: contentHeight,
    data: sampled
  };

  let pattern: Pattern;
  if (ditherRequested && !ditherPostConflict) {
    pattern = ditherFloydSteinberg(cellImage, palette, contentOptions);
    protect = null; // 抖动路径不消费特征掩码（docs/19 §1.1/§4.6）
  } else {
    const matched = matchGridDetailed(cellImage, palette, contentOptions);
    pattern = matched.pattern;
    if (options.maxColors !== null && !postActive) {
      pattern = limitColors(pattern, palette, options.maxColors, matched.details);
    }
  }

  if (regionCleanEnabled) {
    pattern = regionClean(pattern, palette, protect);
  }
  if (options.contain) {
    pattern = placeContain(pattern, options.width, options.height);
    protect = placeProtectMask(protect, contentWidth, contentHeight, options.width, options.height);
  }
  if (postActive && post) {
    pattern = runPostPipeline(pattern, palette, post, protect);
  }
  return pattern;
}

export * from './geometry';
export * from './downsample';
export * from './features';
export * from './match';
export * from './dither';
export * from './colorLimit';
export * from './contain';
export * from '../post';
export * from '../post/regionClean';
