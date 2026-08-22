# k7 monorepo — local development helpers.
#
# The shell crates and k7s-server embed the frontend from their own ./dist
# (see tauri.conf.json / rust-embed). This helper fans the single frontend
# build out to every consumer.

FRONTEND := frontend
CONSUMERS := crates/k7s-desktop crates/k7s-ios crates/k7s-android crates/k7s-server

.PHONY: dist dist-clean test frontend

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
