// components/layout/GoogleTranslateWidget.js
"use client"

import { useEffect } from 'react';
import { initGoogleTranslate } from '../../lib/googleTranslate';

export function GoogleTranslateWidget() {
  useEffect(() => {
    // Initialize Google Translate when component mounts
    const timer = setTimeout(() => {
      initGoogleTranslate();
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {/* Hidden Google Translate Element */}
      <div 
        id="google_translate_element" 
        style={{ 
          display: 'none',
          visibility: 'hidden',
          position: 'absolute',
          left: '-9999px'
        }}
      ></div>
      
      {/* Custom CSS to hide Google Translate banner and toolbar */}
      <style jsx global>{`
        /* Hide Google Translate banner */
        .goog-te-banner-frame {
          display: none !important;
        }
        
        /* Hide Google Translate toolbar */
        .goog-te-ftab {
          display: none !important;
        }
        
        /* Prevent body top margin when Google Translate is active */
        body {
          top: 0 !important;
          margin-top: 0 !important;
        }
        
        /* Hide the original Google Translate widget */
        .goog-te-gadget {
          display: none !important;
        }
        
        /* Fix for layout issues when translation is active */
        .goog-te-banner-frame.skiptranslate {
          display: none !important;
        }
        
        body.goog-te-compat-api {
          margin-top: 0 !important;
        }
        
        /* Style for when page is being translated */
        .goog-te-spinner-pos {
          position: fixed !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
        }
      `}</style>
    </>
  );
}

// Updated Header Component