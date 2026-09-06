# Provenance 与版权说明

本目录保存可再分发上游数据的快照、提交号、SHA-256 与许可证信息。

## Jett-Wu / Perler_Beads_Generator（MIT）

- 来源：https://github.com/Jett-Wu/Perler_Beads_Generator
- 文件：`src/palette.ts`（MARD 221 基础 + 70 扩展色，共 291）
- 快照：`jettwu-palette.ts`
- 许可证：MIT；版权声明见 `jettwu-LICENSE`
- 采集日期：2026-09-06

## maxcleme / beadcolors（MIT）

- 来源：https://github.com/maxcleme/beadcolors
- 文件：`gen/v1/mard.csv`（MARD 291 行；`reference_code, name, r, g, b, hex, contributor`）
- 快照：`beadcolors-mard.csv`
- 提交号：`94b9999`
- 许可证：MIT；版权声明见 `beadcolors-LICENSE`
- 采集日期：2026-09-06

`data/palettes/mard-291.json` 的数据段来自上述两个 MIT 源，保留上游版权声明。代码与数据转换逻辑为本项目原创。

## maxcleme / beadcolors（MIT，v1.1 扩展）

- `beadcolors-perler.csv`（Perler standard 103 色，产品号 `80-xxxxx`）
- `beadcolors-hama.csv`（Hama midi 92 色，`H01…H119`）
- 快照文件名同上；提交号 `94b9999`；许可证同 `beadcolors-LICENSE`。

## hank / perler-bead-map（MIT，交叉源）

- 文件：`hank-beads.hex.txt`（Hama/Perler/Nabbi/Artkal 扁平色名表）
- 提交号：`e95f7b124dbe7bed117ee856d5c1bedb85f874c1`；许可证见 `hank-LICENSE`。

## cornelk / beadmachine（MIT，交叉源）

- 文件：`beadmachine-colors_hama.json`（Hama midi `H1…H71` 子集）
- 提交号：`2cba9d970c85c8f1489cdedbfbe12eab92e477ff`；许可证见 `beadmachine-LICENSE`。

`data/palettes/hama-midi.json` 与 `data/palettes/perler-standard.json` 以 beadcolors 快照为主数据，hank/beadmachine 仅做交叉核对；未伪造官方色号。
