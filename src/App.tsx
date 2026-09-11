import { useEffect, useMemo, useRef, useState } from 'react';
import { builtinPaletteSets } from './generated/palettes';
import type { Pattern } from './types';
import { countByColor } from './core/pattern';
import { loadPalette } from './core/palette/loader';
import type { PaletteSet } from './core/palette/types';
import { ExportBar } from './app/components/ExportBar';
import { MobileNav } from './app/components/MobileNav';
import { PaletteImport } from './app/components/PaletteImport';
import { ParamPanel } from './app/components/ParamPanel';
import { PreviewCanvas } from './app/components/PreviewCanvas';
import { StatsPanel } from './app/components/StatsPanel';
import { UploadZone, type SampleOption } from './app/components/UploadZone';
import { clearDraft, draftSource, loadDraft, saveDraft } from './app/draft';
import { loadImageFile, loadSampleImage } from './app/image';
import { MAX_CELLS, resolveRequest } from './app/options';
import { sampleOptions } from './app/samples';
import { applyUiSettingsPatch, useAppState } from './app/state';
import { exportPng, type PngMode } from './export/png';
import { exportCsv } from './export/csv';
import { copyStats } from './export/stats';
import { printSheet } from './export/print';
import type { ConvertError, ConvertResult } from './worker/protocol';
import type { MobileSection } from './app/types';

const builtin = builtinPaletteSets as unknown as Record<string, PaletteSet>;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [state, dispatch] = useAppState(builtin);
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const restoredRef = useRef(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [mobileSection, setMobileSection] = useState<MobileSection>('preview');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  const { source, settings } = state;
  const currentPalette = state.palettes[settings.paletteId];
  const loadedPalette = useMemo(() => (currentPalette ? loadPalette(currentPalette) : null), [currentPalette]);
  const stats = useMemo(
    () =>
      state.pattern && loadedPalette && state.pattern.paletteId === loadedPalette.set.id
        ? countByColor(state.pattern, loadedPalette)
        : [],
    [state.pattern, loadedPalette]
  );

  useEffect(() => {
    const worker = new Worker(new URL('./worker/convert.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ConvertResult | ConvertError>) => {
      const message = event.data;
      if (message.seq !== seqRef.current) return;
      if (message.kind === 'error') {
        dispatch({ type: 'convertError', message: message.message });
        return;
      }
      const pattern: Pattern = {
        paletteId: message.pattern.paletteId,
        width: message.pattern.width,
        height: message.pattern.height,
        cells: new Int16Array(message.pattern.cells),
        codes: message.pattern.codes,
        options: message.pattern.options,
        backgroundRemoval: message.pattern.backgroundRemoval
      };
      dispatch({ type: 'convertDone', pattern, signature: String(message.seq) });
    };
    worker.onerror = () => dispatch({ type: 'convertError', message: '转换 Worker 出错' });
    workerRef.current = worker;
    setWorkerReady(true);
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const draft = loadDraft();
    if (draft) {
      dispatch({
        type: 'restore',
        state: {
          settings: draft.settings,
          palettes: Object.fromEntries(draft.customPalettes.map((palette) => [palette.id, palette]))
        }
      });
      void draftSource(draft)
        .then((restored) => {
          if (restored) dispatch({ type: 'source', source: restored });
          else if (!draft.source) void loadDefaultSample();
        })
        .catch(() => void loadDefaultSample());
    } else {
      void loadDefaultSample();
    }
  }, []);

  async function loadDefaultSample() {
    const sample = sampleOptions[0];
    try {
      dispatch({ type: 'source', source: await loadSampleImage(sample.url, sample.label, sample.id) });
    } catch (error) {
      dispatch({ type: 'convertError', message: error instanceof Error ? error.message : '示例图加载失败' });
    }
  }

  useEffect(() => {
    if (!source || !currentPalette || !loadedPalette || !workerReady) return;
    try {
      const resolved = resolveRequest(source, settings);
      if (resolved.options.width * resolved.options.height > MAX_CELLS) {
        dispatch({
          type: 'convertError',
          message: `网格超过 ${MAX_CELLS.toLocaleString()} 格上限，请减小长边`
        });
        return;
      }
      seqRef.current += 1;
      const seq = seqRef.current;
      const signature = `${source.id}|${seq}`;
      dispatch({ type: 'convertStart', signature });
      const timer = window.setTimeout(() => {
        const worker = workerRef.current;
        if (!worker) return;
        const data = source.data.slice().buffer as ArrayBuffer;
        worker.postMessage(
          {
            seq,
            kind: 'convert',
            source: { width: source.width, height: source.height, data },
            options: resolved.options,
            palette: currentPalette
          },
          [data]
        );
      }, 300);
      return () => window.clearTimeout(timer);
    } catch (error) {
      dispatch({ type: 'convertError', message: error instanceof Error ? error.message : '参数无法转换' });
    }
  }, [
    source,
    currentPalette,
    loadedPalette,
    workerReady,
    settings.gridMode,
    settings.longEdge,
    settings.boardSide,
    settings.paletteId,
    settings.bg,
    settings.mode,
    settings.maxColorsEnabled,
    settings.maxColors,
    settings.speckleClean,
    settings.speckleMax,
    settings.speckleDeltaE,
    settings.shadowSimplify,
    settings.outline,
    settings.outlineTau,
    settings.protectFeatures,
    settings.removeBackground,
    settings.dither,
    settings.adjust
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void saveDraft(source, settings, state.palettes);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [source, settings, state.palettes]);

  function patchUi(patch: Partial<typeof settings>) {
    if ('paletteId' in patch && patch.paletteId) {
      seqRef.current += 1;
      dispatch({ type: 'setPalette', id: patch.paletteId });
    } else {
      const nextPatch: Partial<typeof settings> = applyUiSettingsPatch(patch);
      dispatch({ type: 'settings', patch: nextPatch });
    }
  }

  function importPalette(palette: PaletteSet) {
    seqRef.current += 1;
    dispatch({ type: 'addPalette', palette });
  }

  function deletePalette(id: string) {
    seqRef.current += 1;
    dispatch({ type: 'deletePalette', id });
  }

  function chooseSample(sample: SampleOption) {
    void loadSampleImage(sample.url, sample.label, sample.id).then((loaded) => dispatch({ type: 'source', source: loaded }));
  }

  function removeSource() {
    clearDraft();
    dispatch({ type: 'source', source: null });
  }

  function pngExport(mode: PngMode) {
    if (!state.pattern || !loadedPalette) return;
    void exportPng(state.pattern, loadedPalette, mode).then((blob) => {
      downloadBlob(blob, `pixelbean-${state.pattern?.width}x${state.pattern?.height}-${mode}.png`);
    });
  }

  function csvExport() {
    if (!state.pattern) return;
    downloadBlob(exportCsv(stats, new Set(state.ownedCodes)), 'pixelbean-用量清单.csv');
  }

  function copyText() {
    void copyStats(stats);
  }

  function printPattern() {
    if (state.pattern && loadedPalette) printSheet(state.pattern, loadedPalette);
  }

  const currentLabel = currentPalette?.label ?? '未选择色表';
  const customCount = Object.keys(state.palettes).filter((id) => id !== 'mard-291').length;

  return (
    <div className={`app-shell mobile-section-${mobileSection} ${panelOpen ? '' : 'tablet-panel-collapsed'}`}>
      <header className="app-header">
        <div className="brand-mark">
          <span className="brand-bean" />
          <div>
            <h1>PixelBean</h1>
            <span>{currentLabel} · hex 仅近似，以 code 为准</span>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="button ghost tablet-panel-toggle"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            参数
          </button>
          {state.loading && <span className="status-pill">转换中…</span>}
          <ExportBar
            disabled={!state.pattern || !loadedPalette}
            onPng={pngExport}
            onCsv={csvExport}
            onPrint={printPattern}
          />
        </div>
      </header>
      {state.error && <div className="app-error">{state.error}</div>}
      <div className="app-body">
        <aside className="left-rail">
          <UploadZone
            source={source}
            samples={sampleOptions}
            onFile={(file) => {
              void loadImageFile(file)
                .then((loaded) => dispatch({ type: 'source', source: loaded }))
                .catch((error: unknown) => dispatch({ type: 'convertError', message: error instanceof Error ? error.message : '图片读取失败' }));
            }}
            onSample={chooseSample}
            onRemove={removeSource}
          />
          <PaletteImport
            currentId={settings.paletteId}
            customCount={customCount}
            onImport={importPalette}
            onDelete={deletePalette}
          />
          <ParamPanel
            settings={settings}
            palettes={state.palettes}
            onPatch={patchUi}
            backgroundRemoval={state.pattern?.backgroundRemoval}
          />
        </aside>
        <main className="center-column">
          <PreviewCanvas
            pattern={state.pattern}
            palette={loadedPalette}
            source={source}
            loading={state.loading}
            showCodes={settings.showCodes}
            showGridLines={settings.showGridLines}
            onToggleCodes={(value) => patchUi({ showCodes: value })}
            onToggleGrid={(value) => patchUi({ showGridLines: value })}
            hover={state.hover}
            view={state.view}
            onHover={(hover) => dispatch({ type: 'hover', hover })}
            onView={(patch) => dispatch({ type: 'view', patch })}
            onFullscreen={() => setViewerOpen(true)}
          />
          <StatsPanel
            pattern={state.pattern}
            palette={loadedPalette}
            ownedCodes={state.ownedCodes}
            onToggleOwned={(code) => dispatch({ type: 'toggleOwned', code })}
            onCopy={copyText}
            exportControls={
              <ExportBar
                disabled={!state.pattern || !loadedPalette}
                onPng={pngExport}
                onCsv={csvExport}
                onPrint={printPattern}
              />
            }
          />
        </main>
      </div>
      {viewerOpen && state.pattern && loadedPalette && (
        <div className="fullscreen-viewer" role="dialog" aria-modal="true" aria-label="全屏图纸">
          <PreviewCanvas
            pattern={state.pattern}
            palette={loadedPalette}
            source={source}
            loading={state.loading}
            fullscreen
            showCodes={settings.showCodes}
            showGridLines={settings.showGridLines}
            onToggleCodes={(value) => patchUi({ showCodes: value })}
            onToggleGrid={(value) => patchUi({ showGridLines: value })}
            hover={state.hover}
            view={state.view}
            onHover={(hover) => dispatch({ type: 'hover', hover })}
            onView={(patch) => dispatch({ type: 'view', patch })}
            onCloseFullscreen={() => setViewerOpen(false)}
          />
        </div>
      )}
      <MobileNav active={mobileSection} onChange={setMobileSection} />
      <div id="print-root" className="print-root" />
    </div>
  );
}
