/**
 * Merge class names; falsy values (false, null, undefined, '') are ignored.
 *
 * A minimal, dependency-free subset of `clsx`/`classnames` — enough for the
 * conditional-active-class idiom used across components:
 *
 *   cx(styles.tab, isActive && styles.tabActive)
 *
 * Keep it string-only: the app never composes non-string classes here.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  let out = '';
  for (const p of parts) {
    if (p) out += out ? ` ${p}` : p;
  }
  return out;
}
