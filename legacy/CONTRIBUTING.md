# Contributing to k7s

感谢你对 k7s 项目的关注！本文档将帮助你了解如何参与贡献。

## 开发环境设置

### 前置要求

- Node.js 26+
- pnpm 10.33.0+
- Rust 1.77.2+
- Tauri CLI
- [sccache](https://github.com/mozilla/sccache)（`.cargo/config.toml` 配置了 `rustc-wrapper = "sccache"`，未安装会导致构建失败）

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

## 已知技术债

以下几项是已知但本次未处理的升级项，留作单独 PR（都涉及 lockfile / 配置迁移，需谨慎）：

- **ESLint 8 → 9**：当前 `eslint ^8.57.1` 已 EOL，配置仍是 legacy
  `.eslintrc.cjs`，lint 脚本用了 ESLint 9 已移除的 `--ext`。迁移需切换到
  flat config（`eslint.config.js`）并升级 `@typescript-eslint` 到 8.x。
- **Vitest → 4.1**：当前 `vitest ^3.1.3` 把 Vite 6 作为硬依赖拉入，而项目
  构建用 Vite 8；测试引擎与构建引擎不一致。Vitest 4.1 起正式支持 Vite 8。
- **schemars 版本收敛**：`Cargo.lock` 同时存在 schemars 0.8 / 0.9 / 1.x，
  源于 `rmcp` 与本 crate 的版本差。收敛需验证 rmcp 的 derive 兼容性。
- **`crates/probe` 游离于 CI**：独立 crate，不在 workspace 内，CI 不编译它。
  建议纳入根 workspace 或单独加 CI 步骤。

