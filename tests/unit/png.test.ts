/**
 * 测试用 PNG 编解码器的自校验 + 夹具来源交叉校验。
 *
 * 独立对照（oracle）：`System.Drawing`（.NET）解码同一文件的读数，
 * 用来证明本仓库自实现的解码器没有读错像素——门禁的可信度建立在它上面。
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { decodePng, encodePng, maskToImage, readPng } from '../support/png';

function pixel(image: { width: number; data: Uint8ClampedArray }, x: number, y: number) {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset],
    image.data[offset + 1],
    image.data[offset + 2],
    image.data[offset + 3]
  ];
}

describe('PNG 测试支撑', () => {
  it('自编码 → 自解码 逐像素一致', () => {
    const width = 37;
    const height = 23;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      data[i * 4] = (i * 7) % 256;
      data[i * 4 + 1] = (i * 13) % 256;
      data[i * 4 + 2] = (i * 29) % 256;
      data[i * 4 + 3] = i % 3 === 0 ? 128 : 255;
    }
    const image = { width, height, data };
    const decoded = decodePng(encodePng(image));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect([...decoded.data]).toEqual([...data]);
  });

  it('maskToImage 主体黑、背景白', () => {
    const mask = new Uint8Array([1, 0, 0, 1]);
    const image = maskToImage(mask, 2, 2);
    expect(pixel(image, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(image, 1, 0)).toEqual([255, 255, 255, 255]);
  });

  // 以下两条用 System.Drawing 的读数作为独立对照（2026-09 本机实测）。
  it('sample-cartoon.png 读数与原始字节流一致', () => {
    const image = readPng(resolve(process.cwd(), 'public/samples/sample-cartoon.png'));
    expect([image.width, image.height]).toEqual([609, 814]);
    // 首像素：行 0 用 Sub 滤波且左邻越界，故原值直通 → 原始 IDAT 解出的就是 (255,255,255,127)。
    // 注：System.Drawing 对同一像素报 (254,254,254,127)，是 GDI+ 半透明像素预乘舍入的假象；
    // 浏览器 canvas 交给算法的也是原始采样值，故以原始字节流为准。
    expect(pixel(image, 0, 0)).toEqual([255, 255, 255, 127]);
    expect(pixel(image, 304, 407)).toEqual([255, 255, 255, 255]);
  });

  it('sample-photo.png 夹具读数与 System.Drawing 一致', () => {
    const image = readPng(resolve(process.cwd(), 'tests/fixtures/sample-photo.png'));
    expect([image.width, image.height]).toEqual([300, 240]);
    expect(pixel(image, 0, 0)).toEqual([236, 210, 185, 255]);
    expect(pixel(image, 150, 120)).toEqual([173, 108, 88, 255]);
  });
});
