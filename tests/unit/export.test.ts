import { describe, expect, it } from 'vitest';
import { exportCsv } from '../../src/export/csv';
import { statsText } from '../../src/export/stats';
import type { ColorStat } from '../../src/types';

const stats: ColorStat[] = [
  { index: 0, code: 'A01', name: '白色', hex: '#FAF4C8', count: 261, ratio: 0.1 },
  { index: 1, code: 'H07', name: '黑色', hex: '#000000', count: 16, ratio: 0.006 }
];

describe('exportCsv', () => {
  it('带 UTF-8 BOM，中文表头含色名列', async () => {
    const blob = exportCsv(stats, new Set(['H07']));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = await blob.text();
    expect(text).toContain('序号,色号,色名,HEX,数量,占比,已有,待购');
  });

  it('每行含色号与色名，Excel 中文不乱码', async () => {
    const blob = exportCsv(stats, new Set<string>());
    const text = await blob.text();
    expect(text).toContain('"A01","白色"');
    expect(text).toContain('"H07","黑色"');
  });

  it('已勾选色号标注已有、待购归零', async () => {
    const blob = exportCsv(stats, new Set(['H07']));
    const text = await blob.text();
    // 第二行 H07：已有=是，待购=0
    const rows = text.replace(/^﻿/, '').split('\r\n');
    const h07 = rows.find((row) => row.includes('"H07"'));
    expect(h07).toContain('"是"');
    expect(h07).toContain('"0"');
  });
});

describe('statsText', () => {
  it('复制清单包含色名', () => {
    const text = statsText(stats);
    expect(text).toContain('A01 白色');
    expect(text).toContain('H07 黑色');
  });
});
