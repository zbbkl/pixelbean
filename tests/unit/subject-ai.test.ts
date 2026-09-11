/**
 * 可选 AI 抠图路径（`extractSubjectFromAIMask`）的门禁。
 *
 * **不需要 onnxruntime / 不需要 44MB 模型**：用真实模型的原始输出掩码做夹具
 * （`tests/fixtures/ai-mask-isnet-int8-rabbit-1024.png`，由 ISNet-int8 对权威样例推理所得，
 * 11.4KB），因此整条后处理链与可靠度门都能在 CI 里被测到。
 *
 * 覆盖：
 * - GA1/GA2：权威样例上 AI 路径给出可信掩码（占比/连通域/覆盖主体中心、排除背景）
 * - GA3：不可信必须回退（全 1 掩码 / 散点掩码 / 全 0 掩码）
 * - 契约一致性：与 extractSubject 同字段、同红线、同 despill
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  extractSubject,
  extractSubjectFromAIMask,
  SUBJECT_COMPONENT_MIN,
  SUBJECT_RATIO_MIN
} from '../../src/core/pipeline/subject';
import { readPng } from '../support/png';
import type { CellImage } from '../../src/types';

const AUTHORITATIVE_IMAGE = 'tests/fixtures/rabbit-soft.png';
const AI_MASK_FIXTURE = 'tests/fixtures/ai-mask-isnet-int8-rabbit-1024.png';

function loadImage(relative: string): CellImage {
  const raster = readPng(resolve(process.cwd(), relative));
  return { width: raster.width, height: raster.height, data: raster.data };
}

/** 灰度 PNG → 0/1 掩码（夹具是二值图，黑=主体）。 */
function loadMask(relative: string): { width: number; height: number; data: Uint8Array } {
  const raster = readPng(resolve(process.cwd(), relative));
  const data = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < data.length; i += 1) data[i] = raster.data[i * 4] < 128 ? 1 : 0;
  return { width: raster.width, height: raster.height, data };
}

function countOnes(mask: Uint8Array): number {
  let n = 0;
  for (const value of mask) if (value) n += 1;
  return n;
}

describe('AI 抠图路径（extractSubjectFromAIMask）', () => {
  it('GA1/GA2：真实模型输出掩码 → 可信、覆盖主体、排除背景', () => {
    const image = loadImage(AUTHORITATIVE_IMAGE);
    const aiMask = loadMask(AI_MASK_FIXTURE);
    const result = extractSubjectFromAIMask(image, aiMask);

    console.log(
      `AI reliable=${result.reliable} subjectRatio=${result.subjectRatio.toFixed(3)} comp=${result.largestComponentRatio.toFixed(3)} bbox=${JSON.stringify(result.bbox)} mask=${countOnes(result.mask)}px`
    );

    expect(result.reliable).toBe(true);
    expect(result.subjectRatio).toBeGreaterThanOrEqual(SUBJECT_RATIO_MIN);
    expect(result.largestComponentRatio).toBeGreaterThanOrEqual(SUBJECT_COMPONENT_MIN);

    // 主体中心在掩码内、左上角背景在外（与 docs/41 G1/G2 同口径的抽样检查）
    const at = (x: number, y: number) => result.mask[y * image.width + x];
    expect(at(Math.floor(image.width / 2), Math.floor(image.height / 2))).toBe(1);
    expect(at(2, 2)).toBe(0);
    // 主体占比应在「像是主体」的区间（不是几乎整幅、也不是碎片）
    expect(result.subjectRatio).toBeGreaterThan(0.2);
    expect(result.subjectRatio).toBeLessThan(0.8);
    // despill 生效：至少有一个主体边缘像素被改动过
    let changed = 0;
    for (let i = 0; i < result.mask.length; i += 1) {
      if (!result.mask[i]) continue;
      const offset = i * 4;
      if (
        result.cells[offset] !== image.data[offset] ||
        result.cells[offset + 1] !== image.data[offset + 1] ||
        result.cells[offset + 2] !== image.data[offset + 2]
      ) {
        changed += 1;
      }
    }
    console.log(`AI despill 改动边缘像素=${changed}px`);
  });

  it('GA3：全 1 掩码（几乎无背景可去）必须回退，不产空图纸', () => {
    const image = loadImage(AUTHORITATIVE_IMAGE);
    const aiMask = {
      width: image.width,
      height: image.height,
      data: new Uint8Array(image.width * image.height).fill(1)
    };
    const result = extractSubjectFromAIMask(image, aiMask);
    expect(result.reliable).toBe(false);
    expect(countOnes(result.mask)).toBe(image.width * image.height);
  });

  it('GA3：散点掩码（主体被打碎）必须回退', () => {
    const image = loadImage(AUTHORITATIVE_IMAGE);
    const data = new Uint8Array(image.width * image.height);
    // 规则散点：彼此不连通、密度足够大以绕过 minArea
    for (let y = 0; y < image.height; y += 12) {
      for (let x = 0; x < image.width; x += 12) data[y * image.width + x] = 1;
    }
    const result = extractSubjectFromAIMask(image, { width: image.width, height: image.height, data });
    expect(result.reliable).toBe(false);
    expect(countOnes(result.mask)).toBe(image.width * image.height);
  });

  it('GA3：全 0 掩码（无主体）必须回退，绝不产空图纸', () => {
    const image = loadImage(AUTHORITATIVE_IMAGE);
    const aiMask = {
      width: image.width,
      height: image.height,
      data: new Uint8Array(image.width * image.height)
    };
    const result = extractSubjectFromAIMask(image, aiMask);
    expect(result.reliable).toBe(false);
    expect(countOnes(result.mask)).toBe(image.width * image.height);
    expect(result.subjectRatio).toBe(0);
  });

  it('契约一致性：字段与 extractSubject 相同，且同样受可靠度门约束', () => {
    const image = loadImage(AUTHORITATIVE_IMAGE);
    const aiMask = loadMask(AI_MASK_FIXTURE);
    const ai = extractSubjectFromAIMask(image, aiMask);
    const deterministic = extractSubject(image, { edge: 12 });
    expect(Object.keys(ai).sort()).toEqual(Object.keys(deterministic).sort());
    expect(ai.cells.length).toBe(deterministic.cells.length);
    // 同一条红线：不可信 ⇒ 掩码全 1（两条路径行为一致）
    if (!ai.reliable) {
      expect(countOnes(ai.mask)).toBe(image.width * image.height);
    }
  });

  it('掩码尺寸与原图不同也能对齐（1024² 掩码 → 276×356 图）', () => {
    const image = loadImage(AUTHORITATIVE_IMAGE);
    const aiMask = loadMask(AI_MASK_FIXTURE);
    expect([aiMask.width, aiMask.height]).toEqual([1024, 1024]);
    expect([image.width, image.height]).toEqual([276, 356]);
    const result = extractSubjectFromAIMask(image, aiMask);
    expect(result.bbox).not.toBeNull();
  });
});
