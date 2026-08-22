# Development Guide

This guide covers how to set up, run, test, and debug the k7s project locally.

## Prerequisites

| Tool      | Minimum Version | Notes                                                       |
| --------- | --------------- | ----------------------------------------------------------- |
| Node.js   | 18+             | LTS recommended                                             |
| pnpm      | 10+             | Package manager (see `package.json` `packageManager` field) |
| Rust      | stable (1.70+)  | Required for the Tauri backend                              |
| Tauri CLI | 2.x             | Installed as devDependency (`@tauri-apps/cli`)              |

### Quick check

```bash
node --version   # >= 18
pnpm --version   # >= 10
rustc --version  # >= 1.70
```

## Project Structure

```
k7s/
├── src/                   # React frontend (TypeScript)
│   ├── components/        # UI components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility functions
│   ├── providers/         # Data providers (K8s API, HTTP transport)
│   ├── store.ts           # Zustand global store
│   ├── test/              # Test setup and helpers
│   └── main.tsx           # App entry point
├── src-tauri/             # Rust backend (Tauri)
│   ├── src/               # Rust source code
│   ├── tauri.conf.json    # Tauri configuration
│   └── Cargo.toml         # Rust dependencies
├── docs/                  # Documentation
├── dev/                   # Dev tooling scripts
├── vite.config.ts         # Vite + Vitest configuration
├── tsconfig.json          # TypeScript configuration
└── package.json           # Node dependencies and scripts
```

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start the development server (frontend only)

```bash
pnpm dev
```

This starts Vite on `http://localhost:1420` with HMR. Open the URL in a browser to preview the UI without the Tauri shell.

### 3. Start the full Tauri application

```bash
pnpm tauri:dev
```

This launches Vite AND the Rust backend. The Tauri window will open with the full application.

## Available Scripts

| Command             | Description                                      |
| ------------------- | ------------------------------------------------ |
| `pnpm dev`          | Start Vite dev server (port 1420)                |
| `pnpm build`        | Type-check + production build                    |
| `pnpm preview`      | Preview production build locally                 |
| `pnpm typecheck`    | Run `tsc --noEmit` (type errors only, no output) |
| `pnpm test`         | Run all Vitest tests once                        |
| `pnpm test:watch`   | Run Vitest in watch mode                         |
| `pnpm lint`         | Run ESLint                                       |
| `pnpm lint:fix`     | Run ESLint with auto-fix                         |
| `pnpm format`       | Format source with Prettier                      |
| `pnpm format:check` | Check formatting without modifying files         |
| `pnpm tauri:dev`    | Launch full Tauri app in dev mode                |
| `pnpm tauri:build`  | Build Tauri release binary                       |

## Testing

### Frontend tests (Vitest)

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run a specific test file
pnpm test -- src/store.test.ts

# Run tests matching a pattern
pnpm test -- -t "useTheme"
```

Tests use:

- **Vitest** as the test runner
- **jsdom** as the DOM environment
- **@testing-library/jest-dom** for custom matchers (e.g., `toBeInTheDocument`)
- Global test setup at `src/test/setup.ts`

### Rust tests

```bash
cd src-tauri
cargo test
```

## Debugging

### VSCode Debug Configurations

The project includes pre-configured debug profiles in `.vscode/launch.json`. Open the **Run and Debug** panel (`Ctrl+Shift+D` / `Cmd+Shift+D`) and select a configuration:

| Configuration            | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| **Tauri: Debug App**     | Full Tauri app with debug symbols; breakpoints in both TSX and Rust |
| **Tauri: Rust Only**     | Debug the Rust backend without launching the frontend               |
| **Frontend: Chrome**     | Debug the Vite frontend in Chrome DevTools                          |
| **Frontend: Edge**       | Debug the Vite frontend in Edge DevTools                            |
| **Test: Vitest**         | Run and debug all tests                                             |
| **Test: Single File**    | Debug the currently open test file                                  |
| **Attach: Rust Process** | Attach to an already-running Rust process                           |

### VSCode Tasks

Pre-configured tasks in `.vscode/tasks.json` (run via `Ctrl+Shift+P` -> "Tasks: Run Task"):

| Task                   | Description             |
| ---------------------- | ----------------------- |
| Vite: Dev Server       | Start Vite on port 1420 |
| Test: Run All          | Run Vitest once         |
| Test: Watch Mode       | Vitest in watch mode    |
| TypeScript: Type Check | `tsc --noEmit`          |
| Lint: ESLint           | Lint all files          |
| Format: Prettier       | Format all files        |
| Tauri: Build Release   | Release build           |
| Tauri: Cargo Test      | Run Rust tests          |

### Debugging tips

- **Frontend breakpoints**: Place `debugger;` statements or set breakpoints directly in VSCode's editor gutter when using Chrome/Edge debug configs.
- **Rust breakpoints**: Set breakpoints in `.rs` files when using the "Tauri: Debug App" or "Tauri: Rust Only" configurations. Requires the CodeLLDB extension.
- **Console logging**: Use `console.log()` in TSX and `println!()` / `log::debug!()` in Rust.
- **React DevTools**: Install the React Developer Tools browser extension for inspecting component state and props.

## Recommended VSCode Extensions

| Extension                   | Purpose                                |
| --------------------------- | -------------------------------------- |
| `rust-lang.rust-analyzer`   | Rust language support and inlay hints  |
| `vadimcn.vscode-lldb`       | Required for Rust debugging (CodeLLDB) |
| `dbaeumer.vscode-eslint`    | ESLint integration                     |
| `esbenp.prettier-vscode`    | Prettier formatting                    |
| `bradlc.vscode-tailwindcss` | Tailwind CSS IntelliSense (if used)    |

## Code Quality

### Pre-commit checks

Before committing, ensure:

```bash
pnpm typecheck   # No type errors
pnpm test        # All tests pass
pnpm format      # Code is formatted
pnpm lint        # No lint warnings
```

### Architecture decisions

- **State management**: Zustand (`src/store.ts`) with a single global store
- **Styling**: CSS Modules (`.module.css` files)
- **Data fetching**: Custom providers in `src/providers/`
- **Testing**: Component tests with Testing Library, unit tests for hooks and utilities

## Troubleshooting

### Port 1420 already in use

Kill the process occupying the port:

```bash
lsof -ti:1420 | xargs kill -9
```

### Rust build fails

Ensure Rust toolchain is up to date:

```bash
rustup update stable
cd src-tauri && cargo update
```

### Tests fail with "ResizeObserver is not defined"

This should be handled by `src/test/setup.ts`. If you see this error, ensure the setup file is correctly referenced in `vitest.config.ts` (under `test.setupFiles`).

### Tauri dev command hangs

Try cleaning the Rust build cache:

```bash
cd src-tauri && cargo clean
pnpm tauri:dev
```
