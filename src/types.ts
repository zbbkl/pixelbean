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
  adjust?: AdjustOptions;
  post?: PostOptions;
  features?: { enabled: boolean };
  contain?: {
    contentWidth: number;
    contentHeight: number;
  };
}

export interface Pattern {
  paletteId: PaletteId;
  width: number;
  height: number;
  cells: Int16Array;
  codes: string[];
  options: ConvertOptions;
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
