# tools-subsite

`tools-subsite` 是一个独立部署在 `tools.domain.xxx` 的工具子站项目，和主博客（如 Hugo）解耦。

- 前端：`Vite + React + React Router`
- 计算：`Rust/WASM`（浏览器优先）
- 后端：`Rust + Axum`（API 兜底）
- 部署：`Nginx` 原生 + `tools-api` Docker + `systemd`

## 项目目标

1. 提供可持续上新的工具卡片子站（`/` 总览，`/:toolSlug` 工具入口）。
2. 统一工具注册方式（`registry/tools/*.yaml`）。
3. 支持三种执行模式：`client-wasm`、`server-api`、`hybrid`。
4. 支持生产发布与回滚脚本化运维。

## 快速开始（本地开发）

### 1) 安装依赖

```bash
npm install
```

### 2) 启动前端开发服务

```bash
npm run dev:web
```

默认地址：`http://127.0.0.1:5173`

### 3) 启动 API（用于 server-api / hybrid）

```bash
cargo run -p tools-api
```

API 健康检查：

```bash
curl http://127.0.0.1:8080/api/readyz
```

## 仓库结构

```text
apps/tools-web/            # React 前端子站
services/tools-api/        # Rust Axum API 服务
crates/tool-core/          # Rust 计算核心（可复用）
crates/tool-wasm/          # wasm-bindgen 绑定层
registry/tools/            # 工具清单（manifest）
schemas/                   # manifest / input / output schema
deploy/                    # nginx、systemd、发布回滚脚本
scripts/                   # catalog 生成、manifest 校验、wasm 构建
.github/workflows/         # CI pipeline
```

## 常用命令

```bash
# manifest schema 校验
npm run validate:manifests

# 生成前后端工具目录产物
npm run generate:catalog

# 单独构建 wasm 包
npm run build:wasm

# 前端构建（会自动执行 catalog + wasm）
npm run build:web

# 前端 lint
npm run lint:web

# Rust 全量测试
cargo test --workspace
```

## 文档索引

- 架构文档：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 开发文档（新增工具指南）：[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- 生产部署文档：[`docs/DEPLOY_PRODUCTION.md`](docs/DEPLOY_PRODUCTION.md)
- Pipeline 文档：[`docs/PIPELINE.md`](docs/PIPELINE.md)
- 现有部署入口：[`deploy/README.md`](deploy/README.md)

## 常见问题（FAQ）

### 1) `wasm-pack` 找不到

```bash
cargo install wasm-pack
```

如果使用 `rustup`，确保安装了 wasm target：

```bash
rustup target add wasm32-unknown-unknown
```

### 2) API 访问失败（本地）

确认 `tools-api` 在 `:8080` 监听：

```bash
curl http://127.0.0.1:8080/api/healthz
```

### 3) 前端访问 `/api/*` 失败

本地 `vite dev` 未默认反向代理 API，生产环境请使用 Nginx `/api/` 反代到 `127.0.0.1:18080`。

### 4) 新增 manifest 后页面没变化

执行：

```bash
npm run generate:catalog
```

并确认生成文件已更新：
- `apps/tools-web/src/generated/tool-manifests.ts`
- `services/tools-api/config/tool-manifests.json`
