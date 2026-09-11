import { convertPipeline } from '../core/pipeline';
import { loadPalette } from '../core/palette/loader';
import type { CellImage } from '../types';
import type { ConvertError, ConvertRequest, ConvertResult } from './protocol';

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<ConvertRequest>) => {
  const request = event.data;
  if (!request || request.kind !== 'convert') return;
  try {
    const palette = loadPalette(request.palette);
    const source: CellImage = {
      width: request.source.width,
      height: request.source.height,
      data: new Uint8ClampedArray(request.source.data)
    };
    const pattern = convertPipeline(source, request.options, palette);
    const result: ConvertResult = {
      seq: request.seq,
      kind: 'result',
      pattern: {
        paletteId: pattern.paletteId,
        width: pattern.width,
        height: pattern.height,
        cells: pattern.cells.buffer as ArrayBuffer,
        codes: pattern.codes,
        options: pattern.options,
        backgroundRemoval: pattern.backgroundRemoval
      }
    };
    worker.postMessage(result, [pattern.cells.buffer]);
  } catch (error) {
    const payload: ConvertError = {
      seq: request.seq,
      kind: 'error',
      message: error instanceof Error ? error.message : '转换失败'
    };
    worker.postMessage(payload);
  }
};
