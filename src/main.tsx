import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Global reset + design tokens replace MUI's CssBaseline at the entry level;
// the themed CssBaseline renders inside the lazily loaded AppShell so the
// entry chunk carries no MUI code.
import "./styles/tokens.css";
import "./styles/global.css";
import "virtual:uno.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const app = <App />;

// StrictMode double-invokes render/effects in development only; keep it out of
// production builds to avoid the extra overhead.
root.render(import.meta.env.DEV ? <React.StrictMode>{app}</React.StrictMode> : app);
