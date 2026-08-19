# k7s Android — 本地构建 Makefile
#
# 用法:
#   make          — 构建 release APK/AAB
#   make debug    — 构建 debug APK
#   make clean    — 清理构建产物
#   make install  — 安装到已连接的 Android 设备
#
# 依赖: Rust, Node.js 26+, pnpm, Java 17+, Android SDK (NDK)
# 首次运行会自动安装 tauri-cli (如尚未安装)

SHELL := /bin/bash
.DEFAULT_GOAL := build

# 目录布局: k7/ 下 k7s-frontend/ 与 k7s-android/ 是同级目录
REPO_ROOT := $(shell git rev-parse --show-toplevel 2>/dev/null || pwd)
PARENT    := $(dir $(REPO_ROOT))
FRONTEND  := $(PARENT)k7s-frontend
DIST      := $(PARENT)dist

VERSION   := $(shell grep '^version' Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
TARGETS   := aarch64-linux-android
OUTDIR    := gen/android/app/build/outputs

# ──────────────────────────────────────────────
# 前置检查
# ──────────────────────────────────────────────
.PHONY: check-deps
check-deps:
	@command -v cargo >/dev/null  || (echo "❌ 需要安装 Rust: https://rustup.rs"; exit 1)
	@command -v pnpm  >/dev/null  || (echo "❌ 需要安装 pnpm: npm i -g pnpm"; exit 1)
	@command -v java   >/dev/null  || (echo "❌ 需要安装 Java 17+"; exit 1)
	@test -d "$$ANDROID_HOME"     || (echo "❌ 需要设置 ANDROID_HOME (Android SDK)"; exit 1)
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
# Android 构建
# ──────────────────────────────────────────────
.PHONY: init
init: check-deps check-tauri-cli frontend
	@echo "🔧 初始化 Android 项目..."
	ln -sf $(DIST) $(PARENT)dist 2>/dev/null || true
	cargo tauri android init

.PHONY: build
build: init
	@echo "🚀 构建 Android release..."
	cargo tauri android build
	@echo ""
	@echo "✅ 构建完成!"
	@echo "   APK: $(OUTDIR)/apk/universal/release/*.apk"
	@echo "   AAB: $(OUTDIR)/bundle/universalRelease/*.aab"

.PHONY: debug
debug: init
	@echo "🔧 构建 Android debug..."
	cargo tauri android build --debug
	@echo "✅ Debug APK: $(OUTDIR)/apk/universal/debug/*.apk"

.PHONY: install
install: init
	@echo "📲 安装到设备..."
	cargo tauri android build
	@adb install $(OUTDIR)/apk/universal/release/*-unsigned.apk 2>/dev/null || \
		echo "⚠️  签名 APK 需要先签名才能安装,或使用 debug 构建: make debug && adb install ..."

.PHONY: clean
clean:
	rm -rf target gen
	@echo "✅ 已清理"

# ──────────────────────────────────────────────
# 签名 (可选)
# ──────────────────────────────────────────────
.PHONY: sign
sign:
	@test -f "$(OUTDIR)/apk/universal/release/"*-unsigned.apk || (echo "❌ 请先运行 make build"; exit 1)
	@test -n "$(KEYSTORE)" || (echo "用法: make sign KEYSTORE=path/to/keystore.jks KEYPASS=xxx"; exit 1)
	@APK=$$(ls $(OUTDIR)/apk/universal/release/*-unsigned.apk | head -1); \
	jarsigner -verbose -keystore $(KEYSTORE) -storepass $(KEYPASS) "$$APK" k7s 2>/dev/null && \
	echo "✅ 已签名: $$APK"
