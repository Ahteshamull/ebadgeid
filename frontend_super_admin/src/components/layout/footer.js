// components/layout/footer.js
'use client'
import { useLocale } from "@/context/Localecontext"
export function Footer() {
  const { t } = useLocale();
  return (
    <footer className="border-t py-4 text-center text-sm text-muted-foreground">
      <p>© {new Date().getFullYear()} {t('com_footer_text')}</p>
    </footer>
  )
}