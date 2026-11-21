import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
// The app's styles, for the composer and its menus, under the panel's own.
import "../style.css";
import "./capture.css";
import { CapturePanel } from "./CapturePanel";

// The macOS app's screen capture send panel (`capture.html?id=<capture>`).
const id = new URLSearchParams(location.search).get("id") ?? "";
// Light or dark follows the system as it changes.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  document.documentElement.dataset.theme = e.matches ? "dark" : "light";
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CapturePanel id={id} />
  </StrictMode>,
);
