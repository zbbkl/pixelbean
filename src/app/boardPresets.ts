export interface BoardPreset {
  id: string;
  label: string;
  side: number;
}

export const boardPresets: BoardPreset[] = [
  { id: 'board-29', label: '29 × 29', side: 29 },
  { id: 'board-39', label: '39 × 39', side: 39 },
  { id: 'board-58', label: '58 × 58', side: 58 },
  { id: 'board-116', label: '116 × 116', side: 116 }
];

export const longEdgePresets = [
  { id: 'edge-32', label: '32 格', value: 32 },
  { id: 'edge-58', label: '58 格', value: 58 },
  { id: 'edge-100', label: '100 格', value: 100 },
  { id: 'edge-200', label: '200 格', value: 200 }
];
