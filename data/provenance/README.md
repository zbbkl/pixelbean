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
