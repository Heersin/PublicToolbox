# 开发文档：新增工具指南

本文档用于指导后续持续新增工具，覆盖三种场景：

1. 纯前端工具（`client-wasm`）
2. 前后端工具（`server-api`）
3. 混合工具（`hybrid`）

## 1. 开发前准备

### 1.1 环境要求

- Node.js（建议 >= 22）
- npm
- Rust（建议通过 `rustup`）
- wasm-pack

安装 wasm-pack：

```bash
cargo install wasm-pack
```

如果使用 rustup：

```bash
rustup target add wasm32-unknown-unknown
```

### 1.2 常用命令

```bash
# 1) 校验 manifest
npm run validate:manifests

# 2) 生成前后端目录产物
npm run generate:catalog

# 3) 预处理 submods 外部静态工具
npm run prepare:submods

# 4) 前端构建（自动包含 catalog + submods + wasm）
npm run build:web

# 5) Rust 测试
cargo test --workspace
```

## 2. 工具清单（Manifest）契约

文件路径：`registry/tools/<your-tool>.yaml`

关键字段：

- `id`: 全局唯一
- `slug`: URL 路由名（不能与 `api/assets/static/favicon.ico` 冲突）
- `name`, `description`, `tags`, `version`
- `execution_mode`: `client-wasm | server-api | hybrid`
- `input_schema`, `output_schema`
- `wasm_entry`（前端 WASM 工具需要）
- `api_endpoint`（服务端工具需要）
- `external_href`（外部静态工具入口，可选；例如 `/toolX/`）

最小模板：

```yaml
id: sample-tool-x
slug: subX
name: 示例工具X
description: 示例描述。
tags:
  - demo
  - text
version: 0.1.0
execution_mode: client-wasm
input_schema: schemas/subX-input.json
output_schema: schemas/subX-output.json
wasm_entry: reverse_text
```

## 3. 场景 A：新增纯前端工具（client-wasm）

### 3.1 最小步骤清单

1. 新增 manifest：`registry/tools/subX.yaml`
2. 新增 schema：`schemas/subX-input.json`、`schemas/subX-output.json`
3. 在 Rust 核心实现算法：`crates/tool-core/src/lib.rs`
4. 在 wasm 导出层暴露函数：`crates/tool-wasm/src/lib.rs`
5. 在前端 runtime 接入映射：`apps/tools-web/src/lib/runtime/wasmRuntime.ts`
6. 生成目录产物：`npm run generate:catalog`
7. 构建验证：`npm run build:web && cargo test --workspace`

### 3.2 前端接入点说明

`apps/tools-web/src/lib/runtime/wasmRuntime.ts`

- 在 `runWasmTool(entry, inputText)` 中按 `entry` 做分支。
- `entry` 与 manifest 中 `wasm_entry` 保持一致。

### 3.3 自测清单

- `/subX` 页面可访问
- 输入正常可返回结果
- 空输入和异常输入有错误提示
- 不依赖 `/api/*` 即可运行

## 4. 场景 B：新增前后端工具（server-api）

### 4.1 最小步骤清单

1. 新增 manifest（`execution_mode: server-api` + `api_endpoint`）
2. 新增 input/output schema
3. 在 `services/tools-api/src/lib.rs` 中新增 `tool.id` 分支
4. （可选）复用 `tool-core` 算法
5. 前端无需改 runtime（当前 `serverRuntime` 支持通用请求）
6. 执行目录生成与构建测试

### 4.2 服务端接入点（必须）

文件：`services/tools-api/src/lib.rs`

定位函数：`run_tool()` 内的

```rust
match tool.id.as_str() {
  // existing branches
  _ => Err(String::from("tool has no server runtime implementation")),
}
```

新增你的 `tool.id` 分支，并返回统一 JSON 数据结构。

### 4.3 API 请求示例

```bash
curl -X POST http://127.0.0.1:8080/api/tools/v1/run/sample-tool-x \
  -H 'content-type: application/json' \
  -d '{
    "tool_version": "0.1.0",
    "input": {"text": "hello world"}
  }'
```

### 4.4 自测清单

- `GET /api/tools/v1/list` 出现新工具
- `POST /api/tools/v1/run/{tool_id}` 正常返回
- 输入过大、版本不匹配、非法输入能返回合理错误

## 5. 场景 C：新增混合工具（hybrid）

### 5.1 最小步骤清单

1. manifest 设为 `execution_mode: hybrid`，同时填写 `wasm_entry` 与 `api_endpoint`
2. 完成 WASM 端实现（参考场景 A）
3. 完成 API 端实现（参考场景 B）
4. 前端在 `ToolEntryPage.tsx` 复用既有 hybrid 逻辑（通常无需新增框架代码）
5. 执行生成、构建、测试与回退验证

### 5.2 回退行为说明（当前实现）

文件：`apps/tools-web/src/pages/ToolEntryPage.tsx`

- 优先执行 WASM。
- 触发以下条件回退 API：
  - 输入字符数超过 `MAX_WASM_INPUT_CHARS`
  - WASM 执行抛错
- 可通过 `?forceWasmFail=1` 验证 fallback 路径。

### 5.3 自测清单

- 常规输入走 WASM
- `?forceWasmFail=1` 时走 API fallback
- 超长输入直接走 API guardrail 路径

## 6. 场景 D：集成已有 dist 到子路由（例如 `/colorcard`）

适用场景：你已经有独立前端构建产物（例如 `submods/colorcard`），希望在工具站内通过卡片入口访问。

### 6.1 最小步骤清单

1. 将 dist 放入仓库（示例：`submods/colorcard`），确保未被 `.gitignore` 忽略。
2. 新增 manifest，设置 `external_href`（如 `/colorcard/`）。
3. 确保目录名和路由名一致（例如 `submods/colorcard` 对应 `/colorcard/`）。
4. 执行 `npm run prepare:submods`（`dev/build` 会自动执行）。
5. 重新部署 `tools-web`（Dokploy 里 Redeploy 即可）。

### 6.2 Manifest 示例（外部静态工具）

```yaml
id: colorcard-static-submod
slug: colorcard
name: 配色工坊
description: 外部静态工具（来自 submods/colorcard dist）。
tags:
  - color
  - static
version: 0.1.0
execution_mode: client-wasm
input_schema: schemas/color-input.json
output_schema: schemas/color-output.json
external_href: /colorcard/
```

规则说明：

- `external_href: /toolX/` 对应目录为 `submods/toolX`
- 外部静态工具资源会被处理为 `/<toolX>/...` 路径（例如 `/<toolX>/assets/*`）
- 不需要手工改 `Dockerfile.web` 或 `nginx.web.conf` 为每个工具单独加路由

### 6.3 自测清单

- 总览页出现新书简卡片
- 点击卡片可进入 `/colorcard/`
- 刷新 `/colorcard/` 不 404
- `https://<domain>/api/readyz` 仍然可用（确认 API 反代未受影响）

## 7. 场景 E：文件上传型工具（示例：易形）

适用场景：工具输入不是纯文本，而是文件（如图片、音频、PDF），需要上传并返回二进制下载。

### 7.1 最小步骤清单

1. 新增 manifest（建议 `execution_mode: server-api`，并填写真实 `api_endpoint`）。
2. 新增 input/output schema（描述 multipart 入参和二进制响应语义）。
3. 在 `services/tools-api/src/lib.rs` 增加独立路由（例如 `/api/media/v1/convert-image`）。
4. API 使用 `multipart/form-data` 读取文件字段，并做二次大小校验（例如 16MB）。
5. 前端新增专用页面（而不是复用 `ToolEntryPage.tsx` 文本输入框）。
6. 在前端 runtime 使用 `fetch + FormData` 上传，并处理二进制响应下载。
7. 同步 Nginx `client_max_body_size`，避免大文件被网关提前拦截。

### 7.2 推荐返回约定

- 成功：`200` + 二进制 body
  - `Content-Type: image/png|image/jpeg|image/webp` 等
  - `Content-Disposition: attachment; filename="xxx.ext"`
- 失败：统一 JSON 错误结构
  - `{ success:false, error:{ code, message }, meta:{ ... } }`

### 7.3 自测清单

- 正常路径：各输入格式到各目标格式的转换均可下载并可打开。
- 异常路径：缺字段、格式非法、文件超限、multipart 解析失败均返回可读错误码。
- 部署路径：线上网关不出现 `413 Request Entity Too Large`。

## 8. 模板片段

### 7.1 Manifest（server-api）模板

```yaml
id: sample-server-tool
slug: subServer
name: 示例服务端工具
description: 在服务端执行计算。
tags:
  - demo
  - server
version: 0.1.0
execution_mode: server-api
input_schema: schemas/subServer-input.json
output_schema: schemas/subServer-output.json
api_endpoint: /api/tools/v1/run/sample-server-tool
```

### 7.2 Input schema 模板

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "tool input",
  "type": "object",
  "required": ["text"],
  "properties": {
    "text": {
      "type": "string",
      "maxLength": 20000
    }
  },
  "additionalProperties": false
}
```

### 7.3 Output schema 模板

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "tool output",
  "type": "object",
  "required": ["result"],
  "properties": {
    "result": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

## 9. 提交流程建议

每次新增工具建议包含：

1. manifest + schema
2. 对应运行时实现（WASM/API）
3. 生成产物更新
4. 测试结果

推荐提交前命令：

```bash
npm run validate:manifests
npm run generate:catalog
npm run prepare:submods
npm run build:web
cargo test --workspace
```
