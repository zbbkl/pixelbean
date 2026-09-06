import { useRef, useState } from 'react';
import type { SourceImage } from '../types';

export interface SampleOption {
  id: string;
  label: string;
  url: string;
}

interface Props {
  source: SourceImage | null;
  samples: SampleOption[];
  onFile: (file: File) => void;
  onSample: (sample: SampleOption) => void;
  onRemove: () => void;
}

export function UploadZone({ source, samples, onFile, onSample, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = () => inputRef.current?.click();
  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && file.type.startsWith('image/')) onFile(file);
  };

  return (
    <section className="panel-block upload-zone">
      <div className="block-title">1 图片</div>
      <div
        className={`drop-target ${dragging ? 'is-dragging' : ''} ${source ? 'has-source' : ''}`}
        onClick={pick}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') pick();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
          hidden
          onChange={(event) => handleFiles(event.target.files)}
        />
        {source ? (
          <div className="source-preview">
            <img src={source.previewUrl} alt="" />
            <div className="source-meta">
              <strong>{source.name}</strong>
              <span>{source.naturalWidth} × {source.naturalHeight}</span>
            </div>
            <button
              className="mini-button danger"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
            >
              移除
            </button>
          </div>
        ) : (
          <div className="drop-copy">
            <span className="drop-plus">＋</span>
            <strong>选择或拖入图片</strong>
            <span>PNG · JPG · WebP · BMP · GIF 首帧</span>
          </div>
        )}
      </div>
      <div className="sample-row">
        {samples.map((sample) => (
          <button
            key={sample.id}
            className="sample-chip"
            title={sample.label}
            onClick={() => onSample(sample)}
          >
            <img src={sample.url} alt={sample.label} />
            <span>{sample.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
