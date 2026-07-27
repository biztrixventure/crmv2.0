import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { applyCachedTheme } from "./utils/themeApply";
import { applyCachedUserTheme } from "./utils/userTheme";
import { initPwa } from "./utils/pwa";

// Re-inject the last-saved Appearance theme synchronously, before React paints,
// so a custom theme doesn't flash the default palette on cold load. ThemeRuntime
// then confirms/refreshes it once auth resolves.
applyCachedTheme();
// Then the user's PERSONAL theme layer (localStorage) on top, also flash-free;
// UserThemeRuntime reconciles it to the signed-in user once auth resolves.
applyCachedUserTheme();
// Before the first render, because `beforeinstallprompt` can fire before React
// mounts and there is no way to ask for it after the fact. The service-worker
// registration inside waits for `load` and for the superadmin's `enabled` flag,
// so nothing here competes with first paint or changes an unconfigured boot.
initPwa();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
