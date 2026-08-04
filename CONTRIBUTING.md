# Contributing to k7s

感谢你对 k7s 项目的关注！本文档将帮助你了解如何参与贡献。

## 开发环境设置

### 前置要求

- Node.js 26+
- pnpm 10.33.0+
- Rust 1.77.2+
- Tauri CLI

### 安装步骤

1. 克隆仓库
```bash
git clone https://github.com/your-org/k7s.git
cd k7s
```

2. 安装依赖
```bash
pnpm install
```

3. 启动开发服务器
```bash
pnpm tauri dev
```

## 代码规范

### TypeScript/React

- 使用 ESLint + Prettier
- 运行 `pnpm lint` 检查代码
- 运行 `pnpm format` 格式化代码

### Rust

- 使用 rustfmt + clippy
- 运行 `cargo fmt --check` 检查格式
- 运行 `cargo clippy -- -D warnings` 检查代码质量

## 提交规范

使用 Conventional Commits：

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

类型：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具

## Pull Request 流程

1. Fork 仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m "feat: add your feature"`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

## 测试要求

- 前端测试：`pnpm test`
- 后端测试：`cargo test`
- 所有测试必须通过才能合并

## 问题反馈

使用 GitHub Issues 报告问题，请包含：
- 问题描述
- 复现步骤
- 预期行为
- 实际行为
- 环境信息
