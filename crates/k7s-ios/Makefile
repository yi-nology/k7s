# k7s iOS — 本地构建 Makefile
#
# 用法:
#   make          — 构建 release IPA (需要 Apple Developer 签名)
#   make debug    — 构建 debug 版本
#   make clean    — 清理构建产物
#   make simulator — 构建 iOS 模拟器版本 (无需签名)
#
# 依赖: Rust, Node.js 26+, pnpm, Xcode, Apple Developer 账号
# 首次运行会自动安装 tauri-cli (如尚未安装)
#
# 签名方式 (二选一):
#   1. 在 Xcode 中登录 Apple Developer 账号 (推荐)
#   2. 设置环境变量: APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD

SHELL := /bin/bash
.DEFAULT_GOAL := build

REPO_ROOT := $(shell git rev-parse --show-toplevel 2>/dev/null || pwd)
FRONTEND  := $(REPO_ROOT)/frontend
DIST      := $(REPO_ROOT)/dist

VERSION   := $(shell grep -m1 '^version' $(REPO_ROOT)/Cargo.toml | sed 's/.*"\(.*\)"/\1/')

# ──────────────────────────────────────────────
# 前置检查
# ──────────────────────────────────────────────
.PHONY: check-deps
check-deps:
	@command -v cargo >/dev/null   || (echo "❌ 需要安装 Rust: https://rustup.rs"; exit 1)
	@command -v pnpm  >/dev/null   || (echo "❌ 需要安装 pnpm: npm i -g pnpm"; exit 1)
	@command -v xcodebuild >/dev/null || (echo "❌ 需要安装 Xcode"; exit 1)
	@echo "✅ 依赖检查通过"

.PHONY: check-tauri-cli
check-tauri-cli:
	@command -v cargo-tauri >/dev/null || cargo install tauri-cli --version "^2.11"

# ──────────────────────────────────────────────
# 前端构建 (共享 k7/dist)
# ──────────────────────────────────────────────
.PHONY: frontend
frontend:
	@if [ ! -d "$(DIST)/assets" ]; then \
		echo "📦 构建前端..."; \
		cd $(FRONTEND) && pnpm install --frozen-lockfile && pnpm build; \
		cp -r $(FRONTEND)/dist $(DIST); \
	else \
		echo "✅ 前端产物已存在: $(DIST)"; \
	fi

# ──────────────────────────────────────────────
# iOS 构建
# ──────────────────────────────────────────────
.PHONY: init
init: check-deps check-tauri-cli frontend
	@echo "🔧 初始化 iOS 项目..."
	cargo tauri ios init

.PHONY: build
build: init
	@echo "🚀 构建 iOS release..."
	@echo "   如果 Xcode 提示签名错误,请先在 Xcode 中登录 Apple Developer 账号"
	cargo tauri ios build
	@echo ""
	@echo "✅ 构建完成!"
	@echo "   IPA: gen/apple/build/**/*.ipa"

.PHONY: debug
debug: init
	@echo "🔧 构建 iOS debug..."
	cargo tauri ios build --debug
	@echo "✅ Debug 构建完成"

.PHONY: simulator
simulator: init
	@echo "📱 构建 iOS 模拟器版本 (无需签名)..."
	cargo tauri ios build -- --arch x86_64-sim CODE_SIGNING_ALLOWED=NO
	@echo "✅ 模拟器版本构建完成"

.PHONY: clean
clean:
	rm -rf target gen
	@echo "✅ 已清理"
