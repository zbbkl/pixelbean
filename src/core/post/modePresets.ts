import type { TargetMode, UiSettings } from '../../types';

export type NonCustomTargetMode = Exclude<TargetMode, 'custom'>;

export interface ModeOption {
  id: NonCustomTargetMode;
  label: string;
}

export const modeOptions: ModeOption[] = [
  { id: 'photo', label: '照片' },
  { id: 'cartoon', label: '卡通/插画' },
  { id: 'lineart', label: '线稿' },
  { id: 'pixel', label: '像素表情包' }
];

export const MODE_PRESETS: Record<NonCustomTargetMode, Partial<UiSettings>> = {
  photo: {
    targetMode: 'photo',
    mode: 'dominant',
    maxColorsEnabled: false,
    maxColors: 32,
    shadowSimplify: 0,
    speckleClean: false,
    speckleMax: 2,
    speckleDeltaE: 30,
    outline: false,
    outlineTau: 0.18,
    dither: 'none',
    protectFeatures: true
  },
  cartoon: {
    targetMode: 'cartoon',
    mode: 'dominant',
    maxColorsEnabled: true,
    maxColors: 24,
    shadowSimplify: 1,
    speckleClean: true,
    speckleMax: 2,
    speckleDeltaE: 30,
    outline: true,
    outlineTau: 0.18,
    dither: 'none',
    protectFeatures: true
  },
  lineart: {
    targetMode: 'lineart',
    mode: 'dominant',
    maxColorsEnabled: true,
    maxColors: 16,
    shadowSimplify: 0,
    speckleClean: true,
    speckleMax: 2,
    speckleDeltaE: 30,
    outline: false,
    outlineTau: 0.18,
    dither: 'none',
    protectFeatures: false
  },
  pixel: {
    targetMode: 'pixel',
    mode: 'dominant',
    maxColorsEnabled: false,
    maxColors: 36,
    shadowSimplify: 0,
    speckleClean: false,
    speckleMax: 1,
    speckleDeltaE: 30,
    outline: false,
    outlineTau: 0.18,
    dither: 'none',
    protectFeatures: false
  }
};

export function applyMode(mode: NonCustomTargetMode, current: UiSettings): Partial<UiSettings> {
  const patch = MODE_PRESETS[mode];
  return {
    ...patch,
    targetMode: mode,
    adjust: current.adjust
  };
}
