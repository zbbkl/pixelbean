import type { ConvertOptions, PaletteId } from '../types';

export interface ConvertRequest {
  seq: number;
  kind: 'convert';
  source: {
    width: number;
    height: number;
    data: ArrayBuffer;
  };
  options: ConvertOptions;
  palette: unknown;
}

export interface PatternPayload {
  paletteId: PaletteId;
  width: number;
  height: number;
  cells: ArrayBuffer;
  codes: string[];
  options: ConvertOptions;
}

export interface ConvertResult {
  seq: number;
  kind: 'result';
  pattern: PatternPayload;
}

export interface ConvertError {
  seq: number;
  kind: 'error';
  message: string;
}
