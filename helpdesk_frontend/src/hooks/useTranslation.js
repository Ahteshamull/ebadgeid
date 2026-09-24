// app/hooks/useTranslation.js
import { useLocalization } from '../context/LocalizationContext';

export function useTranslation() {
  const { t } = useLocalization();
  return { t };
}

// 4. Updated Header Component with Localization