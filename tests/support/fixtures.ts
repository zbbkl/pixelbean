/**
 * 去背景门禁夹具（docs/43 §4.1 / docs/41 §A.4）。
 *
 * 合成夹具全部**确定性**（固定种子），可进 CI；`truth` 是主体真值掩码，
 * 用来度量「主体被救回多少」——这是判定「是否吞主体」的唯一硬指标。
 *
 * 说明：`docs/39`/`docs/41` 指定的真实样例 `.tools/diag-v12final/rabbit-source.png`
 * 是本地工具产物（`.tools/` 被 .gitignore 忽略），本仓库不存在，
 * 因此用 `rabbitLike()` 作为该类图（白底 + 白身 + 软阴影 + 噪点）的**确定性替身**。
 */
import type { CellImage } from '../../src/types';

export interface Fixture {
  image: CellImage;
  /** 主体真值（1 = 主体核心，不含软边过渡带）。 */
  truth: Uint8Array;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampByte = (v: number) => Math.min(255, Math.max(0, v));
const softEdge = (t: number) => Math.min(1, Math.max(0, (t - 0.88) / 0.24));

/**
 * 兔子类：白底 + 近白主体 + 软接触阴影 + 轻噪点（对应 docs/39 的核心失败样例）。
 * 主体/背景色差极小（ΔE ≈ 1~5），颜色判据天然失效。
 */
export function rabbitLike(width = 240, height = 300, noise = 1.5): Fixture {
  const data = new Uint8ClampedArray(width * height * 4);
  const truth = new Uint8Array(width * height);
  const rand = mulberry32(20260908);
  const cx = width / 2;
  const headCy = height * 0.32;
  const bodyCy = height * 0.62;
  const headR = width * 0.16;
  const bodyRx = width * 0.22;
  const bodyRy = height * 0.22;
  const ell = (x: number, y: number, ex: number, ey: number, rx: number, ry: number) =>
    Math.hypot((x - ex) / rx, (y - ey) / ry);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const vignette = 1.2 * (Math.hypot(x - cx, y - height / 2) / Math.hypot(cx, height / 2));
      let rgb: [number, number, number] = [250 - vignette, 250 - vignette, 250 - vignette];
      const bodyD = Math.min(
        ell(x, y, cx, headCy, headR, headR),
        ell(x, y, cx, bodyCy, bodyRx, bodyRy)
      );
      if (bodyD <= 0.95) truth[y * width + x] = 1;
      const shadow = 1 - Math.min(1, Math.max(0, (bodyD - 1) / 0.1));
      if (shadow > 0) {
        const m = 0.55 * shadow;
        rgb = [rgb[0] * (1 - m) + 236 * m, rgb[1] * (1 - m) + 236 * m, rgb[2] * (1 - m) + 236 * m];
      }
      const t = softEdge(bodyD);
      if (t > 0) {
        rgb = [rgb[0] * (1 - t) + 253 * t, rgb[1] * (1 - t) + 252 * t, rgb[2] * (1 - t) + 250 * t];
      }
      const feature = (
        ex: number,
        ey: number,
        rx: number,
        ry: number,
        color: [number, number, number]
      ) => {
        const d = ell(x, y, ex, ey, rx, ry);
        if (d > 1) return;
        const ft = Math.min(1, Math.max(0, (1 - d) / 0.25));
        rgb = [
          rgb[0] * (1 - ft) + color[0] * ft,
          rgb[1] * (1 - ft) + color[1] * ft,
          rgb[2] * (1 - ft) + color[2] * ft
        ];
      };
      feature(cx - headR * 0.35, headCy - headR * 0.9, headR * 0.3, headR * 0.7, [242, 205, 210]);
      feature(cx + headR * 0.35, headCy - headR * 0.9, headR * 0.3, headR * 0.7, [242, 205, 210]);
      feature(cx - headR * 0.35, headCy + headR * 0.1, headR * 0.18, headR * 0.16, [38, 42, 50]);
      feature(cx + headR * 0.35, headCy + headR * 0.1, headR * 0.18, headR * 0.16, [38, 42, 50]);
      feature(cx, headCy + headR * 0.45, headR * 0.14, headR * 0.1, [120, 96, 100]);
      feature(cx, bodyCy + bodyRy * 0.25, bodyRx * 0.45, bodyRy * 0.3, [246, 240, 230]);
      const jitter = (rand() - 0.5) * 2 * noise;
      const o = (y * width + x) * 4;
      data[o] = clampByte(rgb[0] + jitter);
      data[o + 1] = clampByte(rgb[1] + jitter);
      data[o + 2] = clampByte(rgb[2] + jitter);
      data[o + 3] = 255;
    }
  }
  return { image: { width, height, data }, truth };
}

/**
 * docs/43 §4.1 原样夹具：白底白身软边 + 两只深色眼（无阴影，最苛刻）。
 *
 * `edgeRatio` = 软边过渡带宽度 / 主体半径。默认 0.16 即 docs/43 §4.1 原样（d∈[0.92,1.08]）。
 * **这个比例是决定 B-1 能否成立的隐藏变量**：脊的衰减尺度 ≈ 2·s_max = 16px，而屏障只能在
 * 真实边缘之前停下，误差量级就是 16px。夹具取 0.16 时 16px 误差 ≈ 主体半径的 20%（放大失真）；
 * 真实照片里软边通常只占主体半径的 1~2%，需要用它做尺度扫描（见 tests/acceptance/ridge-calibration）。
 */
export function softWhiteSubject(size = 240, edgeRatio = 0.16): Fixture {
  const data = new Uint8ClampedArray(size * size * 4);
  const truth = new Uint8Array(size * size);
  const bg: [number, number, number] = [250, 250, 250];
  const body: [number, number, number] = [255, 255, 255];
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  const mid = 1 - edgeRatio / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - cx, y - cy) / r;
      const t = Math.min(1, Math.max(0, (d - mid) / edgeRatio));
      if (d <= 1 - edgeRatio * 0.25) truth[y * size + x] = 1;
      data.set(
        [
          Math.round(body[0] * (1 - t) + bg[0] * t),
          Math.round(body[1] * (1 - t) + bg[1] * t),
          Math.round(body[2] * (1 - t) + bg[2] * t)
        ],
        (y * size + x) * 4
      );
      data[(y * size + x) * 4 + 3] = 255;
    }
  }
  for (const [ex, ey] of [
    [cx - 14, cy - 12],
    [cx + 14, cy - 12]
  ] as const) {
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const px = Math.round(ex + dx);
        const py = Math.round(ey + dy);
        data.set([35, 40, 48], (py * size + px) * 4);
      }
    }
  }
  return { image: { width: size, height: size, data }, truth };
}

/** 高对比硬边主体（既有单测覆盖的「本来就能用」基线，用于回归）。 */
export function hardSquare(size = 240): Fixture {
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const truth = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inSquare = x >= size * 0.3 && x < size * 0.7 && y >= size * 0.3 && y < size * 0.7;
      const o = (y * size + x) * 4;
      if (inSquare) {
        data[o] = 235;
        data[o + 1] = 196;
        data[o + 2] = 160;
        truth[y * size + x] = 1;
      }
    }
  }
  return { image: { width: size, height: size, data }, truth };
}

export interface SubjectQuality {
  /** 出图（pattern）里主体格数：mask=1 的格。 */
  kept: number;
  /** 真值主体格数。 */
  truth: number;
  /** 真值主体被保留下来的比例（0~1）。 */
  recovery: number;
}

/** 度量「真值主体被救回多少」——判定是否吞主体的硬指标。 */
export function recovery(mask: Uint8Array, truth: Uint8Array): SubjectQuality {
  let kept = 0;
  let total = 0;
  for (let i = 0; i < truth.length; i += 1) {
    if (truth[i]) {
      total += 1;
      if (mask[i]) kept += 1;
    }
  }
  return { kept, truth: total, recovery: total ? kept / total : 1 };
}
