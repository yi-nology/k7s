/**
 * Plotly colours for the host's token surface. Extracted from PlotChart.tsx so
 * that file only exports a component (react-refresh); the colour resolution is
 * a pure data concern shared by the Plot wrapper and the metrics tabs directly.
 *
 * Re-resolves after mount (ref is null on the first render) and whenever the
 * app palette flips — needed so light-mode dark panels don't hand plotly the
 * document's light tokens.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';
import { plotColors } from './plot';
import { useResolvedTheme } from '../../hooks/useTheme';

export function useHostPlotColors(hostRef: RefObject<Element | null>) {
  const theme = useResolvedTheme();
  const [colors, setColors] = useState(() => plotColors());
  useLayoutEffect(() => {
    setColors(plotColors(hostRef.current));
  }, [hostRef, theme]);
  return colors;
}
