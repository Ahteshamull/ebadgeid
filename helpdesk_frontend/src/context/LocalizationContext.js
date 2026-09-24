'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { helpdeskTranslations, languages, currencies } from '../locales';
import { setLanguageCookie, getLanguageCookie } from '../lib/languageCookie';

const LocalizationContext = createContext();

export function LocalizationProvider({ children }) {
  const [language, setLanguage] = useState('en');
  const [currency] = useState('USD');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // 1️⃣ Try cookie first
      const cookieLang = getLanguageCookie();
      if (cookieLang && helpdeskTranslations[cookieLang]) {
        setLanguage(cookieLang);
        localStorage.setItem('language', cookieLang);
      } else {
        // 2️⃣ Fallback to localStorage
        const savedLanguage = localStorage.getItem('language');
        if (savedLanguage && helpdeskTranslations[savedLanguage]) {
          setLanguage(savedLanguage);
          setLanguageCookie(savedLanguage);
        }
      }
      setIsLoading(false);
    }
  }, []);

  const changeLanguage = (newLanguage) => {
    if (helpdeskTranslations[newLanguage]) {
      setLanguage(newLanguage);
      if (typeof window !== 'undefined') {
        localStorage.setItem('language', newLanguage);
        setLanguageCookie(newLanguage); // 3️⃣ Sync across subdomains
      }
    }
  };

  // Price utilities unchanged ...
  const convertPrice = (usdPrice) => parseFloat(usdPrice) || 0;
  const formatPrice = (usdPrice, options = {}) => {
    const { showCurrency = true, decimals = 2 } = options;
    let formattedPrice = convertPrice(usdPrice).toFixed(decimals);
    formattedPrice = formattedPrice.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return showCurrency ? `$${formattedPrice}` : formattedPrice;
  };
  const getCurrencySymbol = () => '$';

  const t = (key) => {
    const keys = key.split('.');
    let value = helpdeskTranslations[language];
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return key;
      }
    }
    return value || key;
  };

  const currentLanguage = languages.find(l => l.code === language);
  const currentCurrency = currencies[0];

  return (
    <LocalizationContext.Provider
      value={{
        language,
        currency,
        currentLanguage,
        currentCurrency,
        changeLanguage,
        t,
        languages,
        currencies,
        isLoading,
        convertPrice,
        formatPrice,
        getCurrencySymbol,
      }}
    >
      {children}
    </LocalizationContext.Provider>
  );
}

export const useLocalization = () => {
  const context = useContext(LocalizationContext);
  if (!context) throw new Error('useLocalization must be used within a LocalizationProvider');
  return context;
};
