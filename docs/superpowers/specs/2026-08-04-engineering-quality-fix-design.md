# k7s 工程质量修复设计文档

## 概述

修复 k7s 项目中的工程质量问题，包括 CI 缺失、安全配置、代码质量、测试覆盖和文档。

## 问题清单

| 优先级 | 问题 | 影响 |
|--------|------|------|
| P0 | CI 缺 Rust 测试 | 后端回归可直接发布 |
| P0 | CSP 禁用 | 安全隐患（处理 K8s 凭据） |
| P1 | 巨型文件（45K 行 types.ts 等） | 难以维护 |
| P1 | 90 个 unwrap() | 生产环境 panic 风险 |
| P1 | 零组件测试 | UI 回归无法捕获 |
| P2 | 包管理器混乱 | 构建不稳定 |
| P2 | 无 Linter 配置 | 代码风格不一致 |
| P3 | 文档缺失 | 贡献者门槛高 |

## 修复方案

### Phase 1: 基础设施

#### 1.1 统一包管理器
- 删除 `package-lock.json`
- 统一使用 pnpm
- 更新 Dockerfile 中的 pnpm 版本

#### 1.2 配置 ESLint + Prettier
- 添加 `.eslintrc.js`（继承 Tauri/React 推荐配置）
- 添加 `.prettierrc`
- 添加 `package.json` scripts：`lint`、`format`

#### 1.3 配置 rustfmt + clippy
- 添加 `rustfmt.toml`
- 在 CI 中强制检查

#### 1.4 基础 CSP
- 更新 `tauri.conf.json`，设置 Tauri 推荐的 CSP
- 允许必要的资源连接

### Phase 2: CI 重构

#### 2.1 重构 `.github/workflows/release.yml`
```yaml
jobs:
  frontend:
    - pnpm install
    - pnpm lint
    - pnpm typecheck
    - pnpm test

  backend:
    - cargo check
    - cargo clippy
    - cargo test
    - cargo fmt --check

  build:
    needs: [frontend, backend]
    - pnpm tauri:build
```

#### 2.2 本地 CI 脚本
- 添加 `scripts/pre-commit.sh`
- 集成 lint + typecheck + test

### Phase 3: 代码质量

#### 3.1 拆分巨型文件

**types.ts (45,231 行)**
```
src/types/
├── index.ts          # 导出所有类型
├── kubernetes.ts     # K8s 资源类型
├── pods.ts           # Pod 相关
├── services.ts       # Service 相关
├── deployments.ts    # Deployment 相关
├── nodes.ts          # Node 相关
└── ...
```

**properties.rs (3,590 行)**
```
src-tauri/src/kube/properties/
├── mod.rs
├── pod.rs
├── service.rs
├── deployment.rs
└── ...
```

**server.rs (2,414 行)**
```
src-tauri/src/mcp/
├── server.rs         # 主入口
├── tools.rs          # MCP 工具定义
├── handlers.rs       # 请求处理
└── types.rs          # MCP 类型
```

#### 3.2 修复 unwrap()
- 替换为 `?` 操作符
- 必要时用 `expect("上下文")` 替代
- 目标：0 个 `unwrap()` 调用

#### 3.3 修复 as any
- 添加正确的类型定义
- 使用类型守卫或泛型

### Phase 4: 测试覆盖

#### 4.1 测试工具增强
- 扩展 `src/hooks/testUtils.ts`
- 添加 Mock 数据工厂

#### 4.2 组件测试（54 个）
按目录分批：
1. `components/common/` - 基础组件
2. `components/pods/` - Pod 相关
3. `components/services/` - Service 相关
4. `components/deployments/` - Deployment 相关
5. `components/nodes/` - Node 相关
6. 其他目录

每个组件测试覆盖：
- 渲染测试
- 交互测试
- 状态测试
- 边界情况

### Phase 5: 文档

#### 5.1 CONTRIBUTING.md
- 开发环境设置
- 代码规范
- 提交规范
- PR 流程
- 测试要求

## 执行顺序

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
```

每个 Phase 完成后验证：
- Phase 1: `pnpm lint && cargo fmt --check`
- Phase 2: CI 通过
- Phase 3: `cargo test && pnpm typecheck`
- Phase 4: `pnpm test && cargo test`
- Phase 5: 文档完整性检查

## 风险缓解

| 风险 | 措施 |
|------|------|
| 拆分文件导致编译失败 | 每拆一个立即编译验证 |
| 组件测试工作量大 | 按目录分批，每批验证 |
| CI 重构可能失败 | 先在分支测试 |

## 成功标准

- [ ] CI 包含 Rust 测试
- [ ] CSP 配置正确
- [ ] 无巨型文件（< 500 行）
- [ ] 0 个 unwrap()
- [ ] 54 个组件测试
- [ ] 统一包管理器
- [ ] ESLint/Prettier 配置
- [ ] CONTRIBUTING.md 存在
