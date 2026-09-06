import type { CellImage } from '../types';
export type { AdjustUi, GridMode, TargetMode, UiSettings } from '../types';

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

export type MobileSection = 'params' | 'preview' | 'stats';
