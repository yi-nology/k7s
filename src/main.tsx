/**
 * React entry point. Imports global styles (which in turn bundle the fonts and
 * design tokens) and mounts the app.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { startThemeSync } from "./hooks/useTheme";
import { startLocaleSync } from "./hooks/useI18n";

// Before the first render, so nothing paints against the wrong palette (B52)
// or the wrong UI language.
startThemeSync();
startLocaleSync();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
