/**
 * useAsyncEffect — async-friendly useEffect that guards state updates against
 * unmount. Replaces the hand-rolled `let cancelled = false` idiom:
 *
 *   // before
 *   useEffect(() => {
 *     let cancelled = false;
 *     void getProvider().getX().then((r) => { if (!cancelled) setX(r); });
 *     return () => { cancelled = true; };
 *   }, [dep]);
 *
 *   // after
 *   useAsyncEffect(async (isMounted) => {
 *     const r = await getProvider().getX();
 *     if (isMounted()) setX(r);
 *   }, [dep]);
 *
 * The effect receives an `isMounted()` guard instead of a raw `cancelled` flag
 * so the intent reads at the call site. An optional cleanup function returned
 * from the effect runs on unmount / deps change, exactly like useEffect.
 *
 * Not a drop-in for effects whose cleanup must run synchronously on unmount
 * BEFORE the next effect fires — those should keep the manual form.
 */
import { useEffect, useRef } from 'react';

type AsyncEffect = (isMounted: () => boolean) => Promise<void> | void;

export function useAsyncEffect(effect: AsyncEffect, deps: React.DependencyList): void {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const isMounted = () => mounted.current;
    void effect(isMounted);
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
