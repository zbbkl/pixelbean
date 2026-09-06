import type { CellImage, ConvertOptions, Pattern } from '../../types';
import { srgbRgbToLab } from '../color/lab';
import { linearToSrgbByte, srgbToLinearRgb } from '../color/srgb';
import type { LoadedPalette } from '../palette/types';
import { nearestPaletteIndex } from './match';

export function ditherFloydSteinberg(
  image: CellImage,
  palette: LoadedPalette,
  options: ConvertOptions
): Pattern {
  const { width, height, data } = image;
  const linear = new Float64Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const rgb: [number, number, number] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    const l = srgbToLinearRgb(rgb);
    linear[i * 3] = l[0];
    linear[i * 3 + 1] = l[1];
    linear[i * 3 + 2] = l[2];
  }

  const cells = new Int16Array(width * height);
  for (let gy = 0; gy < height; gy += 1) {
    const leftToRight = gy % 2 === 0;
    for (let step = 0; step < width; step += 1) {
      const gx = leftToRight ? step : width - 1 - step;
      const i = gy * width + gx;
      const offset = i * 3;
      const current: [number, number, number] = [linear[offset], linear[offset + 1], linear[offset + 2]];
      const rgb = [
        linearToSrgbByte(current[0]),
        linearToSrgbByte(current[1]),
        linearToSrgbByte(current[2])
      ] as [number, number, number];
      const chosen = nearestPaletteIndex(srgbRgbToLab(rgb), palette);
      cells[i] = chosen;
      const palLinear = palette.linearRgb.subarray(chosen * 3, chosen * 3 + 3) as unknown as [number, number, number];
      const err = [
        current[0] - palLinear[0],
        current[1] - palLinear[1],
        current[2] - palLinear[2]
      ];

      const add = (row: number, col: number, weight: number) => {
        if (row < 0 || row >= height || col < 0 || col >= width) return;
        const target = (row * width + col) * 3;
        linear[target] += err[0] * weight;
        linear[target + 1] += err[1] * weight;
        linear[target + 2] += err[2] * weight;
      };

      if (leftToRight) {
        add(gy, gx + 1, 7 / 16);
        add(gy + 1, gx - 1, 3 / 16);
        add(gy + 1, gx, 5 / 16);
        add(gy + 1, gx + 1, 1 / 16);
      } else {
        add(gy, gx - 1, 7 / 16);
        add(gy + 1, gx + 1, 3 / 16);
        add(gy + 1, gx, 5 / 16);
        add(gy + 1, gx - 1, 1 / 16);
      }
    }
  }

  return {
    paletteId: options.paletteId,
    width,
    height,
    cells,
    codes: palette.codes,
    options: {
      ...options,
      width,
      height,
      contain: undefined
    }
  };
}
