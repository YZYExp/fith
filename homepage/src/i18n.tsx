import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { messages } from "./content";
import type { Locale, Messages } from "./content";

const storageKey = "fith-locale";

function isLocale(value: unknown): value is Locale {
  return value === "zh" || value === "en";
}

// ?lang= wins (shareable links), then the visitor's last choice, then the browser.
function initialLocale(): Locale {
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (isLocale(fromUrl)) return fromUrl;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (isLocale(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return navigator.languages?.some((lang) => lang.toLowerCase().startsWith("zh"))
    ? "zh"
    : "en";
}

interface LocaleState {
  locale: Locale;
  t: Messages;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleState | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const t = messages[locale];

  useEffect(() => {
    document.documentElement.lang = t.htmlLang;
    document.title = t.meta.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", t.meta.description);
  }, [t]);

  function setLocale(next: Locale) {
    setLocaleState(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      /* storage unavailable */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <LocaleContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleState {
  const state = useContext(LocaleContext);
  if (!state) throw new Error("useLocale must be used inside <LocaleProvider>.");
  return state;
}
