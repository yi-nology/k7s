/**
 * Lazy watching for custom (CRD-backed) kinds (B15).
 *
 * A cluster can define hundreds of CRDs — murphy-yi alone has 44 — so watching them
 * all on connect would open dozens of streams for data nobody is looking at.
 * Instead this hook keeps exactly one rule: *the open custom kind is watched, and
 * nothing else is*. Navigating away tears its watcher down (via the effect's
 * cleanup), which is what keeps the sidebar's watch count honest.
 *
 * Mounted once at the app root, alongside useBootstrap.
 */

import { useEffect, useRef } from 'react';
import { getProvider } from '../providers';
import { useStore } from '../store';
import { isCustomKind } from '../lib/kinds';

export function useCustomKindWatch(): void {
  const nav = useStore((s) => s.nav);
  const customKinds = useStore((s) => s.customKinds);
  const phase = useStore((s) => s.connection.phase);
  // Track whether a watch was actually started so cleanup only unwatches when
  // necessary. Without this, a customKinds reference change (same content)
  // triggers an unwatch/watch cycle for the currently-viewed kind.
  const watching = useRef(false);

  useEffect(() => {
    // Built-in kinds are watched eagerly by the backend on connect.
    if (!isCustomKind(nav)) return;
    // Nothing to watch until there's a live client.
    if (phase !== 'connected') return;
    // The kind must actually exist on this cluster. This also covers the ordering
    // on startup: a nav restored from prefs is applied before discovery lands, so
    // the effect re-runs once customKinds arrives and picks it up then.
    if (!customKinds.some((k) => k.id === nav)) return;

    const provider = getProvider();
    let cancelled = false;
    watching.current = true;
    void provider.watchCustomKind(nav).catch((e) => {
      // Non-fatal: an RBAC-forbidden CRD simply shows an empty table, matching
      // how built-in kinds degrade.
      if (!cancelled) console.warn(`could not watch ${nav}:`, e);
    });

    return () => {
      cancelled = true;
      // Only tear down the watcher if we actually started one.
      if (watching.current) {
        watching.current = false;
        void provider.unwatchCustomKind(nav).catch(() => {
          // Teardown is best-effort; the backend also drops these on reset.
        });
      }
    };
  }, [nav, customKinds, phase]);
}
