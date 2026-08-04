#!/bin/bash
# Local CI pre-commit script
# Runs all frontend and backend checks before committing.

set -e

echo "Running pre-commit checks..."

# Frontend checks
echo "1/4 Frontend lint..."
pnpm lint

echo "2/4 Frontend typecheck..."
pnpm typecheck

echo "3/4 Frontend tests..."
pnpm test -- --run

# Backend checks
echo "4/4 Backend checks..."
cd src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cd ..

echo "All pre-commit checks passed!"
