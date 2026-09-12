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

## 可选 AI 抠图（docs/45）—— 模型与推理运行时

> **不进仓库**：`public/models/` 已 gitignore；模型由部署侧单独上传，前端按需下载 + sha256 校验 +
> Cache Storage 缓存。以下许可链在引入前逐项核过（docs/42 §5 的纪律：不抄受限代码/权重、非商用权重一律不用）。

| 构件 | 许可 | 出处 | 结论 |
|---|---|---|---|
| **DIS / ISNet**（网络结构与权重血统） | **Apache-2.0** | https://github.com/xuebinqin/DIS （GitHub API `license.spdx_id=apache-2.0`，2026-09 实取） | ✅ 可商用（保留版权/NOTICE） |
| **rembg**（`isnet-general-use` 的 ONNX 转换与权重训练） | **MIT** | https://github.com/danielgatis/rembg | ✅ 可商用 |
| **onnxruntime-web / onnxruntime-node**（推理运行时 / 量化工具） | **MIT** | 微软官方发布 | ✅ 可商用 |
| BRIA RMBG-1.4 / 2.0 | CC BY-NC 4.0 | 官方模型卡明示「非商用」 | ❌ **不用** |
| imgly/background-removal-js | AGPL-3.0 | 仓库声明 | ❌ **不用**（AGPL 红线） |
| u2net / u2netp（备选轻量档） | Apache-2.0 | https://github.com/xuebinqin/U-2-Net | ✅ 备选（当前未启用） |

**制品（自托管，需部署侧上传）**：

| 制品 | 大小 | SHA-256 |
|---|---|---|
| `public/models/isnet-general-use-int8.onnx` | 44.2MB (46,360,717 B) | `f1b1c6f7656e532627697afc989d953be1e7ef8f55a718f3611e8c9fd50cdef7` |

**量化可复现**（本制品由我们对 rembg 的 fp32 ONNX 做 int8 动态量化而来，脚本见 docs/45 §11.1）：

```python
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic("isnet-general-use.onnx", "isnet-general-use-int8.onnx", weight_type=QuantType.QUInt8)
```

量化前后一致性实测：IoU **0.9994**、面积差 0.03%（docs/45 §11.1）⇒ 用 44.2MB 得到 170.4MB 的质量。
**注意**：`isnet-general-use-int8.onnx` 是本项目生成的新制品，公网无此文件，因此**不能走公共 CDN**，
必须自托管（docs/45 §12.2 ①）。
