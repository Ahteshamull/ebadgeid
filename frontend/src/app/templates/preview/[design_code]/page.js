"use client"
import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Linkedin, Loader2, AlertCircle, Building2 } from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';

// Public, unauthenticated read-only preview of a PUBLISHED template — backs
// the "Share on LinkedIn" flow off the design editor. No auth, no org
// scoping beyond what the backend already enforces (getPublicDesignPreview
// only ever returns a published design, and 404s identically for "doesn't
// exist" and "is still a draft" — see controllers/designController.js).
//
// Rendering mirrors credentials/design-editor/page.js's own canvas markup
// (same absolute-position + rotate(deg) + whitespace-pre text approach) so
// this preview is trustworthy, not a reimplementation that could drift from
// what issuing actually produces.
const CANVAS_W = 900;
const CANVAS_H = 636;
const MAX_PREVIEW_WIDTH = 760;

export default function PublicTemplatePreviewPage() {
  const params = useParams();
  const design_code = params?.design_code;

  const [design, setDesign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: CANVAS_W, h: CANVAS_H });
  const [shareMessage, setShareMessage] = useState('');

  useEffect(() => {
    if (!design_code) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/designs/public/${encodeURIComponent(design_code)}`);
        if (!res.ok) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const json = await res.json();
        if (!cancelled) setDesign(json.data);
      } catch (err) {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [design_code]);

  const backgroundUrl = design?.main_template_url || design?.template_url || '';

  const onBackgroundLoad = useCallback((e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (naturalWidth && naturalHeight) setCanvasSize({ w: naturalWidth, h: naturalHeight });
  }, []);

  const shareOnLinkedIn = () => {
    // share-offsite is the correct LinkedIn intent for sharing a link (this
    // preview page), distinct from the /profile/add?startTask=CERTIFICATION
    // flow used elsewhere for a recipient adding an *earned* credential to
    // their own profile (see verifications/credentials/[credential_code]/
    // page.js's addToLinkedInProfile) — a template isn't anyone's earned
    // achievement, so that flow doesn't apply here.
    const pageUrl = window.location.href;
    const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;
    window.open(linkedInUrl, '_blank', 'width=600,height=600,scrollbars=yes,resizable=yes,location=yes');
    setShareMessage('Opening LinkedIn to share this template…');
    setTimeout(() => setShareMessage(''), 3000);
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" role="status" aria-label="Loading template preview" />
      </main>
    );
  }

  if (notFound || !design) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-background text-center px-4">
        <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
        <h1 className="text-lg font-semibold text-foreground">Template not found</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          This template doesn&apos;t exist, or it hasn&apos;t been published yet.
        </p>
      </main>
    );
  }

  const scale = Math.min(1, MAX_PREVIEW_WIDTH / canvasSize.w);

  return (
    <main className="min-h-screen bg-background flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-3xl flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{design.credential_title || design.design_code}</h1>
          {design.organization_name && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
              <Building2 className="w-3.5 h-3.5" /> {design.organization_name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {shareMessage && <span className="text-sm text-muted-foreground">{shareMessage}</span>}
          <button
            onClick={shareOnLinkedIn}
            className="flex items-center gap-2 bg-[#0A66C2] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#08508f]"
          >
            <Linkedin className="w-4 h-4" /> Share on LinkedIn
          </button>
        </div>
      </div>

      <div
        className="bg-card rounded-lg shadow-md overflow-hidden border border-border"
        style={{ width: canvasSize.w * scale, height: canvasSize.h * scale }}
      >
        <div
          className="relative bg-muted/30"
          style={{
            width: canvasSize.w, height: canvasSize.h,
            transform: `scale(${scale})`, transformOrigin: 'top left',
          }}
        >
          {backgroundUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={backgroundUrl}
              alt=""
              onLoad={onBackgroundLoad}
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}

          {(design.shapes || []).map((s, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: s.X, top: s.Y, width: s.width, height: s.shape_type === 'line' ? 0 : s.height,
                transform: `rotate(${s.rotation || 0}deg)`, transformOrigin: 'center center', boxSizing: 'border-box',
                border: s.shape_type === 'line' ? undefined : (s.stroke_width ? `${s.stroke_width}px solid ${s.stroke_color}` : undefined),
                borderTop: s.shape_type === 'line' ? `${s.stroke_width || 1}px solid ${s.stroke_color}` : undefined,
                backgroundColor: s.shape_type !== 'line' ? (s.fill_color || 'transparent') : undefined,
                borderRadius: s.shape_type === 'circle' ? '50%' : undefined,
              }}
            />
          ))}

          {(design.images || []).map((im, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={im.url}
              alt=""
              className="absolute"
              style={{
                left: im.X, top: im.Y, width: im.width, height: im.height,
                transform: `rotate(${im.rotation || 0}deg)`, transformOrigin: 'center center', opacity: im.opacity ?? 1,
              }}
            />
          ))}

          {(design.text_attributes || []).map((attr, i) => {
            const font = attr.font_attributes?.[0] || {};
            return (
              <div
                key={i}
                className="absolute whitespace-pre px-1"
                style={{
                  left: attr.positions?.X ?? 0, top: attr.positions?.Y ?? 0,
                  fontFamily: font.font_family || 'Georgia', fontSize: font.font_size || 24,
                  color: font.font_color || '#1f2937', fontWeight: font.font_weight || 'normal',
                  letterSpacing: font.letter_spacing ? `${font.letter_spacing}px` : undefined,
                  lineHeight: font.line_height || 1.2,
                }}
              >
                {attr.text_title === 'recipient_name' ? '{{ recipient_name }}' : attr.text}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-4 max-w-md text-center">
        This is a preview of a blank template — recipient names are substituted per credential at issuance.
      </p>
    </main>
  );
}
