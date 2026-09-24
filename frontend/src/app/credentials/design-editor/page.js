"use client"
import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Plus, Type, QrCode, Trash2, Save, Image as ImageIcon, Loader2, LayoutTemplate, Undo2, Redo2, Lock, Unlock,
  ArrowUp, ArrowDown, Grid3X3, Group, Ungroup, ZoomIn, ZoomOut, Upload, Download, ChevronDown,
  Square, Circle as CircleIcon, Minus, Sparkles, History, MessageSquare, Users, X as XIcon, RotateCw,
  Linkedin, Globe, Archive, ArchiveRestore, Copy, FileCheck, Share2, Palette, Building, Signature,
  FileText, Award,
} from 'lucide-react';
import { apiFetch, API_BASE_URL } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import { assignGroup, clampZoom, reorderLayer } from '@/lib/editor-utils.mjs';
import { TEMPLATE_LIBRARY } from '@/lib/template-library';

// Visual certificate/badge template editor — drag & drop, snap-to-alignment
// guides, live preview, reusable templates. Built on top of the /api/designs
// endpoints, plus vector shapes, placed images (asset library + AI
// generation), custom fonts, template version history, and comments/
// presence for admins collaborating on the same template (see
// AUDIT_FIXES.md for the full list and what's intentionally out of scope --
// no live cursors or operational-transform merging).
//
// Canvas size mirrors a standard landscape certificate at a manageable
// on-screen scale; positions are stored in these same canvas pixels, so
// what you see here is what the certificate generation service places.
const CANVAS_W = 900;
const CANVAS_H = 636; // ~ US Letter landscape ratio
// Badges are square by convention (LinkedIn, Credly and Open Badges all
// render them that way), not landscape like a certificate.
const BADGE_CANVAS = 600;

const BUILTIN_FONT_FAMILIES = ['Georgia', 'Arial', 'Helvetica', 'Times New Roman', 'Playfair Display', 'Montserrat'];
const FONT_WEIGHTS = ['normal', 'bold', '300', '600'];
const SNAP_THRESHOLD = 6;
const SHAPE_DEFAULTS = {
  rectangle: { width: 200, height: 120 },
  circle: { width: 120, height: 120 },
  line: { width: 220, height: 0 },
};
// Preview-only verification URL — real credentials get their real
// verification URL (and real QR) baked in server-side at issuance, see
// certificateController.js. This is purely so the editor's canvas shows an
// actual scannable QR code instead of a gray placeholder box.
const QR_PREVIEW_DATA = 'https://ebadgeid.com/verifications/credentials/PREVIEW';

const FIELD_TYPES = [
  { value: 'recipient_name', label: 'Recipient name (auto-filled at issuance)' },
  { value: 'custom', label: 'Static text (same on every certificate)' },
  // A dynamic field's text_title is NOT the literal string 'dynamic_field' --
  // that's only this dropdown's own sentinel for "currently in dynamic
  // mode." The real text_title is whatever key the admin types below (see
  // the "Field key" input), e.g. 'course_name' -- that key is what
  // credentials/page.js's issue form renders an input for, and what
  // certificateController.generateCertificate matches a caller's
  // custom_fields against. Falling back to `text` (this field's own saved
  // default) when nothing is supplied at issuance means an existing
  // 'custom' (static) field and this are really the same mechanism -- this
  // just also lets an issuer override it per credential.
  { value: 'dynamic_field', label: 'Custom field (a different value per issuance)' },
];

// Maps a saved text_title back to which FIELD_TYPES option it represents --
// 'recipient_name' and 'custom' are the two reserved sentinel values;
// anything else is an admin-chosen dynamic field key.
function fieldTypeOf(text_title) {
  if (text_title === 'recipient_name') return 'recipient_name';
  if (text_title === 'custom') return 'custom';
  return 'dynamic_field';
}

let nextLocalId = 1;

function newTextElement(overrides = {}, canvasSize = { w: CANVAS_W, h: CANVAS_H }) {
  return {
    id: `local-${nextLocalId++}`,
    text_title: 'custom',
    text: 'Certificate of Achievement',
    font_family: 'Georgia',
    font_size: 32,
    font_color: '#1f2937',
    font_weight: 'bold',
    // Matches the certificate service's own defaults (utils/main.py,
    // FontAttributes) — 0 letter-spacing renders through the exact same
    // single draw.text() call it always used, 1.2 line-height only shows
    // up once the text has a line break at all.
    letter_spacing: 0,
    line_height: 1.2,
    x: canvasSize.w / 2 - 150,
    y: canvasSize.h / 2 - 20,
    ...overrides,
  };
}

function newShapeElement(shapeType, canvasSize = { w: CANVAS_W, h: CANVAS_H }) {
  const dims = SHAPE_DEFAULTS[shapeType];
  return {
    id: `local-${nextLocalId++}`,
    shape_type: shapeType,
    x: Math.round(canvasSize.w / 2 - dims.width / 2),
    y: Math.round(canvasSize.h / 2 - dims.height / 2),
    width: dims.width,
    height: dims.height,
    stroke_color: '#1f2937',
    fill_color: shapeType === 'line' ? '' : '#e5e7eb',
    stroke_width: shapeType === 'line' ? 3 : 2,
    rotation: 0,
  };
}

function newImageElement(url, naturalSize, canvasSize = { w: CANVAS_W, h: CANVAS_H }) {
  // Placed at a reasonable on-canvas size (capped so a huge upload doesn't
  // swallow the whole certificate) rather than at its real pixel dimensions.
  const maxDim = 220;
  const ratio = naturalSize && naturalSize.w ? naturalSize.w / naturalSize.h : 1;
  const width = ratio >= 1 ? maxDim : Math.round(maxDim * ratio);
  const height = ratio >= 1 ? Math.round(maxDim / ratio) : maxDim;
  return {
    id: `local-${nextLocalId++}`,
    url,
    x: Math.round(canvasSize.w / 2 - width / 2),
    y: Math.round(canvasSize.h / 2 - height / 2),
    width, height,
    rotation: 0,
    opacity: 1,
  };
}

// Upload/generation endpoints (handleUpload/handleFontUpload/
// handleGenerateImage in uploadController.js) always return an already-
// absolute URL via fileUrl() — either PUBLIC_STORAGE_BASE_URL or the
// request's own protocol+host, never a bare path — so resolving it
// against the API origin here would double it up into something like
// "http://api-hosthttp://storage-host/uploads/x.png". Only fall back to
// prefixing the API origin for the (theoretical, not currently reachable)
// case where the backend ever does return a relative path.
function resolveUploadUrl(url) {
  return /^https?:\/\//i.test(url) ? url : `${new URL(API_BASE_URL).origin}${url}`;
}

// --- Rotation-aware resize/rotate math for the transform handles --------
// Every shape/image is rendered with CSS transform-origin:center, so
// rotating never moves the element's own center -- only the visual
// position of its corners. These helpers work entirely in real screen
// coordinates (not CSS), independent of how the browser happens to be
// rendering the rotation, so the handles stay correct at any angle.
const DEG2RAD = Math.PI / 180;

function rotateVector(x, y, angleDeg) {
  const rad = angleDeg * DEG2RAD;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

// Where a point in the element's own unrotated local frame (0,0 = its
// top-left before rotation, width,height = its bottom-right) actually
// lands on screen, given its current x/y/width/height/rotation.
function localPointToScreen(localX, localY, box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const rel = rotateVector(localX - box.width / 2, localY - box.height / 2, box.rotation || 0);
  return { x: cx + rel.x, y: cy + rel.y };
}

const OPPOSITE_CORNER_LOCAL = {
  nw: (box) => ({ x: box.width, y: box.height }), // se
  ne: (box) => ({ x: 0, y: box.height }),          // sw
  se: (box) => ({ x: 0, y: 0 }),                   // nw
  sw: (box) => ({ x: box.width, y: 0 }),           // ne
};
// Mid-edge handles -- resize along a single axis only (width for e/w,
// height for n/s), anchored on the opposite edge's midpoint rather than a
// corner. Complements OPPOSITE_CORNER_LOCAL, which drives both axes at once.
const OPPOSITE_EDGE_LOCAL = {
  e: (box) => ({ x: 0, y: box.height / 2 }),          // left-middle
  w: (box) => ({ x: box.width, y: box.height / 2 }),  // right-middle
  n: (box) => ({ x: box.width / 2, y: box.height }),  // bottom-middle
  s: (box) => ({ x: box.width / 2, y: 0 }),           // top-middle
};
const EDGE_HANDLES = new Set(['n', 's', 'e', 'w']);

export default function DesignEditorPage({ initialKind } = {}) {
  const { session } = useSession();
  const [designKind, setDesignKind] = useState(initialKind || 'certificate');
  const [galleryKind, setGalleryKind] = useState(initialKind || 'certificate');
  const [templateFilter, setTemplateFilter] = useState('all'); // 'all' | 'certificate' | 'badge'
  const [organizationInfo, setOrganizationInfo] = useState({ name: '', logo: '', signature: '' });
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [activeDesignCode, setActiveDesignCode] = useState(null); // null = new template
  const [designStatus, setDesignStatus] = useState(null); // null = not saved yet; 'draft' | 'pending_review' | 'published' | 'archived' once it is
  const [currentVersion, setCurrentVersion] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [reviewInfo, setReviewInfo] = useState({ submitted_by: null, rejection_reason: null });
  const [reviewing, setReviewing] = useState(false);
  const autosaveTimerRef = useRef(null);
  const skipNextAutosaveRef = useRef(true);
  const [templateName, setTemplateName] = useState(initialKind === 'badge' ? 'Untitled badge' : 'Untitled certificate');
  const [backgroundUrl, setBackgroundUrl] = useState('');
  const [elements, setElements] = useState([newTextElement({ text_title: 'recipient_name', text: 'Recipient Name', y: 300 })]);
  const [shapes, setShapes] = useState([]);
  const [images, setImages] = useState([]);
  const [qrPos, setQrPos] = useState({
    x: (initialKind === 'badge' ? BADGE_CANVAS : CANVAS_W) - (initialKind === 'badge' ? 110 : 120),
    y: (initialKind === 'badge' ? BADGE_CANVAS : CANVAS_H) - (initialKind === 'badge' ? 110 : 120)
  });

  useEffect(() => {
    if (initialKind && ['certificate', 'badge'].includes(initialKind)) {
      setDesignKind(initialKind);
      setGalleryKind(initialKind);
      if (initialKind === 'badge' && !activeDesignCode) {
        setCanvasSize({ w: BADGE_CANVAS, h: BADGE_CANVAS });
        setQrPos({ x: BADGE_CANVAS - 110, y: BADGE_CANVAS - 110 });
        setTemplateName('Untitled badge');
      }
    } else if (typeof window !== 'undefined') {
      const paramKind = new URLSearchParams(window.location.search).get('kind');
      if (paramKind && ['certificate', 'badge'].includes(paramKind)) {
        setDesignKind(paramKind);
        setGalleryKind(paramKind);
        if (paramKind === 'badge' && !activeDesignCode) {
          setCanvasSize({ w: BADGE_CANVAS, h: BADGE_CANVAS });
          setQrPos({ x: BADGE_CANVAS - 110, y: BADGE_CANVAS - 110 });
          setTemplateName('Untitled badge');
        }
      }
    }
  }, [initialKind, activeDesignCode]);
  // The canvas is sized to whatever background image is actually loaded —
  // there's nothing in the certificate service (utils/main.py) that assumes
  // a fixed size; it loads the real template image and draws at absolute
  // X/Y coordinates on it, whatever its dimensions are. Defaulting to
  // 900x636 just matches a blank canvas and the six built-in starter
  // templates, which are that size natively.
  const [canvasSize, setCanvasSize] = useState({ w: CANVAS_W, h: CANVAS_H });
  const [selectedId, setSelectedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(0.8);
  const [guides, setGuides] = useState({ x: null, y: null });
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const canvasRef = useRef(null);
  const dragState = useRef(null);
  const transformState = useRef(null);
  const history = useRef([]);
  const future = useRef([]);
  const fileInputRef = useRef(null);

  const organizationCode = session?.organization_code;

  const snapshot = () => ({ elements, shapes, images, qrPos, backgroundUrl, canvasSize });
  const restore = (state) => {
    setElements(state.elements);
    setShapes(state.shapes || []);
    setImages(state.images || []);
    setQrPos(state.qrPos);
    setBackgroundUrl(state.backgroundUrl);
    if (state.canvasSize) setCanvasSize(state.canvasSize);
    setSelectedId(null);
    setSelectedIds([]);
  };

  // Reads an image's real pixel dimensions in the browser — the only
  // reliable way to know a background's actual size without asking the
  // backend (which doesn't track it either; storage.js serves whatever
  // bytes were uploaded). Resolves null on failure (broken URL, CORS) so
  // callers can just keep whatever canvas size was already set instead of
  // crashing the editor over an unreachable image.
  const probeImageSize = (url) => new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new window.Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
  const checkpoint = () => {
    history.current.push(structuredClone(snapshot()));
    if (history.current.length > 100) history.current.shift();
    future.current = [];
  };
  const undo = () => {
    const state = history.current.pop();
    if (!state) return;
    future.current.push(structuredClone(snapshot()));
    restore(state);
  };
  const redo = () => {
    const state = future.current.pop();
    if (!state) return;
    history.current.push(structuredClone(snapshot()));
    restore(state);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      // Never while the user is actually typing somewhere (the template
      // name field, a numeric input in the inspector, any text field) --
      // otherwise Ctrl+C/V here would hijack real text copy/paste, and
      // Delete/Backspace would delete the selected shape instead of a
      // character.
      const target = event.target;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
        else if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
        else if (event.key.toLowerCase() === 'd' && selectedId && selectedId !== 'qr') { event.preventDefault(); duplicateSelected(); }
        else if (!isTyping && event.key.toLowerCase() === 'c' && selectedId && selectedId !== 'qr') { event.preventDefault(); copySelected(); }
        else if (!isTyping && event.key.toLowerCase() === 'v' && clipboardRef.current) { event.preventDefault(); pasteClipboard(); }
        return;
      }
      // Delete/Backspace only act on a selected canvas element, same guard.
      if (!isTyping && (event.key === 'Delete' || event.key === 'Backspace') && selectedId && selectedId !== 'qr') {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const loadTemplates = async (includeArchivedParam) => {
    if (!organizationCode) return;
    setLoadingTemplates(true);
    try {
      const query = includeArchivedParam ? '?include_archived=true' : '';
      const res = await apiFetch(`/designs/organization/${organizationCode}${query}`);
      const json = await res.json();
      setTemplates(json.data || []);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const [includeArchived, setIncludeArchived] = useState(false);
  useEffect(() => { loadTemplates(includeArchived); }, [organizationCode, includeArchived]); // eslint-disable-line react-hooks/exhaustive-deps

  // Org's brand kit (see settings/page.js's Brand Kit tab) -- purely a
  // starting point offered here as quick-picks (brand colors, insert logo),
  // never applied automatically to anything. null while unloaded/unset;
  // failing to load it is not worth surfacing an error for, the quick-picks
  // just don't render.
  const [brandKit, setBrandKit] = useState(null);
  // Company assets are loaded from the authenticated organization profile,
  // not through the public branding endpoint: an administrator signature is
  // private to the organization and must never be readable by an anonymous
  // caller just because it appears on a published certificate.
  //
  // Both are placed on a NEW design automatically (see the seeding effect
  // below) -- an admin who already uploaded their logo and signature when
  // the account was created should not have to insert them by hand on every
  // certificate. The quick-pick buttons in the toolbar remain, for putting
  // one back after deleting it, or adding a second copy.
  const [companyAssets, setCompanyAssets] = useState({ logo: '', signature: '' });
  // Distinguishes "not loaded yet" from "loaded, and there is none" -- without
  // it the "not configured" prompt would flash on every page load before the
  // organization profile arrives, which reads as a bug of its own.
  const [companyAssetsLoaded, setCompanyAssetsLoaded] = useState(false);
  useEffect(() => {
    if (!organizationCode) return;
    (async () => {
      try {
        const res = await apiFetch('/brand-kit');
        const json = await res.json();
        if (res.ok && json.success) setBrandKit(json.data);
      } catch {
        // Quick-picks just don't show -- not worth interrupting the editor for.
      }
    })();
  }, [organizationCode]);

  useEffect(() => {
    if (!organizationCode) return;
    (async () => {
      try {
        const res = await apiFetch('/organizations/me');
        if (!res.ok) return;
        const organization = await res.json();
        setCompanyAssets({ logo: organization.logo || '', signature: organization.signature || '' });
        setOrganizationInfo({ name: organization.name || '', logo: organization.logo || '', signature: organization.signature || '' });
        setCompanyAssetsLoaded(true);
      } catch {
        // The editor stays usable; the quick actions simply remain hidden.
      }
    })();
  }, [organizationCode]);

  const insertBrandLogo = async () => {
    if (!brandKit?.logo_url) return;
    const naturalSize = await probeImageSize(brandKit.logo_url);
    addImageElement(brandKit.logo_url, naturalSize);
  };

  const insertCompanyAsset = async (url) => {
    if (!url) return;
    const naturalSize = await probeImageSize(url);
    addImageElement(url, naturalSize);
  };

  // Has this blank canvas already been seeded with the organization's logo
  // and signature? A ref rather than state on purpose.
  const companyAssetsSeededRef = useRef(false);

  // Lays the organization's logo, administrator signature, institution name,
  // and structured templates onto a blank canvas automatically.
  const seedCompanyAssets = async (assets, size, kind = designKind, orgInfo = organizationInfo) => {
    const seeded = [];
    const logoSize = assets?.logo ? await probeImageSize(assets.logo) : null;
    const signatureSize = assets?.signature ? await probeImageSize(assets.signature) : null;
    const orgName = orgInfo?.name || assets?.name || '';

    if (kind === 'badge') {
      if (assets?.logo && logoSize) {
        const logo = newImageElement(assets.logo, logoSize, size);
        logo.width = Math.round(logo.width * 0.45);
        logo.height = Math.round(logo.height * 0.45);
        logo.x = Math.round(size.w / 2 - logo.width / 2);
        logo.y = Math.round(size.h * 0.12);
        seeded.push(logo);
      }
      setImages((prev) => (prev.length ? prev : seeded));

      const badgeElements = [
        newTextElement({
          text_title: 'custom',
          text: orgName ? orgName.toUpperCase() : 'VERIFIED ACHIEVEMENT',
          font_family: 'Montserrat',
          font_size: 16,
          font_weight: 'bold',
          font_color: brandKit?.primary_color || '#4f46e5',
          letter_spacing: 2,
          x: Math.round(size.w / 2 - 120),
          y: Math.round(size.h * 0.38)
        }, size),
        newTextElement({
          text_title: 'custom',
          text: 'Skill Certification',
          font_family: 'Montserrat',
          font_size: 24,
          font_weight: 'bold',
          font_color: '#1e293b',
          letter_spacing: 1,
          x: Math.round(size.w / 2 - 110),
          y: Math.round(size.h * 0.48)
        }, size),
        newTextElement({
          text_title: 'recipient_name',
          text: 'Recipient Name',
          font_family: 'Arial',
          font_size: 16,
          font_weight: 'bold',
          font_color: '#334155',
          x: Math.round(size.w / 2 - 80),
          y: Math.round(size.h * 0.60)
        }, size),
      ];
      setElements((prev) => (prev.length > 1 ? prev : badgeElements));
      return;
    }

    // Certificate Layout: Landscape, Institutional, Formal
    if (assets?.logo && logoSize) {
      const logo = newImageElement(assets.logo, logoSize, size);
      logo.width = Math.round(logo.width * 0.5);
      logo.height = Math.round(logo.height * 0.5);
      logo.x = Math.round(size.w / 2 - logo.width / 2);
      logo.y = Math.round(size.h * 0.05);
      seeded.push(logo);
    }
    if (assets?.signature && signatureSize) {
      const signature = newImageElement(assets.signature, signatureSize, size);
      signature.width = Math.round(signature.width * 0.45);
      signature.height = Math.round(signature.height * 0.45);
      signature.x = Math.round(size.w * 0.12);
      signature.y = Math.round(size.h - signature.height - size.h * 0.14);
      seeded.push(signature);
    }
    if (seeded.length) {
      setImages((prev) => (prev.length ? prev : seeded));
    }

    const certElements = [
      newTextElement({
        text_title: 'custom',
        text: orgName || 'Institution Name',
        font_family: 'Playfair Display',
        font_size: 24,
        font_weight: 'bold',
        font_color: brandKit?.primary_color || '#1e293b',
        letter_spacing: 1,
        x: Math.round(size.w / 2 - 140),
        y: Math.round(size.h * 0.22)
      }, size),
      newTextElement({
        text_title: 'custom',
        text: 'CERTIFICATE OF ACHIEVEMENT',
        font_family: 'Montserrat',
        font_size: 18,
        font_weight: 'bold',
        font_color: brandKit?.secondary_color || '#475569',
        letter_spacing: 3,
        x: Math.round(size.w / 2 - 180),
        y: Math.round(size.h * 0.32)
      }, size),
      newTextElement({
        text_title: 'custom',
        text: 'This certificate is proudly awarded to',
        font_family: 'Georgia',
        font_size: 14,
        font_weight: 'normal',
        font_color: '#64748b',
        x: Math.round(size.w / 2 - 130),
        y: Math.round(size.h * 0.40)
      }, size),
      newTextElement({
        text_title: 'recipient_name',
        text: 'Recipient Name',
        font_family: 'Playfair Display',
        font_size: 32,
        font_weight: 'bold',
        font_color: '#0f172a',
        x: Math.round(size.w / 2 - 140),
        y: Math.round(size.h * 0.48)
      }, size),
      newTextElement({
        text_title: 'course_name',
        text: 'for successfully completing all requirements of the program',
        font_family: 'Georgia',
        font_size: 15,
        font_weight: 'normal',
        font_color: '#64748b',
        x: Math.round(size.w / 2 - 200),
        y: Math.round(size.h * 0.58)
      }, size),
      newTextElement({
        text_title: 'custom',
        text: 'Authorized Signatory',
        font_family: 'Arial',
        font_size: 13,
        font_weight: 'normal',
        font_color: '#64748b',
        x: Math.round(size.w * 0.12),
        y: Math.round(size.h - size.h * 0.11)
      }, size),
      newTextElement({
        text_title: 'custom',
        text: `Issued: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        font_family: 'Arial',
        font_size: 12,
        font_weight: 'normal',
        font_color: '#94a3b8',
        x: Math.round(size.w * 0.12),
        y: Math.round(size.h - size.h * 0.07)
      }, size),
    ];
    setElements((prev) => (prev.length > 1 ? prev : certElements));
  };

  useEffect(() => {
    if (activeDesignCode) return;
    if (companyAssetsSeededRef.current) return;
    if (!companyAssets.logo && !companyAssets.signature && !organizationInfo.name) return;
    companyAssetsSeededRef.current = true;
    seedCompanyAssets(companyAssets, canvasSize, designKind, organizationInfo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyAssets, activeDesignCode, organizationInfo]);

  const switchStudioKind = (kind) => {
    if (kind === designKind) return;
    checkpoint();
    setDesignKind(kind);
    setGalleryKind(kind);
    if (!activeDesignCode) {
      const isBadge = kind === 'badge';
      const size = isBadge ? { w: BADGE_CANVAS, h: BADGE_CANVAS } : { w: CANVAS_W, h: CANVAS_H };
      setCanvasSize(size);
      setQrPos(isBadge ? { x: BADGE_CANVAS - 110, y: BADGE_CANVAS - 110 } : { x: CANVAS_W - 120, y: CANVAS_H - 120 });
      setTemplateName(isBadge ? 'Untitled badge' : 'Untitled certificate');
      setElements([]);
      setImages([]);
      setShapes([]);
      companyAssetsSeededRef.current = false;
      seedCompanyAssets(companyAssets, size, kind, organizationInfo);
    }
  };

  const selected = elements.find((el) => el.id === selectedId) || null;
  const selectedShape = shapes.find((s) => s.id === selectedId) || null;
  const selectedImage = images.find((im) => im.id === selectedId) || null;

  const resetCanvas = (targetKind = designKind) => {
    skipNextAutosaveRef.current = true;
    setDesignKind(targetKind);
    setActiveDesignCode(null);
    setDesignStatus(null);
    setCurrentVersion(null);
    setTemplateName(targetKind === 'badge' ? 'Untitled badge' : 'Untitled certificate');
    setBackgroundUrl('');
    setShapes([]);
    setImages([]);
    const size = targetKind === 'badge' ? { w: BADGE_CANVAS, h: BADGE_CANVAS } : { w: CANVAS_W, h: CANVAS_H };
    setCanvasSize(size);
    setQrPos(targetKind === 'badge' ? { x: BADGE_CANVAS - 110, y: BADGE_CANVAS - 110 } : { x: CANVAS_W - 120, y: CANVAS_H - 120 });
    setSelectedId(null);
    setPinMode(false);
    setPendingPinPos(null);
    setOpenPinCommentId(null);
    companyAssetsSeededRef.current = false;
    seedCompanyAssets(companyAssets, size, targetKind, organizationInfo);
  };

  const loadTemplateIntoEditor = async (design) => {
    skipNextAutosaveRef.current = true; // loading a template's own saved content must not immediately autosave it right back
    setPinMode(false);
    setPendingPinPos(null);
    setOpenPinCommentId(null);
    const url = design.main_template_url || design.template_url || '';
    // Resolve the real canvas size before computing the QR's default
    // fallback position below, so a design saved without QR_CODE.X/Y (older
    // data) still gets a sane bottom-right default for whatever size this
    // particular background actually is, not a stale previous canvas size.
    const probed = await probeImageSize(url);
    const size = probed || { w: CANVAS_W, h: CANVAS_H };

    setActiveDesignCode(design.design_code);
    // A template saved before design_kind existed has none; such designs
    // were all certificates, so that is what they stay.
    setDesignKind(design.design_kind === 'badge' ? 'badge' : 'certificate');
    setCurrentVersion(design.current_version ?? null);
    // Missing status = a template saved before the field existed, same
    // backward-compatibility default the schema and the issuance gate both
    // apply (see models/designSchema.js, controllers/certificateController.js).
    setDesignStatus(design.status || 'published');
    setReviewInfo({ submitted_by: design.submitted_by || null, rejection_reason: design.rejection_reason || null });
    setTemplateName(design.credential_title || design.design_code);
    setBackgroundUrl(url);
    setCanvasSize(size);
    setElements(
      (design.text_attributes || []).map((attr) => {
        const font = attr.font_attributes?.[0] || {};
        return {
          id: `local-${nextLocalId++}`,
          text_title: attr.text_title,
          text: attr.text,
          font_family: font.font_family || 'Georgia',
          font_size: font.font_size || 24,
          font_color: font.font_color || '#1f2937',
          font_weight: font.font_weight || 'normal',
          letter_spacing: font.letter_spacing ?? 0,
          line_height: font.line_height ?? 1.2,
          x: attr.positions?.X ?? 100,
          y: attr.positions?.Y ?? 100,
        };
      })
    );
    setShapes(
      (design.shapes || []).map((s) => ({
        id: `local-${nextLocalId++}`,
        shape_type: s.shape_type, x: s.X, y: s.Y, width: s.width, height: s.height,
        stroke_color: s.stroke_color || '#1f2937', fill_color: s.fill_color || '',
        stroke_width: s.stroke_width ?? 2, rotation: s.rotation || 0,
      }))
    );
    setImages(
      (design.images || []).map((im) => ({
        id: `local-${nextLocalId++}`,
        url: im.url, x: im.X, y: im.Y, width: im.width, height: im.height,
        rotation: im.rotation || 0, opacity: im.opacity ?? 1,
      }))
    );
    setQrPos({ x: design.QR_CODE?.X ?? size.w - 120, y: design.QR_CODE?.Y ?? size.h - 120 });
    setSelectedId(null);
  };

  // --- Drag & drop with snap-to-alignment guides -----------------------
  const otherElementCenters = (excludeId) => {
    const xs = [canvasSize.w / 2]; // canvas center is always a snap target
    const ys = [canvasSize.h / 2];
    elements.forEach((el) => {
      if (el.id === excludeId) return;
      xs.push(el.x);
      ys.push(el.y);
    });
    return { xs, ys };
  };

  const currentForKind = (id, kind) => {
    if (kind === 'qr') return qrPos;
    if (kind === 'shape') return shapes.find((s) => s.id === id);
    if (kind === 'image') return images.find((im) => im.id === id);
    return elements.find((el) => el.id === id);
  };

  const startDrag = (e, id, kind) => {
    e.preventDefault();
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const current = currentForKind(id, kind);
    if (current?.locked) return;
    checkpoint();
    dragState.current = {
      id, kind,
      offsetX: (e.clientX - canvasRect.left) / zoom - current.x,
      offsetY: (e.clientY - canvasRect.top) / zoom - current.y,
    };
    setSelectedId(kind === 'qr' ? 'qr' : id);
    if (kind !== 'qr') setSelectedIds(e.shiftKey ? (prev => prev.includes(id) ? prev.filter(value => value !== id) : [...prev, id]) : [id]);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
  };

  const onDragMove = (e) => {
    if (!dragState.current) return;
    const { id, kind, offsetX, offsetY } = dragState.current;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    let x = Math.round((e.clientX - canvasRect.left) / zoom - offsetX);
    let y = Math.round((e.clientY - canvasRect.top) / zoom - offsetY);

    const { xs, ys } = otherElementCenters(kind === 'qr' ? '__qr__' : id);
    let snappedX = null, snappedY = null;
    for (const gx of xs) {
      if (Math.abs(x - gx) < SNAP_THRESHOLD) { x = gx; snappedX = gx; break; }
    }
    for (const gy of ys) {
      if (Math.abs(y - gy) < SNAP_THRESHOLD) { y = gy; snappedY = gy; break; }
    }
    setGuides({ x: snappedX, y: snappedY });

    if (kind === 'qr') {
      setQrPos({ x, y });
    } else if (kind === 'shape') {
      setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)));
    } else if (kind === 'image') {
      setImages((prev) => prev.map((im) => (im.id === id ? { ...im, x, y } : im)));
    } else {
      setElements((prev) => prev.map((el) => (el.id === id ? { ...el, x, y } : el)));
    }
  };

  const endDrag = () => {
    dragState.current = null;
    setGuides({ x: null, y: null });
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
  };

  // --- Transform handles (resize + rotate) for shapes and images ---------
  // One checkpoint() at the start of the drag, same as startDrag above —
  // not one per pointermove, or a single resize/rotate would flood undo
  // history with dozens of intermediate states instead of being one step.
  const startTransform = (e, id, kind, handle) => {
    e.preventDefault();
    e.stopPropagation();
    const current = (kind === 'shape' ? shapes : images).find((it) => it.id === id);
    if (!current) return;
    checkpoint();
    const box = { x: current.x, y: current.y, width: current.width, height: current.height, rotation: current.rotation || 0 };
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const mouseScreen = { x: (e.clientX - canvasRect.left) / zoom, y: (e.clientY - canvasRect.top) / zoom };

    if (handle === 'rotate') {
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const startAngle = Math.atan2(mouseScreen.y - center.y, mouseScreen.x - center.x) / DEG2RAD;
      transformState.current = { id, kind, handle, center, startAngle, startRotation: box.rotation };
    } else {
      const isEdge = EDGE_HANDLES.has(handle);
      const opposite = isEdge ? OPPOSITE_EDGE_LOCAL[handle](box) : OPPOSITE_CORNER_LOCAL[handle](box);
      const anchorScreen = localPointToScreen(opposite.x, opposite.y, box);
      // Alt/Option held -> resize symmetrically about the box's own center
      // instead of the fixed opposite anchor (see onTransformMove below).
      // Computed once here since the center is what stays fixed in that
      // mode, exactly like anchorScreen is what stays fixed in the normal
      // mode.
      const centerScreen = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const aspectRatio = box.height > 0 ? box.width / box.height : null;
      transformState.current = {
        id, kind, handle, anchorScreen, centerScreen, rotation: box.rotation, aspectRatio,
        isEdge, origWidth: box.width, origHeight: box.height,
      };
    }
    window.addEventListener('pointermove', onTransformMove);
    window.addEventListener('pointerup', endTransform);
  };

  const onTransformMove = (e) => {
    const t = transformState.current;
    if (!t) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const mouseScreen = { x: (e.clientX - canvasRect.left) / zoom, y: (e.clientY - canvasRect.top) / zoom };
    const setFn = t.kind === 'shape' ? setShapes : setImages;

    if (t.handle === 'rotate') {
      const angle = Math.atan2(mouseScreen.y - t.center.y, mouseScreen.x - t.center.x) / DEG2RAD;
      let rotation = t.startRotation + (angle - t.startAngle);
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15; // Shift + rotate -> 15° snapping
      rotation = Math.round(rotation * 10) / 10;
      setFn((prev) => prev.map((it) => (it.id === t.id ? { ...it, rotation } : it)));
      return;
    }

    // Resize: the opposite corner/edge (anchorScreen) stays visually fixed —
    // the dragged handle tracks the mouse. Both are true screen positions;
    // rotating the mouse delta by -rotation projects it back into the
    // element's own unrotated width/height, exactly undoing the CSS
    // rotation so the box resizes along its own axes, not the screen's.
    // Alt/Option -> resize about the box's own center instead: the center
    // stays fixed rather than the opposite anchor, and since the center is
    // only half as far from the dragged edge/corner as the opposite anchor
    // is, the measured local delta is doubled to compensate.
    const useCenter = e.altKey;
    const anchorPoint = useCenter ? t.centerScreen : t.anchorScreen;
    const scaleFactor = useCenter ? 2 : 1;
    const delta = { x: mouseScreen.x - anchorPoint.x, y: mouseScreen.y - anchorPoint.y };
    const local = rotateVector(delta.x, delta.y, -t.rotation);
    const MIN_SIZE = 10;
    let width, height;
    if (t.isEdge) {
      // A mid-edge handle only ever drives one axis -- the other stays at
      // whatever it was when the drag started, regardless of Shift/Alt.
      if (t.handle === 'e' || t.handle === 'w') {
        width = Math.max(Math.round(Math.abs(local.x) * scaleFactor), MIN_SIZE);
        height = t.origHeight;
      } else {
        height = Math.max(Math.round(Math.abs(local.y) * scaleFactor), MIN_SIZE);
        width = t.origWidth;
      }
    } else {
      width = Math.max(Math.round(Math.abs(local.x) * scaleFactor), MIN_SIZE);
      height = Math.max(Math.round(Math.abs(local.y) * scaleFactor), MIN_SIZE);
      if (e.shiftKey && t.aspectRatio) {
        // Shift + resize -> keep the original aspect ratio, driven by
        // whichever axis the drag moved further along.
        if (width / height > t.aspectRatio) width = Math.max(Math.round(height * t.aspectRatio), MIN_SIZE);
        else height = Math.max(Math.round(width / t.aspectRatio), MIN_SIZE);
      }
    }

    let centerScreen;
    if (useCenter) {
      centerScreen = t.centerScreen; // fixed -- box grows/shrinks symmetrically around it
    } else if (t.isEdge) {
      // The opposite edge's midpoint (anchorScreen) is fixed; project the
      // anchor-to-new-center vector (known exactly, since only one
      // dimension changed) from local space back to screen space.
      const vecLocal = t.handle === 'e' ? { x: width / 2, y: 0 }
        : t.handle === 'w' ? { x: -width / 2, y: 0 }
        : t.handle === 'n' ? { x: 0, y: -height / 2 }
        : { x: 0, y: height / 2 }; // 's'
      const vecScreen = rotateVector(vecLocal.x, vecLocal.y, t.rotation);
      centerScreen = { x: t.anchorScreen.x + vecScreen.x, y: t.anchorScreen.y + vecScreen.y };
    } else {
      // For a corner handle, the box's center is exactly the midpoint of
      // any two diagonally opposite corners -- true for any rectangle
      // regardless of rotation -- so the anchor/mouse midpoint is exact.
      centerScreen = { x: (t.anchorScreen.x + mouseScreen.x) / 2, y: (t.anchorScreen.y + mouseScreen.y) / 2 };
    }
    const x = Math.round(centerScreen.x - width / 2);
    const y = Math.round(centerScreen.y - height / 2);
    setFn((prev) => prev.map((it) => (it.id === t.id ? { ...it, x, y, width, height } : it)));
  };

  const endTransform = () => {
    transformState.current = null;
    window.removeEventListener('pointermove', onTransformMove);
    window.removeEventListener('pointerup', endTransform);
  };

  // --- Element editing ---------------------------------------------------
  const addTextElement = () => {
    checkpoint();
    const el = newTextElement({}, canvasSize);
    setElements((prev) => [...prev, el]);
    setSelectedId(el.id);
  };

  const updateSelected = (patch) => {
    checkpoint();
    if (selectedShape) setShapes((prev) => prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));
    else if (selectedImage) setImages((prev) => prev.map((im) => (im.id === selectedId ? { ...im, ...patch } : im)));
    else setElements((prev) => prev.map((el) => (el.id === selectedId ? { ...el, ...patch } : el)));
  };

  const deleteSelected = () => {
    checkpoint();
    const ids = selectedIds.length ? selectedIds : [selectedId];
    setElements((prev) => prev.filter((el) => !ids.includes(el.id)));
    setShapes((prev) => prev.filter((s) => !ids.includes(s.id)));
    setImages((prev) => prev.filter((im) => !ids.includes(im.id)));
    setSelectedId(null);
    setSelectedIds([]);
  };

  // Duplicates whichever single element is currently selected (text,
  // shape, or image), offset slightly so the copy is visibly distinct
  // from the original rather than sitting exactly on top of it.
  const DUPLICATE_OFFSET = 16;
  const duplicateSelected = () => {
    if (!selectedId || selectedId === 'qr') return;
    checkpoint();
    if (selectedShape) {
      const copy = { ...selectedShape, id: `local-${nextLocalId++}`, x: selectedShape.x + DUPLICATE_OFFSET, y: selectedShape.y + DUPLICATE_OFFSET };
      setShapes((prev) => [...prev, copy]);
      setSelectedId(copy.id);
    } else if (selectedImage) {
      const copy = { ...selectedImage, id: `local-${nextLocalId++}`, x: selectedImage.x + DUPLICATE_OFFSET, y: selectedImage.y + DUPLICATE_OFFSET };
      setImages((prev) => [...prev, copy]);
      setSelectedId(copy.id);
    } else if (selected) {
      const copy = { ...selected, id: `local-${nextLocalId++}`, x: selected.x + DUPLICATE_OFFSET, y: selected.y + DUPLICATE_OFFSET };
      setElements((prev) => [...prev, copy]);
      setSelectedId(copy.id);
    }
  };

  // Copy/Paste -- distinct from Duplicate (Ctrl+D) above in the one way
  // that actually matters: Duplicate copies-and-places in one step, so
  // pasting the same element several times means re-selecting the
  // original and hitting Ctrl+D again each time. Ctrl+C remembers one
  // element; Ctrl+V can then place it repeatedly, each paste offset
  // further from the last (not from the original), same as every real
  // editor's paste-repeatedly behavior.
  const clipboardRef = useRef(null);
  const copySelected = () => {
    if (!selectedId || selectedId === 'qr') return;
    const kind = selectedShape ? 'shape' : selectedImage ? 'image' : selected ? 'text' : null;
    const data = selectedShape || selectedImage || selected;
    if (!kind || !data) return;
    clipboardRef.current = { kind, data: structuredClone(data), pasteCount: 0 };
  };
  const pasteClipboard = () => {
    const clip = clipboardRef.current;
    if (!clip) return;
    checkpoint();
    clip.pasteCount += 1;
    const offset = DUPLICATE_OFFSET * clip.pasteCount;
    const copy = { ...clip.data, id: `local-${nextLocalId++}`, x: clip.data.x + offset, y: clip.data.y + offset };
    if (clip.kind === 'shape') setShapes((prev) => [...prev, copy]);
    else if (clip.kind === 'image') setImages((prev) => [...prev, copy]);
    else setElements((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  };

  const addShape = (shapeType) => {
    checkpoint();
    const shape = newShapeElement(shapeType, canvasSize);
    setShapes((prev) => [...prev, shape]);
    setSelectedId(shape.id);
  };

  const addImageElement = (url, naturalSize) => {
    checkpoint();
    const image = newImageElement(url, naturalSize, canvasSize);
    setImages((prev) => [...prev, image]);
    setSelectedId(image.id);
  };

  const moveLayer = (direction) => {
    if (!selectedId) return;
    checkpoint();
    setElements(prev => reorderLayer(prev, selectedId, direction));
  };

  const setGroup = (grouped) => {
    if (selectedIds.length < 2 && grouped) return;
    checkpoint();
    const groupId = grouped ? `group-${Date.now()}` : null;
    setElements(prev => assignGroup(prev, selectedIds, groupId));
  };

  const [uploading, setUploading] = useState(false);
  // Pages of a just-uploaded multi-page PDF, as { page, url }. Empty for a
  // single-page PDF or any other upload -- the picker only appears when
  // there is genuinely a choice to make.
  const [pdfPages, setPdfPages] = useState([]);

  // Sets a background and resizes the canvas to its real dimensions -- a
  // square badge or a vertical certificate is exactly as valid a background
  // as the default landscape one; the certificate service has no fixed-size
  // assumption to accommodate (see utils/main.py).
  const applyBackground = async (url) => {
    setBackgroundUrl(url);
    const size = await probeImageSize(url);
    if (size) setCanvasSize(size);
  };

  const uploadBackground = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === 'application/pdf';
    const isImage = file.type.startsWith('image/');
    if ((!isImage && !isPdf) || file.size > 10 * 1024 * 1024) {
      setStatusMessage('Choose an image or PDF smaller than 10 MB.');
      setTimeout(() => setStatusMessage(''), 3000);
      return;
    }

    // Uploads to the backend now (POST /api/uploads) instead of embedding
    // the file as a base64 data URI directly in the browser — that used to
    // work for small images but bloated the saved design document (base64
    // is ~33% larger than the original) and had no way to handle a PDF at
    // all. The backend rasterizes a PDF (every page) and an SVG server-
    // side; from here it's just a URL either way.
    setUploading(true);
    setStatusMessage(isPdf ? 'Converting PDF…' : 'Uploading…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('visibility', 'private');
      const res = await apiFetch('/uploads', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Upload failed');

      checkpoint();
      // Uploads are stored on the backend's own host, not the frontend's.
      const uploadedUrl = resolveUploadUrl(json.url);
      await applyBackground(uploadedUrl);
      // A multi-page PDF offers a page picker rather than silently using
      // page 1: an admin whose certificate is on page 3 of a brand deck
      // previously had no way to reach it without splitting the file first.
      if (Array.isArray(json.pages) && json.pages.length > 1) {
        setPdfPages(json.pages.map((page) => ({ ...page, url: resolveUploadUrl(page.url) })));
        setStatusMessage(`PDF converted — ${json.pages.length} pages. Page 1 applied; pick another below if you need it.`);
      } else {
        setPdfPages([]);
        if (json.type === 'svg-converted') {
          setStatusMessage(json.removed?.length
            ? `SVG added. ${json.removed.length} unsafe element(s) were removed.`
            : 'SVG added.');
        } else {
          setStatusMessage(isPdf ? 'PDF converted and added.' : 'Image uploaded.');
        }
      }
    } catch (err) {
      console.error('Upload failed:', err);
      setStatusMessage(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  // --- Save ---------------------------------------------------------------
  // trigger is purely cosmetic (which message to show) -- autosave and the
  // manual Save button call the exact same function, so an autosaved
  // template can never drift from what a manual save would have produced.
  // _isConflictRetry is internal-only (see the 409 handling below) -- never
  // passed by a caller.
  const saveTemplate = async (trigger = 'manual', _isConflictRetry = false) => {
    if (!backgroundUrl) {
      if (trigger === 'manual') {
        setStatusMessage('Add a background image URL before saving.');
        setTimeout(() => setStatusMessage(''), 3000);
      }
      return;
    }
    // A manual save makes any already-scheduled autosave for the exact
    // same (about to be stale) content redundant -- cancel it so it can
    // never fire moments later as a pointless duplicate request.
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setSaving(true);
    setStatusMessage('');
    const isUpdate = Boolean(activeDesignCode);
    const payload = {
      main_template_url: backgroundUrl,
      template_url: backgroundUrl,
      credential_title: templateName,
      // Certificate or badge -- recorded so the template lists, the issuance
      // flows and the bulk flows can tell the two apart.
      design_kind: designKind,
      // Optimistic-lock token -- see updateDesign on the backend. Only
      // meaningful (and only sent) on an update to an already-saved
      // design; a brand-new POST has no prior version to race against.
      ...(isUpdate && currentVersion !== null ? { known_version: currentVersion } : {}),
      text_attributes: elements.map((el) => ({
        text_title: el.text_title,
        text: el.text,
        font_attributes: [{
          font_family: el.font_family,
          font_size: el.font_size,
          font_color: el.font_color,
          font_weight: el.font_weight,
          letter_spacing: el.letter_spacing ?? 0,
          line_height: el.line_height ?? 1.2,
        }],
        positions: { X: el.x, Y: el.y },
      })),
      shapes: shapes.map((s) => ({
        shape_type: s.shape_type, X: s.x, Y: s.y, width: s.width, height: s.height,
        stroke_color: s.stroke_color, fill_color: s.fill_color, stroke_width: s.stroke_width, rotation: s.rotation,
      })),
      images: images.map((im) => ({
        url: im.url, X: im.x, Y: im.y, width: im.width, height: im.height, rotation: im.rotation, opacity: im.opacity,
      })),
      QR_CODE: {
        // Placeholder — the real verification URL is generated per
        // credential at issuance time (reserveCredentialCode + the actual
        // credential_code), not here. See credentials/page.js.
        ecoding_data: 'https://ebadgeid.com/verifications/credentials/PREVIEW',
        X: qrPos.x,
        Y: qrPos.y,
      },
    };

    try {
      const res = await apiFetch(
        isUpdate ? `/designs/${activeDesignCode}` : '/designs',
        { method: isUpdate ? 'PUT' : 'POST', body: JSON.stringify(payload) }
      );
      const json = await res.json();
      if (res.status === 409 && isUpdate && !_isConflictRetry) {
        // Someone/something else (a concurrent autosave, another tab, a
        // slow request that landed out of order) saved a newer version
        // first -- never let this stale write win. Re-sync to the real
        // current_version and retry exactly once with the SAME local
        // content (still sitting in elements/shapes/images/etc, nothing
        // lost), so a legitimate race resolves itself without the admin
        // having to notice or redo anything. If the retry conflicts too,
        // fall through to the normal error path below instead of looping.
        const latestRes = await apiFetch(`/designs/by-code/${activeDesignCode}`);
        if (latestRes.ok) {
          const latest = await latestRes.json();
          if (typeof latest.current_version === 'number') {
            setCurrentVersion(latest.current_version);
            // Awaited (not a bare early return) so this call's own
            // `finally` below only runs once the retry has fully finished
            // -- otherwise it would clear `saving` and the status message
            // while the retry it just kicked off is still in flight.
            await saveTemplate(trigger, true);
            return;
          }
        }
      }
      if (!res.ok || json.success === false) {
        throw new Error(json.message || 'Failed to save template');
      }
      setStatusMessage(trigger === 'autosave' ? 'Autosaved' : isUpdate ? 'Template updated.' : 'Template created.');
      if (!isUpdate) setActiveDesignCode(json.data.design_code);
      setDesignStatus(json.data.status || 'draft');
      if (typeof json.data.current_version === 'number') setCurrentVersion(json.data.current_version);
      // This save's own resulting state change (new current_version etc.)
      // must not immediately re-trigger the autosave effect below.
      skipNextAutosaveRef.current = true;
      loadTemplates();
    } catch (err) {
      console.error(err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setStatusMessage(''), trigger === 'autosave' ? 2000 : 4000);
    }
  };

  // Debounced autosave: only once a template already has a design_code
  // (activeDesignCode), so a blank brand-new template is never silently
  // half-saved before the admin has even named it or picked a background.
  // Fires 2.5s after the last real change to any visual content, coalescing
  // a burst of drag/resize/typing events into a single save the same way a
  // manual save would only happen once, not on every intermediate pointer
  // move.
  useEffect(() => {
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return undefined;
    }
    if (!activeDesignCode) return undefined;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      saveTemplate('autosave');
    }, 2500);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, shapes, images, qrPos, backgroundUrl, templateName, activeDesignCode]);

  // --- Draft/Published + LinkedIn share -----------------------------------
  // A template only becomes eligible to actually issue credentials from once
  // it's explicitly published — see certificateController.generateCertificate's
  // 409 gate. Publishing/unpublishing is a deliberate action, not a side
  // effect of saving (updateDesign explicitly excludes `status` from the
  // fields a plain save can touch).
  const togglePublish = async () => {
    if (!activeDesignCode) return;
    setPublishing(true);
    setStatusMessage('');
    const nextAction = designStatus === 'published' ? 'unpublish' : 'publish';
    try {
      const res = await apiFetch(`/designs/${activeDesignCode}/${nextAction}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || `Failed to ${nextAction} template`);
      setDesignStatus(json.data.status);
      setStatusMessage(nextAction === 'publish' ? 'Template published.' : 'Template reverted to draft.');
      loadTemplates();
    } catch (err) {
      console.error(err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setPublishing(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  // Submits a draft for another admin to sign off on before it can be
  // published -- an alternative to the direct Publish button above, for
  // orgs that want a second set of eyes. See
  // controllers/designController.js's submitForReview.
  const submitForReview = async () => {
    if (!activeDesignCode) return;
    setReviewing(true);
    setStatusMessage('');
    try {
      const res = await apiFetch(`/designs/${activeDesignCode}/submit-review`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to submit for review');
      setDesignStatus(json.data.status);
      setReviewInfo({ submitted_by: json.data.submitted_by, rejection_reason: null });
      setStatusMessage('Submitted for review.');
      loadTemplates();
    } catch (err) {
      console.error(err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setReviewing(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  // Approving publishes it directly (skipping the separate Publish button);
  // the server rejects this with 403 if the caller is the same admin who
  // submitted it -- surfaced here as a normal error message, same as any
  // other server-side rejection on this page.
  const approveDesign = async () => {
    if (!activeDesignCode) return;
    setReviewing(true);
    setStatusMessage('');
    try {
      // redirectOnUnauthorized: false -- a 403 here is routinely the
      // self-approval business rule (see controllers/designController.js),
      // not an expired/invalid session; apiFetch's default behavior would
      // otherwise force a full logout for a normal, expected rejection.
      const res = await apiFetch(`/designs/${activeDesignCode}/approve`, { method: 'POST', redirectOnUnauthorized: false });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to approve template');
      setDesignStatus(json.data.status);
      setReviewInfo({ submitted_by: json.data.submitted_by, rejection_reason: null });
      setStatusMessage('Template approved and published.');
      loadTemplates();
    } catch (err) {
      console.error(err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setReviewing(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  const rejectDesign = async () => {
    if (!activeDesignCode) return;
    const reason = window.prompt('Why is this template being sent back? (shown to whoever submitted it)');
    if (!reason || !reason.trim()) return;
    setReviewing(true);
    setStatusMessage('');
    try {
      // Same self-rejection 403 case as approveDesign above.
      const res = await apiFetch(`/designs/${activeDesignCode}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }), redirectOnUnauthorized: false });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to reject template');
      setDesignStatus(json.data.status);
      setReviewInfo({ submitted_by: null, rejection_reason: json.data.rejection_reason });
      setStatusMessage('Template sent back to draft.');
      loadTemplates();
    } catch (err) {
      console.error(err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setReviewing(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  // Archiving takes a template out of the default sidebar list and off the
  // issuance gate the same way a draft is blocked (see
  // certificateController.js) without deleting it -- e.g. a template
  // retired for a past cohort/event. Restoring always lands on draft, not
  // straight back to published, matching the same "publishing is always a
  // deliberate, separate action" rule createDesign/unarchiveDesign apply.
  const toggleArchive = async () => {
    if (!activeDesignCode) return;
    setPublishing(true);
    setStatusMessage('');
    const nextAction = designStatus === 'archived' ? 'unarchive' : 'archive';
    try {
      const res = await apiFetch(`/designs/${activeDesignCode}/${nextAction}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || `Failed to ${nextAction} template`);
      setDesignStatus(json.data.status);
      setStatusMessage(nextAction === 'archive' ? 'Template archived.' : 'Template restored to draft.');
      loadTemplates(includeArchived);
    } catch (err) {
      console.error(err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setPublishing(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  // Clones the CURRENTLY OPEN template's full content into a brand-new one
  // -- distinct from duplicateSelected() below, which only copies one
  // element within the same template. Loads the new copy into the editor
  // so it's immediately obvious the duplicate worked and ready to edit.
  const [duplicatingTemplate, setDuplicatingTemplate] = useState(false);
  const duplicateTemplate = async () => {
    if (!activeDesignCode) return;
    setDuplicatingTemplate(true);
    setStatusMessage('');
    try {
      const res = await apiFetch(`/designs/${activeDesignCode}/duplicate`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to duplicate template');
      setStatusMessage('Template duplicated.');
      await loadTemplates(includeArchived);
      await loadTemplateIntoEditor(json.data);
    } catch (err) {
      console.error(err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setDuplicatingTemplate(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  // share-offsite is the correct LinkedIn intent for sharing a link (the
  // public preview page below), distinct from the /profile/add?startTask=
  // CERTIFICATION flow used for a recipient adding an *earned* credential to
  // their own profile (see verifications/credentials/[credential_code]/
  // page.js) — a template isn't anyone's earned achievement.
  const shareOnLinkedIn = () => {
    if (!activeDesignCode) return;
    const previewUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/templates/preview/${activeDesignCode}`;
    const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(previewUrl)}`;
    window.open(linkedInUrl, '_blank', 'width=600,height=600,scrollbars=yes,resizable=yes,location=yes');
    setStatusMessage('Opening LinkedIn to share this template…');
    setTimeout(() => setStatusMessage(''), 3000);
  };

  // --- Download the template itself -------------------------------------
  // Composes background + text elements + a QR placeholder onto an offscreen
  // <canvas>, entirely client-side — this is a preview of the blank
  // template, not a real certificate (the real QR/text substitution for an
  // actual recipient only happens server-side at issuance, via
  // certificateController.js, which needs a reserved credential_code this
  // template doesn't have). Mirrors the Python renderer's own text logic
  // (utils/main.py, draw_text_attribute) — same per-character loop for
  // letter_spacing, same font_size*line_height line advance — so this stays
  // a trustworthy preview of what issuing from this template will produce.
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const composeCanvas = async () => {
    if (!backgroundUrl) throw new Error('Add a background image first.');
    const bg = await new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load the background image (check it loads directly in a browser tab).'));
      img.src = backgroundUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bg, 0, 0, canvasSize.w, canvasSize.h);

    if (document.fonts?.ready) {
      try { await document.fonts.ready; } catch { /* best effort */ }
    }

    // Shapes first, then placed images, then text -- same stacking order
    // the certificate service itself draws in (utils/main.py).
    for (const s of shapes) {
      ctx.save();
      const cx = s.x + s.width / 2, cy = s.y + s.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((s.rotation || 0) * Math.PI / 180);
      ctx.translate(-cx, -cy);
      ctx.lineWidth = s.stroke_width || 0;
      ctx.strokeStyle = s.stroke_color || '#000000';
      if (s.shape_type === 'rectangle') {
        if (s.fill_color) { ctx.fillStyle = s.fill_color; ctx.fillRect(s.x, s.y, s.width, s.height); }
        if (s.stroke_width) ctx.strokeRect(s.x, s.y, s.width, s.height);
      } else if (s.shape_type === 'circle') {
        ctx.beginPath();
        ctx.ellipse(cx, cy, s.width / 2, s.height / 2, 0, 0, Math.PI * 2);
        if (s.fill_color) { ctx.fillStyle = s.fill_color; ctx.fill(); }
        if (s.stroke_width) ctx.stroke();
      } else if (s.shape_type === 'line') {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + s.width, s.y + s.height);
        if (s.stroke_width) ctx.stroke();
      }
      ctx.restore();
    }

    for (const im of images) {
      const imgEl = await new Promise((resolve) => {
        const image = new window.Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = im.url;
      });
      if (!imgEl) continue;
      ctx.save();
      ctx.globalAlpha = im.opacity ?? 1;
      const cx = im.x + im.width / 2, cy = im.y + im.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((im.rotation || 0) * Math.PI / 180);
      ctx.drawImage(imgEl, -im.width / 2, -im.height / 2, im.width, im.height);
      ctx.restore();
    }

    for (const el of elements) {
      const text = el.text_title === 'recipient_name' ? '{{ Recipient Name }}' : el.text;
      ctx.fillStyle = el.font_color;
      ctx.textBaseline = 'top';
      ctx.font = `${el.font_weight === 'bold' ? 'bold ' : ''}${el.font_size}px ${el.font_family}`;
      const lineAdvance = Math.round(el.font_size * (el.line_height || 1.2));
      text.split('\n').forEach((line, index) => {
        const y = el.y + index * lineAdvance;
        if (!el.letter_spacing) {
          ctx.fillText(line, el.x, y);
          return;
        }
        let x = el.x;
        for (const character of line) {
          ctx.fillText(character, x, y);
          x += ctx.measureText(character).width + el.letter_spacing;
        }
      });
    }

    // A real, scannable QR code encoding a placeholder verification URL —
    // the real one is generated per-credential at issuance and encodes
    // that credential's own verification URL, which doesn't exist yet for
    // a template that was never issued (see certificateController.js).
    // This is real QR data, not a decorative gray box, so the preview
    // actually shows what a QR will look like on the finished certificate.
    const qrDataUrl = await QRCode.toDataURL(QR_PREVIEW_DATA, { width: 256, margin: 0 });
    const qrImg = await new Promise((resolve) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = qrDataUrl;
    });
    if (qrImg) ctx.drawImage(qrImg, qrPos.x, qrPos.y, 64, 64);

    return canvas;
  };

  const downloadTemplateAsPng = async () => {
    setDownloadMenuOpen(false);
    setDownloading(true);
    try {
      const canvas = await composeCanvas();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${templateName || 'template'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Template download failed:', err);
      setStatusMessage(`Download failed: ${err.message}`);
      setTimeout(() => setStatusMessage(''), 4000);
    } finally {
      setDownloading(false);
    }
  };

  const downloadTemplateAsPdf = async () => {
    setDownloadMenuOpen(false);
    setDownloading(true);
    try {
      const canvas = await composeCanvas();
      const dataUrl = canvas.toDataURL('image/png');
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({
        orientation: canvasSize.w >= canvasSize.h ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvasSize.w, canvasSize.h],
      });
      doc.addImage(dataUrl, 'PNG', 0, 0, canvasSize.w, canvasSize.h);
      doc.save(`${templateName || 'template'}.pdf`);
    } catch (err) {
      console.error('Template PDF export failed:', err);
      setStatusMessage(`PDF export failed: ${err.message}`);
      setTimeout(() => setStatusMessage(''), 4000);
    } finally {
      setDownloading(false);
    }
  };

  const deleteTemplate = async (designCode) => {
    if (!window.confirm('Delete this template? This cannot be undone.')) return;
    try {
      await apiFetch(`/designs/${designCode}`, { method: 'DELETE' });
      if (activeDesignCode === designCode) resetCanvas();
      loadTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  // Real, scannable QR code for the live canvas preview — generated once
  // (the preview data never changes; only the real per-credential URL
  // does, at issuance time) instead of showing a gray placeholder box.
  const [qrPreviewDataUrl, setQrPreviewDataUrl] = useState('');
  useEffect(() => {
    QRCode.toDataURL(QR_PREVIEW_DATA, { width: 256, margin: 0 }).then(setQrPreviewDataUrl).catch(() => {});
  }, []);

  // --- Asset library (uploaded images + AI-generated backgrounds/stickers) ---
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [assetLibraryTab, setAssetLibraryTab] = useState('library'); // 'library' | 'generate'
  const [imageAssets, setImageAssets] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetUploading, setAssetUploading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [generatingAi, setGeneratingAi] = useState(false);
  const assetFileInputRef = useRef(null);

  const loadImageAssets = async () => {
    setLoadingAssets(true);
    try {
      const res = await apiFetch('/assets?asset_type=image');
      const json = await res.json();
      setImageAssets(json.data || []);
    } catch (err) {
      console.error('Failed to load asset library:', err);
    } finally {
      setLoadingAssets(false);
    }
  };

  useEffect(() => { if (showAssetLibrary) loadImageAssets(); }, [showAssetLibrary]);  

  const registerAsset = async ({ asset_type, name, url, mime_type, original_filename }) => {
    const res = await apiFetch('/assets', {
      method: 'POST',
      body: JSON.stringify({ asset_type, name, url, mime_type, original_filename }),
    });
    const json = await res.json();
    if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to save asset');
    return json.data;
  };

  const uploadLibraryImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAssetUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('visibility', 'private');
      const res = await apiFetch('/uploads', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Upload failed');
      const uploadedUrl = resolveUploadUrl(json.url);
      const name = window.prompt('Name this asset (for reuse later):', file.name.replace(/\.[^.]+$/, '')) || file.name;
      await registerAsset({ asset_type: 'image', name, url: uploadedUrl, mime_type: file.type || 'image/png', original_filename: file.name });
      await loadImageAssets();
    } catch (err) {
      console.error('Asset upload failed:', err);
      setStatusMessage(`Upload failed: ${err.message}`);
      setTimeout(() => setStatusMessage(''), 3000);
    } finally {
      setAssetUploading(false);
      if (assetFileInputRef.current) assetFileInputRef.current.value = '';
    }
  };

  const generateAiImage = async () => {
    if (!aiPrompt.trim()) return;
    setGeneratingAi(true);
    try {
      const res = await apiFetch('/uploads/generate-image', {
        method: 'POST',
        body: JSON.stringify({ prompt: aiPrompt.trim(), width: 1024, height: 1024 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Generation failed');
      const generatedUrl = resolveUploadUrl(json.url);
      await registerAsset({ asset_type: 'image', name: aiPrompt.trim().slice(0, 80), url: generatedUrl, mime_type: 'image/jpeg' });
      await loadImageAssets();
      setAssetLibraryTab('library');
      setAiPrompt('');
    } catch (err) {
      console.error('AI generation failed:', err);
      setStatusMessage(`Generation failed: ${err.message}`);
      setTimeout(() => setStatusMessage(''), 3000);
    } finally {
      setGeneratingAi(false);
    }
  };

  const insertAssetAsImage = async (asset) => {
    const naturalSize = await probeImageSize(asset.url);
    addImageElement(asset.url, naturalSize);
    setShowAssetLibrary(false);
  };

  // Named applyAssetAsBackground, not useAssetAsBackground -- it's a plain
  // click handler, not a React hook, but ESLint's rules-of-hooks flags any
  // "use..." name as a hook by convention regardless of what it actually
  // does, and rejects calling it from inside the onClick callback below.
  const applyAssetAsBackground = async (asset) => {
    checkpoint();
    setBackgroundUrl(asset.url);
    const size = await probeImageSize(asset.url);
    if (size) setCanvasSize(size);
    setShowAssetLibrary(false);
  };

  // --- Template version history ------------------------------------------
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const openVersionHistory = async () => {
    if (!activeDesignCode) return;
    setShowVersionHistory(true);
    setLoadingVersions(true);
    try {
      const res = await apiFetch(`/designs/${activeDesignCode}/versions`);
      const json = await res.json();
      setVersions(json.data || []);
    } catch (err) {
      console.error('Failed to load version history:', err);
    } finally {
      setLoadingVersions(false);
    }
  };

  const revertToVersion = async (versionNumber) => {
    if (!activeDesignCode) return;
    if (!window.confirm(`Revert to version ${versionNumber}? This creates a new version with that content — nothing is deleted.`)) return;
    try {
      const res = await apiFetch(`/designs/${activeDesignCode}/versions/${versionNumber}/revert`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Revert failed');
      await loadTemplateIntoEditor(json.data);
      setShowVersionHistory(false);
      loadTemplates();
      setStatusMessage(`Reverted to version ${versionNumber}.`);
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.error('Revert failed:', err);
      setStatusMessage(`Revert failed: ${err.message}`);
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  // --- Cross-organization sharing (routes/designShareRoutes.js) -----------
  // Distinct from the LinkedIn "Share" button above: that's a public,
  // read-only preview link for anyone; this reuses a template *within* the
  // system, giving the receiving organization its own independent, editable
  // copy (see importShare below), not a live link back to this one.
  const [showSharing, setShowSharing] = useState(false);
  const [shareTargetOrgCode, setShareTargetOrgCode] = useState('');
  const [sharingBusy, setSharingBusy] = useState(false);
  const [loadingShares, setLoadingShares] = useState(false);
  const [outgoingShares, setOutgoingShares] = useState([]); // this template's own outgoing shares only
  const [incomingShares, setIncomingShares] = useState([]); // everything shared with this organization, org-wide

  const openSharingDialog = async () => {
    setShowSharing(true);
    setLoadingShares(true);
    try {
      const [sentRes, receivedRes] = await Promise.all([
        apiFetch('/design-shares/sent'),
        apiFetch('/design-shares/received'),
      ]);
      const sentJson = await sentRes.json();
      const receivedJson = await receivedRes.json();
      setOutgoingShares((sentJson.data || []).filter((s) => s.design_code === activeDesignCode));
      setIncomingShares(receivedJson.data || []);
    } catch (err) {
      console.error('Failed to load shares:', err);
    } finally {
      setLoadingShares(false);
    }
  };

  const shareWithOrg = async () => {
    if (!activeDesignCode || !shareTargetOrgCode.trim()) return;
    setSharingBusy(true);
    try {
      const res = await apiFetch('/design-shares', {
        method: 'POST',
        body: JSON.stringify({ design_code: activeDesignCode, target_organization_code: shareTargetOrgCode.trim() }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to share template');
      setShareTargetOrgCode('');
      setOutgoingShares((prev) => [json.data, ...prev.filter((s) => s._id !== json.data._id)]);
      setStatusMessage(json.message || 'Shared.');
    } catch (err) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setSharingBusy(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  const revokeOutgoingShare = async (shareId) => {
    setSharingBusy(true);
    try {
      const res = await apiFetch(`/design-shares/${shareId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to revoke share');
      setOutgoingShares((prev) => prev.filter((s) => s._id !== shareId));
    } catch (err) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setSharingBusy(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  // Turns an incoming share into a brand-new, independent draft this
  // organization owns and can edit freely -- always a draft regardless of
  // the source's status, same rule duplicateTemplate follows.
  const importShare = async (shareId) => {
    setSharingBusy(true);
    try {
      const res = await apiFetch(`/design-shares/${shareId}/import`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to import template');
      setShowSharing(false);
      await loadTemplateIntoEditor(json.data);
      loadTemplates();
      setStatusMessage('Imported as a new draft.');
    } catch (err) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setSharingBusy(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  // --- Comments & presence (scoped-down collaboration) --------------------
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [presenceUsers, setPresenceUsers] = useState([]);
  // Pin-a-comment-to-a-spot flow: the backend has always accepted a
  // position on a comment (see designController.createComment), but the
  // editor never gave a way to set one -- comments only ever showed up in
  // the flat side list, with no indication of what on the canvas they were
  // actually about. `pinMode` arms a single click on the canvas to capture
  // that position instead of deselecting as normal; `pendingPinPos` holds
  // it until the comment is actually submitted (or the composer is
  // cleared without submitting, which just drops it).
  const [pinMode, setPinMode] = useState(false);
  const [pendingPinPos, setPendingPinPos] = useState(null);
  const [openPinCommentId, setOpenPinCommentId] = useState(null);

  const loadComments = async () => {
    if (!activeDesignCode) return;
    try {
      const res = await apiFetch(`/designs/${activeDesignCode}/comments`);
      const json = await res.json();
      setComments(json.data || []);
    } catch (err) {
      console.error('Failed to load comments:', err);
    }
  };

  useEffect(() => {
    if (!activeDesignCode) { setComments([]); setPresenceUsers([]); return; }
    loadComments();
    // Presence: heartbeat + poll every 8s — well inside the backend's 20s
    // TTL (utils/presence.js) so this admin never disappears from other
    // viewers' lists between polls.
    const heartbeatAndList = async () => {
      try {
        await apiFetch(`/designs/${activeDesignCode}/presence`, { method: 'POST' });
        const res = await apiFetch(`/designs/${activeDesignCode}/presence`);
        const json = await res.json();
        setPresenceUsers(json.data || []);
      } catch { /* presence is best-effort, never blocks editing */ }
    };
    heartbeatAndList();
    const interval = setInterval(heartbeatAndList, 8000);
    return () => clearInterval(interval);
  }, [activeDesignCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const postComment = async () => {
    if (!newCommentText.trim() || !activeDesignCode) return;
    try {
      const res = await apiFetch(`/designs/${activeDesignCode}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text: newCommentText.trim(), position: pendingPinPos || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Failed to post comment');
      setComments((prev) => [...prev, json.data]);
      setNewCommentText('');
      setPendingPinPos(null);
    } catch (err) {
      console.error('Failed to post comment:', err);
    }
  };

  const resolveCommentById = async (commentId) => {
    try {
      const res = await apiFetch(`/designs/${activeDesignCode}/comments/${commentId}/resolve`, { method: 'PATCH' });
      const json = await res.json();
      setComments((prev) => prev.map((c) => (c._id === commentId ? json.data : c)));
    } catch (err) {
      console.error('Failed to resolve comment:', err);
    }
  };

  const deleteCommentById = async (commentId) => {
    try {
      await apiFetch(`/designs/${activeDesignCode}/comments/${commentId}`, { method: 'DELETE' });
      setComments((prev) => prev.filter((c) => c._id !== commentId));
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  // --- Custom fonts (org-uploaded, beyond the built-in family list) -------
  const [customFonts, setCustomFonts] = useState([]);
  const [uploadingFont, setUploadingFont] = useState(false);
  const fontFileInputRef = useRef(null);
  const fontFamilyOptions = [...BUILTIN_FONT_FAMILIES, ...customFonts.map((f) => f.name)];

  const loadCustomFonts = async () => {
    try {
      const res = await apiFetch('/assets?asset_type=font');
      const json = await res.json();
      setCustomFonts(json.data || []);
    } catch (err) {
      console.error('Failed to load custom fonts:', err);
    }
  };

  useEffect(() => { loadCustomFonts(); }, []);

  const uploadCustomFont = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingFont(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('visibility', 'private');
      const res = await apiFetch('/uploads/font', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Font upload failed');
      const uploadedUrl = resolveUploadUrl(json.url);
      const defaultName = file.name.replace(/\.[^.]+$/, '');
      const name = window.prompt('Name this font (used in the font picker):', defaultName) || defaultName;
      await registerAsset({ asset_type: 'font', name, url: uploadedUrl, mime_type: json.mime, original_filename: file.name });
      await loadCustomFonts();
      if (selected) updateSelected({ font_family: name });
      setStatusMessage('Font uploaded.');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.error('Font upload failed:', err);
      setStatusMessage(`Font upload failed: ${err.message}`);
      setTimeout(() => setStatusMessage(''), 3000);
    } finally {
      setUploadingFont(false);
      if (fontFileInputRef.current) fontFileInputRef.current.value = '';
    }
  };

  const [showGallery, setShowGallery] = useState(false);
  // The "how do you want to start" flow. null = closed; 'kind' = choosing
  // certificate vs badge; 'certificate'/'badge' = choosing template vs
  // upload, for that kind. Deliberately a small state machine rather than
  // three booleans, so it is impossible to be in two steps at once.
  const [startStep, setStartStep] = useState(null);
  const [startKind, setStartKind] = useState(null);

  const beginNewDesign = () => {
    setStartKind(null);
    setStartStep('kind');
  };

  const chooseKind = (kind) => {
    setStartKind(kind);
    setStartStep(kind);
  };

  // "Upload your own" -- identical for both kinds, which is the point: a
  // badge design can be uploaded exactly like a certificate design.
  const startFromUpload = (kind) => {
    resetCanvas();
    setDesignKind(kind);
    setTemplateName(kind === 'badge' ? 'Untitled badge' : 'Untitled certificate');
    if (kind === 'badge') {
      // A badge is square by convention; a certificate is landscape. The
      // admin can still resize, and uploading a background overrides this
      // with the file's own dimensions.
      setCanvasSize({ w: BADGE_CANVAS, h: BADGE_CANVAS });
      setQrPos({ x: BADGE_CANVAS - 110, y: BADGE_CANVAS - 110 });
    }
    setStartStep(null);
    // Opens the file picker straight away: the admin already said they want
    // to upload, so making them find the button again would be busywork.
    setTimeout(() => fileInputRef.current?.click(), 0);
  };
  const [materializingTemplateId, setMaterializingTemplateId] = useState(null);

  // Loads one of the 12 built-in starter designs (src/lib/template-library.js)
  // into the canvas as a fresh, unsaved template — same as resetCanvas() but
  // pre-filled instead of blank. Nothing is saved to the backend until the
  // admin clicks Save, same as starting from scratch.
  //
  // The starter's own backgroundUrl (an SVG served by this frontend) is
  // only ever used for the picker's thumbnail — never set as the actual
  // editable background. The certificate microservice can't reach this
  // frontend host and can't rasterize SVG regardless (see
  // utils/galleryTemplates.js on the backend), so the real background comes
  // from materializing the same official SVG into a storage-hosted PNG
  // first, through the exact same code path every one of the 12 templates
  // uses, org-independent and with no frontend/arbitrary-URL involved.
  const loadStarterTemplate = async (starter) => {
    // The starter library already knows which kind each design is; adopt it
    // so a badge template produces a badge, not a certificate.
    setDesignKind(starter.category === 'badge' ? 'badge' : 'certificate');
    setMaterializingTemplateId(starter.id);
    try {
      const res = await apiFetch('/designs/gallery-templates/materialize', {
        method: 'POST',
        body: JSON.stringify({ template_id: starter.id }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.message || 'Failed to load this template');
      }

      checkpoint();
      setActiveDesignCode(null);
      setDesignStatus(null);
      setCurrentVersion(null);
      setTemplateName(starter.name);
      setBackgroundUrl(json.data.url);
      setElements(starter.elements.map((el) => ({ id: `local-${nextLocalId++}`, letter_spacing: 0, line_height: 1.2, ...el })));
      setShapes([]);
      setImages([]);
      setQrPos({ ...starter.qrPosition });
      // All 12 starters are materialized at the canvas's default 900x636 —
      // not probed via probeImageSize like an uploaded background, since
      // that dimension is fixed server-side too (see
      // utils/galleryTemplates.js's CANVAS_W/CANVAS_H).
      setCanvasSize({ w: CANVAS_W, h: CANVAS_H });
      setSelectedId(null);
      setSelectedIds([]);
      setShowGallery(false);
    } catch (err) {
      console.error('Error loading starter template:', err);
      setStatusMessage(`Error: ${err.message}`);
      setTimeout(() => setStatusMessage(''), 4000);
    } finally {
      setMaterializingTemplateId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* No visible page title here (the editable template-name field above
          the canvas isn't semantically a page heading) -- this sr-only h1
          is what the page-has-heading-one rule needs, without changing the
          visual layout. */}
      <h1 className="sr-only">Certificate template editor</h1>
      {/* Left: template library */}
      <aside aria-label="Template library" className="w-64 border-r border-border bg-card p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <LayoutTemplate className="w-4 h-4" /> Templates
          </h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowGallery(true)} className="text-primary hover:opacity-80" title="Browse starter templates">
              <ImageIcon className="w-5 h-5" />
            </button>
            <button onClick={beginNewDesign} className="text-primary hover:opacity-80" title="New certificate or badge">
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg border border-border/50 mb-3">
          <button
            type="button"
            onClick={() => setTemplateFilter('all')}
            className={`flex-1 py-1 text-[11px] font-medium rounded transition-all text-center ${
              templateFilter === 'all' ? 'bg-card text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setTemplateFilter('certificate')}
            className={`flex-1 py-1 text-[11px] font-medium rounded transition-all text-center ${
              templateFilter === 'certificate' ? 'bg-card text-primary shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Certificates
          </button>
          <button
            type="button"
            onClick={() => setTemplateFilter('badge')}
            className={`flex-1 py-1 text-[11px] font-medium rounded transition-all text-center ${
              templateFilter === 'badge' ? 'bg-card text-purple-600 dark:text-purple-400 shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Badges
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3 cursor-pointer">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="rounded" />
          Show archived
        </label>
        {loadingTemplates ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : templates.filter(t => templateFilter === 'all' || (templateFilter === 'badge' ? t.design_kind === 'badge' : t.design_kind !== 'badge')).length === 0 ? (
          <p className="text-sm text-muted-foreground">No {templateFilter === 'all' ? '' : templateFilter} templates found.</p>
        ) : (
          <div className="space-y-2">
            {templates
              .filter(t => templateFilter === 'all' || (templateFilter === 'badge' ? t.design_kind === 'badge' : t.design_kind !== 'badge'))
              .map((t) => (
              <div
                key={t.design_code}
                role="button"
                tabIndex={0}
                aria-label={`Open template ${t.credential_title || t.design_code}`}
                aria-current={activeDesignCode === t.design_code ? 'true' : undefined}
                className={`p-2 rounded-lg border cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${activeDesignCode === t.design_code ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40'} ${t.status === 'archived' ? 'opacity-60' : ''}`}
                onClick={() => loadTemplateIntoEditor(t)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    loadTemplateIntoEditor(t);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                    {t.design_kind === 'badge' ? (
                      <Award className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" title="Digital Badge" />
                    ) : (
                      <FileCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" title="Certificate" />
                    )}
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        t.status === 'archived' ? 'bg-muted-foreground/40' : (t.status || 'published') === 'published' ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                      title={t.status === 'archived' ? 'Archived' : (t.status || 'published') === 'published' ? 'Published' : 'Draft'}
                    />
                    {t.credential_title || t.design_code}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteTemplate(t.design_code); }}
                    aria-label={`Delete template ${t.credential_title || t.design_code}`}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:opacity-80"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{t.design_code}</p>
              </div>
            ))}
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col items-center p-8 overflow-auto">
        <div className="w-full max-w-4xl flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-muted p-1 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => switchStudioKind('certificate')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  designKind === 'certificate'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <FileCheck className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                Certificate Studio
              </button>
              <button
                type="button"
                onClick={() => switchStudioKind('badge')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  designKind === 'badge'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Award className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                Badge Studio
              </button>
            </div>
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              aria-label="Template name"
              className="text-lg font-semibold text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none px-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={undo} className="p-2 rounded border" title="Undo"><Undo2 className="w-4 h-4" /></button>
            <button onClick={redo} className="p-2 rounded border" title="Redo"><Redo2 className="w-4 h-4" /></button>
            <button onClick={() => setShowGrid(value => !value)} className={`p-2 rounded border ${showGrid ? 'bg-indigo-50' : ''}`} title="Grid"><Grid3X3 className="w-4 h-4" /></button>
            <button onClick={() => setZoom(value => clampZoom(value - 0.1))} className="p-2 rounded border" title="Zoom out"><ZoomOut className="w-4 h-4" /></button>
            <span className="text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(value => clampZoom(value + 0.1))} className="p-2 rounded border" title="Zoom in"><ZoomIn className="w-4 h-4" /></button>
            <span className="text-xs text-gray-600 border-l pl-2" title="Matches the background image's real pixel size">{canvasSize.w}×{canvasSize.h}</span>
            {activeDesignCode && designStatus && (
              <span
                className={`text-xs font-medium px-2 py-1 rounded-full border-l ${
                  designStatus === 'published' ? 'bg-emerald-50 text-emerald-700'
                    : designStatus === 'archived' ? 'bg-gray-100 text-gray-600'
                    : designStatus === 'pending_review' ? 'bg-blue-50 text-blue-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
                title={
                  designStatus === 'published' ? 'Available for issuing credentials'
                    : designStatus === 'archived' ? 'Archived — restore to draft before publishing again'
                    : designStatus === 'pending_review' ? `Waiting for another admin to review${reviewInfo.submitted_by ? ` (submitted by ${reviewInfo.submitted_by})` : ''}`
                    : 'Not yet available for issuing credentials'
                }
              >
                {designStatus === 'published' ? 'Published' : designStatus === 'archived' ? 'Archived' : designStatus === 'pending_review' ? 'Pending review' : 'Draft'}
              </span>
            )}
            {designStatus === 'draft' && reviewInfo.rejection_reason && (
              <span className="text-xs text-rose-600" title={reviewInfo.rejection_reason}>Rejected: {reviewInfo.rejection_reason}</span>
            )}
            {statusMessage && <span className="text-sm text-gray-600">{statusMessage}</span>}
            {activeDesignCode && designStatus === 'draft' && (
              <button
                onClick={submitForReview}
                disabled={reviewing}
                title="Send this template to another admin to review before it's published"
                className="flex items-center gap-1 border px-3 py-2 rounded-lg text-sm text-blue-700 border-blue-300 hover:bg-blue-50 disabled:opacity-50"
              >
                {reviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
                Submit for review
              </button>
            )}
            {activeDesignCode && designStatus === 'pending_review' && (
              <>
                <button
                  onClick={approveDesign}
                  disabled={reviewing}
                  title="Approve and publish"
                  className="flex items-center gap-1 border px-3 py-2 rounded-lg text-sm text-emerald-700 border-emerald-300 hover:bg-emerald-50 disabled:opacity-50"
                >
                  {reviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
                  Approve
                </button>
                <button
                  onClick={rejectDesign}
                  disabled={reviewing}
                  title="Send back to draft with a reason"
                  className="flex items-center gap-1 border px-3 py-2 rounded-lg text-sm text-rose-700 border-rose-300 hover:bg-rose-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            )}
            {activeDesignCode && designStatus !== 'archived' && designStatus !== 'pending_review' && (
              <button
                onClick={togglePublish}
                disabled={publishing}
                className={`flex items-center gap-1 border px-3 py-2 rounded-lg text-sm disabled:opacity-50 ${
                  designStatus === 'published' ? 'text-amber-700 border-amber-300 hover:bg-amber-50' : 'text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                }`}
              >
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                {designStatus === 'published' ? 'Unpublish' : 'Publish'}
              </button>
            )}
            {activeDesignCode && designStatus === 'published' && (
              <button
                onClick={shareOnLinkedIn}
                title="Share this template's public preview on LinkedIn"
                className="flex items-center gap-1 bg-[#0A66C2] text-white px-3 py-2 rounded-lg text-sm hover:bg-[#08508f]"
              >
                <Linkedin className="w-4 h-4" /> Share
              </button>
            )}
            {activeDesignCode && (
              <button
                onClick={toggleArchive}
                disabled={publishing}
                title={designStatus === 'archived' ? 'Restore to draft' : 'Archive — hides it from the list and blocks issuing from it, without deleting it'}
                className="flex items-center gap-1 border px-3 py-2 rounded-lg text-sm text-gray-600 border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                {designStatus === 'archived' ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                {designStatus === 'archived' ? 'Restore' : 'Archive'}
              </button>
            )}
            {activeDesignCode && (
              <button
                onClick={duplicateTemplate}
                disabled={duplicatingTemplate}
                title="Duplicate this template as a new draft"
                className="flex items-center gap-1 border px-3 py-2 rounded-lg text-sm text-gray-600 border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                {duplicatingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                Duplicate
              </button>
            )}
            <button
              onClick={openSharingDialog}
              title="Share this template with another organization, or import one shared with yours"
              className="flex items-center gap-1 border px-3 py-2 rounded-lg text-sm text-gray-600 border-gray-300 hover:bg-gray-50"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
            <div className="relative">
              <button
                onClick={() => setDownloadMenuOpen((v) => !v)}
                disabled={downloading || !backgroundUrl}
                title={!backgroundUrl ? 'Add a background image first' : 'Download this template'}
                className="flex items-center gap-1 border px-3 py-2 rounded-lg text-sm disabled:opacity-50"
              >
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download
                <ChevronDown className="w-3 h-3" />
              </button>
              {downloadMenuOpen && (
                <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-30 overflow-hidden">
                  <button onClick={downloadTemplateAsPng} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Download as PNG</button>
                  <button onClick={downloadTemplateAsPdf} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Download as PDF</button>
                </div>
              )}
            </div>
            <button
              onClick={() => saveTemplate('manual')}
              disabled={saving}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {activeDesignCode ? 'Save changes' : 'Save template'}
            </button>
          </div>
        </div>

        <div className="w-full max-w-3xl mb-4 flex gap-2 items-end">
          <div className="flex-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-1">
            <ImageIcon className="w-3 h-3" /> Background image URL
          </label>
          <input
            value={backgroundUrl}
            onChange={(e) => setBackgroundUrl(e.target.value)}
            onBlur={async (e) => {
              const size = await probeImageSize(e.target.value);
              if (size) setCanvasSize(size);
            }}
            placeholder="Upload a managed PNG, JPG, WEBP, SVG or PDF template"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
          />
          </div>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.svg,.pdf" onChange={uploadBackground} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm disabled:opacity-50">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {/* Names the formats the backend actually accepts
                (ALLOWED_MIME in controllers/uploadController.js). "Upload
                image, SVG or PDF" left an admin guessing whether their JPG
                or WEBP would be taken. */}
            {uploading ? 'Uploading…' : 'Upload PNG, JPG, WEBP, SVG or PDF'}
          </button>
        </div>

        {/* Only rendered when a PDF actually had more than one page, so a
            single-page certificate template shows no extra chrome. */}
        {pdfPages.length > 1 && (
          <div className="mb-3 border border-gray-200 rounded-lg p-3 bg-white">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Which page is the template?</p>
              <button
                onClick={() => setPdfPages([])}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
                title="Hide the page picker"
              >
                Done
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pdfPages.map((page) => (
                <button
                  key={page.page}
                  onClick={() => { checkpoint(); applyBackground(page.url); }}
                  className={`shrink-0 border rounded-md p-1 hover:border-indigo-400 ${backgroundUrl === page.url ? 'border-indigo-500 ring-1 ring-indigo-300' : 'border-gray-200'}`}
                  title={`Use page ${page.page} as the background`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={page.url} alt={`Page ${page.page}`} className="h-24 w-auto object-contain" />
                  <span className="block text-[11px] text-gray-500 mt-1">Page {page.page}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ width: canvasSize.w * zoom, height: canvasSize.h * zoom }}>
        <div
          ref={canvasRef}
          className="relative bg-white shadow-xl border select-none"
          style={{
            width: canvasSize.w, height: canvasSize.h,
            transform: `scale(${zoom})`, transformOrigin: 'top left',
            backgroundPosition: 'center',
            backgroundColor: backgroundUrl ? undefined : '#f3f4f6',
            backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : (showGrid ? 'linear-gradient(#ddd 1px, transparent 1px), linear-gradient(90deg, #ddd 1px, transparent 1px)' : undefined),
            backgroundSize: backgroundUrl ? 'cover' : (showGrid ? '20px 20px' : undefined),
            cursor: pinMode ? 'crosshair' : undefined,
          }}
          onPointerDown={(e) => {
            if (pinMode) {
              const canvasRect = canvasRef.current.getBoundingClientRect();
              const pos = { X: Math.round((e.clientX - canvasRect.left) / zoom), Y: Math.round((e.clientY - canvasRect.top) / zoom) };
              setPendingPinPos(pos);
              setPinMode(false);
              setShowComments(true);
              return;
            }
            setSelectedId(null);
          }}
        >
          {!backgroundUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
              Add a background image URL above to get started
            </div>
          )}

          {/* Snap guides */}
          {guides.x !== null && (
            <div className="absolute top-0 bottom-0 border-l border-dashed border-pink-500 pointer-events-none" style={{ left: guides.x }} />
          )}
          {guides.y !== null && (
            <div className="absolute left-0 right-0 border-t border-dashed border-pink-500 pointer-events-none" style={{ top: guides.y }} />
          )}

          {shapes.map((s) => (
            <div
              key={s.id}
              onPointerDown={(e) => { e.stopPropagation(); startDrag(e, s.id, 'shape'); }}
              className={`absolute cursor-move ${selectedId === s.id ? 'ring-2 ring-indigo-500' : 'hover:ring-1 hover:ring-indigo-300'}`}
              style={{
                left: s.x, top: s.y, width: s.width, height: s.shape_type === 'line' ? 0 : s.height,
                transform: `rotate(${s.rotation || 0}deg)`, transformOrigin: 'center center', boxSizing: 'border-box',
                border: s.shape_type === 'line' ? undefined : (s.stroke_width ? `${s.stroke_width}px solid ${s.stroke_color}` : undefined),
                borderTop: s.shape_type === 'line' ? `${s.stroke_width || 1}px solid ${s.stroke_color}` : undefined,
                backgroundColor: s.shape_type !== 'line' ? (s.fill_color || 'transparent') : undefined,
                borderRadius: s.shape_type === 'circle' ? '50%' : undefined,
              }}
            />
          ))}

          {images.map((im) => (
            <img
              key={im.id}
              src={im.url}
              alt=""
              onPointerDown={(e) => { e.stopPropagation(); startDrag(e, im.id, 'image'); }}
              className={`absolute cursor-move ${selectedId === im.id ? 'ring-2 ring-indigo-500' : 'hover:ring-1 hover:ring-indigo-300'}`}
              style={{
                left: im.x, top: im.y, width: im.width, height: im.height,
                transform: `rotate(${im.rotation || 0}deg)`, transformOrigin: 'center center', opacity: im.opacity ?? 1,
              }}
            />
          ))}

          {elements.map((el) => (
            <div
              key={el.id}
              onPointerDown={(e) => { e.stopPropagation(); startDrag(e, el.id, 'text'); }}
              className={`absolute cursor-move whitespace-pre px-1 ${selectedId === el.id ? 'ring-2 ring-indigo-500' : 'hover:ring-1 hover:ring-indigo-300'}`}
              style={{
                left: el.x, top: el.y,
                fontFamily: el.font_family, fontSize: el.font_size,
                color: el.font_color, fontWeight: el.font_weight,
                // whitespace-pre (not pre-wrap): the certificate service
                // only breaks lines on a literal \n, it never auto-wraps at
                // a container width — matching that here is what makes
                // this preview trustworthy.
                letterSpacing: el.letter_spacing ? `${el.letter_spacing}px` : undefined,
                lineHeight: el.line_height || 1.2,
              }}
            >
              {el.text_title === 'recipient_name' ? `{{ ${el.text} }}` : el.text}
            </div>
          ))}

          {/* Real, scannable QR preview (placeholder verification URL — the
              real one is generated per-credential at issuance) */}
          <div
            onPointerDown={(e) => { e.stopPropagation(); startDrag(e, 'qr', 'qr'); }}
            className={`absolute w-16 h-16 bg-white border-2 flex items-center justify-center cursor-move ${selectedId === 'qr' ? 'ring-2 ring-indigo-500 border-indigo-500' : 'border-gray-400 hover:border-indigo-300'}`}
            style={{ left: qrPos.x, top: qrPos.y }}
          >
            {qrPreviewDataUrl ? (
              <img src={qrPreviewDataUrl} alt="QR preview" className="w-full h-full" />
            ) : (
              <QrCode className="w-8 h-8 text-gray-500" />
            )}
          </div>

          {/* Comment pins -- the backend has always accepted a position on
              a comment, but nothing on the canvas showed where a comment
              was actually about until now. Click one to see its text and
              resolve/delete it right there, instead of hunting for it in
              the side list. */}
          {comments.filter((c) => c.position && Number.isFinite(c.position.X) && Number.isFinite(c.position.Y)).map((c) => (
            <div key={c._id} className="absolute" style={{ left: c.position.X, top: c.position.Y, transform: 'translate(-50%, -100%)' }}>
              <button
                onClick={(e) => { e.stopPropagation(); setOpenPinCommentId((prev) => (prev === c._id ? null : c._id)); }}
                title={c.text}
                className={`w-6 h-6 rounded-full rounded-bl-none border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold ${c.resolved ? 'bg-gray-400' : 'bg-amber-500'}`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
              {openPinCommentId === c._id && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-10 text-left"
                >
                  <p className="text-xs text-gray-500 mb-1">{c.author_username}</p>
                  <p className="text-sm text-gray-800 mb-2">{c.text}</p>
                  <div className="flex gap-2">
                    {!c.resolved && (
                      <button onClick={() => resolveCommentById(c._id)} className="text-xs text-emerald-700 hover:underline">Resolve</button>
                    )}
                    <button onClick={() => { deleteCommentById(c._id); setOpenPinCommentId(null); }} className="text-xs text-red-600 hover:underline">Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Transform handles (resize + rotate) for the selected shape or
              image — rendered last so it's always on top. The wrapper is
              sized/positioned/rotated exactly like the element itself
              (same CSS as the shape/image divs above), so the 4 corner
              handles visually track rotation for free; the actual
              resize/rotate math in startTransform/onTransformMove works in
              real screen coordinates independent of this CSS. */}
          {(selectedShape || selectedImage) && (() => {
            const box = selectedShape || selectedImage;
            const kind = selectedShape ? 'shape' : 'image';
            const HS = 10; // handle size in px, unaffected by zoom since it lives inside the same zoomed container
            const cornerStyle = (handle) => ({
              width: HS, height: HS,
              left: handle.includes('w') ? -HS / 2 : undefined,
              right: handle.includes('e') ? -HS / 2 : undefined,
              top: handle.includes('n') ? -HS / 2 : undefined,
              bottom: handle.includes('s') ? -HS / 2 : undefined,
              cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
            });
            // Mid-edge handles -- centered along the perpendicular axis,
            // unlike corner handles which sit flush at a corner.
            const edgeStyle = (handle) => ({
              width: handle === 'n' || handle === 's' ? HS * 2 : HS,
              height: handle === 'e' || handle === 'w' ? HS * 2 : HS,
              left: handle === 'n' || handle === 's' ? box.width / 2 - HS : (handle === 'w' ? -HS / 2 : undefined),
              right: handle === 'e' ? -HS / 2 : undefined,
              top: handle === 'e' || handle === 'w' ? box.height / 2 - HS : (handle === 'n' ? -HS / 2 : undefined),
              bottom: handle === 's' ? -HS / 2 : undefined,
              cursor: handle === 'n' || handle === 's' ? 'ns-resize' : 'ew-resize',
              borderRadius: 3,
            });
            return (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: box.x, top: box.y, width: box.width, height: box.height,
                  transform: `rotate(${box.rotation || 0}deg)`, transformOrigin: 'center center',
                }}
              >
                {['nw', 'ne', 'se', 'sw'].map((handle) => (
                  <div
                    key={handle}
                    onPointerDown={(e) => startTransform(e, box.id, kind, handle)}
                    title="Drag to resize — hold Shift to keep proportions, Alt/Option to resize from the center"
                    className="absolute bg-white border-2 border-indigo-500 rounded-full pointer-events-auto"
                    style={cornerStyle(handle)}
                  />
                ))}
                {['n', 's', 'e', 'w'].map((handle) => (
                  <div
                    key={handle}
                    onPointerDown={(e) => startTransform(e, box.id, kind, handle)}
                    title="Drag to resize this side only — hold Alt/Option to resize from the center"
                    className="absolute bg-white border-2 border-indigo-500 pointer-events-auto"
                    style={edgeStyle(handle)}
                  />
                ))}
                <div className="absolute bg-indigo-500 pointer-events-none" style={{ width: 1, height: 20, left: box.width / 2, top: -20 }} />
                <div
                  onPointerDown={(e) => startTransform(e, box.id, kind, 'rotate')}
                  title="Drag to rotate — hold Shift to snap to 15°"
                  className="absolute bg-white border-2 border-indigo-500 rounded-full pointer-events-auto"
                  style={{ width: HS, height: HS, left: box.width / 2 - HS / 2, top: -28, cursor: 'grab' }}
                />
              </div>
            );
          })()}
        </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button onClick={addTextElement} className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-medium text-sm">
            <Type className="w-4 h-4" /> Add text field
          </button>
          <span className="text-gray-300">|</span>
          <button onClick={() => addShape('rectangle')} className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium text-sm" title="Add rectangle">
            <Square className="w-4 h-4" /> Rectangle
          </button>
          <button onClick={() => addShape('circle')} className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium text-sm" title="Add circle">
            <CircleIcon className="w-4 h-4" /> Circle
          </button>
          <button onClick={() => addShape('line')} className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium text-sm" title="Add line">
            <Minus className="w-4 h-4" /> Line
          </button>
          <span className="text-gray-300">|</span>
          <button onClick={() => setShowAssetLibrary(true)} className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium text-sm" title="Asset library / AI image generation">
            <ImageIcon className="w-4 h-4" /> Assets
          </button>
          {/* When the asset exists it can be inserted; when it does NOT, say
              so and offer the way to fix it. Rendering nothing was the worse
              option: the logo simply never appeared on a new design and there
              was no way to tell whether that was a bug or a missing setting. */}
          {companyAssetsLoaded && (companyAssets.logo ? (
            <button onClick={() => insertCompanyAsset(companyAssets.logo)} className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium text-sm" title="Insert the Company logo saved in Settings">
              <Building className="w-4 h-4" /> Company logo
            </button>
          ) : (
            <a href="/settings?tab=organization" className="flex items-center gap-1.5 text-amber-700 hover:text-amber-800 font-medium text-sm" title="No company logo is configured yet">
              <Building className="w-4 h-4" /> Organization logo not configured — Add Logo
            </a>
          ))}
          {companyAssetsLoaded && (companyAssets.signature ? (
            <button onClick={() => insertCompanyAsset(companyAssets.signature)} className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium text-sm" title="Insert the administrator signature saved in Settings">
              <Signature className="w-4 h-4" /> Admin signature
            </button>
          ) : (
            <a href="/settings?tab=signature" className="flex items-center gap-1.5 text-amber-700 hover:text-amber-800 font-medium text-sm" title="No signature is configured yet">
              <Signature className="w-4 h-4" /> Signature not configured — Add Signature
            </a>
          ))}
          {activeDesignCode && (
            <>
              <button onClick={openVersionHistory} className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium text-sm" title="Version history">
                <History className="w-4 h-4" /> History
              </button>
              <button onClick={() => setShowComments((v) => !v)} className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium text-sm" title="Comments">
                <MessageSquare className="w-4 h-4" /> Comments{comments.length > 0 ? ` (${comments.filter(c => !c.resolved).length})` : ''}
              </button>
              {presenceUsers.length > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-gray-500" title={`Also viewing: ${presenceUsers.join(', ')}`}>
                  <Users className="w-4 h-4" /> {presenceUsers.join(', ')}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right: element inspector */}
      <aside aria-label="Element properties" tabIndex={0} className="w-72 border-l border-border bg-card p-4 overflow-y-auto">
        <h2 className="font-semibold text-foreground mb-4">
          {selectedId === 'qr' ? 'QR Code' : selected ? 'Text field' : selectedShape ? 'Shape' : selectedImage ? 'Image' : 'Nothing selected'}
        </h2>

        {selectedId === 'qr' && (
          <p className="text-sm text-muted-foreground">
            The QR always links to the credential's public verification page — its target is set automatically when a credential is issued from this template, not here.
          </p>
        )}

        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => moveLayer(-1)} className="flex justify-center gap-1 border border-border rounded p-2 text-xs text-foreground hover:bg-muted/40"><ArrowDown className="w-4 h-4" /> Back</button>
              <button onClick={() => moveLayer(1)} className="flex justify-center gap-1 border border-border rounded p-2 text-xs text-foreground hover:bg-muted/40"><ArrowUp className="w-4 h-4" /> Front</button>
              <button onClick={() => updateSelected({ locked: !selected.locked })} className="flex justify-center gap-1 border border-border rounded p-2 text-xs text-foreground hover:bg-muted/40">{selected.locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}{selected.locked ? 'Unlock' : 'Lock'}</button>
              <button onClick={() => setGroup(true)} disabled={selectedIds.length < 2} className="flex justify-center gap-1 border border-border rounded p-2 text-xs text-foreground hover:bg-muted/40 disabled:opacity-40"><Group className="w-4 h-4" /> Group</button>
              {selected.groupId && <button onClick={() => setGroup(false)} className="col-span-2 flex justify-center gap-1 border border-border rounded p-2 text-xs text-foreground hover:bg-muted/40"><Ungroup className="w-4 h-4" /> Ungroup</button>}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Field type</label>
              <select
                value={fieldTypeOf(selected.text_title)}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === 'recipient_name') {
                    updateSelected({ text_title: 'recipient_name', text: 'Recipient Name' });
                  } else if (next === 'custom') {
                    updateSelected({ text_title: 'custom', text: selected.text_title === 'recipient_name' ? 'Certificate of Achievement' : selected.text });
                  } else {
                    updateSelected({
                      text_title: fieldTypeOf(selected.text_title) === 'dynamic_field' ? selected.text_title : `custom_field_${nextLocalId++}`,
                      text: selected.text_title === 'recipient_name' ? 'Sample value' : selected.text,
                    });
                  }
                }}
                className="w-full mt-1 text-sm border border-border bg-background text-foreground rounded-lg px-2 py-1.5"
              >
                {FIELD_TYPES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            {fieldTypeOf(selected.text_title) === 'dynamic_field' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Field key</label>
                <input
                  value={selected.text_title}
                  onChange={(e) => updateSelected({ text_title: (e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'field') }) }
                  className="w-full mt-1 text-sm border border-border bg-background text-foreground rounded-lg px-2 py-1.5"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Shown as a &ldquo;{selected.text_title.replace(/_/g, ' ')}&rdquo; input when issuing a credential from this template. Leave blank at issuance to fall back to the default text below.
                </p>
              </div>
            )}

            {selected.text_title !== 'recipient_name' && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {fieldTypeOf(selected.text_title) === 'dynamic_field' ? 'Default text' : 'Text'}
                </label>
                <textarea
                  rows={3}
                  value={selected.text}
                  onChange={(e) => updateSelected({ text: e.target.value })}
                  className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5 resize-y"
                />
                <p className="text-[11px] text-gray-400 mt-1">Press Enter for a line break — Line height below controls the gap between lines.</p>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Font family</label>
              <select
                value={selected.font_family}
                onChange={(e) => updateSelected({ font_family: e.target.value })}
                className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
              >
                {fontFamilyOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <input ref={fontFileInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={uploadCustomFont} className="hidden" />
              <button
                onClick={() => fontFileInputRef.current?.click()}
                disabled={uploadingFont}
                className="mt-1 flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
              >
                {uploadingFont ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                Upload custom font (TTF/OTF/WOFF/WOFF2)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Size</label>
                <input
                  type="number" min={8} max={120}
                  value={selected.font_size}
                  onChange={(e) => updateSelected({ font_size: parseInt(e.target.value, 10) || 12 })}
                  className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Weight</label>
                <select
                  value={selected.font_weight}
                  onChange={(e) => updateSelected({ font_weight: e.target.value })}
                  className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                >
                  {FONT_WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="letter-spacing-input" className="text-xs font-medium text-gray-500 uppercase tracking-wide">Letter spacing</label>
                <input
                  id="letter-spacing-input"
                  type="number" min={-20} max={100} step={0.5}
                  value={selected.letter_spacing ?? 0}
                  onChange={(e) => updateSelected({ letter_spacing: parseFloat(e.target.value) || 0 })}
                  className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                />
              </div>
              <div>
                <label htmlFor="line-height-input" className="text-xs font-medium text-gray-500 uppercase tracking-wide">Line height</label>
                <input
                  id="line-height-input"
                  type="number" min={0.5} max={5} step={0.1}
                  value={selected.line_height ?? 1.2}
                  onChange={(e) => updateSelected({ line_height: parseFloat(e.target.value) || 1.2 })}
                  className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Color</label>
              <input
                type="color"
                value={selected.font_color}
                onChange={(e) => updateSelected({ font_color: e.target.value })}
                className="w-full mt-1 h-9 border border-gray-300 rounded-lg"
              />
              {brandKit && (
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[11px] text-gray-400">Brand:</span>
                  <button
                    onClick={() => updateSelected({ font_color: brandKit.primary_color })}
                    title={`Primary (${brandKit.primary_color})`}
                    style={{ backgroundColor: brandKit.primary_color }}
                    className="w-5 h-5 rounded-full border border-gray-300"
                  />
                  <button
                    onClick={() => updateSelected({ font_color: brandKit.secondary_color })}
                    title={`Secondary (${brandKit.secondary_color})`}
                    style={{ backgroundColor: brandKit.secondary_color }}
                    className="w-5 h-5 rounded-full border border-gray-300"
                  />
                </div>
              )}
            </div>

            <button
              onClick={deleteSelected}
              className="w-full flex items-center justify-center gap-2 text-red-600 hover:text-red-800 text-sm font-medium border border-red-200 rounded-lg py-2 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" /> Delete field
            </button>
          </div>
        )}

        {selectedShape && (
          <div className="space-y-4">
            <button
              onClick={deleteSelected}
              className="w-full flex items-center justify-center gap-2 text-red-600 hover:text-red-800 text-sm font-medium border border-red-200 rounded-lg py-2 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" /> Delete shape
            </button>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Width{selectedShape.shape_type === 'line' ? ' (length)' : ''}</label>
                <input
                  type="number" min={1} max={2000}
                  value={selectedShape.width}
                  onChange={(e) => updateSelected({ width: parseInt(e.target.value, 10) || 1 })}
                  className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                />
              </div>
              {selectedShape.shape_type !== 'line' && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Height</label>
                  <input
                    type="number" min={1} max={2000}
                    value={selectedShape.height}
                    onChange={(e) => updateSelected({ height: parseInt(e.target.value, 10) || 1 })}
                    className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                  />
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1"><RotateCw className="w-3 h-3" /> Rotation (degrees)</label>
              <input
                type="number" min={-360} max={360}
                value={selectedShape.rotation}
                onChange={(e) => updateSelected({ rotation: parseFloat(e.target.value) || 0 })}
                className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Stroke width</label>
              <input
                type="number" min={0} max={100}
                value={selectedShape.stroke_width}
                onChange={(e) => updateSelected({ stroke_width: parseInt(e.target.value, 10) || 0 })}
                className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Stroke color</label>
              <input
                type="color"
                value={selectedShape.stroke_color}
                onChange={(e) => updateSelected({ stroke_color: e.target.value })}
                className="w-full mt-1 h-9 border border-gray-300 rounded-lg"
              />
            </div>
            {selectedShape.shape_type !== 'line' && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Fill color</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={selectedShape.fill_color || '#ffffff'}
                    onChange={(e) => updateSelected({ fill_color: e.target.value })}
                    className="flex-1 h-9 border border-gray-300 rounded-lg"
                  />
                  <button onClick={() => updateSelected({ fill_color: '' })} className="text-xs text-gray-500 hover:text-gray-700 border rounded px-2 py-1.5">No fill</button>
                </div>
              </div>
            )}
          </div>
        )}

        {selectedImage && (
          <div className="space-y-4">
            <img src={selectedImage.url} alt="" className="w-full rounded-lg border" />
            <button
              onClick={deleteSelected}
              className="w-full flex items-center justify-center gap-2 text-red-600 hover:text-red-800 text-sm font-medium border border-red-200 rounded-lg py-2 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" /> Delete image
            </button>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Width</label>
                <input
                  type="number" min={1} max={2000}
                  value={selectedImage.width}
                  onChange={(e) => updateSelected({ width: parseInt(e.target.value, 10) || 1 })}
                  className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Height</label>
                <input
                  type="number" min={1} max={2000}
                  value={selectedImage.height}
                  onChange={(e) => updateSelected({ height: parseInt(e.target.value, 10) || 1 })}
                  className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1"><RotateCw className="w-3 h-3" /> Rotation (degrees)</label>
              <input
                type="number" min={-360} max={360}
                value={selectedImage.rotation}
                onChange={(e) => updateSelected({ rotation: parseFloat(e.target.value) || 0 })}
                className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Opacity</label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={selectedImage.opacity}
                onChange={(e) => updateSelected({ opacity: parseFloat(e.target.value) })}
                className="w-full mt-1"
              />
            </div>
          </div>
        )}

        {!selected && selectedId !== 'qr' && !selectedShape && !selectedImage && (
          <p className="text-sm text-gray-500">Click a text field, shape, image, or the QR code on the canvas to edit it. Drag any element to reposition — it snaps to the canvas center and to other elements automatically.</p>
        )}
      </aside>

      {showAssetLibrary && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={() => setShowAssetLibrary(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Asset library</h2>
              <button onClick={() => setShowAssetLibrary(false)} className="text-gray-400 hover:text-gray-600"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="flex gap-2 mb-4 border-b">
              <button onClick={() => setAssetLibraryTab('library')} className={`px-3 py-2 text-sm font-medium border-b-2 ${assetLibraryTab === 'library' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>Your assets</button>
              <button onClick={() => setAssetLibraryTab('generate')} className={`px-3 py-2 text-sm font-medium border-b-2 flex items-center gap-1 ${assetLibraryTab === 'generate' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}><Sparkles className="w-3.5 h-3.5" /> Generate with AI</button>
            </div>

            {assetLibraryTab === 'library' && (
              <div>
                <input ref={assetFileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg" onChange={uploadLibraryImage} className="hidden" />
                <button
                  onClick={() => assetFileInputRef.current?.click()}
                  disabled={assetUploading}
                  className="mb-4 flex items-center gap-2 border rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                >
                  {assetUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Upload icon, sticker, or background
                </button>
                {brandKit?.logo_url && (
                  <button
                    onClick={() => { insertBrandLogo(); setShowAssetLibrary(false); }}
                    className="mb-4 ml-2 flex items-center gap-2 border rounded-lg px-3 py-2 text-sm"
                  >
                    <Palette className="w-4 h-4" />
                    Insert brand logo
                  </button>
                )}
                {(companyAssets.logo || companyAssets.signature) && (
                  <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-medium text-slate-600">Company assets</p>
                    <div className="flex flex-wrap gap-2">
                      {companyAssets.logo && (
                        <button onClick={() => { insertCompanyAsset(companyAssets.logo); setShowAssetLibrary(false); }} className="flex items-center gap-2 border rounded-lg bg-white px-3 py-2 text-sm hover:bg-slate-50">
                          <Building className="w-4 h-4" /> Insert company logo
                        </button>
                      )}
                      {companyAssets.signature && (
                        <button onClick={() => { insertCompanyAsset(companyAssets.signature); setShowAssetLibrary(false); }} className="flex items-center gap-2 border rounded-lg bg-white px-3 py-2 text-sm hover:bg-slate-50">
                          <Signature className="w-4 h-4" /> Insert admin signature
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {loadingAssets ? (
                  <p className="text-sm text-gray-500">Loading…</p>
                ) : imageAssets.length === 0 ? (
                  <p className="text-sm text-gray-500">No assets saved yet — upload one, or generate one with AI.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {imageAssets.map((asset) => (
                      <div key={asset._id} className="border rounded-lg overflow-hidden">
                        <img src={asset.url} alt={asset.name} className="w-full aspect-square object-contain bg-gray-50" />
                        <p className="text-xs font-medium text-gray-800 px-2 pt-1 truncate">{asset.name}</p>
                        <div className="flex gap-1 p-2 pt-1">
                          <button onClick={() => insertAssetAsImage(asset)} className="flex-1 text-xs bg-indigo-600 text-white rounded px-2 py-1 hover:bg-indigo-700">Insert</button>
                          <button onClick={() => applyAssetAsBackground(asset)} className="flex-1 text-xs border rounded px-2 py-1 hover:bg-gray-50">Background</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {assetLibraryTab === 'generate' && (
              <div className="space-y-3">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Describe the image or background</label>
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. a subtle gold laurel wreath on a transparent background"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-y"
                />
                <button
                  onClick={generateAiImage}
                  disabled={generatingAi || !aiPrompt.trim()}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {generatingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {generatingAi ? 'Generating…' : 'Generate'}
                </button>
                <p className="text-[11px] text-gray-400">Generated images are saved to Your assets automatically, ready to insert or reuse on other templates.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showVersionHistory && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={() => setShowVersionHistory(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Version history</h2>
              <button onClick={() => setShowVersionHistory(false)} className="text-gray-400 hover:text-gray-600"><XIcon className="w-5 h-5" /></button>
            </div>
            {loadingVersions ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : versions.length === 0 ? (
              <p className="text-sm text-gray-500">No saved versions yet.</p>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div key={v.version_number} className="flex items-center justify-between border rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Version {v.version_number}</p>
                      <p className="text-xs text-gray-500">{v.created_by} · {new Date(v.createdAt).toLocaleString()}</p>
                    </div>
                    <button onClick={() => revertToVersion(v.version_number)} className="text-xs border rounded px-3 py-1.5 hover:bg-gray-50">Revert</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showSharing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={() => setShowSharing(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Sharing</h2>
              <button onClick={() => setShowSharing(false)} className="text-gray-400 hover:text-gray-600"><XIcon className="w-5 h-5" /></button>
            </div>

            {activeDesignCode && (
              <div className="mb-6">
                <p className="text-sm font-medium text-gray-900 mb-2">Share this template</p>
                <div className="flex gap-2">
                  <input
                    value={shareTargetOrgCode}
                    onChange={(e) => setShareTargetOrgCode(e.target.value)}
                    placeholder="Target organization code"
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                  />
                  <button
                    onClick={shareWithOrg}
                    disabled={sharingBusy || !shareTargetOrgCode.trim()}
                    className="border rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Share
                  </button>
                </div>
                {outgoingShares.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {outgoingShares.map((s) => (
                      <div key={s._id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-1.5">
                        <span>{s.target_organization_code}</span>
                        <button onClick={() => revokeOutgoingShare(s._id)} disabled={sharingBusy} className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50">Revoke</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-gray-900 mb-2">Shared with your organization</p>
              {loadingShares ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : incomingShares.length === 0 ? (
                <p className="text-sm text-gray-500">Nothing shared with your organization yet.</p>
              ) : (
                <div className="space-y-2">
                  {incomingShares.map((s) => (
                    <div key={s.share_id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{s.design?.credential_title || s.design_code}</p>
                        <p className="text-xs text-gray-500 truncate">from {s.source_organization_name}{!s.design && ' — no longer available'}</p>
                      </div>
                      <button
                        onClick={() => importShare(s.share_id)}
                        disabled={sharingBusy || !s.design}
                        className="text-xs border rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 shrink-0"
                      >
                        Import as draft
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showComments && activeDesignCode && (
        <div className="fixed right-0 top-0 bottom-0 w-80 bg-white border-l shadow-xl z-40 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Comments</h2>
            <button onClick={() => setShowComments(false)} className="text-gray-400 hover:text-gray-600"><XIcon className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {comments.length === 0 ? (
              <p className="text-sm text-gray-500">No comments yet.</p>
            ) : (
              comments.map((c) => (
                <div key={c._id} className={`border rounded-lg p-3 ${c.resolved ? 'opacity-50' : ''}`}>
                  <p className="text-xs font-medium text-gray-800 flex items-center gap-1">
                    {c.author_username}
                    {c.position && Number.isFinite(c.position.X) && (
                      <span title="Pinned to a spot on the canvas" className="text-amber-500">📍</span>
                    )}
                  </p>
                  <p className="text-sm text-gray-700 mt-1">{c.text}</p>
                  <div className="flex gap-2 mt-2">
                    {!c.resolved && <button onClick={() => resolveCommentById(c._id)} className="text-xs text-indigo-600 hover:text-indigo-800">Resolve</button>}
                    <button onClick={() => deleteCommentById(c._id)} className="text-xs text-red-600 hover:text-red-800">Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t">
            {pendingPinPos ? (
              <div className="flex items-center justify-between text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                <span className="text-amber-700">📍 Pinned to ({pendingPinPos.X}, {pendingPinPos.Y})</span>
                <button onClick={() => setPendingPinPos(null)} className="text-amber-700 hover:text-amber-900 underline">Remove</button>
              </div>
            ) : (
              <button
                onClick={() => setPinMode((v) => !v)}
                className={`w-full text-xs rounded-lg py-1.5 mb-2 border ${pinMode ? 'bg-amber-500 text-white border-amber-500' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
              >
                {pinMode ? 'Click anywhere on the canvas…' : '📍 Pin this comment to a spot on the canvas'}
              </button>
            )}
            <textarea
              rows={2}
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              placeholder="Leave a note for other admins…"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none"
            />
            <button
              onClick={postComment}
              disabled={!newCommentText.trim()}
              className="mt-2 w-full bg-indigo-600 text-white text-sm rounded-lg py-2 hover:bg-indigo-700 disabled:opacity-50"
            >
              Post comment
            </button>
          </div>
        </div>
      )}

      {/* Step 1 of starting a design: certificate or badge. eBadgeID designs
          and issues both, and this is where that becomes visible -- badges
          used to have no entry point of their own at all. */}
      {startStep === 'kind' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={() => setStartStep(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-gray-900">What are you creating?</h2>
              <button onClick={() => setStartStep(null)} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
            </div>
            <p className="text-sm text-gray-500 mb-5">Both are designed the same way and both get a QR code automatically.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => chooseKind('certificate')}
                className="border-2 rounded-xl p-5 text-left hover:border-indigo-500 hover:shadow-md transition group"
              >
                <div className="w-full aspect-[900/636] rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-300 mb-3 flex items-center justify-center">
                  <FileText className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 transition" />
                </div>
                <p className="font-semibold text-gray-900">Create Certificate</p>
                <p className="text-xs text-gray-500 mt-0.5">Landscape document for course completion, awards and recognition.</p>
              </button>
              <button
                onClick={() => chooseKind('badge')}
                className="border-2 rounded-xl p-5 text-left hover:border-indigo-500 hover:shadow-md transition group"
              >
                <div className="w-full aspect-[900/636] rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-300 mb-3 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-lg bg-white border-2 border-slate-300 flex items-center justify-center">
                    <Award className="w-7 h-7 text-slate-400 group-hover:text-indigo-500 transition" />
                  </div>
                </div>
                <p className="font-semibold text-gray-900">Create Badge</p>
                <p className="text-xs text-gray-500 mt-0.5">Square mark for skills and micro-credentials, shareable on LinkedIn.</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: template or your own file -- offered identically for both
          kinds. Uploading your own BADGE design is a first-class path, not
          a certificate-only feature. */}
      {(startStep === 'certificate' || startStep === 'badge') && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={() => setStartStep(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {startStep === 'badge' ? 'Badge' : 'Certificate'} — how do you want to start?
              </h2>
              <button onClick={() => setStartStep(null)} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
            </div>
            <button onClick={() => setStartStep('kind')} className="text-xs text-indigo-600 hover:text-indigo-800 mb-5">← Back</button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => { setStartKind(startStep); setGalleryKind(startStep); setStartStep(null); setShowGallery(true); }}
                className="border-2 rounded-xl p-5 text-left hover:border-indigo-500 hover:shadow-md transition"
              >
                <LayoutTemplate className="w-7 h-7 text-indigo-500 mb-3" />
                <p className="font-semibold text-gray-900">
                  Choose {startStep === 'badge' ? 'Badge' : 'Certificate'} Template
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Start from a ready-made design and edit it.</p>
              </button>
              <button
                onClick={() => startFromUpload(startStep)}
                className="border-2 rounded-xl p-5 text-left hover:border-indigo-500 hover:shadow-md transition"
              >
                <Upload className="w-7 h-7 text-indigo-500 mb-3" />
                <p className="font-semibold text-gray-900">
                  Upload Your Own {startStep === 'badge' ? 'Badge' : 'Certificate'} Design
                </p>
                <p className="text-xs text-gray-500 mt-0.5">PNG, JPG, WEBP, SVG or PDF. A multi-page PDF lets you pick the page.</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {showGallery && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={() => setShowGallery(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Start from a template</h2>
              <button onClick={() => setShowGallery(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
            </div>
            {/* Certificate and badge templates are separate libraries. They
                are different objects with different shapes, and mixing them
                in one grid made badges look like an afterthought. */}
            <div className="flex gap-1 mb-4 border-b border-gray-200">
              {['certificate', 'badge'].map((kind) => {
                const count = TEMPLATE_LIBRARY.filter((t) => t.category === kind).length;
                const active = (galleryKind || 'certificate') === kind;
                return (
                  <button
                    key={kind}
                    onClick={() => setGalleryKind(kind)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                      active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {kind === 'badge' ? 'Badge Templates' : 'Certificate Templates'}
                    <span className="ml-1.5 text-xs text-gray-400">{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {TEMPLATE_LIBRARY.filter((t) => t.category === (galleryKind || 'certificate')).map((starter) => (
                <button
                  key={starter.id}
                  onClick={() => loadStarterTemplate(starter)}
                  disabled={materializingTemplateId !== null}
                  className="border rounded-lg overflow-hidden hover:border-indigo-500 hover:shadow-md transition text-left relative disabled:opacity-60"
                >
                  <img src={starter.backgroundUrl} alt={starter.name} className="w-full aspect-[900/636] object-cover bg-gray-100" />
                  {materializingTemplateId === starter.id && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                    </div>
                  )}
                  <div className="p-2">
                    <p className="text-sm font-medium text-gray-900">{starter.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{starter.category}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
