# k7 monorepo — local development helpers.
#
# The shell crates and k7s-server embed the frontend from their own ./dist
# (see tauri.conf.json / rust-embed). This helper fans the single frontend
# build out to every consumer.

FRONTEND := frontend
CONSUMERS := crates/k7s-desktop crates/k7s-ios crates/k7s-android crates/k7s-server

.PHONY: dist dist-clean test frontend sync-repos set-version check-versions

frontend:
	cd $(FRONTEND) && pnpm install --frozen-lockfile && pnpm build

# Build the frontend once and copy it into every crate that embeds it.
dist: frontend
	@for c in $(CONSUMERS); do \
		rm -rf $$c/dist; \
		cp -r $(FRONTEND)/dist $$c/dist; \
		echo "  dist -> $$c/dist"; \
	done

dist-clean:
	@for c in $(CONSUMERS); do rm -rf $$c/dist; done

# Everything CI runs.
test:
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace
	cargo test -p k7s-server --features web --test web_api
	cargo check -p k7s-server --features web,mcp
	cd $(FRONTEND) && pnpm typecheck && pnpm lint && pnpm test -- --run

# ── Multi-repo helpers ─────────────────────────────────────────────────────
# The 9 GitHub repos are fed from this aggregation tree; these three targets
# are the only sanctioned way to sync/bump versions (see scripts/*.sh).

# Push crates/* + frontend/ back to their independent repos (subtree split).
# Extra args pass through: `make sync-repos REPOS="core server"`.
REPOS ?=
sync-repos:
	scripts/sync-repos.sh $(REPOS)

# Bump every k7s crate + frontend to one version: `make set-version VER=0.6.0`.
set-version:
	@test -n "$(VER)" || (echo "usage: make set-version VER=0.6.0" >&2; exit 1)
	scripts/set-version.sh $(VER)

# Verify all crates share one version and Cargo.lock agrees.
check-versions:
	scripts/check-versions.sh
