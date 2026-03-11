# 生产部署指南（自建服务器：Docker Compose + Host Nginx）

Dokploy 部署请优先参考 [`DEPLOY_DOKPLOY.md`](./DEPLOY_DOKPLOY.md)。

本指南采用“自建服务器容器化主线”，目标：

- 前端与 API 统一 Docker 打包与启动
- 站点内部监听 `127.0.0.1:4200`
- 主机 Nginx 以 `tools.heersin.cloud` 对外提供访问

## 1. 前置条件

服务器需具备：

1. `nginx`
2. `docker` + `docker compose` 插件
3. 域名 `tools.heersin.cloud` 已解析到服务器

## 2. 首次部署（推荐）

### 2.1 拉取项目并进入目录

```bash
git clone <your-repo-url> /opt/tools-subsite
cd /opt/tools-subsite
```

### 2.2 启动容器（构建 + 后台运行）

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

说明：
- `tools-web` 容器会在宿主机暴露 `127.0.0.1:4200`
- `tools-api` 只在 Docker 网络内暴露 `8080`
- `tools-web` 内部 Nginx 会把 `/api/*` 转发到 `tools-api:8080`
- 外部静态子工具按 `external_href -> submods/<toolName>` 自动挂载（例如 `/colorcard/`）

### 2.3 配置主机 Nginx

```bash
sudo cp deploy/nginx/tools.heersin.cloud.conf /etc/nginx/conf.d/tools.heersin.cloud.conf
sudo nginx -t
sudo nginx -s reload
```

该配置会把外部域名流量代理到本机 `127.0.0.1:4200`。

### 2.4 验证

```bash
# 容器健康
curl -fsS http://127.0.0.1:4200/
curl -fsS http://127.0.0.1:4200/colorcard/
curl -fsS http://127.0.0.1:4200/api/readyz

# 域名访问
curl -fsS -H 'Host: tools.heersin.cloud' http://127.0.0.1/
```

## 3. 后续发布（简化版）

更新代码后执行：

```bash
cd /opt/tools-subsite
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

若你使用镜像仓库发布，可改用：

```bash
TOOLS_WEB_IMAGE=ghcr.io/<org>/tools-web:<tag> \
TOOLS_API_IMAGE=ghcr.io/<org>/tools-api:<tag> \
docker compose -f docker-compose.prod.yml pull

TOOLS_WEB_IMAGE=ghcr.io/<org>/tools-web:<tag> \
TOOLS_API_IMAGE=ghcr.io/<org>/tools-api:<tag> \
docker compose -f docker-compose.prod.yml up -d
```

## 4. 回滚

### 4.1 Git 回滚版本（最简单）

```bash
cd /opt/tools-subsite
git checkout <old-commit-or-tag>
docker compose -f docker-compose.prod.yml up -d --build
```

### 4.2 镜像回滚（使用镜像标签）

```bash
TOOLS_WEB_IMAGE=ghcr.io/<org>/tools-web:<old-tag> \
TOOLS_API_IMAGE=ghcr.io/<org>/tools-api:<old-tag> \
docker compose -f docker-compose.prod.yml up -d
```

## 5. 运维排查

### 5.1 查看容器状态与日志

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f tools-web
docker compose -f docker-compose.prod.yml logs -f tools-api
```

### 5.2 主机 Nginx 排查

```bash
sudo nginx -t
sudo tail -n 200 /var/log/nginx/error.log
```

### 5.3 API 不可用

```bash
curl -v http://127.0.0.1:4200/api/readyz
docker compose -f docker-compose.prod.yml logs --tail 200 tools-api
```

## 6. TLS（可选）

`deploy/nginx/tools.heersin.cloud.conf` 已附带可选 `443` 模板注释。

启用步骤：

1. 签发证书（如 certbot）
2. 填写证书路径
3. 取消注释 `443` server 块
4. `nginx -t && nginx -s reload`
