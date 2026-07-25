import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { applyCachedTheme } from "./utils/themeApply";
import { applyCachedUserTheme } from "./utils/userTheme";

// Re-inject the last-saved Appearance theme synchronously, before React paints,
// so a custom theme doesn't flash the default palette on cold load. ThemeRuntime
// then confirms/refreshes it once auth resolves.
applyCachedTheme();
// Then the user's PERSONAL theme layer (localStorage) on top, also flash-free;
// UserThemeRuntime reconciles it to the signed-in user once auth resolves.
applyCachedUserTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
