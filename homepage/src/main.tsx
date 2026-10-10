import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LocaleProvider } from "./i18n";
import "./site.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("The homepage root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
