'use client';

// components/CredentialPreview.jsx
//
// Renders what one credential will actually look like, for one real
// recipient, using the saved design.
//
// This exists because a bulk preview that shows a TABLE of CSV rows answers
// the wrong question. The thing that goes wrong in a batch of 500 is
// visual: a name that is twice as long as the box it sits in, an email that
// overruns the signature, a badge whose title wraps onto the QR code. None
// of that is visible in a table, and by the time it is visible the
// credentials are issued and emailed.
//
// The renderer mirrors what the certificate service composites server-side
// (backend/utils/main.py): background, then shapes, then images, then text,
// with the QR in its saved position. It is a preview, so small font-metric
// differences from the server render are expected -- what it is for is
// catching layout problems that are obvious at a glance and invisible in a
// spreadsheet.
import { useMemo } from 'react';

// Fields the design can reference by text_title, resolved from the parsed
// CSV row. Kept in one place so the substitution used here cannot drift
// from what the issuance flow actually fills in.
export function resolveDynamicField(title, recipient) {
  if (!title) return null;
  const guest = recipient?.guest_recipient || {};
  const first = guest.first_name || '';
  const last = guest.last_name || '';
  const fullName = `${first} ${last}`.trim() || recipient?.achiever_username || '';

  switch (title) {
    case 'recipient_name':
    case 'full_name':
    case 'name':
      return fullName;
    case 'first_name':
      return first || fullName.split(' ')[0] || '';
    case 'last_name':
      return last || fullName.split(' ').slice(1).join(' ');
    case 'email':
      return guest.email || '';
    case 'designation':
    case 'title':
      return guest.designation || '';
    case 'city':
      return guest.city || '';
    case 'issue_date':
    case 'date':
      return new Date().toLocaleDateString();
    case 'credential_id':
    case 'credential_code':
      // Deliberately not a real code: each recipient gets a unique one
      // minted at issuance. Showing a plausible placeholder makes the
      // layout honest without implying this ID means anything.
      return 'XXXX-XXXX-XXXX';
    default:
      return null;
  }
}

export default function CredentialPreview({
  design,
  recipient,
  maxWidth = 420,
  className = '',
}) {
  const canvas = useMemo(() => ({
    w: design?.canvas_width || 900,
    h: design?.canvas_height || 636,
  }), [design]);

  const scale = Math.min(maxWidth / canvas.w, 1);

  if (!design) {
    return (
      <div className={`flex items-center justify-center bg-slate-50 border border-dashed border-slate-200 rounded-lg text-xs text-slate-400 ${className}`}
           style={{ width: maxWidth, height: maxWidth * 0.7 }}>
        Select a design to preview
      </div>
    );
  }

  const backgroundUrl = design.main_template_url || design.template_url || '';
  const qr = design.qr_position || design.qrPos || null;

  return (
    <div className={className} style={{ width: canvas.w * scale, height: canvas.h * scale }}>
      <div
        className="relative bg-white shadow-sm border border-slate-200 overflow-hidden"
        style={{
          width: canvas.w, height: canvas.h,
          transform: `scale(${scale})`, transformOrigin: 'top left',
        }}
      >
        {backgroundUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={backgroundUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}

        {(design.shapes || []).map((s, i) => (
          <div
            key={`shape-${i}`}
            className="absolute"
            style={{
              left: s.X ?? s.x, top: s.Y ?? s.y,
              width: s.width, height: s.shape_type === 'line' ? 0 : s.height,
              transform: `rotate(${s.rotation || 0}deg)`, transformOrigin: 'center center', boxSizing: 'border-box',
              border: s.shape_type === 'line' ? undefined : (s.stroke_width ? `${s.stroke_width}px solid ${s.stroke_color}` : undefined),
              borderTop: s.shape_type === 'line' ? `${s.stroke_width || 1}px solid ${s.stroke_color}` : undefined,
              backgroundColor: s.shape_type !== 'line' ? (s.fill_color || 'transparent') : undefined,
              borderRadius: s.shape_type === 'circle' ? '50%' : undefined,
            }}
          />
        ))}

        {/* Logo, signature and any other placed image -- the same for every
            recipient, which is exactly the point of a master design. */}
        {(design.images || []).map((im, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`img-${i}`}
            src={im.url}
            alt=""
            className="absolute"
            style={{
              left: im.X ?? im.x, top: im.Y ?? im.y, width: im.width, height: im.height,
              transform: `rotate(${im.rotation || 0}deg)`, transformOrigin: 'center center', opacity: im.opacity ?? 1,
            }}
          />
        ))}

        {(design.text_attributes || design.elements || []).map((attr, i) => {
          const font = attr.font_attributes?.[0] || {};
          const dynamic = resolveDynamicField(attr.text_title, recipient);
          // A field this recipient has no value for falls back to the
          // design's own text, so the layout still shows something rather
          // than collapsing to an empty box and looking fine when it is not.
          const value = dynamic !== null && dynamic !== '' ? dynamic : attr.text;
          const isDynamic = dynamic !== null && dynamic !== '';
          return (
            <div
              key={`text-${i}`}
              className="absolute whitespace-pre px-1"
              style={{
                left: attr.positions?.X ?? attr.x ?? 0,
                top: attr.positions?.Y ?? attr.y ?? 0,
                fontFamily: font.font_family || attr.font_family || 'Georgia',
                fontSize: font.font_size || attr.font_size || 24,
                color: font.font_color || attr.font_color || '#1f2937',
                fontWeight: font.font_weight || attr.font_weight || 'normal',
                letterSpacing: (font.letter_spacing || attr.letter_spacing) ? `${font.letter_spacing || attr.letter_spacing}px` : undefined,
                lineHeight: font.line_height || attr.line_height || 1.2,
                outline: isDynamic ? '1px dashed rgba(79,70,229,0.35)' : undefined,
              }}
            >
              {value}
            </div>
          );
        })}

        {/* The QR is mandatory on every design. Drawn as a placeholder block
            at its real saved position and size: the actual code is unique
            per credential and only exists once the credential is issued, but
            where it SITS is a layout decision worth seeing now. */}
        {qr && (
          <div
            className="absolute bg-white border border-slate-300 flex items-center justify-center"
            style={{ left: qr.x ?? qr.X, top: qr.y ?? qr.Y, width: qr.size || 100, height: qr.size || 100 }}
          >
            <span className="text-[9px] text-slate-400 text-center leading-tight px-1">QR<br />unique</span>
          </div>
        )}
      </div>
    </div>
  );
}
