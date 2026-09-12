export type PaletteId = string;
export type BgMode = 'white' | 'black';
export type DownsampleMode = 'average' | 'dominant';
export type DitherMode = 'none' | 'floyd-steinberg';
export type GridMode = 'long-edge' | 'square-board';
export type TargetMode = 'photo' | 'cartoon' | 'lineart' | 'pixel' | 'custom';

export interface AdjustOptions {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface PostOptions {
  speckleClean: boolean;
  speckleMax: number;
  speckleDeltaE: number;
  shadowSimplify: 0 | 1 | 2;
  maxColors: number | null;
  outline: boolean;
  outlineTau: number;
}

export interface AdjustUi {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface UiSettings {
  targetMode: TargetMode;
  gridMode: GridMode;
  longEdge: number;
  boardSide: number;
  paletteId: PaletteId;
  bg: BgMode;
  mode: DownsampleMode;
  maxColorsEnabled: boolean;
  maxColors: number;
  dither: DitherMode;
  adjust: AdjustUi;
  speckleClean: boolean;
  speckleMax: number;
  speckleDeltaE: number;
  shadowSimplify: 0 | 1 | 2;
  outline: boolean;
  outlineTau: number;
  protectFeatures: boolean;
  removeBackground: boolean;
  /** 可选 AI 抠图（增强）：首次需下载模型；与 removeBackground 互斥。 */
  aiBackground: boolean;
  /** AI 抠图档位 id（见 worker/aiModel.ts 的 AI_MODELS）；未设置时用默认档。 */
  aiModel: string;
  showCodes: boolean;
  showGridLines: boolean;
}

/**
 * width/height 是图纸总网格尺寸。方形底板 contain 模式通过 contain.content* 保留
 * 实际内容网格；无 contain 时 width/height 即内容尺寸。
 */
export interface ConvertOptions {
  paletteId: PaletteId;
  width: number;
  height: number;
  bg: BgMode;
  mode: DownsampleMode;
  maxColors: number | null;
  dither: DitherMode;
  removeBackground?: boolean;
  /** 可选 AI 抠图：由 worker 内的 ONNX 推理给出掩码（见 docs/45）；与 removeBackground 互斥。 */
  aiBackground?: boolean;
  /** AI 抠图档位（见 worker/aiModel.ts 的 AI_MODELS）。 */
  aiModel?: string;
  adjust?: AdjustOptions;
  post?: PostOptions;
  features?: { enabled: boolean };
  contain?: {
    contentWidth: number;
    contentHeight: number;
  };
}

/**
 * 去背景实际结果：
 * - `applied`：确定性抠图可信、已按主体出图；
 * - `applied-ai`：**可选 AI 抠图**可信、已按主体出图（docs/45）；
 * - `fallback`：用户开了开关，但抠图**不可信**（可靠度兜底触发）→ 已完全按「未去背景」处理。
 *
 * 仅在用户开启去背景（确定性或 AI）时出现该字段（关闭态不带，保证关闭态输出与上一版逐格一致）。
 */
export type BackgroundRemovalOutcome = 'applied' | 'applied-ai' | 'fallback';

export interface Pattern {
  paletteId: PaletteId;
  width: number;
  height: number;
  cells: Int16Array;
  codes: string[];
  options: ConvertOptions;
  backgroundRemoval?: BackgroundRemovalOutcome;
}

export interface ColorStat {
  index: number;
  code: string;
  name: string | null;
  hex: string | null;
  count: number;
  ratio: number;
}

export interface CellImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
