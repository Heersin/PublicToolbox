# tools-web

`tools-web` 是 `tools-subsite` 的前端子应用，负责：

1. 工具总览页（书简卡片滚动布局）。
2. 工具路由页（`/:toolSlug`）。
3. 根据 `execution_mode` 调用 WASM / API / Hybrid 执行链路。

## 目录说明

- `src/pages/CatalogPage.tsx`：工具总览页
- `src/pages/ToolEntryPage.tsx`：工具执行页
- `src/lib/runtime/wasmRuntime.ts`：WASM 运行时
- `src/lib/runtime/serverRuntime.ts`：服务端 API 运行时
- `src/generated/tool-manifests.ts`：由脚本生成，不手改

## 常用命令

```bash
# 开发
npm run dev

# 构建（会自动执行 catalog + wasm）
npm run build

# lint
npm run lint
```

## 与上层仓库协作

推荐在仓库根目录执行统一命令：

```bash
npm run dev:web
npm run build:web
npm run lint:web
npm run generate:catalog
```

## 相关文档

- 根说明：[`../../README.md`](../../README.md)
- 架构文档：[`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)
- 开发文档：[`../../docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md)
- 部署文档：[`../../docs/DEPLOY_PRODUCTION.md`](../../docs/DEPLOY_PRODUCTION.md)
