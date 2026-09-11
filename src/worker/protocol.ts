import type { BackgroundRemovalOutcome, ConvertOptions, PaletteId } from '../types';

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
  /** 仅在用户开启去背景时出现，见 types.ts 的 BackgroundRemovalOutcome。 */
  backgroundRemoval?: BackgroundRemovalOutcome;
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
