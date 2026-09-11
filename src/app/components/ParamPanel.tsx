import { boardPresets, longEdgePresets } from '../boardPresets';
import type { BackgroundRemovalOutcome } from '../../types';
import type { UiSettings } from '../types';
import type { PaletteSet } from '../../core/palette/types';
import { applyMode, modeOptions, type NonCustomTargetMode } from '../../core/post/modePresets';
import { MAX_COLOR_STEPS } from '../options';

interface Props {
  settings: UiSettings;
  palettes: Record<string, PaletteSet>;
  onPatch: (patch: Partial<UiSettings>) => void;
  /** 上一次转换的实际去背景结果（仅在用户开启开关时出现）。 */
  backgroundRemoval?: BackgroundRemovalOutcome;
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

export function ParamPanel({ settings, palettes, onPatch, backgroundRemoval }: Props) {
  const limitOn = settings.maxColorsEnabled;
  const ditherBlocked = limitOn || settings.shadowSimplify > 0;
  return (
    <div className="param-panel">
      <section className="panel-block">
        <div className="block-title">0 目标模式</div>
        <select
          value={settings.targetMode}
          onChange={(event) => {
            const id = event.target.value as NonCustomTargetMode | 'custom';
            if (id !== 'custom') onPatch(applyMode(id, settings));
          }}
        >
          {modeOptions.map((mode) => (
            <option key={mode.id} value={mode.id}>{mode.label}</option>
          ))}
          {settings.targetMode === 'custom' && <option value="custom">自定义</option>}
        </select>
      </section>
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
                {palette.label} · {palette.quality === 'official' ? '官方' : palette.quality === 'community-verified' ? '社区核对' : '社区旧表'}
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
              checked={settings.protectFeatures}
              onChange={(event) => onPatch({ protectFeatures: event.target.checked })}
            />
            <span>保留高对比细节（细线/眼睛/点缀），同时优化区域边界取色</span>
          </label>
        </div>
        <div className="field-row">
          <label className="switch-field">
            <input
              type="checkbox"
              checked={settings.removeBackground}
              onChange={(event) => onPatch({ removeBackground: event.target.checked })}
            />
            <span>一键去背景</span>
          </label>
        </div>
        {settings.removeBackground && backgroundRemoval === 'fallback' ? (
          <p className="field-hint" role="status">
            这张图没找到可分离的背景（主体与背景过于接近），已按「不去背景」出图。
          </p>
        ) : null}
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
          <span className="field-label-inline">智能限色 K</span>
          {MAX_COLOR_STEPS.map((k) => (
            <button
              key={k}
              className={`mini-chip ${limitOn && settings.maxColors === k ? 'active' : ''}`}
              onClick={() => onPatch({ maxColorsEnabled: true, maxColors: k })}
            >
              {k}
            </button>
          ))}
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
              label="K"
              value={settings.maxColors}
              min={2}
              max={400}
              step={1}
              onChange={(value) => onPatch({ maxColors: Math.max(2, Math.min(400, value)) })}
            />
          )}
        </div>
        <div className="segmented">
          <button
            className={settings.dither === 'none' ? 'active' : ''}
            disabled={ditherBlocked}
            onClick={() => onPatch({ dither: 'none' })}
          >
            无抖动
          </button>
          <button
            className={settings.dither === 'floyd-steinberg' ? 'active' : ''}
            disabled={ditherBlocked}
            onClick={() => onPatch({ dither: 'floyd-steinberg' })}
          >
            Floyd–Steinberg
          </button>
        </div>
      </section>

      <section className="panel-block">
        <div className="block-title">4b 工艺后处理</div>
        <label className="field">
          <span>暗部简化</span>
          <select
            value={settings.shadowSimplify}
            onChange={(event) => onPatch({ shadowSimplify: Number(event.target.value) as 0 | 1 | 2 })}
          >
            <option value={0}>关</option>
            <option value={1}>标准（相近暗部并入统一深色，至多 2 层）</option>
            <option value={2}>强（暗部统一为 1 层深色）</option>
          </select>
        </label>
        <div className="field-row">
          <label className="switch-field">
            <input
              type="checkbox"
              checked={settings.speckleClean}
              onChange={(event) => onPatch({ speckleClean: event.target.checked })}
            />
            <span>孤立噪点清理</span>
          </label>
        </div>
        {settings.speckleClean && (
          <div className="field-row">
            <NumberField
              label="≤N格"
              value={settings.speckleMax}
              min={1}
              max={3}
              step={1}
              onChange={(value) => onPatch({ speckleMax: Math.max(1, Math.min(3, value)) })}
            />
            <label className="field field-inline">
              <span>ΔE</span>
              <input
                type="range"
                min={20}
                max={40}
                step={1}
                value={settings.speckleDeltaE}
                onChange={(event) => onPatch({ speckleDeltaE: Number(event.target.value) })}
              />
            </label>
          </div>
        )}
        <label className="switch-field">
          <input
            type="checkbox"
            checked={settings.outline}
            onChange={(event) => onPatch({ outline: event.target.checked })}
          />
          <span>深色轮廓 1px</span>
        </label>
        {settings.outline && (
          <label className="field">
            <span>轮廓阈值</span>
            <input
              type="range"
              min={0.1}
              max={0.3}
              step={0.01}
              value={settings.outlineTau}
              onChange={(event) => onPatch({ outlineTau: Number(event.target.value) })}
            />
          </label>
        )}
        {ditherBlocked && (
          <div className="field-hint">限色或暗部简化开启时抖动置灰</div>
        )}
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
