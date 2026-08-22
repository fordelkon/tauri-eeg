import React from "react";
import ReactDOM from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App";
import "virtual:uno.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const app = (
  <>
    <CssBaseline />
    <App />
  </>
);

// StrictMode double-invokes render/effects in development only; keep it out of
// production builds to avoid the extra overhead.
root.render(import.meta.env.DEV ? <React.StrictMode>{app}</React.StrictMode> : app);
