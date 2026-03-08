# Deploy Guide

推荐主线：Docker Compose（前端 + API 统一打包）+ Host Nginx 反代。

完整步骤请优先阅读：

- [`../docs/DEPLOY_PRODUCTION.md`](../docs/DEPLOY_PRODUCTION.md)

## Quick Start

```bash
# 1) 启动容器（构建）
docker compose -f docker-compose.prod.yml up -d --build

# 2) 配置主机 Nginx
sudo cp deploy/nginx/tools.heersin.cloud.conf /etc/nginx/conf.d/tools.heersin.cloud.conf
sudo nginx -t
sudo nginx -s reload
```

## 关键文件

- Web Dockerfile: `deploy/docker/Dockerfile.web`
- Web Nginx（容器内）: `deploy/docker/nginx.web.conf`
- Compose: `docker-compose.prod.yml`
- Host Nginx（对外域名）: `deploy/nginx/tools.heersin.cloud.conf`
