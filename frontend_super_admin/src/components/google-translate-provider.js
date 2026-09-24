// components/google-translate-provider.js
"use client"

import { useState, useEffect } from 'react'
import { Globe, ChevronUp } from 'lucide-react'

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' }
]

export function GoogleTranslateProvider() {
  const [isOpen, setIsOpen] = useState(false)
  const [currentLang, setCurrentLang] = useState('en')
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    // Check if Google Translate is loaded
    const checkGoogleTranslate = () => {
      if (window.google && window.google.translate) {
        setIsLoaded(true)
      } else {
        setTimeout(checkGoogleTranslate, 100)
      }
    }
    
    checkGoogleTranslate()
  }, [])

  const changeLanguage = (langCode) => {
    if (!isLoaded) return
    
    try {
      const selectElement = document.querySelector('.goog-te-combo')
      if (selectElement) {
        selectElement.value = langCode
        selectElement.dispatchEvent(new Event('change'))
        setCurrentLang(langCode)
        setIsOpen(false)
        
        // Store language preference
        localStorage.setItem('preferred-language', langCode)
      }
    } catch (error) {
      console.error('Error changing language:', error)
    }
  }

  useEffect(() => {
    // Load saved language preference
    const savedLang = localStorage.getItem('preferred-language')
    if (savedLang && savedLang !== 'en' && isLoaded) {
      setTimeout(() => {
        changeLanguage(savedLang)
      }, 500)
    }
  }, [isLoaded])

  const currentLanguage = languages.find(lang => lang.code === currentLang) || languages[0]

  return (
    <div className="translate-floating-container">
      {/* Floating Button */}
      <button
        className="translate-floating-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Change Language"
      >
        <Globe size={16} />
        <span>{currentLanguage.flag}</span>
        <span className="hidden sm:inline">{currentLanguage.name}</span>
        <ChevronUp 
          size={14} 
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {/* Language Dropdown */}
      <div className={`translate-dropdown ${isOpen ? 'show' : ''}`}>
        {languages.map((lang) => (
          <div
            key={lang.code}
            className={`translate-option ${currentLang === lang.code ? 'active' : ''}`}
            onClick={() => changeLanguage(lang.code)}
          >
            <span className="flag-icon text-lg">{lang.flag}</span>
            <span className="font-medium">{lang.name}</span>
          </div>
        ))}
      </div>

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}