import { boardPresets, longEdgePresets } from '../boardPresets';
import type { UiSettings } from '../types';
import type { PaletteSet } from '../../core/palette/types';

interface Props {
  settings: UiSettings;
  palettes: Record<string, PaletteSet>;
  onPatch: (patch: Partial<UiSettings>) => void;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function ParamPanel({ settings, palettes, onPatch }: Props) {
  const limitOn = settings.maxColorsEnabled;
  return (
    <div className="param-panel">
      <section className="panel-block">
        <div className="block-title">3 网格</div>
        <div className="segmented">
          <button
            className={settings.gridMode === 'long-edge' ? 'active' : ''}
            onClick={() => onPatch({ gridMode: 'long-edge' })}
          >
            长边
          </button>
          <button
            className={settings.gridMode === 'square-board' ? 'active' : ''}
            onClick={() => onPatch({ gridMode: 'square-board' })}
          >
            方形底板
          </button>
        </div>
        {settings.gridMode === 'long-edge' ? (
          <>
            <div className="preset-row">
              {longEdgePresets.map((preset) => (
                <button
                  key={preset.id}
                  className={settings.longEdge === preset.value ? 'active' : ''}
                  onClick={() => onPatch({ longEdge: preset.value })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <NumberField
              label="长边格数"
              value={settings.longEdge}
              min={4}
              max={390}
              step={1}
              onChange={(value) => onPatch({ longEdge: Math.max(4, Math.min(390, value)) })}
            />
          </>
        ) : (
          <div className="preset-row">
            {boardPresets.map((preset) => (
              <button
                key={preset.id}
                className={settings.boardSide === preset.side ? 'active' : ''}
                onClick={() => onPatch({ boardSide: preset.side })}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel-block">
        <div className="block-title">4 转换</div>
        <label className="field">
          <span>色表</span>
          <select
            value={settings.paletteId}
            onChange={(event) => onPatch({ paletteId: event.target.value })}
          >
            {Object.values(palettes).map((palette) => (
              <option key={palette.id} value={palette.id}>
                {palette.label}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented">
          <button
            className={settings.mode === 'average' ? 'active' : ''}
            onClick={() => onPatch({ mode: 'average' })}
          >
            面积平均
          </button>
          <button
            className={settings.mode === 'dominant' ? 'active' : ''}
            onClick={() => onPatch({ mode: 'dominant' })}
          >
            主导色
          </button>
        </div>
        <div className="field-row">
          <label className="switch-field">
            <input
              type="checkbox"
              checked={settings.bg === 'white'}
              onChange={(event) => onPatch({ bg: event.target.checked ? 'white' : 'black' })}
            />
            <span>垫白背景</span>
          </label>
        </div>
        <div className="field-row">
          <label className="switch-field">
            <input
              type="checkbox"
              checked={limitOn}
              onChange={(event) => onPatch({ maxColorsEnabled: event.target.checked })}
            />
            <span>限色</span>
          </label>
          {limitOn && (
            <NumberField
              label="最多"
              value={settings.maxColors}
              min={2}
              max={200}
              step={1}
              onChange={(value) => onPatch({ maxColors: Math.max(2, Math.min(200, value)) })}
            />
          )}
        </div>
        <div className="segmented">
          <button
            className={settings.dither === 'none' ? 'active' : ''}
            disabled={limitOn}
            onClick={() => onPatch({ dither: 'none' })}
          >
            无抖动
          </button>
          <button
            className={settings.dither === 'floyd-steinberg' ? 'active' : ''}
            disabled={limitOn}
            onClick={() => onPatch({ dither: 'floyd-steinberg' })}
          >
            Floyd–Steinberg
          </button>
        </div>
      </section>

      <section className="panel-block">
        <div className="block-title">5 预处理</div>
        {(['brightness', 'contrast', 'saturation'] as const).map((name) => (
          <label className="field" key={name}>
            <span>{name === 'brightness' ? '亮度' : name === 'contrast' ? '对比度' : '饱和度'}</span>
            <input
              type="range"
              min={-50}
              max={50}
              step={1}
              value={settings.adjust[name]}
              onChange={(event) =>
                onPatch({ adjust: { ...settings.adjust, [name]: Number(event.target.value) } })
              }
            />
          </label>
        ))}
      </section>
    </div>
  );
}
