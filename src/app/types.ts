import type { CellImage } from '../types';
import type { BgMode, DitherMode, DownsampleMode } from '../types';

export type GridMode = 'long-edge' | 'square-board';

export interface AdjustUi {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface UiSettings {
  gridMode: GridMode;
  longEdge: number;
  boardSide: number;
  paletteId: string;
  bg: BgMode;
  mode: DownsampleMode;
  maxColorsEnabled: boolean;
  maxColors: number;
  dither: DitherMode;
  adjust: AdjustUi;
  showCodes: boolean;
  showGridLines: boolean;
}

export interface SourceImage extends CellImage {
  id: number;
  name: string;
  kind: 'upload' | 'sample';
  naturalWidth: number;
  naturalHeight: number;
  previewUrl: string;
  sampleId?: string;
}

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface HoverCell {
  x: number;
  y: number;
}
