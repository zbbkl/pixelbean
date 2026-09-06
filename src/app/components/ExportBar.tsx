import { useState } from 'react';
import type { PngMode } from '../../export/png';

interface Props {
  disabled: boolean;
  onPng: (mode: PngMode) => void;
  onCsv: () => void;
  onPrint: () => void;
}

export function ExportBar({ disabled, onPng, onCsv, onPrint }: Props) {
  const [mode, setMode] = useState<PngMode>('codes');
  return (
    <div className="export-bar">
      <div className="segmented export-modes">
        <button
          className={mode === 'codes' ? 'active' : ''}
          disabled={disabled}
          onClick={() => setMode('codes')}
        >
          带色号
        </button>
        <button
          className={mode === 'colors' ? 'active' : ''}
          disabled={disabled}
          onClick={() => setMode('colors')}
        >
          纯色块
        </button>
        <button
          className={mode === 'coordinates' ? 'active' : ''}
          disabled={disabled}
          onClick={() => setMode('coordinates')}
        >
          坐标
        </button>
      </div>
      <div className="button-row">
        <button className="button primary" disabled={disabled} onClick={() => onPng(mode)}>
          导出 PNG
        </button>
        <button className="button secondary" disabled={disabled} onClick={onCsv}>
          CSV
        </button>
        <button className="button ghost" disabled={disabled} onClick={onPrint}>
          打印图纸
        </button>
      </div>
    </div>
  );
}
