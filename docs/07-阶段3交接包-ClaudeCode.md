# 07 · 阶段 3 交接包（Claude Code 任务书）

> 本文件是阶段 3 的**完整任务书**，由人（或 DeepSeek）整段复制到 Claude Code 会话。
> 前置必读：`README.md` → `docs/00`（红线）→ `docs/01`（需求与验收）→ `docs/02`（架构）→ `docs/03`（算法）→ `docs/04`（数据）→ `docs/05`（交接纪律）→ `docs/06`（阶段 2 自测报告，含已知偏差）。
> **docs 与代码冲突时：先改 docs 再改代码，并在审查报告中记录。**

---

## 0. 任务概要

对 PixelBean（图片 → 拼豆像素图纸，纯前端）做**阶段 3 终审**：不是通读代码交差，而是**真的把项目跑起来**，按验收清单逐条复现，修 P0/P1 问题，补部署文档，产出可核验的审查报告。

## 1. 环境与现状（先确认，不要假设）

- 工作目录：`D:\workspace\PixelBean`（已是 git 仓库，`origin = https://github.com/zbbkl/pixelbean`，`main` 上现有 4 个提交，勿改写历史；你的工作以**新提交**追加）。
- 依赖：`node_modules/` 已存在；如需重装：`npm install`。
- 命令基线：`npm run dev`（本地预览）、`npm test`（Vitest，阶段 2 全绿 52 例）、`npx tsc --noEmit`、`npm run build`。
- 阶段 2 产物位置：色表 `data/palettes/mard-291.json`（MIT，provenance 在 `data/provenance/`）；算法 `src/core/`；UI `src/app/` + `src/worker/`；导出 `src/export/`；测试 `tests/unit/`。

## 2. 协作纪律（违反即打回）

1. **先跑后审**：每条结论都必须来自真实运行或单测，禁止"看代码觉得应该没问题"。
2. **不抄受限代码/数据**：`docs/00 §1` 许可证矩阵里的 AGPL/GPL/无证仓库（Zippland/Pindo/pbdx/perler-beads-ai/autoclaw 等）一律只参考思路；色表数据增补只能走 `docs/04` 的 MIT/官方转录链路。
3. **文件 ≤ 400 行**；核心算法零 DOM、确定性（禁 `Math.random` 进算法路径）。
4. **改接口先改 docs**：任何模块签名、数据结构、导出格式的变更，同步更新对应 docs 并在报告中列"偏差记录"。
5. **每个修复一个清晰 commit**，message 写对应问题编号（如 `fix: P0-03 透明图边缘黑边`）。
6. 全部在 `main` 上顺序提交即可（单人流水线），不要开无关分支、不要 rebase 历史。

## 3. 必做清单

### 3.1 复现运行
- [ ] `npm install && npm test` 全绿（记录用例数与耗时）
- [ ] `npx tsc --noEmit` 通过；`npm run build` 产出 `dist/` 无报错
- [ ] `npm run dev` 起服务，用真实 Chrome（或 Playwright）打开，控制台零报错

### 3.2 DoD 与用例复核（对照 docs/01 §5 与 §6）
- [ ] 逐条复跑 DoD 12 项 + 测试用例 T1–T12（**T12 的 12000×12000 真大图是阶段 2 明确遗留项，本次必须实测**，含内存/取消/上限保护表现，结果如实记录）
- [ ] 用例结果用表格输出：编号 / 期望 / 实际 / 证据（命令输出或截图路径）/ 结论(PASS|FAIL|DEV)

### 3.3 代码审查（逐项给结论与证据）
- [ ] **算法正确性**：`ciede2000.ts` 逐行对照 Sharma 2005；`tests/unit/ciede2000-vectors.ts` 34 组向量是否齐全并全过；`srgb↔linear↔Lab` 往返精度；`downsample` 边界（floor/ceil、单格宽/高、alpha 阈值）；`geometry` 锁宽高比无 off-by-one；`colorLimit` 保护集语义与 docs 一致
- [ ] **性能与内存**：Worker 无泄漏/无过期结果回跳（seq 机制）；150k 格渲染不冻结；大图路径峰值内存实测记录
- [ ] **安全与隐私**：纯前端无外传（图片不出本机）；无 `dangerouslySetInnerHTML` 类注入点；自定义色表 JSON 导入有校验与错误提示
- [ ] **健壮性**：损坏图片、超大/超小图片、空色表、非法自定义 JSON、断网刷新草稿等边界
- [ ] **工程纪律**：文件行数、`src/core` 纯净度、依赖清单符合 `docs/02 §1`、无新增非必要依赖（要加必须改 docs 并说明）
- [ ] **可访问性基础**：按钮键盘可达、色号文字对比度、悬停信息触屏替代
- [ ] **数据红线**：git grep 无受限来源代码/数据片段；`mard-291.json` 的 source/license/provenance 字段齐全

### 3.4 修复
- [ ] P0（功能错误/崩溃/数据错误）与 P1（明显体验缺陷）**直接修复并补测试**
- [ ] P2（可选优化）记入报告清单，不阻塞交付
- [ ] 修复后重跑 3.1 全绿

### 3.5 部署文档 → 产出 `docs/08-部署指南.md`
覆盖：GitHub Pages（含 **base path 坑**：`vite.config.ts` 需 `base: './'` 或仓库路径，否则资源 404）、Vercel、Nginx 三种方式 + 系统要求（Node ≥ 版本、现代浏览器）+ 常见问题（刷新 404、资源相对路径、离线 PWA 是否需要）。

### 3.6 产出物（3 项，缺一不可）
1. **`docs/08-部署指南.md`**（3.5）
2. **`docs/09-阶段3审查报告.md`**：结构 = 环境与验证记录 → DoD/T1–T12 结果表 → 代码审查逐项结论 → P0/P1 修复提交清单（commit hash + 问题描述）→ P2 遗留清单 → 偏差记录（对 docs 的改动）→ 残余风险
3. README 更新：状态表阶段 3 → ✅（附报告链接）、文档索引补 docs/07–09

## 4. 已知残余风险（来自 docs/06，审查时重点关照）
- 12000×12000 真大图未在本机实测（阶段 2 遗留 → 本次 3.2 必测）。
- `tests/fixtures` golden 为合成小图；真实照片/表情包效果需人工抽验。
- 屏幕色与真实豆色有偏差：图纸以**色号**为准的设计是否在 UI 有说明（docs/01 诚实原则）。
- MARD-291 的 hex 为社区测量/近似（`quality: community-verified`），代码/UI 不得宣称"官方精确色"。

## 5. 交接提示词模板（可整段复制给 Claude Code）

```
你是 PixelBean 拼豆图纸生成器的阶段 3 审查者（Claude Code）。
先完整阅读工作区 README.md 与 docs/00~06（00 许可证红线、01 需求与
DoD/T1-T12、02 架构签名、03 算法伪代码、04 色表契约、05 纪律、06 阶段2自测报告）。
工作目录 D:\workspace\PixelBean 已是 git 仓库（main 上 4 个提交，勿改写历史）。

严格按 docs/07 执行：先跑起来（npm test/tsc/build/dev + 真实浏览器零报错），
逐条复测 docs/01 DoD 与 T1-T12（含 12000×12000 大图遗留项），按 docs/07 §3.3
逐项审查并给证据；P0/P1 直接修复并补测试（文件 ≤400 行、算法零 DOM、
改接口先改 docs、每个修复一个 commit）；产出 docs/08-部署指南.md 与
docs/09-阶段3审查报告.md，更新 README。
先给我 30 秒的实施计划再开工，禁止只读代码不跑项目。
```

## 6. 人工/DeepSeek 复核点（阶段 3 回来后的验收）
1. `docs/09` 里每条 FAIL/DEV 是否有真实证据与处理结果；
2. P0/P1 修复提交是否都带测试且 `npm test` 仍全绿；
3. `docs/08` 部署指南按其中一种方式实测可上线；
4. README 状态表与索引是否已同步（无断链）。
