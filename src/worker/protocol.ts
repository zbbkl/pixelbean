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

/**
 * 可选 AI 抠图的进度回报（仅在 options.aiBackground 且该次转换走 AI 路径时出现）。
 * `stage`：download = 自托管模型下载中（loaded/total 供进度条）；verify = sha256 校验；
 * inference = 模型推理中。UI 据此显示进度，不阻塞主线程。
 */
export interface ConvertProgress {
  seq: number;
  kind: 'progress';
  stage: 'download' | 'verify' | 'inference';
  loaded?: number;
  total?: number;
}
