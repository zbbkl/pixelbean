import { useRef, useState } from 'react';
import type { PaletteSet } from '../../core/palette/types';
import { loadPalette } from '../../core/palette/loader';

interface Props {
  currentId: string;
  customCount: number;
  onImport: (palette: PaletteSet) => void;
  onDelete: (id: string) => void;
}

export function PaletteImport({ currentId, customCount, onImport, onDelete }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importText = () => {
    try {
      const json = JSON.parse(text) as unknown;
      loadPalette(json);
      onImport(json as PaletteSet);
      setText('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JSON 无法解析');
    }
  };

  return (
    <section className="panel-block palette-import">
      <div className="block-title">2 色表</div>
      <textarea
        value={text}
        placeholder='{"schemaVersion":"1.0","id":"my-palette",…}'
        onChange={(event) => setText(event.target.value)}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setText(await file.text());
        }}
      />
      <div className="button-row">
        <button className="button secondary" onClick={importText}>
          导入 JSON
        </button>
        <button className="button ghost" onClick={() => fileRef.current?.click()}>
          选择文件
        </button>
      </div>
      {customCount > 0 && (
        <div className="custom-row">
          <span>自定义 {customCount} 套</span>
          <button
            className="mini-button danger"
            onClick={() => currentId !== 'mard-291' && onDelete(currentId)}
            disabled={currentId === 'mard-291'}
          >
            删除当前
          </button>
        </div>
      )}
      {error && <div className="field-error">{error}</div>}
    </section>
  );
}
