# Deploy Guide

推荐主线：Dokploy（域名与容器由平台托管）。

完整步骤请优先阅读：

- Dokploy 场景：[`../docs/DEPLOY_DOKPLOY.md`](../docs/DEPLOY_DOKPLOY.md)
- 自建 Nginx 场景：[`../docs/DEPLOY_PRODUCTION.md`](../docs/DEPLOY_PRODUCTION.md)

## Quick Start (Dokploy)

1. 在 Dokploy 创建 Docker Compose 应用。
2. Compose 文件：`docker-compose.dokploy.yml`。
3. Domain 绑定：`tools.heersin.cloud -> tools-web:80`。
4. 触发 Deploy。

说明：当前仓库已内置 `/color/` 子工具（来源 `submods/colorcard`），Dokploy UI 里无需新增端口映射。

## 关键文件

- Web Dockerfile: `deploy/docker/Dockerfile.web`
- Web Nginx（容器内）: `deploy/docker/nginx.web.conf`
- Dokploy Compose: `docker-compose.dokploy.yml`
- Compose: `docker-compose.prod.yml`
- Host Nginx（对外域名）: `deploy/nginx/tools.heersin.cloud.conf`
