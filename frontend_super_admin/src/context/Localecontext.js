"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import en from "../locale/en.js"
import es from "../locale/es.js"
import fr from "../locale/fr.js"

const locales = { en, es, fr }

export const LANGUAGE_OPTIONS = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
]

const LocaleContext = createContext(null)

export function LocaleProvider({ children }) {
  const [locale, setLocale] = useState("en")

  // Hydrate from localStorage once on mount
  useEffect(() => {
    const saved = localStorage.getItem("preferred-language")
    if (saved && locales[saved]) {
      setLocale(saved)
    }
  }, [])

  const changeLocale = useCallback((code) => {
    if (!locales[code]) return
    setLocale(code)
    localStorage.setItem("preferred-language", code)
  }, [])

  // Translation function – supports placeholders like {count}
  const t = useCallback(
    (key, params = {}) => {
      let translation = locales[locale]?.[key] ?? key;
      if (params && typeof params === 'object') {
        Object.keys(params).forEach(paramKey => {
          translation = translation.replace(new RegExp(`{${paramKey}}`, 'g'), params[paramKey]);
        });
      }
      return translation;
    },
    [locale]
  )

  const currentLanguage = LANGUAGE_OPTIONS.find((l) => l.code === locale) ?? LANGUAGE_OPTIONS[0]

  return (
    <LocaleContext.Provider value={{ locale, changeLocale, t, currentLanguage, LANGUAGE_OPTIONS }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>")
  return ctx
}