# 16 · 移动端审查任务书（Claude Code 终审）

> 移动端适配由 Codex 实现并自测（109 测试全绿 + 六视口截图，见 docs/15）。本文件给 Claude Code 做**移动端终审**：独立复现、逐条复核 docs/14、代码审查触控/手势逻辑、修 P0/P1、产出审查报告。
> 前置必读：`README.md` → `docs/01 §8–10` → `docs/14`（移动端规格与验收矩阵，本轮基准）→ `docs/15`（Codex 自测报告）→ `docs/02/03`（架构/算法契约，确认本轮未触碰）。

## 1. 复现基线
- 工作目录 `D:\workspace\PixelBean`，git main（先让用户把移动端两个提交 `1fceae2`(feat) `ac3e1c1`(docs) 推到 origin 再开工）；勿改写历史，新提交追加。
- 需审阅的改动范围 = 上述两个提交；确认其 diff **未触碰** `src/core/**`、`data/**`、算法/色板/接口（docs/02 §3、docs/03 §9 契约冻结）。
- 命令基线：`npm test`（期望 109 全绿）、`npx tsc --noEmit`、`npm run build`、`npm run dev` + Playwright/Chrome 零 console 错误。

## 2. 复核矩阵
1. **验收矩阵复跑**（docs/14 §4，Codex 已有截图在 `.tools/mobile-shots/`，含 `audit.mjs`/`results.json`）：你独立抽查至少三档视口（phone-390、tiny-320、ipad-768 + desktop-1440 回归），核对：无横向溢出、三段导航状态保留、触控目标、捏合缩放/平移/双击/点按、统计内滚、打印不受影响。
2. **代码审查重点**：
   - `MobileNav.tsx`：三段切换如何保状态（参数/图纸/统计各自不丢）；激活态/可访问性（role/aria、键盘）。
   - `PreviewCanvas.tsx`（+250 行）：Pointer Events 手势数学 —— 双指捏合（两指距离→zoom、以中心/锚点为基准、1×–16× clamp）、单指平移（含拖动阈值，避免与"点按看格"冲突）、双击放大/复位（`preventDefault` 是否有效抑制页面双击缩放）、`touch-action` 设置是否正确（查看区 none/页面其余可滚）、点按单格命中（pan 后坐标换算正确）。
   - 全屏图纸查看器：打开/关闭/返回不丢状态；复用同一手势逻辑；内存（大 grid 全屏 canvas 无泄漏、`dispose`/移除监听）。
   - `mobile.css`/`mobile-viewer.css`（约 500 行新增）：四档断点、iOS 安全区 `env(safe-area-inset-bottom)`、`100dvh` 回退、输入/select ≥16px、极小屏压缩档、无 `!important` 滥用。
   - 回归：未新增运行时依赖；桌面 1440 与打印样式未破坏；导出 PNG 仍全分辨率非截屏。
3. **真机/微信近似**：Playwright `hasTouch` 模拟 + 你本地 Chrome 设备模拟；微信内嵌 webview 特性只做代码层检查（http 直连限制属平台，记入残余）。
4. 若发现交互在"点按看格 vs 拖拽 vs 双击"间有冲突或误触，给出最小修复。

## 3. 修复与产出
- P0/P1 直接修复并补测试（一修一 commit，message 带编号）；P2 记报告。
- 新增截图/证据放 `.tools/mobile-shots-review/`（不入库）。
- 产出 **`docs/17-移动端审查报告.md`**：环境验证 → 复核矩阵逐条 → 代码审查结论 → P0/P1 修复清单 → P2 → 残余风险（微信 http、个别老机型）；更新 README 状态行与索引（16/17）。

## 4. 交接提示词模板（可整段复制）

```
你是 PixelBean 移动端适配的终审者（Claude Code）。
先完整阅读 README.md 与 docs/14、docs/15（规格与 Codex 自测），确认工作区
git main 已同步（含 1fceae2/ac3e1c1 两个移动端提交），勿改写历史。

严格按 docs/16 执行：npm test(109)/tsc/build/dev+浏览器零报错；
独立抽查 phone-390/tiny-320/ipad-768/desktop-1440 四档（无横向溢出、三段导航
状态保留、触控目标、捏合缩放/平移/双击/点按、全屏查看器、统计内滚、打印）；
代码审查 PreviewCanvas 手势数学（双指捏合锚点与 clamp、点按vs拖拽冲突、
双击防页面缩放）、MobileNav 状态保留、mobile*.css 的 iOS 细节与断点；
确认 diff 未触碰 src/core、data、算法/色板/接口；P0/P1 直接修复补测试；
产出 docs/17-移动端审查报告.md 并更新 README。
先给我 30 秒计划再开工，禁止只读代码不跑项目。
```
