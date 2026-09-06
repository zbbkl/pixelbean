import type { Pattern, PostOptions } from '../../types';
import type { LoadedPalette } from '../palette/types';
import { clusterLimit } from './clusterLimit';
import { outline } from './outline';
import { shadowSimplify } from './shadowSimplify';
import { speckleClean } from './speckle';

export function isPostActive(post: PostOptions | undefined): boolean {
  if (!post) return false;
  return (
    post.speckleClean ||
    post.shadowSimplify > 0 ||
    post.maxColors !== null ||
    post.outline
  );
}

/**
 * docs/03 §9.0 固定顺序：噪点清理 → 暗部简化 → 智能限色 → 自动描边。
 */
export function runPostPipeline(
  pattern: Pattern,
  palette: LoadedPalette,
  post: PostOptions
): Pattern {
  let result = pattern;
  if (post.speckleClean) {
    result = speckleClean(
      result,
      palette,
      Math.max(1, Math.min(3, post.speckleMax)),
      Math.max(20, Math.min(40, post.speckleDeltaE))
    );
  }
  if (post.shadowSimplify > 0) {
    result = shadowSimplify(result, palette, post.shadowSimplify);
  }
  if (post.maxColors !== null) {
    result = clusterLimit(result, palette, Math.max(1, Math.floor(post.maxColors)));
  }
  if (post.outline) {
    result = outline(result, palette, Math.max(0.1, Math.min(0.3, post.outlineTau)));
  }
  return result;
}

export * from './modePresets';
export * from './speckle';
export * from './shadowSimplify';
export * from './clusterLimit';
export * from './outline';
