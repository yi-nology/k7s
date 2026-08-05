# Docker 部署指南

## 快速开始

### 使用 Docker Compose（推荐）

```bash
# 1. 复制环境变量配置文件
cp .env.example .env

# 2. 编辑 .env 文件（可选）
# K7S_PORT=8080
# KUBECONFIG=~/.kube/config

# 3. 启动服务
docker compose up -d

# 4. 查看日志
docker compose logs -f

# 5. 访问 Web 界面
open http://localhost:8080
```

### 使用 Docker 命令

```bash
# 拉取镜像
docker pull ghcr.io/zy84338719/k7s:latest

# 运行容器
docker run -d \
  --name k7s-web \
  -p 8080:8080 \
  -v $HOME/.kube/config:/home/k7s/.kube/config:ro \
  -e KUBECONFIG=/home/k7s/.kube/config \
  ghcr.io/zy84338719/k7s:latest
```

## 多架构支持

镜像支持以下架构：
- `linux/amd64` - x86_64 架构（Intel/AMD）
- `linux/arm64` - ARM64 架构（Apple Silicon, AWS Graviton 等）

Docker 会自动选择适合你系统的架构。

## 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `K7S_PORT` | `8080` | Web 界面端口 |
| `KUBECONFIG` | `~/.kube/config` | Kubernetes 配置文件路径 |
| `RUST_LOG` | `info` | 日志级别 (error/warn/info/debug/trace) |

### 数据持久化

容器使用 Docker volume 持久化以下数据：
- `/data` - 用户配置和偏好设置

```bash
# 查看 volume
docker volume ls | grep k7s

# 备份数据
docker run --rm -v k7s_k7s-data:/data -v $(pwd):/backup alpine tar czf /backup/k7s-data-backup.tar.gz /data

# 恢复数据
docker run --rm -v k7s_k7s-data:/data -v $(pwd):/backup alpine tar xzf /backup/k7s-data-backup.tar.gz -C /
```

## 常用命令

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 重启服务
docker compose restart

# 查看日志
docker compose logs -f

# 查看状态
docker compose ps

# 进入容器（调试用）
docker compose exec k7s sh

# 更新镜像
docker compose pull
docker compose up -d
```

## 自定义构建

如果需要本地构建镜像：

```bash
# 1. 构建前端
pnpm build

# 2. 构建 Docker 镜像
docker build -t k7s:local .

# 3. 使用本地镜像运行
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

创建 `docker-compose.local.yml`:

```yaml
services:
  k7s:
    image: k7s:local
```

## 故障排查

### 1. 容器无法启动

```bash
# 查看容器日志
docker compose logs k7s

# 检查容器状态
docker compose ps
```

### 2. 无法连接到 Kubernetes

```bash
# 检查 kubeconfig 是否正确挂载
docker compose exec k7s ls -la /home/k7s/.kube/

# 测试 kubectl 连接
docker compose exec k7s cat /home/k7s/.kube/config
```

### 3. 端口被占用

```bash
# 修改 .env 文件中的 K7S_PORT
K7S_PORT=9090

# 重启服务
docker compose down
docker compose up -d
```

### 4. 权限问题

```bash
# 检查 kubeconfig 文件权限
ls -la ~/.kube/config

# 确保文件可读
chmod 644 ~/.kube/config
```

## 生产环境建议

### 1. 资源限制

在 `docker-compose.yml` 中调整资源限制：

```yaml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 2G
    reservations:
      cpus: '1'
      memory: 512M
```

### 2. 日志配置

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

### 3. 健康检查

已内置健康检查，可通过以下命令查看状态：

```bash
docker inspect --format='{{.State.Health.Status}}' k7s-web
```

### 4. 安全加固

- 使用非 root 用户运行（已默认配置）
- 只读挂载 kubeconfig
- 定期更新镜像

## 相关链接

- [GitHub 仓库](https://github.com/zy84338719/k7s)
- [Docker 镜像](https://ghcr.io/zy84338719/k7s)
