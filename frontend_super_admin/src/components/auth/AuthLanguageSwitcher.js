"use client"

import { Globe, Check, ChevronDown } from "lucide-react"
import { useState, useRef, useEffect } from "react"
import { useLocale, LANGUAGE_OPTIONS } from "@/context/Localecontext"

/**
 * Self-contained language switcher for unauthenticated (auth) pages.
 * Uses the same LocaleContext as the header switcher, so the language
 * choice persists across login into the authenticated app.
 */
export function AuthLanguageSwitcher() {
    const { locale, changeLocale, currentLanguage } = useLocale()
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    // Close on outside click
    useEffect(() => {
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [])

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white/80 backdrop-blur-sm shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 text-sm font-medium text-gray-700 select-none"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <Globe className="h-4 w-4 text-gray-500" />
                <span className="text-base leading-none">{currentLanguage.flag}</span>
                <span className="hidden sm:inline">{currentLanguage.name}</span>
                <ChevronDown
                    className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                />
            </button>

            {open && (
                <div
                    className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50"
                    role="listbox"
                >
                    {LANGUAGE_OPTIONS.map((lang) => (
                        <button
                            key={lang.code}
                            type="button"
                            role="option"
                            aria-selected={locale === lang.code}
                            onClick={() => {
                                changeLocale(lang.code)
                                setOpen(false)
                            }}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors ${locale === lang.code
                                    ? "bg-blue-50 text-blue-700 font-medium"
                                    : "text-gray-700 hover:bg-gray-50"
                                }`}
                        >
                            <span className="text-base">{lang.flag}</span>
                            <span className="flex-1">{lang.name}</span>
                            {locale === lang.code && (
                                <Check className="h-3.5 w-3.5 text-blue-600" />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
