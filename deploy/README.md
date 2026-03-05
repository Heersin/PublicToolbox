# Deploy Guide

## 1) Nginx (native)
- Copy `deploy/nginx/tools.domain.xxx.conf` to `/etc/nginx/conf.d/tools.domain.xxx.conf`.
- Verify and reload:
  - `nginx -t`
  - `nginx -s reload`

## 2) tools-api (Docker + systemd)
- Build and push image:
  - `docker build -f services/tools-api/Dockerfile -t ghcr.io/<org>/tools-api:<tag> .`
  - `docker push ghcr.io/<org>/tools-api:<tag>`
- Install service:
  - `cp deploy/systemd/tools-api.service /etc/systemd/system/tools-api.service`
  - `mkdir -p /etc/tools-api`
  - `cp deploy/env/tools-api.env.example /etc/tools-api/tools-api.env`
  - edit image tag in `/etc/tools-api/tools-api.env`
  - `systemctl daemon-reload`
  - `systemctl enable --now tools-api.service`

## 3) One-click release
- `sudo deploy/scripts/release.sh --release-id <release-id> --dist-dir <frontend-dist-path> --api-image <image-tag> --domain tools.domain.xxx`

## 4) One-click rollback
- `sudo deploy/scripts/rollback.sh --release-id <release-id> --api-image <image-tag>`
