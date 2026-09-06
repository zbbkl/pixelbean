import type { PaletteSet } from '../core/palette/types';
import { loadSampleImage } from './image';
import { sampleOptions } from './samples';
import type { SourceImage, UiSettings } from './types';

const KEY = 'pixelbean-draft-v1';

export interface DraftSourceMeta {
  sampleId?: string;
  name?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  thumbnail?: string;
}

export interface Draft {
  settings: UiSettings;
  customPalettes: PaletteSet[];
  source?: DraftSourceMeta;
}

async function thumbnailDataUrl(source: SourceImage): Promise<string | null> {
  const canvas = document.createElement('canvas');
  const max = 512;
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const bitmap = await createImageBitmap(
    (() => {
      const buffer = new ArrayBuffer(source.data.byteLength);
      const data = new Uint8ClampedArray(buffer);
      data.set(source.data);
      return new ImageData(data, source.width, source.height);
    })(),
    { resizeWidth: canvas.width, resizeHeight: canvas.height }
  );
  ctx.drawImage(bitmap, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
  return dataUrl.length < 1_500_000 ? dataUrl : null;
}

export async function saveDraft(source: SourceImage | null, settings: UiSettings, palettes: Record<string, PaletteSet>): Promise<void> {
  const customPalettes = Object.values(palettes).filter((palette) => palette.id !== 'mard-291');
  const draft: Draft = { settings, customPalettes };
  if (source) {
    draft.source = {
      sampleId: source.sampleId,
      name: source.name,
      naturalWidth: source.naturalWidth,
      naturalHeight: source.naturalHeight
    };
    if (source.kind === 'upload') {
      const thumbnail = await thumbnailDataUrl(source);
      if (thumbnail) draft.source.thumbnail = thumbnail;
    }
  }
  localStorage.setItem(KEY, JSON.stringify(draft));
}

export function loadDraft(): Draft | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? (JSON.parse(text) as Draft) : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  localStorage.removeItem(KEY);
}

export async function draftSource(draft: Draft): Promise<SourceImage | null> {
  const meta = draft.source;
  if (!meta) return null;
  if (meta.sampleId) {
    const sample = sampleOptions.find((item) => item.id === meta.sampleId);
    return sample ? loadSampleImage(sample.url, sample.label, sample.id) : null;
  }
  if (!meta.thumbnail) return null;
  const image = new Image();
  image.src = meta.thumbnail;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('草稿缩略图无法载入'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    id: Date.now(),
    name: meta.name ?? '草稿图片',
    kind: 'upload',
    width: canvas.width,
    height: canvas.height,
    naturalWidth: meta.naturalWidth ?? canvas.width,
    naturalHeight: meta.naturalHeight ?? canvas.height,
    data: pixels.data,
    previewUrl: meta.thumbnail
  };
}
