export interface BoardPreset {
  id: string;
  label: string;
  side: number;
}

export const boardPresets: BoardPreset[] = [
  { id: 'board-32', label: '32 × 32', side: 32 },
  { id: 'board-52', label: '52 × 52', side: 52 },
  { id: 'board-78', label: '78 × 78', side: 78 },
  { id: 'board-104', label: '104 × 104', side: 104 },
  { id: 'board-120', label: '120 × 120', side: 120 }
];

export const longEdgePresets = [
  { id: 'edge-32', label: '32 格', value: 32 },
  { id: 'edge-58', label: '58 格', value: 58 },
  { id: 'edge-100', label: '100 格', value: 100 },
  { id: 'edge-200', label: '200 格', value: 200 }
];
