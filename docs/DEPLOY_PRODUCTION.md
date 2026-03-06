# 生产部署指南（Nginx Native + tools-api Docker）

本文档面向生产环境运维，采用当前项目既有发布主线：

- `deploy/scripts/release.sh`
- `deploy/scripts/rollback.sh`

## 1. 前置条件

服务器需具备：

1. `nginx`
2. `docker`
3. `systemd`
4. 域名（示例：`tools.domain.xxx`）已解析到服务器 IP

默认路径（脚本依赖）：

- 前端版本目录：`/var/www/tools/releases`
- 前端当前版本软链：`/var/www/tools/current`
- API 环境文件：`/etc/tools-api/tools-api.env`

## 2. 首次安装流程

### 2.1 配置 Nginx 站点

```bash
sudo cp deploy/nginx/tools.domain.xxx.conf /etc/nginx/conf.d/tools.domain.xxx.conf
sudo nginx -t
sudo nginx -s reload
```

说明：
- 该配置会把 `/api/*` 代理到 `127.0.0.1:18080`。
- `root` 指向 `/var/www/tools/current`。

### 2.2 安装 tools-api systemd 服务

```bash
sudo cp deploy/systemd/tools-api.service /etc/systemd/system/tools-api.service
sudo mkdir -p /etc/tools-api
sudo cp deploy/env/tools-api.env.example /etc/tools-api/tools-api.env
```

编辑 `/etc/tools-api/tools-api.env`，设置你的镜像地址：

```env
TOOLS_API_IMAGE=ghcr.io/<org>/tools-api:<tag>
RUST_LOG=info
```

加载并启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tools-api.service
sudo systemctl status tools-api.service --no-pager
```

### 2.3 健康检查

```bash
curl -fsS http://127.0.0.1:18080/api/readyz
curl -fsS -H 'Host: tools.domain.xxx' http://127.0.0.1/
```

## 3. 日常发布流程

### 3.1 在 CI 或本地构建前端产物

```bash
npm ci
npm run build:web
```

前端构建产物目录：`apps/tools-web/dist`

将该目录上传到服务器某个临时路径（示例）：`/tmp/tools-dist`

### 3.2 构建并推送 API 镜像

```bash
docker build -f services/tools-api/Dockerfile -t ghcr.io/<org>/tools-api:<tag> .
docker push ghcr.io/<org>/tools-api:<tag>
```

### 3.3 执行发布脚本

```bash
sudo deploy/scripts/release.sh \
  --release-id 20260306_01 \
  --dist-dir /tmp/tools-dist \
  --api-image ghcr.io/<org>/tools-api:<tag> \
  --domain tools.domain.xxx
```

脚本做的事：

1. 复制前端产物到 `/var/www/tools/releases/<release-id>`
2. 更新软链 `/var/www/tools/current`
3. 更新 `/etc/tools-api/tools-api.env` 的镜像版本
4. 重启 `tools-api.service`
5. `nginx -t && nginx -s reload`
6. 执行 API 与站点健康检查；失败则自动回滚

## 4. 回滚流程

```bash
sudo deploy/scripts/rollback.sh \
  --release-id 20260305_02 \
  --api-image ghcr.io/<org>/tools-api:<old-tag>
```

回滚后建议检查：

```bash
curl -fsS http://127.0.0.1:18080/api/readyz
curl -fsS -H 'Host: tools.domain.xxx' http://127.0.0.1/
```

## 5. 运维检查清单

每次发布后建议至少确认：

1. `systemctl status tools-api.service` 正常
2. `curl /api/readyz` 返回 `ready`
3. 首页可访问：`/`
4. 至少 1 个工具页可访问：`/subA`
5. 至少 1 个 API 工具可执行：`/api/tools/v1/run/<tool_id>`

## 6. 故障排查

### 6.1 镜像拉取失败

现象：`tools-api.service` 启动失败。

排查：

```bash
sudo journalctl -u tools-api.service -n 200 --no-pager
sudo docker pull ghcr.io/<org>/tools-api:<tag>
```

### 6.2 Nginx 反代失败（/api 502/504）

排查：

```bash
sudo nginx -t
curl -v http://127.0.0.1:18080/api/readyz
sudo journalctl -u tools-api.service -n 200 --no-pager
```

### 6.3 manifest 读取失败

现象：API 启动后立即退出。

排查：

- 确认镜像里包含 `/app/registry/tools`
- 确认 `TOOLS_REGISTRY_DIR`（默认 `/app/registry/tools`）
- 查看服务日志关键字：`failed building application router`

## 7. 安全与权限建议

1. `tools-api` 仅监听 `127.0.0.1:18080`，不对公网直接暴露。
2. 站点对外统一走 Nginx。
3. 发布脚本建议仅由具备 sudo 权限的受控账号执行。

