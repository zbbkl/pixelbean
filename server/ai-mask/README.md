# PixelBean · 服务端 AI 抠图（可选增强）

把「AI 抠图」从用户浏览器搬到自家服务器：**用户零下载**，服务器用 fp32 更好质量的模型。
代价是**图片会上传到服务器**（服务端不落盘、不记录像素）——决策与实测见 [`docs/47`](../../docs/47-v1.2-服务端AI抠图-架构变更与Runbook.md)。

## 组成

| 文件 | 作用 |
|---|---|
| `server.mjs` | 常驻服务：`POST /mask?model=&size=`（body = RGBA 原始字节 → 返回 `size²` 的 0/1 掩码） |
| `pixelbean-ai.service` | systemd 单元（开机自启、崩溃重启、`MemoryMax=1300M`、`CPUQuota=180%`） |
| `nginx-location.conf` | 反代片段（`/pixelbean/api/` → `127.0.0.1:8790`） |

## 为什么用 onnxruntime-web（WASM）而不是 onnxruntime-node

目标服务器实测：**Docker Hub 不可达**、`onnxruntime-node` 的 postinstall 要下原生二进制也失败，
只有 `registry.npmjs.org` 与 PyPI 可达；而 `onnxruntime-web` 是**纯 JS + wasm**，`npm i --ignore-scripts` 即可用，
且它就是我先前在浏览器侧验证过的同一套推理代码。代价是比原生慢，但在 320² 输入下可接受（见下）。

## 部署

```bash
# 1) 运行时与模型
mkdir -p /opt/pixelbean-ai/models && cd /opt/pixelbean-ai
npm init -y
npm i onnxruntime-web --ignore-scripts --no-audit --no-fund
curl -sSL -o models/u2net.onnx  https://hf-mirror.com/tomjackson2023/rembg/resolve/main/u2net.onnx
curl -sSL -o models/u2netp.onnx https://hf-mirror.com/tomjackson2023/rembg/resolve/main/u2netp.onnx
#   注：服务器上 huggingface.co / github.com 不可达，hf-mirror.com 可达，所以在服务器直接取权重最快。

# 2) 服务本体
cp server.mjs /opt/pixelbean-ai/server.mjs
cp pixelbean-ai.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now pixelbean-ai
systemctl is-active pixelbean-ai
curl -s http://127.0.0.1:8790/health

# 3) nginx（先备份配置，插片段，再 nginx -t && reload）
cp -a /etc/nginx/sites-available/<站点> /etc/nginx/sites-available/<站点>.bak.$(date +%s)
# 按 nginx-location.conf 的内容插入（放在 location /pixelbean/ 之前）
nginx -t && systemctl reload nginx
curl -s http://127.0.0.1/pixelbean/api/health

# 4) 前端
npm run build && 部署 dist（**不再包含模型**）
```

## 运维

```bash
systemctl status pixelbean-ai
tail -f /var/log/pixelbean-ai.log        # 只记 路径/状态/耗时/模型/尺寸，不记像素
curl -s http://127.0.0.1:8790/health     # { ok, model, served, loaded, switchAllowed, modelsOnDisk }
```

可调环境变量（systemd 单元里加 `Environment=`）：`MODEL_ID`（**本部署只服务这一个档位**）、
`ALLOW_MODEL_SWITCH`（默认 `0`，见下）、`PORT`、`HOST`、`MODEL_DIR`、`MAX_BODY`、
`CONCURRENCY`、`QUEUE_LIMIT`、`RATE_LIMIT`、`WASM_THREADS`、`ORT_WASM_DIR`。

> ⚠️ 改 `MODEL_ID` 时**前端 `src/worker/aiMaskClient.ts` 的 `AI_MODELS` 要同步**（否则客户端请求的 id 与服务端不符 → 400 → 自动落回确定性抠图）。

## 性能（目标服务器：2 核 / 3.4GB）

| 档位 | 模型 | 热推理 | RSS |
|---|---|---|---|
| `u2net-quality`（默认） | u2net fp32 @320² | **3.64s** | 792MB |
| `u2netp-fast` | u2netp @320² | **1.45s** | 389MB |

**同一时刻只服务一个档位（默认锁定，`ALLOW_MODEL_SWITCH=0`）**。最初实现的是「LRU=1 换入换出」，
实测**每切换一次内存涨 100~200MB**（旧 onnxruntime-web 会话的 WASM 堆不真正释放）：

| 事件 | RSS/current | cgroup 峰值 |
|---|---|---|
| 启动 + 首次推理 | 884MB | — |
| 切到另一档位 ×1 | 957MB | — |
| 切回再切 ×3（共 5 次切换） | 1133MB | **1266MB**（上限 1363MB） |

⇒ 再切几次就会被 OOM-kill，且整机 `available` 一度低到 623MB（同机还有 mysqld）。
修复：① 默认锁定单模型，请求别的 id 明确返回 **400**；② 释放旧会话时显式 `session.release?.()`；
③ 加 2GB `/swapfile` + `vm.swappiness=10` 兜底。

修复后实测：连续 8 次同一模型，**峰值恒定 940MB**（`current` 782→796MB），整机 `available` 回升到 1180MB，swap 0 使用。

需要多档位的部署：换更大内存的机器，并显式 `ALLOW_MODEL_SWITCH=1`（并接受内存随切换持续增长，建议配 `RuntimeMaxSec` 定期重启）。

## 验收

```powershell
$env:AI_SERVICE_URL='http://<host>/pixelbean/api'
npx vitest run tests/acceptance/ai-service.test.ts
```
