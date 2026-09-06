export type PaletteKind = 'solid' | 'special' | 'transparent';
export type PaletteQuality = 'official' | 'community-verified' | 'community-legacy';
export type BeadType = 'round' | 'square' | 'mix';

export interface PaletteCodeStyle {
  stripLeadingBrandChar?: boolean;
  zeroPad?: number;
}

export interface PaletteColor {
  code: string;
  name?: string;
  nameEn?: string;
  hex: string | null;
  rgb?: [number, number, number];
  kind: PaletteKind;
  family?: string;
  sortKey?: number;
}

export interface PaletteSet {
  schemaVersion: '1.0';
  id: string;
  label: string;
  brand: string;
  standard: string;
  beadSizeMm?: number;
  beadType?: BeadType;
  quality: PaletteQuality;
  source: string;
  license: string;
  licenseNote?: string;
  codeStyle?: PaletteCodeStyle;
  notes?: string;
  colors: PaletteColor[];
}

export interface LoadedPalette {
  set: PaletteSet;
  solids: PaletteColor[];
  codes: string[];
  indexByCode: Map<string, number>;
  labs: Float64Array;
  linearRgb: Float64Array;
}
