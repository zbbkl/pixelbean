import { MAX_SOURCE_EDGE, MAX_SOURCE_PIXELS } from './options';
import type { SourceImage } from './types';

let sourceSeq = 1;

function waitForImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败，请确认文件未损坏'));
    img.src = url;
    if (typeof src !== 'string') {
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
    }
  });
}

function sampledSize(width: number, height: number): { width: number; height: number } {
  const edgeScale = Math.min(1, MAX_SOURCE_EDGE / Math.max(width, height));
  let outW = Math.max(1, Math.round(width * edgeScale));
  let outH = Math.max(1, Math.round(height * edgeScale));
  const pixelScale = Math.min(1, Math.sqrt(MAX_SOURCE_PIXELS / (outW * outH)));
  outW = Math.max(1, Math.round(outW * pixelScale));
  outH = Math.max(1, Math.round(outH * pixelScale));
  return { width: outW, height: outH };
}

function decodeAndSample(img: HTMLImageElement, name: string, kind: SourceImage['kind'], previewUrl: string, sampleId?: string): SourceImage {
  const { naturalWidth, naturalHeight } = img;
  if (naturalWidth > 12000 || naturalHeight > 12000) {
    throw new Error('源图单边超过 12000px，已拒绝载入以避免浏览器崩溃；请先用图片工具缩小');
  }
  const size = sampledSize(naturalWidth, naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D 不可用');
  ctx.drawImage(img, 0, 0, size.width, size.height);
  const imageData = ctx.getImageData(0, 0, size.width, size.height);
  return {
    id: sourceSeq++,
    name,
    kind,
    width: size.width,
    height: size.height,
    naturalWidth,
    naturalHeight,
    data: imageData.data,
    previewUrl,
    sampleId
  };
}

export async function loadImageFile(file: File): Promise<SourceImage> {
  const img = await waitForImage(file);
  const url = URL.createObjectURL(file);
  return decodeAndSample(img, file.name, 'upload', url);
}

export async function loadSampleImage(url: string, label: string, sampleId: string): Promise<SourceImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`示例图加载失败（${response.status}）`);
  const blob = await response.blob();
  const img = await waitForImage(blob);
  return decodeAndSample(img, label, 'sample', url, sampleId);
}
