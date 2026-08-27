# 已知遗留问题（2026-08-28 v0.6.0 发布前更新）

> 本轮修复清单见 [ROADMAP.md](ROADMAP.md)、[CHANGELOG.md](CHANGELOG.md)。以下为仍开放项，按优先级。

## 安全

1. **auth setup 先到先得**：首次访问者可设置密码（单用户模型下可接受；做多用户前必须改）。

## 架构债

2. **薄壳仓合并待拍板**：k7s-ios（~60 行）/k7s-android（~60 行）/k7s-desktop（~114 行）各自背着独立仓的全部流程。合并为单 shells 仓可减一半 subtree 同步；`make sync-repos` 已把现存模型的税降到最低，不阻塞。**（维护者两次拍板保留 9 仓，勿自动执行）**
3. **移动端发布流水线缺失**：iOS/Android 目标编译已由 CI 门禁（cross-targets job 常绿），但仓库内没有产出安装包的 release workflow；移动壳目前定位**实验性**（见 README）。
4. **helm `--keep-history` 反转**（ops.rs 卸载语义）：卸载行为需产品决策，未动。

## 功能性小项

5. **trivy `--output /dev/stdout` 在 Windows 挂**：SBOM 扫描器路径假设 Unix。
6. **webhook agent 仍是 stub**：`/hooks/agent` 只回执不执行（cron 执行器已真实，hook 复用同一 headless 路径是顺手的后续）。
