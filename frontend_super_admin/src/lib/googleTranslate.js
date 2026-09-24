// utils/googleTranslate.js
export const initGoogleTranslate = () => {
  // Add Google Translate script to head if not already present
  if (!document.getElementById('google-translate-script')) {
    const script = document.createElement('script');
    script.id = 'google-translate-script';
    script.type = 'text/javascript';
    script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.head.appendChild(script);
  }

  // Initialize Google Translate
  window.googleTranslateElementInit = function() {
    new window.google.translate.TranslateElement({
      pageLanguage: 'en',
      includedLanguages: 'en,fr,es,de,it,pt,ru,ja,ko,zh,ar,hi,ur,tr,nl,sv,da,no,fi,pl,cs,hu,ro,bg,hr,sk,sl,et,lv,lt,mt,cy,ga,eu,ca,gl,ast,is,mk,sq,sr,bs,me,lb,rm,fur,sc,co,br,gd,kw,gv,jv,su,tl,ceb,haw,mi,sm,to,fj,ty,mg,ny,sn,st,xh,zu,sw,rw,rn,ki,lg,wo,bm,ee,tw,ak,ig,yo,ha,am,ti,om,so,dv,ne,si,my,km,lo,ka,hy,az,be,bg,mk,mn,kk,ky,tg,tk,uz,af,ps,fa,ku,sd,ur,hi,bn,as,or,te,kn,ml,ta,si,th,lo,my,ka,hy,az,be,uk,bg,mk,mn,kk,ky,tg,tk,uz',
      layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE,
      autoDisplay: false,
      multilanguagePage: true
    }, 'google_translate_element');
  };
};

export const changeLanguage = (languageCode) => {
  // Method 1: Try using the combo box
  const translateElement = document.querySelector('.goog-te-combo');
  if (translateElement) {
    translateElement.value = languageCode;
    // Try multiple event types to ensure it triggers
    translateElement.dispatchEvent(new Event('change', { bubbles: true }));
    translateElement.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Force trigger with a small delay
    setTimeout(() => {
      if (translateElement.value !== languageCode) {
        translateElement.value = languageCode;
        translateElement.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 100);
    return;
  }
  
  // Method 2: If combo box not available, try direct Google Translate trigger
  if (window.google && window.google.translate) {
    try {
      const translateInstance = window.google.translate.TranslateElement._instances[0];
      if (translateInstance) {
        translateInstance.c(languageCode);
        return;
      }
    } catch (error) {
      console.log('Direct translate method failed:', error);
    }
  }
  
  // Method 3: Use URL hash method (fallback)
  const hash = languageCode === 'en' || languageCode === '' ? '' : `#googtrans(en|${languageCode})`;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
    window.location.reload();
  }
};

export const getCurrentLanguage = () => {
  // Method 1: Check combo box
  const translateElement = document.querySelector('.goog-te-combo');
  if (translateElement && translateElement.value) {
    return translateElement.value;
  }
  
  // Method 2: Check URL hash
  const hash = window.location.hash;
  if (hash && hash.includes('googtrans')) {
    const match = hash.match(/googtrans\(en\|([^)]+)\)/);
    if (match) {
      return match[1];
    }
  }
  
  // Method 3: Check localStorage
  const savedLang = localStorage.getItem('preferred-language');
  if (savedLang && savedLang !== 'en') {
    return savedLang;
  }
  
  return 'en';
};

// Language options for the custom dropdown
export const LANGUAGE_OPTIONS = [
  { code: '', name: 'English', flag: '🇺🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ur', name: 'اردو', flag: '🇵🇰' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
  { code: 'da', name: 'Dansk', flag: '🇩🇰' },
  { code: 'no', name: 'Norsk', flag: '🇳🇴' },
  { code: 'fi', name: 'Suomi', flag: '🇫🇮' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' }
];