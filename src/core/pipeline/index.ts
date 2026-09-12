import type { CellImage, ConvertOptions, Pattern } from '../../types';
import type { LoadedPalette } from '../palette/types';
import { placeContain } from './contain';
import { deriveContainContent } from './geometry';
import { ditherFloydSteinberg } from './dither';
import { downsample } from './downsample';
import { downsampleWithFeatures, placeProtectMask } from './features';
import { limitColors } from './colorLimit';
import { matchGridDetailed } from './match';
import {
  downsampleMask,
  extractSubject,
  extractSubjectFromAIMask,
  type AIMaskInput,
  type SubjectResult
} from './subject';
import { isPostActive, runPostPipeline } from '../post';
import { regionClean } from '../post/regionClean';
import { mergeAdjacent } from '../post/merge';

function clearBackgroundCells(pattern: Pattern, subjectMask: Uint8Array): Pattern {
  let changed = false;
  const cells = new Int16Array(pattern.cells);
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i] >= 0 && subjectMask[i] === 0) {
      cells[i] = -1;
      changed = true;
    }
  }
  return changed ? { ...pattern, cells } : pattern;
}

function clearProtectOutside(protect: Uint8Array | null, subjectMask: Uint8Array): Uint8Array | null {
  if (!protect) return null;
  const out = new Uint8Array(protect);
  for (let i = 0; i < out.length; i += 1) {
    if (subjectMask[i] === 0) out[i] = 0;
  }
  return out;
}

function cropImage(image: CellImage, bbox: SubjectResult['bbox']): CellImage | null {
  if (!bbox) return null;
  const width = bbox.x1 - bbox.x0 + 1;
  const height = bbox.y1 - bbox.y0 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = (bbox.y0 + y) * image.width * 4;
    const targetRow = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = sourceRow + (bbox.x0 + x) * 4;
      const targetOffset = targetRow + x * 4;
      data[targetOffset] = image.data[sourceOffset];
      data[targetOffset + 1] = image.data[sourceOffset + 1];
      data[targetOffset + 2] = image.data[sourceOffset + 2];
      data[targetOffset + 3] = image.data[sourceOffset + 3];
    }
  }
  return { width, height, data };
}

function cropMask(mask: Uint8Array, maskWidth: number, bbox: SubjectResult['bbox']): Uint8Array | null {
  if (!bbox) return null;
  const width = bbox.x1 - bbox.x0 + 1;
  const height = bbox.y1 - bbox.y0 + 1;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = (bbox.y0 + y) * maskWidth + bbox.x0;
    out.set(mask.subarray(sourceRow, sourceRow + width), y * width);
  }
  return out;
}

export function convertPipeline(
  source: CellImage,
  options: ConvertOptions,
  palette: LoadedPalette,
  regionCleanEnabled = false,
  /**
   * 可选 AI 抠图掩码（由 worker 内的 ONNX 推理给出，见 docs/45）。给了就走 AI 路径，
   * 与确定性路径**共用同一道可靠度门与红线**。
   */
  aiMask: AIMaskInput | null = null
): Pattern {
  // 「是否要抠图」与「用哪种算法」是两件事：UI 里两个开关互斥只是选择算法，
  // 所以 aiBackground=true 而 removeBackground=false 时**仍然要抠图**（走 AI 掩码）。
  const wantRemoval = options.removeBackground === true || options.aiBackground === true;
  const subjectRaw: SubjectResult | null = wantRemoval
    ? aiMask
      ? extractSubjectFromAIMask(source, aiMask)
      : extractSubject(source)
    : null;
  // A.2：抠图不可信 → 完全按「未去背景」处理（等价 removeBackground=false），
  // 保证默认开启也绝不吞主体、不产空图纸。
  const subject: SubjectResult | null = subjectRaw && subjectRaw.reliable ? subjectRaw : null;
  let contentWidth = options.contain?.contentWidth ?? options.width;
  let contentHeight = options.contain?.contentHeight ?? options.height;
  let maskSource: Uint8Array | null = subject?.mask ?? null;
  let sampleSource: CellImage;
  if (subject?.bbox && options.contain) {
    const bboxW = subject.bbox.x1 - subject.bbox.x0 + 1;
    const bboxH = subject.bbox.y1 - subject.bbox.y0 + 1;
    const box = deriveContainContent(bboxW, bboxH, options.width, options.height);
    contentWidth = box.width;
    contentHeight = box.height;
    const cropped = cropImage(
      { width: source.width, height: source.height, data: subject.cells },
      subject.bbox
    );
    sampleSource = cropped ?? { width: source.width, height: source.height, data: subject.cells };
    maskSource = cropMask(subject.mask, source.width, subject.bbox);
  } else {
    sampleSource = subject
      ? { width: source.width, height: source.height, data: subject.cells }
      : source;
  }
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
      sampleSource,
      contentWidth,
      contentHeight,
      options.mode,
      options.bg,
      options.adjust,
      wantRemoval ? { transparentSource: true } : {}
    );
    sampled = featured.cells;
    protect = featured.protect;
  } else {
    sampled = downsample(
      sampleSource,
      contentWidth,
      contentHeight,
      options.mode,
      options.bg,
      options.adjust,
      wantRemoval ? { transparentSource: true } : {}
    );
  }
  const subjectMask = maskSource
    ? downsampleMask(maskSource, sampleSource.width, sampleSource.height, contentWidth, contentHeight)
    : null;
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
  let matchedDetails: ReturnType<typeof matchGridDetailed>['details'] | null = null;
  if (ditherRequested && !ditherPostConflict) {
    pattern = ditherFloydSteinberg(cellImage, palette, contentOptions);
    protect = null; // 抖动路径不消费特征掩码（docs/19 §1.1/§4.6）
  } else {
    const matched = matchGridDetailed(cellImage, palette, contentOptions);
    pattern = matched.pattern;
    matchedDetails = matched.details;
  }
  if (subjectMask) {
    pattern = clearBackgroundCells(pattern, subjectMask);
    protect = clearProtectOutside(protect, subjectMask);
  }
  if (matchedDetails && options.maxColors !== null && !postActive) {
    pattern = limitColors(pattern, palette, options.maxColors, matchedDetails);
  }

  const mergeEnabled = featuresEnabled && options.mode === 'dominant' && !postActive;
  if (mergeEnabled) {
    pattern = mergeAdjacent(pattern, palette, protect);
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
  // 仅在用户开启去背景时标注实际结果：界面据此在「不可信回退」时给出提示，
  // 而不是静默什么都不做（关闭态不带该字段，保证关闭态输出与上一版逐格一致）。
  if (wantRemoval) {
    pattern.backgroundRemoval = subject ? (aiMask ? 'applied-ai' : 'applied') : 'fallback';
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
export * from './subject';
export * from '../post';
export * from '../post/regionClean';
export * from '../post/merge';

