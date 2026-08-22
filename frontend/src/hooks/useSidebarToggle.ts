/**
 * Sidebar toggle hook for iPadOS.
 *
 * On iPadOS the sidebar becomes a drawer that overlays the content area.
 * This hook manages the open/close state and provides a toggle function.
 * On desktop the sidebar is always visible and the hook is a no-op.
 */

import { useCallback, useState } from 'react';
import { IS_IPADOS } from '../providers/transport';

export function useSidebarToggle() {
  // On iPadOS the sidebar starts collapsed; on desktop it's always visible.
  const [open, setOpen] = useState(!IS_IPADOS);

  const toggle = useCallback(() => {
    if (!IS_IPADOS) return; // no-op on desktop
    setOpen((v) => !v);
  }, []);

  const close = useCallback(() => {
    if (!IS_IPADOS) return;
    setOpen(false);
  }, []);

  return { open, toggle, close, isMobile: IS_IPADOS };
}
