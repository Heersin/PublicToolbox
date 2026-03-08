# Dokploy 部署指南（推荐）

本文档用于 `tools.heersin.cloud` 在 Dokploy 上部署本项目。

## 0. 先确认是否存在冲突配置

如果你之前已经在主机 Nginx 里手工添加了 `tools.heersin.cloud`，请先停用该配置，避免和 Dokploy 网关抢同一域名。

典型处理：

```bash
sudo rm -f /etc/nginx/conf.d/tools.heersin.cloud.conf
sudo nginx -t && sudo nginx -s reload
```

> 说明：使用 Dokploy 时，建议由 Dokploy 的网关（通常是 Traefik）统一接管域名与证书。

## 1. 在 Dokploy 创建 Compose 应用

1. 新建应用类型选择 `Docker Compose`。
2. 关联此仓库与分支（例如 `main` 或你的发布分支）。
3. Compose 文件路径填写：`docker-compose.dokploy.yml`。
4. 点击部署（Build + Run）。

本项目服务说明：

- `tools-web`：前端网关（容器内端口 `80`）
- `tools-api`：后端 API（容器内端口 `8080`，仅内部访问）
- `tools-web` 镜像会自动打包 `submods/colorcard` 并挂载为 `/color/` 工具入口

## 2. 配置域名与 HTTPS

在 Dokploy 的 Domains（或 Routing）里新增：

1. Domain: `tools.heersin.cloud`
2. Target Service: `tools-web`
3. Target Port: `80`
4. 开启 TLS/Let's Encrypt（如果你的 Dokploy 环境支持自动签发）

部署后流量路径：

- 浏览器 -> Dokploy 网关 -> `tools-web:80`
- `tools-web` 内部将 `/api/*` 反代到 `tools-api:8080`

## 3. 部署与更新

### 3.1 首次部署

在 Dokploy 界面点击 Deploy 即可。

### 3.2 后续更新

推荐两种方式：

1. Git push 到已绑定分支，Dokploy 自动/手动重新部署。
2. 在 Dokploy 里手动触发 Redeploy。

## 4. 环境变量（可选）

如你使用镜像仓库标签而非每次构建，可在 Dokploy 设置：

- `TOOLS_WEB_IMAGE`
- `TOOLS_API_IMAGE`

默认可不填，直接使用 Compose 内 build。

## 5. 验证清单

部署完成后检查：

1. 打开 `https://tools.heersin.cloud/`
2. 工具页可打开：`https://tools.heersin.cloud/subA`
3. 外部静态工具可打开：`https://tools.heersin.cloud/color/`
4. API 健康：`https://tools.heersin.cloud/api/readyz`
5. API 示例执行：`POST /api/tools/v1/run/subb-server-sample`

## 5.1 接入更多 submods 工具（Dokploy UI 无需改端口）

当你新增一个 dist 工具（例如 `/toolX`）时：

1. 把构建产物放入仓库（例如 `submods/toolX`）
2. 更新 `deploy/docker/Dockerfile.web` 与 `deploy/docker/nginx.web.conf`（新增 `/toolX` 路由映射）
3. 新增 manifest 并设置 `external_href: /toolX/`
4. 在 Dokploy 点击 Redeploy（Compose 结构通常不需要改）

## 6. 故障排查

### 6.1 域名不通

- 检查域名 DNS 是否指向 Dokploy 所在服务器。
- 检查 Dokploy Domain 配置是否绑定到 `tools-web:80`。

### 6.2 页面正常但 API 失败

- 看 `tools-api` 容器日志。
- 确认 `tools-web` 容器内 Nginx 配置仍将 `/api/*` 指向 `tools-api:8080`。

### 6.3 HTTPS 证书失败

- 确认 80/443 对公网可达。
- 检查 Dokploy 证书签发日志。

## 7. 与手工部署文档关系

- Dokploy 场景：优先使用本文档。
- 自建 Nginx + 本机 4200 场景：使用 [`docs/DEPLOY_PRODUCTION.md`](./DEPLOY_PRODUCTION.md)。
