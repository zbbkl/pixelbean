import { srgbByteToLinear } from './srgb';

const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;

export function linearToXyz(linear: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = linear;
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b
  ];
}

function labF(t: number): number {
  if (t > 216 / 24389) return Math.cbrt(t);
  return (24389 / 27) * t + 16 / 116;
}

export function xyzToLab(xyz: readonly [number, number, number]): [number, number, number] {
  const [x, y, z] = xyz;
  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function srgbRgbToLab(rgb: readonly [number, number, number]): [number, number, number] {
  const srgb = [srgbByteToLinear(rgb[0]), srgbByteToLinear(rgb[1]), srgbByteToLinear(rgb[2])] as const;
  return xyzToLab(linearToXyz(srgb));
}
