# k7s 演进路线（P0–P3）

> 2026-08-27 制定并于当日全部实施完成（分支 `evolution/p0-p3`，14 个提交）。
> 依据：同日全库评审（10 项严重 + ~50 项已验证问题）。遗留项见 [KNOWN_ISSUES.md](KNOWN_ISSUES.md)。

## P0 — 安全止血 ✅

| 项 | 内容 | 状态 |
|---|---|---|
| /mcp 鉴权 | merge 移到 `require_token` layer 之前 + 401 回归测试 | ✅ 8cd7af2 |
| /api/events 收口 | SSE 与 /api/status 移出 public 名单（广播 shell 输出/集群上下文） | ✅ 8cd7af2 |
| delete 绕过保护 | `delete_resource_impl` 前置 `ensure_writable`（Secrets/Helm 拒删） | ✅ 13480e0 |
| 多字节 panic | `agent.rs` 字节切片 → 字符级截断 | ✅ 13480e0 |
| install.sh | SHA256 校验（.sha256 sidecar）；`xattr -cr` 收敛为仅删 quarantine；release workflow 发布全部产物的校验和 | ✅ 454d057 |
| compose | `K7S_WEB_TOKEN` 透传进容器；注释反映真实鉴权模型 | ✅ 454d057 |

## P1 — 正确性防线 ✅

| 项 | 内容 | 状态 |
|---|---|---|
| 注册对账 | `CommandRegistry` 重名即报错（log + 不再静默覆盖）；`COMMAND_NAMES` 常量 + 双侧 reconciliation 测试（宏 ↔ 常量 ↔ `#[tauri::command]` fn ↔ registry ∪ 专用路由）——"v0.5.2 漏 27 命令"这一类 bug 结构上不可能复发 | ✅ d76ec23/ca9ea55 |
| 缺失命令可达 | 17 个 ai_* helper 进 registry、5 个 grafana CRUD 进 registry——**web 端命令面与桌面端完全对齐** | ✅ ca9ea55 |
| CI 跨 target | `cargo check`：aarch64-apple-ios / aarch64-linux-android（含 NDK 工具链 env）/ x86_64-unknown-linux-musl；iOS 本地已验证通过 | ✅ 20730d3 |
| 审计日志 | `audit.log`（JSONL，0600）——drain/rollout/pod_files/templates/image 等危险 impl + 桌面与 web 启动接线 | ✅ f08bccb |
| Secret 脱敏 | AI describe 默认脱敏（`include_secrets` 显式开启）；选中资源上下文同脱敏 | ✅ f08bccb |
| 沙箱真实化 | `AiConfig.sandbox` 被 agent 真实加载（此前恒 default，规则/预设全死配置）；arg_pattern 结构化匹配 `key=value`（含数字/bool）；按分钟限流 | ✅ f08bccb |
| 镜像导入/导出 | exec 容器名 `pod名→"debug"` 三处修复（此前必 400） | ✅ 8cd7af2 |
| helm 临时文件 | kubeconfig/values RAII Guard：0600 创建、唯一命名、所有退出路径删除 | ✅ f08bccb |
| 登录限速 | 5 次失败/60s → 429 | ✅ b7ca0fe |
| SSE 重连 | 前端事件总线 done 后指数退避重连（此前永久静默）+ 测试 | ✅ b7ca0fe |

## P2 — 收敛修坏 ✅

| 项 | 内容 | 状态 |
|---|---|---|
| LLM 超时 | connect 10s + read 5m（per-read，不杀长流） | ✅ 880c927 |
| context 压缩 | 不再拆散 tool_call↔result 配对（旧实现必产生 provider 400）；token 估算计入 tool_calls.arguments | ✅ f08bccb |
| HTML 提取 | 闭合标签解析修复（`</script>` 曾再次开启 skip，整页正文被丢） | ✅ 880c927 |
| netpol 模拟 | matchExpressions 全四算子（In/NotIn/Exists/DoesNotExist）+ namespaceSelector 用真实 ns 标签——不再对 expression-only 选择器误报"允许" | ✅ f08bccb |
| grype SBOM | `-o json` + 原生 schema 解析 + 测试 | ✅ f08bccb |
| cron 真实接线 | 5 字段表达式解析、60s 调度循环、执行前先盖 last_run 防重入；headless 执行器审批一律拒绝（无人值守绝不写集群），web 端强制 ReadOnly | ✅ ec2d647 |
| session/knowledge | 按 data_dir 共享单例 + 原子写；knowledge 同步去重 + 容量上限 | ✅ f08bccb |
| 配置路径 | XDG_CONFIG_HOME / K7S_CONFIG_DIR 生效（原 7 处只认 $HOME） | ✅ f08bccb |
| 仓模型减负 | `make sync-repos`（subtree split 推送，--dry-run）、`make set-version VER=`（单一版本源）、`make check-versions`（CI 步骤） | ✅ 9f2a12f |

## P3 — MCP/AI 工具面质量 ✅

| 项 | 内容 | 状态 |
|---|---|---|
| 工具鉴权 | /mcp 复用 web 鉴权（P0）——MCP 网关即 web 网关 | ✅ |
| 错误可自纠 | agent 工具结果与 MCP 错误统一 `{error, hint, retryable}`：未连接→提示先 connect、NotFound→提示先 list、权限/沙箱→标记不可重试 | ✅ af36978 |
| 分页 | `list_resources` 支持 limit/continueToken，大集群返回 `{items, continue}`（默认返回形状向后兼容） | ✅ af36978 |

## 验证

- `cargo test --workspace`：433 通过 / 0 失败（含新增 reconciliation×6、cron×8、netpol、sandbox、compress、browser、audit、throttle、error_shape、transport 等回归）
- `cargo clippy --workspace --all-targets -- -D warnings`：0；`cargo fmt --check`：通过
- `cargo check --target aarch64-apple-ios`：通过（修复前 iOS 完全编不过）
- 前端：typecheck + lint + **1358 测试** + build 全过
- `make check-versions`：全仓 0.5.2 一致

## 下一轮候选（未承诺）

- HTTPS/TLS：内置自签或文档化反代方案（当前全链路明文 HTTP）
- 多用户/多集群 web 部署（鉴权已就绪，会话模型仍是单用户）
- 前端 ErrorBoundary 下沉到面板级、AiChat busy 卡死、LogsTab 高亮错位（详见 KNOWN_ISSUES）
- 薄壳仓合并（desktop/ios/android → 单 shells 仓）——需要用户拍板，脚本已就绪不阻塞
