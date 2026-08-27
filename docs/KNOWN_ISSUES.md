# 已知遗留问题（2026-08-27 P0–P3 实施后仍开放）

> 本轮修复清单见 [ROADMAP.md](ROADMAP.md)。以下按优先级排列，均为本轮**未**处理或部分处理的项。

## 安全

1. **全链路明文 HTTP**：k7s-web 与 MCP 无内置 TLS。跨网部署应置于 TLS 反代之后（compose 注释已说明）。候选方案：内置 rustls 自签模式或文档化 Caddy/nginx 配置。
2. **auth setup 先到先得**：首次访问者可设置密码（单用户模型下可接受，多用户前必须改）。

## 前端

3. **ErrorBoundary 只在根**：面板级异常会白屏整个应用而非仅该面板。
4. **AiChat 轮询卡 busy**：异常路径下前端 busy 状态不复位。
5. **LogsTab 高亮错位**：日志搜索命中高亮与实际行错位。

## 架构债

6. **薄壳仓合并待拍板**：k7s-ios（~60 行）/k7s-android（~60 行）/k7s-desktop（~114 行）各自背着独立仓的全部流程。合并为单 shells 仓可减一半 subtree 同步；`make sync-repos` 已把现存模型的税降到最低，不阻塞。
7. **移动端发布流水线缺失**：仓库内无 release-android/ios workflow（仅 desktop/docker）；CI 的 cross-target check 只保证"能编译"，不产出制品。
8. **helm `--keep-history` 反转**（ops.rs 卸载语义）：本轮未动，卸载行为需产品决策。

## 功能性小项

9. **trivy `--output /dev/stdout` 在 Windows 挂**：SBOM 扫描器路径假设 Unix。
10. **webhook agent 仍是 stub**：`/hooks/agent` 只回执不执行（cron 执行器已真实，hook 复用同一 headless 路径是顺手的后续）。

## 验证环境备注

- Android/musl 交叉检查在本机受限于 NDK/musl-gcc 未配置，已写入 CI（含 NDK 工具链 env），以 CI 为准。
