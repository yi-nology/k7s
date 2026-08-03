/**
 * Sidebar composition (Design §1): brand mark, cluster switcher, scrollable
 * nav, watch footer. The brand row is a CSS-only addition (the same colour mark
 * is inlined by `index.html` for the app icon — keeping it in CSS here means
 * the visual identity stays in one place).
 */

import styles from "./Sidebar.module.css";
import { ClusterSwitcher } from "./ClusterSwitcher";
import { NavList } from "./NavList";
import { WatchFooter } from "./WatchFooter";

export function Sidebar() {
  // data-surface="panel": in light mode the sidebar is dark chrome (tokens.css).
  return (
    <div className={styles.sidebar} data-surface="panel">
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden="true">k7</div>
        <div>
          <div className={styles.brandName}>k7s</div>
          <div className={styles.brandSub}>kubernetes manager</div>
        </div>
      </div>
      <ClusterSwitcher />
      <NavList />
      <WatchFooter />
    </div>
  );
}
