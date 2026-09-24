// src/lib/template-library.js
//
// Starter templates for the design editor — 12 ready-made designs so an
// admin doesn't have to start from a blank canvas and a background-image
// URL box. Backgrounds are hand-built SVGs, kept in two places on purpose:
// here (served from /public/templates/) purely so this file's `<img>`
// gallery-card previews below have something to point at, and a second,
// backend-owned copy (backend/assets/gallery-templates/) that the design
// editor's page.js actually uses when a template is picked -- see
// loadStarterTemplate() there and utils/galleryTemplates.js on the backend.
// The certificate microservice can only reach the internal storage host
// and can only rasterize (Pillow), never parse SVG, so the frontend's own
// SVG URL is never usable as a saved design's background directly; picking
// a starter now materializes it into a real storage-hosted PNG first.
// Picking one loads its background, canvas size, and a sensible starting
// set of text fields — all still fully editable afterward, same as any
// other template.
//
// Positions below are hand-placed to match each background's actual empty
// space (clear of borders, seals, ribbons) — not just centered blindly.

export const TEMPLATE_LIBRARY = [
  {
    id: 'classic-gold',
    name: 'Classic Gold',
    category: 'certificate',
    backgroundUrl: '/templates/classic-gold.svg',
    elements: [
      { text_title: 'custom', text: 'Certificate of Achievement', font_family: 'Playfair Display', font_size: 34, font_color: '#5c4a1f', font_weight: 'bold', x: 450, y: 185, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Playfair Display', font_size: 40, font_color: '#1f2937', font_weight: 'bold', x: 450, y: 300, align: 'center' },
      { text_title: 'custom', text: 'has successfully completed the program', font_family: 'Georgia', font_size: 18, font_color: '#4b5563', font_weight: 'normal', x: 450, y: 350, align: 'center' },
      { text_title: 'custom', text: 'Issued on {{issue_date}}', font_family: 'Georgia', font_size: 15, font_color: '#6b7280', font_weight: 'normal', x: 450, y: 498, align: 'center' },
    ],
    qrPosition: { x: 780, y: 515 },
  },
  {
    id: 'modern-minimal',
    name: 'Modern Minimal',
    category: 'certificate',
    backgroundUrl: '/templates/modern-minimal.svg',
    elements: [
      { text_title: 'custom', text: 'CERTIFICATE OF COMPLETION', font_family: 'Montserrat', font_size: 16, font_color: '#6b7280', font_weight: '600', x: 90, y: 110, align: 'left' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Montserrat', font_size: 44, font_color: '#111827', font_weight: 'bold', x: 90, y: 300, align: 'left' },
      { text_title: 'custom', text: 'for outstanding performance', font_family: 'Arial', font_size: 16, font_color: '#6b7280', font_weight: 'normal', x: 90, y: 340, align: 'left' },
      { text_title: 'custom', text: 'Signature', font_family: 'Arial', font_size: 12, font_color: '#9ca3af', font_weight: 'normal', x: 90, y: 500, align: 'left' },
      { text_title: 'custom', text: '{{issue_date}}', font_family: 'Arial', font_size: 12, font_color: '#9ca3af', font_weight: 'normal', x: 520, y: 500, align: 'left' },
    ],
    qrPosition: { x: 770, y: 520 },
  },
  {
    id: 'corporate-blue',
    name: 'Corporate Blue',
    category: 'certificate',
    backgroundUrl: '/templates/corporate-blue.svg',
    elements: [
      { text_title: 'custom', text: 'Certificate of Recognition', font_family: 'Helvetica', font_size: 28, font_color: '#0f3d63', font_weight: 'bold', x: 450, y: 210, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Helvetica', font_size: 38, font_color: '#111827', font_weight: 'bold', x: 450, y: 290, align: 'center' },
      { text_title: 'custom', text: 'in recognition of dedication and achievement', font_family: 'Arial', font_size: 16, font_color: '#4b5563', font_weight: 'normal', x: 450, y: 340, align: 'center' },
      { text_title: 'custom', text: 'Issued {{issue_date}}', font_family: 'Arial', font_size: 14, font_color: '#6b7280', font_weight: 'normal', x: 450, y: 560, align: 'center' },
    ],
    qrPosition: { x: 760, y: 545 },
  },
  {
    id: 'diploma-formal',
    name: 'Formal Diploma',
    category: 'certificate',
    backgroundUrl: '/templates/diploma-formal.svg',
    elements: [
      { text_title: 'custom', text: 'Diploma', font_family: 'Times New Roman', font_size: 32, font_color: '#3f3a33', font_weight: 'bold', x: 450, y: 195, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Times New Roman', font_size: 38, font_color: '#1f2937', font_weight: 'bold', x: 450, y: 290, align: 'center' },
      { text_title: 'custom', text: 'has fulfilled all requirements and is hereby awarded this diploma', font_family: 'Georgia', font_size: 15, font_color: '#4b5563', font_weight: 'normal', x: 450, y: 350, align: 'center' },
      { text_title: 'custom', text: 'Program Director', font_family: 'Georgia', font_size: 12, font_color: '#6b7280', font_weight: 'normal', x: 240, y: 465, align: 'center' },
      { text_title: 'custom', text: 'Registrar', font_family: 'Georgia', font_size: 12, font_color: '#6b7280', font_weight: 'normal', x: 660, y: 465, align: 'center' },
    ],
    qrPosition: { x: 750, y: 175 },
  },
  {
    id: 'badge-circular',
    name: 'Circular Badge',
    category: 'badge',
    backgroundUrl: '/templates/badge-circular.svg',
    elements: [
      { text_title: 'custom', text: 'CERTIFIED', font_family: 'Montserrat', font_size: 16, font_color: '#8a6a1f', font_weight: '600', x: 450, y: 215, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Georgia', font_size: 24, font_color: '#1f2937', font_weight: 'bold', x: 450, y: 270, align: 'center' },
      { text_title: 'custom', text: 'Professional Badge', font_family: 'Arial', font_size: 15, font_color: '#6b7280', font_weight: 'normal', x: 450, y: 310, align: 'center' },
      { text_title: 'custom', text: '{{issue_date}}', font_family: 'Arial', font_size: 14, font_color: '#f5e6b8', font_weight: 'bold', x: 450, y: 525, align: 'center' },
    ],
    qrPosition: { x: 40, y: 540 },
  },
  {
    id: 'badge-achievement',
    name: 'Achievement Badge',
    category: 'badge',
    backgroundUrl: '/templates/badge-achievement.svg',
    elements: [
      { text_title: 'custom', text: 'ACHIEVEMENT UNLOCKED', font_family: 'Montserrat', font_size: 15, font_color: '#f5e6b8', font_weight: '600', x: 450, y: 95, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Montserrat', font_size: 24, font_color: '#ffffff', font_weight: 'bold', x: 450, y: 505, align: 'center' },
    ],
    qrPosition: { x: 780, y: 540 },
  },
  {
    id: 'elegant-emerald',
    name: 'Elegant Emerald',
    category: 'certificate',
    backgroundUrl: '/templates/elegant-emerald.svg',
    elements: [
      { text_title: 'custom', text: 'Certificate of Excellence', font_family: 'Playfair Display', font_size: 32, font_color: '#0d6b4f', font_weight: 'bold', x: 450, y: 200, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Playfair Display', font_size: 38, font_color: '#1f2937', font_weight: 'bold', x: 450, y: 300, align: 'center' },
      { text_title: 'custom', text: 'for exceptional dedication and results', font_family: 'Georgia', font_size: 16, font_color: '#4b5563', font_weight: 'normal', x: 450, y: 350, align: 'center' },
      { text_title: 'custom', text: 'Issued on {{issue_date}}', font_family: 'Georgia', font_size: 14, font_color: '#6b7280', font_weight: 'normal', x: 450, y: 500, align: 'center' },
    ],
    qrPosition: { x: 780, y: 515 },
  },
  {
    id: 'bold-crimson',
    name: 'Bold Crimson',
    category: 'certificate',
    backgroundUrl: '/templates/bold-crimson.svg',
    elements: [
      { text_title: 'custom', text: 'CERTIFICATE OF ACHIEVEMENT', font_family: 'Montserrat', font_size: 18, font_color: '#ffffff', font_weight: '600', x: 450, y: 40, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Montserrat', font_size: 42, font_color: '#111111', font_weight: 'bold', x: 450, y: 260, align: 'center' },
      { text_title: 'custom', text: 'has demonstrated outstanding performance', font_family: 'Arial', font_size: 17, font_color: '#4b5563', font_weight: 'normal', x: 450, y: 320, align: 'center' },
      { text_title: 'custom', text: '{{issue_date}}', font_family: 'Arial', font_size: 14, font_color: '#ffffff', font_weight: 'bold', x: 450, y: 606, align: 'center' },
    ],
    qrPosition: { x: 770, y: 470 },
  },
  {
    id: 'tech-gradient',
    name: 'Tech Gradient',
    category: 'certificate',
    backgroundUrl: '/templates/tech-gradient.svg',
    elements: [
      { text_title: 'custom', text: 'CERTIFICATE OF COMPLETION', font_family: 'Montserrat', font_size: 16, font_color: '#93c5fd', font_weight: '600', x: 90, y: 220, align: 'left' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Montserrat', font_size: 44, font_color: '#ffffff', font_weight: 'bold', x: 90, y: 300, align: 'left' },
      { text_title: 'custom', text: 'completed this program with distinction', font_family: 'Arial', font_size: 16, font_color: '#cbd5e1', font_weight: 'normal', x: 90, y: 345, align: 'left' },
      { text_title: 'custom', text: '{{issue_date}}', font_family: 'Arial', font_size: 13, font_color: '#93c5fd', font_weight: 'normal', x: 90, y: 560, align: 'left' },
    ],
    qrPosition: { x: 760, y: 500 },
  },
  {
    id: 'academic-navy',
    name: 'Academic Navy',
    category: 'certificate',
    backgroundUrl: '/templates/academic-navy.svg',
    elements: [
      { text_title: 'custom', text: 'Diploma of Achievement', font_family: 'Times New Roman', font_size: 30, font_color: '#1a2f5c', font_weight: 'bold', x: 450, y: 260, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Times New Roman', font_size: 36, font_color: '#1f2937', font_weight: 'bold', x: 450, y: 340, align: 'center' },
      { text_title: 'custom', text: 'has met all requirements of the program', font_family: 'Georgia', font_size: 15, font_color: '#4b5563', font_weight: 'normal', x: 450, y: 390, align: 'center' },
      { text_title: 'custom', text: 'Dean', font_family: 'Georgia', font_size: 12, font_color: '#6b7280', font_weight: 'normal', x: 270, y: 480, align: 'center' },
      { text_title: 'custom', text: 'Program Director', font_family: 'Georgia', font_size: 12, font_color: '#6b7280', font_weight: 'normal', x: 630, y: 480, align: 'center' },
    ],
    qrPosition: { x: 750, y: 175 },
  },
  {
    id: 'star-badge',
    name: 'Star Badge',
    category: 'badge',
    backgroundUrl: '/templates/star-badge.svg',
    elements: [
      { text_title: 'custom', text: 'TOP PERFORMER', font_family: 'Montserrat', font_size: 15, font_color: '#8a6a1f', font_weight: '600', x: 450, y: 200, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Georgia', font_size: 23, font_color: '#1f2937', font_weight: 'bold', x: 450, y: 245, align: 'center' },
      { text_title: 'custom', text: '{{issue_date}}', font_family: 'Arial', font_size: 13, font_color: '#8a6a1f', font_weight: 'normal', x: 450, y: 285, align: 'center' },
    ],
    qrPosition: { x: 40, y: 540 },
  },
  {
    id: 'ribbon-seal',
    name: 'Ribbon Seal',
    category: 'badge',
    backgroundUrl: '/templates/ribbon-seal.svg',
    elements: [
      { text_title: 'custom', text: 'CERTIFIED', font_family: 'Montserrat', font_size: 16, font_color: '#4a2e6b', font_weight: '600', x: 450, y: 210, align: 'center' },
      { text_title: 'recipient_name', text: 'Recipient Name', font_family: 'Georgia', font_size: 24, font_color: '#1f2937', font_weight: 'bold', x: 450, y: 265, align: 'center' },
      { text_title: 'custom', text: 'Professional Achievement', font_family: 'Arial', font_size: 14, font_color: '#5c3583', font_weight: 'normal', x: 450, y: 305, align: 'center' },
    ],
    qrPosition: { x: 780, y: 540 },
  },
];

export function getTemplateById(id) {
  return TEMPLATE_LIBRARY.find((t) => t.id === id) || null;
}
