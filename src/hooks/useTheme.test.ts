/**
 * Behavioural tests for `useTheme`'s `startThemeSync` subscription (B52, pass-25).
 *
 * The follow-up queue from passes 22 / 23 / 24 listed "Settings theme picker
 * mid-session resolution" as untested. The behavioural claim is: switching
 * the theme in Settings (from "dark" to "system", say) while the OS is in
 * the opposite mode should *immediately* re-resolve the palette — no
 * Settings reopen, no app reload, no waiting for the next OS flip.
 *
 * The same path also handles the in-flight OS-flip case: a user on "system"
 * sees the palette change the moment the OS does, without ever touching the
 * Settings panel. Both are the same subscription — `startThemeSync`'s
 * `useStore.subscribe(apply)` — and both are pinned here.
 *
 * These drive the real subscription, not a copy of its logic, because the
 * interesting part is the *wiring* (subscribe + apply + cacheTheme). A unit
 * test of `resolveTheme` alone would miss a regression that subscribes to
 * the wrong slice or applies to the wrong attribute.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store";
import { startThemeSync } from "./useTheme";

/** Read the palette actually painted on the document. */
function liveTheme(): string {
  return document.documentElement.dataset.theme ?? "";
}

/** Read the OS-level colour scheme hint, which `applyTheme` sets in parallel. */
function liveColorScheme(): string {
  return document.documentElement.style.colorScheme;
}

beforeEach(() => {
  // Reset the document between tests so a stale `data-theme` from the previous
  // test doesn't leak. jsdom's <html> is shared across tests in the same file.
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  // Belt-and-braces: the unsubscribe pattern below is the real cleanup, but if
  // a test forgot to call it, a stale subscription would apply to the next
  // test's state. Stripping every test-owned listener defensively keeps the
  // file ordering-independent.
  for (const unsub of unsubs) unsub();
  unsubs.length = 0;
});

/** Track subscribers so the afterEach can clean them up. */
const unsubs: Array<() => void> = [];

function start(): void {
  unsubs.push(startThemeSync());
}

describe("startThemeSync — initial paint", () => {
  it("applies the resolved theme to <html> on first subscribe", () => {
    // The store's initial state has `settings.theme: "system"` and
    // `systemDark: prefersDark()`. jsdom has no `matchMedia`, so
    // `prefersDark()` returns false → resolved is "light". This pins the
    // "first paint agrees with what index.html painted" contract.
    useStore.setState({ settings: { ...useStore.getState().settings, theme: "system" } });
    useStore.setState({ systemDark: false });

    start();

    expect(liveTheme()).toBe("light");
    expect(liveColorScheme()).toBe("light");
  });
});

describe("startThemeSync — Settings panel changes", () => {
  it("flips the palette the moment Settings changes theme from 'dark' to 'system' on a light OS", () => {
    // The headline behavioural claim from the pass-25 follow-up. A user who
    // had dark on, on a light desktop, switches to "system" in Settings — the
    // palette must immediately follow the OS, not stay on dark until the
    // next OS flip.
    useStore.setState({ systemDark: false });
    useStore.setState({ settings: { ...useStore.getState().settings, theme: "dark" } });
    start();
    expect(liveTheme()).toBe("dark");

    // The Settings dropdown change: SettingsPanel calls setSettings({ theme }).
    useStore.getState().setSettings({ theme: "system" });

    expect(liveTheme()).toBe("light");
    expect(liveColorScheme()).toBe("light");
  });

  it("flips the palette the moment Settings changes theme from 'light' to 'system' on a dark OS", () => {
    // Symmetric case. A light-mode user on a dark desktop switches to
    // "system" — the palette must immediately follow the dark OS.
    useStore.setState({ systemDark: true });
    useStore.setState({ settings: { ...useStore.getState().settings, theme: "light" } });
    start();
    expect(liveTheme()).toBe("light");

    useStore.getState().setSettings({ theme: "system" });

    expect(liveTheme()).toBe("dark");
    expect(liveColorScheme()).toBe("dark");
  });

  it("flips the palette when Settings changes from 'system' to an explicit choice", () => {
    // The other direction: a "system" user locks the choice to "light". The
    // OS may currently be dark, but the explicit "light" wins immediately.
    useStore.setState({ systemDark: true });
    useStore.setState({ settings: { ...useStore.getState().settings, theme: "system" } });
    start();
    expect(liveTheme()).toBe("dark");

    useStore.getState().setSettings({ theme: "light" });

    expect(liveTheme()).toBe("light");
  });
});

describe("startThemeSync — OS flip while on 'system'", () => {
  it("re-resolves to light the moment the OS flips to light", () => {
    // The in-flight OS-flip case. A user on "system" with a dark desktop
    // sees the palette follow the OS at sunset (or whenever the test
    // simulates it). The `useTheme` effect calls `onSystemThemeChange` which
    // dispatches `setSystemDark(false)`, and the subscription here must
    // apply the new resolution before React notices.
    useStore.setState({ systemDark: true });
    useStore.setState({ settings: { ...useStore.getState().settings, theme: "system" } });
    start();
    expect(liveTheme()).toBe("dark");

    useStore.getState().setSystemDark(false);

    expect(liveTheme()).toBe("light");
    expect(liveColorScheme()).toBe("light");
  });

  it("re-resolves to dark the moment the OS flips to dark", () => {
    // Symmetric OS-flip case.
    useStore.setState({ systemDark: false });
    useStore.setState({ settings: { ...useStore.getState().settings, theme: "system" } });
    start();
    expect(liveTheme()).toBe("light");

    useStore.getState().setSystemDark(true);

    expect(liveTheme()).toBe("dark");
  });

  /**
   * "Explicit choice ignores the OS" is the whole point of the picker, and
   * the same subscription must respect it. If `startThemeSync` ever
   * short-circuits on `systemDark` alone (rather than the resolved value),
   * this test fails loudly: an OS flip while the user has dark locked must
   * not move the palette.
   */
  it("ignores an OS flip when the user has picked an explicit theme", () => {
    useStore.setState({ systemDark: true });
    useStore.setState({ settings: { ...useStore.getState().settings, theme: "dark" } });
    start();
    expect(liveTheme()).toBe("dark");

    useStore.getState().setSystemDark(false);

    expect(liveTheme()).toBe("dark");
  });
});

describe("startThemeSync — unsubscribed, state changes are no-ops", () => {
  /**
   * The hook returns an unsubscribe, and the test setup relies on it. A
   * regression that forgot to call `useStore.subscribe` (or used a no-op
   * listener) would still pass the "first paint" test above, because the
   * initial `apply()` call writes the document directly. The unsubscribe
   * test is the proof that *future* state changes go through the
   * subscription, not just the constructor.
   */
  it("stops applying once unsubscribed", () => {
    useStore.setState({ systemDark: false });
    useStore.setState({ settings: { ...useStore.getState().settings, theme: "system" } });
    const unsub = startThemeSync();
    expect(liveTheme()).toBe("light");

    unsub();

    useStore.getState().setSettings({ theme: "dark" });
    expect(liveTheme()).toBe("light"); // unchanged — subscription is gone
  });
});
