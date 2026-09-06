const RAD = Math.PI / 180;

function cosDeg(v: number): number {
  return Math.cos(v * RAD);
}

function sinDeg(v: number): number {
  return Math.sin(v * RAD);
}

/**
 * Sharma, Wu & Dalal 2005 完整 CIEDE2000，kL = kC = kH = 1。
 * 输入为 CIELAB D65 值。
 */
export function ciede2000(
  lab1: readonly [number, number, number],
  lab2: readonly [number, number, number]
): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G =
    0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = C1p === 0 ? 0 : (Math.atan2(b1, a1p) / RAD + 360) % 360;
  const h2p = C2p === 0 ? 0 : (Math.atan2(b2, a2p) / RAD + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * sinDeg(dhp / 2);

  const Lbar = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbar: number;
  if (C1p * C2p === 0) {
    hbar = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbar = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbar = (h1p + h2p + 360) / 2;
  } else {
    hbar = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * cosDeg(hbar - 30) +
    0.24 * cosDeg(2 * hbar) +
    0.32 * cosDeg(3 * hbar + 6) -
    0.2 * cosDeg(4 * hbar - 63);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -sinDeg(2 * dTheta) * RC;

  return Math.sqrt(
    (dLp / SL) ** 2 +
      (dCp / SC) ** 2 +
      (dHp / SH) ** 2 +
      RT * (dCp / SC) * (dHp / SH)
  );
}

export function ciede76(lab1: readonly [number, number, number], lab2: readonly [number, number, number]): number {
  return Math.hypot(lab1[0] - lab2[0], lab1[1] - lab2[1], lab1[2] - lab2[2]);
}
