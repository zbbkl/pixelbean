import { useMemo } from 'react';
import type { Pattern } from '../../types';
import type { LoadedPalette } from '../../core/palette/types';
import { countByColor } from '../../core/pattern';

interface Props {
  pattern: Pattern | null;
  palette: LoadedPalette | null;
  ownedCodes: string[];
  onToggleOwned: (code: string) => void;
  onCopy: () => void;
}

export function StatsPanel({ pattern, palette, ownedCodes, onToggleOwned, onCopy }: Props) {
  const stats = useMemo(() => (pattern && palette ? countByColor(pattern, palette) : []), [pattern, palette]);
  const ownedSet = useMemo(() => new Set(ownedCodes), [ownedCodes]);
  const total = stats.reduce((sum, stat) => sum + stat.count, 0);
  const totalRemaining = stats.reduce((sum, stat) => sum + (ownedSet.has(stat.code) ? 0 : stat.count), 0);
  const needKinds = stats.filter((stat) => !ownedSet.has(stat.code)).length;

  return (
    <section className="stats-pane">
      <div className="pane-toolbar stats-toolbar">
        <span className="pane-title">用量</span>
        <div className="stats-summary">
          <span>总 {total} 颗</span>
          <span>{needKinds} 色待购</span>
          <span>待购 {totalRemaining} 颗</span>
        </div>
        <button className="tool-button" onClick={onCopy} disabled={!pattern}>
          复制清单
        </button>
      </div>
      {stats.length ? (
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>已有</th>
                <th>色块</th>
                <th>色号</th>
                <th>色名</th>
                <th>HEX</th>
                <th>数量</th>
                <th>占比</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat) => (
                <tr key={stat.code}>
                  <td>
                    <input
                      type="checkbox"
                      checked={ownedSet.has(stat.code)}
                      onChange={() => onToggleOwned(stat.code)}
                    />
                  </td>
                  <td><span className="swatch" style={{ background: stat.hex ?? '#fff' }} /></td>
                  <td><strong>{stat.code}</strong></td>
                  <td>{palette?.solids[stat.index]?.name ?? ''}</td>
                  <td className="hex-cell">{stat.hex ?? ''}</td>
                  <td className="num">{stat.count}</td>
                  <td className="num">{Math.round(stat.ratio * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-stats">出图后显示每色用量</div>
      )}
    </section>
  );
}
