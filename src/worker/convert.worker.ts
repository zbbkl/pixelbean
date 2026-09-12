import { convertPipeline } from '../core/pipeline';
import { loadPalette } from '../core/palette/loader';
import type { CellImage } from '../types';
import { AI_MODEL_ISNET_INT8, runAiMask, type AiProgress } from './aiModel';
import type { ConvertError, ConvertProgress, ConvertRequest, ConvertResult } from './protocol';

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<ConvertRequest>) => {
  const request = event.data;
  if (!request || request.kind !== 'convert') return;
  void handle(request);
};

async function handle(request: ConvertRequest): Promise<void> {
  const post = (payload: ConvertProgress) => worker.postMessage(payload);
  try {
    const palette = loadPalette(request.palette);
    const source: CellImage = {
      width: request.source.width,
      height: request.source.height,
      data: new Uint8ClampedArray(request.source.data)
    };

    // 可选 AI 抠图：先跑推理拿到掩码，再走与确定性路径相同的管线与可靠度门。
    // 任何失败（离线 / 校验失败 / 后端不可用）都**不抛给用户**，而是落回确定性路径，
    // 保持「绝不吞主体、不产空图纸」的红线（docs/45 §0）。
    let aiMask = null;
    let aiFailed = false;
    if (request.options.aiBackground === true) {
      try {
        aiMask = await runAiMask(source, AI_MODEL_ISNET_INT8, (progress: AiProgress) =>
          post({
            seq: request.seq,
            kind: 'progress',
            stage: progress.stage,
            loaded: progress.stage === 'download' ? progress.loaded : undefined,
            total: progress.stage === 'download' ? progress.total : undefined
          })
        );
      } catch (error) {
        aiFailed = true;
        aiMask = null;
        // 失败原因必须可见（否则线上只会表现为「开关没反应」）；UI 侧仍按兜底处理。
        console.warn(
          '[AI 抠图] 推理失败，已落回确定性抠图：',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const pattern = convertPipeline(
      source,
      // AI 失败时退回确定性抠图（开关仍然生效，只是换算法）
      aiFailed ? { ...request.options, aiBackground: false } : request.options,
      palette,
      false,
      aiMask
    );
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
}
