import { useReducer } from 'react';
import type { Pattern } from '../types';
import type { PaletteSet } from '../core/palette/types';
import type { HoverCell, SourceImage, UiSettings, ViewState } from './types';

export interface AppState {
  source: SourceImage | null;
  settings: UiSettings;
  palettes: Record<string, PaletteSet>;
  currentPaletteId: string;
  pattern: Pattern | null;
  loading: boolean;
  error: string | null;
  status: 'idle' | 'running' | 'ready';
  hover: HoverCell | null;
  view: ViewState;
  ownedCodes: string[];
  convertedSignature: string;
}

export type AppAction =
  | { type: 'source'; source: SourceImage | null }
  | { type: 'settings'; patch: Partial<UiSettings> }
  | { type: 'addPalette'; palette: PaletteSet }
  | { type: 'deletePalette'; id: string }
  | { type: 'setPalette'; id: string }
  | { type: 'convertStart'; signature: string }
  | { type: 'convertDone'; pattern: Pattern; signature: string }
  | { type: 'convertError'; message: string }
  | { type: 'cancelConvert' }
  | { type: 'hover'; hover: HoverCell | null }
  | { type: 'view'; patch: Partial<ViewState> }
  | { type: 'toggleOwned'; code: string }
  | { type: 'restore'; state: Partial<AppState> };

export const defaultSettings: UiSettings = {
  targetMode: 'cartoon',
  gridMode: 'long-edge',
  longEdge: 58,
  boardSide: 29,
  paletteId: 'mard-291',
  bg: 'white',
  mode: 'average',
  maxColorsEnabled: true,
  maxColors: 24,
  dither: 'none',
  adjust: { brightness: 0, contrast: 0, saturation: 0 },
  speckleClean: true,
  speckleMax: 2,
  speckleDeltaE: 30,
  shadowSimplify: 1,
  outline: true,
  outlineTau: 0.18,
  protectFeatures: false,
  showCodes: true,
  showGridLines: true
};

export function applyUiSettingsPatch(patch: Partial<UiSettings>): Partial<UiSettings> {
  if (patch.targetMode !== undefined && patch.targetMode !== 'custom') return patch;
  if ('showCodes' in patch || 'showGridLines' in patch) return patch;
  return { ...patch, targetMode: 'custom' };
}

export function initialState(initialPalettes: Record<string, PaletteSet>): AppState {
  return {
    source: null,
    settings: defaultSettings,
    palettes: initialPalettes,
    currentPaletteId: 'mard-291',
    pattern: null,
    loading: false,
    error: null,
    status: 'idle',
    hover: null,
    view: { zoom: 10, panX: 24, panY: 24 },
    ownedCodes: [],
    convertedSignature: ''
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'source':
      return { ...state, source: action.source, pattern: null, error: null, hover: null };
    case 'settings':
      return {
        ...state,
        settings: { ...state.settings, ...action.patch },
        hover: null
      };
    case 'addPalette':
      return {
        ...state,
        palettes: { ...state.palettes, [action.palette.id]: action.palette },
        currentPaletteId: action.palette.id,
        settings: { ...state.settings, paletteId: action.palette.id, targetMode: 'custom' },
        pattern: null,
        error: null
      };
    case 'deletePalette': {
      const palettes = { ...state.palettes };
      delete palettes[action.id];
      const fallback = Object.keys(palettes).includes('mard-291') ? 'mard-291' : Object.keys(palettes)[0];
      return {
        ...state,
        palettes,
        currentPaletteId: fallback,
        settings: { ...state.settings, paletteId: fallback, targetMode: 'custom' },
        pattern: null
      };
    }
    case 'setPalette':
      return {
        ...state,
        currentPaletteId: action.id,
        settings: { ...state.settings, paletteId: action.id, targetMode: 'custom' },
        pattern: null
      };
    case 'convertStart':
      return { ...state, loading: true, status: 'running', error: null, convertedSignature: action.signature };
    case 'convertDone':
      return {
        ...state,
        pattern: action.pattern,
        loading: false,
        status: 'ready',
        error: null,
        convertedSignature: action.signature,
        ownedCodes: state.ownedCodes.filter((code) => action.pattern.codes.includes(code))
      };
    case 'convertError':
      return { ...state, loading: false, status: 'ready', error: action.message };
    case 'cancelConvert':
      return { ...state, loading: false, status: 'ready' };
    case 'hover':
      return { ...state, hover: action.hover };
    case 'view':
      return { ...state, view: { ...state.view, ...action.patch } };
    case 'toggleOwned': {
      const owned = new Set(state.ownedCodes);
      if (owned.has(action.code)) owned.delete(action.code);
      else owned.add(action.code);
      return { ...state, ownedCodes: [...owned] };
    }
    case 'restore':
      return {
        ...state,
        ...action.state,
        settings: action.state.settings ? { ...defaultSettings, ...action.state.settings } : state.settings,
        palettes: action.state.palettes ? { ...state.palettes, ...action.state.palettes } : state.palettes
      };
    default:
      return state;
  }
}

export function useAppState(initialPalettes: Record<string, PaletteSet>) {
  return useReducer(appReducer, initialPalettes, initialState);
}
