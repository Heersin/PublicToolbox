# Pipeline 文档

本文档描述当前仓库 CI 门禁（`.github/workflows/ci.yml`）及其通过标准。

## 1. 触发条件

CI 在以下事件触发：

1. `push` 到 `main` 或 `codex/**`
2. `pull_request`

## 2. 当前 Job 说明

## 2.1 `manifest-validation`

目的：保证工具清单合法且生成产物已提交。

执行内容：

1. `npm ci`
2. `npm run validate:manifests`
3. `npm run generate:catalog`
4. 校验生成文件是否有未提交变更：
   - `apps/tools-web/src/generated/tool-manifests.ts`
   - `services/tools-api/config/tool-manifests.json`

失败常见原因：

- manifest 缺少必填字段
- `id`/`slug` 重复
- `execution_mode` 非法
- 修改 manifest 后忘记执行 `npm run generate:catalog`

## 2.2 `web-build`

目的：保证前端可完整构建（含 wasm）。

执行内容：

1. Node 环境安装与 `npm ci`
2. Rust toolchain（含 `wasm32-unknown-unknown` target）
3. 安装 `wasm-pack`
4. `npm run build:web`

说明：`build:web` 的 `prebuild` 会执行 `prepare:submods`，因此会同时校验外部静态工具目录是否可用。

失败常见原因：

- `wasm-pack` 未正确安装
- Rust/WASM 导出函数与前端 runtime 映射不一致
- TypeScript 编译错误
- 存在 `external_href`，但缺少对应 `submods/<toolName>` 目录

## 2.3 `rust-tests`

目的：保证 Rust 工作区测试通过。

执行内容：

1. 安装 Rust toolchain
2. `cargo test --workspace`

失败常见原因：

- `tool-core` 单元测试失败
- `tools-api` 路由/响应测试失败
- 新增服务端分支逻辑破坏既有行为

## 3. PR 门禁规则

PR 合并前必须满足：

1. 三个 job 全部通过
2. manifest 相关变更已同步更新生成文件
3. 不允许绕过 CI 直接合并（团队流程约束）

建议在本地先执行：

```bash
npm run validate:manifests
npm run generate:catalog
npm run build:web
cargo test --workspace
```

## 4. 发布与 CI 的边界

当前 CI **只负责验收，不负责自动部署**。

生产发布由人工触发脚本执行：

- 发布：`deploy/scripts/release.sh`
- 回滚：`deploy/scripts/rollback.sh`

完整生产流程请见：

- [`docs/DEPLOY_PRODUCTION.md`](DEPLOY_PRODUCTION.md)

## 5. 故障修复指引

### 5.1 `manifest-validation` 失败

1. 阅读错误输出定位具体 manifest。
2. 修复 schema 字段后重跑：

```bash
npm run validate:manifests
npm run generate:catalog
```

3. 提交更新后的 generated 文件。

### 5.2 `web-build` 失败

1. 本地复现：

```bash
npm run build:web
```

2. 若与 WASM 相关，先验证：

```bash
npm run build:wasm
```

3. 检查 `wasmRuntime.ts` 与 `tool-wasm` 导出函数名是否一致。

### 5.3 `rust-tests` 失败

1. 本地复现：

```bash
cargo test --workspace
```

2. 根据失败测试定位模块：
- `tool-core`：算法层
- `tools-api`：接口层

## 6. 后续可选增强（非本轮）

1. 增加文档链接检查（避免 README 链接失效）
2. 增加 Shell 脚本静态检查（`shellcheck`）
3. 增加部署前 smoke test job（仍不触发自动部署）
