'use client';
import React, { useEffect, useState, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Image from 'next/image';
import NextImage from 'next/image';
import { Download, Plus, Loader2, Ban, AlertTriangle, Search, Award, FileCheck, FileX, Upload, FileText, Move, ZoomIn, ZoomOut, Type, Bold, Italic, Underline, Trash2, AlignLeft, ChevronLeft, ChevronRight, Circle, Square, Minus, Star, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { checkAuth } from '../../lib/authChecker.js';
import { apiFetch, uploadFile } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import QRCode from 'qrcode';
import { useLocale } from '@/context/Localecontext.js';
const AVAILABLE_FONTS = [
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Times New Roman', value: 'Times New Roman, serif' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Courier New', value: 'Courier New, monospace' },
  { name: 'Verdana', value: 'Verdana, sans-serif' },
  { name: 'Trebuchet MS', value: 'Trebuchet MS, sans-serif' },
  { name: 'Palatino', value: 'Palatino, serif' },
  { name: 'Garamond', value: 'Garamond, serif' },
  { name: 'Bookman', value: 'Bookman, serif' },
  { name: 'Comic Sans MS', value: 'Comic Sans MS, cursive' },
  { name: 'Impact', value: 'Impact, sans-serif' },
  { name: 'Lucida Sans', value: 'Lucida Sans, sans-serif' }
];

// Font sizes from 10 to 48
const AVAILABLE_FONT_SIZES = (() => {
  const result = [];
  let value = 10;
  let t = 0;

  while (value <= 148) {
    result.push(value);
    value = value + (t + 1);
    t++;
  }

  return result;
})();

// Wrapped in forwardRef to expose functions to the parent
const CertificateCanvas = forwardRef(({ templateUrl, achieverUsername, credentialCode, isBulkMode = false, employeeData = null }, ref) => {
  const { session } = useSession();
  const canvasRef = useRef(null);
  const hiddenInputRef = useRef(null);
  const [canvasLoaded, setCanvasLoaded] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [textElements, setTextElements] = useState([]);
  const [shapeElements, setShapeElements] = useState([]);
  const [selectedElement, setSelectedElement] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [orgData, setOrgData] = useState(null);
  const [userData, setUserData] = useState(null);
  const [qrCodeImage, setQrCodeImage] = useState(null);

  // Positions
  const [qrPosition, setQrPosition] = useState({ x: 100, y: 550 });
  const [logoPosition, setLogoPosition] = useState({ x: 50, y: 50 });
  const [signaturePosition, setSignaturePosition] = useState({ x: 650, y: 500 });

  // Resize State
  const [logoScale, setLogoScale] = useState(1);
  const [signatureScale, setSignatureScale] = useState(1);
  const [qrScale, setQrScale] = useState(1);
  // Resize State


  // New Features State
  const [visibleElements, setVisibleElements] = useState({ logo: true, signature: true, qr: true });
  // Single custom logo/signature for the main slots (kept for org data compatibility)
  const [customLogo, setCustomLogo] = useState(null);
  const [customSignature, setCustomSignature] = useState(null);
  // All uploaded images as canvas elements
  const [imageElements, setImageElements] = useState([]);
  const imageInputRef = useRef(null);

  // Clipboard and Undo/Redo state
  const [clipboard, setClipboard] = useState(null);
  const [undoHistory, setUndoHistory] = useState([]);
  const [undoHistoryIndex, setUndoHistoryIndex] = useState(-1);
  const maxHistorySize = 50;

  // Ref-based state for Smooth Dragging (Performance)
  const liveState = useRef({
    textElements: [],
    shapeElements: [],
    imageElements: [],
    logoPosition: { x: 50, y: 50 },
    qrPosition: { x: 100, y: 550 },
    signaturePosition: { x: 650, y: 500 },
    logoScale: 1,
    signatureScale: 1,
    qrScale: 1
  });

  // Sync React state to Ref when it changes (initial load or external updates)
  useEffect(() => {
    liveState.current.textElements = textElements;
    liveState.current.shapeElements = shapeElements;
    liveState.current.imageElements = imageElements;
    liveState.current.logoPosition = logoPosition;
    liveState.current.qrPosition = qrPosition;
    liveState.current.signaturePosition = signaturePosition;
    liveState.current.logoScale = logoScale;
    liveState.current.signatureScale = signatureScale;
    liveState.current.qrScale = qrScale;
  }, [textElements, shapeElements, imageElements, logoPosition, qrPosition, signaturePosition, logoScale, signatureScale, qrScale]);

  const [draggingType, setDraggingType] = useState(null); // 'qr', 'logo', 'signature', or 'text'
  const dragRef = useRef({ active: false, type: null, startX: 0, startY: 0, initialData: null, id: null });

  const selectedElementRef = useRef(null);
  const isEditingRef = useRef(false);

  // Sync refs with state
  useEffect(() => {
    selectedElementRef.current = selectedElement;
    isEditingRef.current = isEditing;
  }, [selectedElement, isEditing]);

  const lastClickTimeRef = useRef(0); // For manual double-tap detection

  // Ref to hold the latest draw function to avoid closure staleness in onload callbacks
  const drawCertRef = useRef(null);

  const imageCache = useRef({
    template: null,
    qr: null,
    logo: null,
    signature: null
  });

  // Auto-save function - saves to a list of drafts
  const saveDesignToLocalStorage = useCallback(() => {
    if (!templateUrl || !achieverUsername) return;

    try {
      // Convert image elements to serializable format (keep src, remove Image objects)
      const serializableImageElements = imageElements.map(el => ({
        id: el.id,
        src: el.src,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        scale: el.scale
      }));

      const designState = {
        id: `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        textElements,
        shapeElements,
        imageElements: serializableImageElements,
        logoPosition,
        qrPosition,
        signaturePosition,
        logoScale,
        signatureScale,
        qrScale,
        visibleElements,
        customLogo,
        customSignature,
        templateUrl,
        achieverUsername,
        // Save employee data for proper restoration
        employeeData: employeeData ? {
          username: employeeData.username || employeeData.user_name,
          email: employeeData.email,
          displayName: employeeData.displayName || `${employeeData.first_name || ''} ${employeeData.last_name || ''}`.trim() || employeeData.name,
          first_name: employeeData.first_name,
          last_name: employeeData.last_name,
          name: employeeData.name,
          user_name: employeeData.user_name,
          avatar_url: employeeData.avatar_url,
          profile_pic: employeeData.profile_pic,
          // Save any other identifying fields
          _id: employeeData._id,
          id: employeeData.id
        } : null,
        savedAt: Date.now(),
        name: `Draft ${new Date().toLocaleString()}`
      };

      // Get existing drafts
      const existingDrafts = JSON.parse(localStorage.getItem('credential_design_drafts') || '[]');

      // Check if there's a draft with the same template and user (update it instead of creating new)
      const existingIndex = existingDrafts.findIndex(
        (draft) => draft.templateUrl === templateUrl && draft.achieverUsername === achieverUsername
      );

      if (existingIndex >= 0) {
        // Update existing draft
        existingDrafts[existingIndex] = designState;
      } else {
        // Add new draft (limit to 20 drafts)
        existingDrafts.push(designState);
        if (existingDrafts.length > 20) {
          existingDrafts.shift(); // Remove oldest draft
        }
      }

      localStorage.setItem('credential_design_drafts', JSON.stringify(existingDrafts));

      // Also keep the single draft for backward compatibility
      localStorage.setItem('credential_design_draft', JSON.stringify(designState));
    } catch (err) {
      console.error('Error saving design to localStorage:', err);
    }
  }, [textElements, shapeElements, imageElements, logoPosition, qrPosition, signaturePosition, logoScale, signatureScale, qrScale, visibleElements, customLogo, customSignature, templateUrl, achieverUsername, employeeData]);

  // Auto-save every 2 seconds
  useEffect(() => {
    if (!templateUrl || !achieverUsername || !canvasLoaded) return;

    const interval = setInterval(() => {
      saveDesignToLocalStorage();
    }, 2000);
    console.log('Saving design to localStorage');
    return () => clearInterval(interval);
  }, [templateUrl, achieverUsername, canvasLoaded, saveDesignToLocalStorage]);

  // Restore design from localStorage
  const restoreDesignFromLocalStorage = useCallback(() => {
    try {
      const saved = localStorage.getItem('credential_design_draft');
      if (!saved) return false;

      const designState = JSON.parse(saved);

      // Check if saved design matches current template and user
      if (designState.templateUrl !== templateUrl || designState.achieverUsername !== achieverUsername) {
        return false;
      }

      return restoreDesignState(designState);
    } catch (err) {
      console.error('Error restoring design from localStorage:', err);
      return false;
    }
  }, [templateUrl, achieverUsername]);

  // Helper function to restore a design state (used by both restoreDesignFromLocalStorage and restoreDraftById)
  const restoreDesignState = useCallback((designState) => {
    try {
      // Restore state
      setTextElements(designState.textElements || []);
      setShapeElements(designState.shapeElements || []);
      setLogoPosition(designState.logoPosition || { x: 50, y: 50 });
      setQrPosition(designState.qrPosition || { x: 100, y: 550 });
      setSignaturePosition(designState.signaturePosition || { x: 650, y: 500 });
      setLogoScale(designState.logoScale || 1);
      setSignatureScale(designState.signatureScale || 1);
      setQrScale(designState.qrScale || 1);
      setVisibleElements(designState.visibleElements || { logo: true, signature: true, qr: true });
      setCustomLogo(designState.customLogo || null);
      setCustomSignature(designState.customSignature || null);

      // Restore image elements (recreate Image objects from src)
      if (designState.imageElements && designState.imageElements.length > 0) {
        const restoredImages = designState.imageElements.map(el => {
          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          return {
            ...el,
            img: img
          };
        });

        // Load images asynchronously
        Promise.all(
          restoredImages.map((el, index) => {
            return new Promise((resolve) => {
              const img = el.img;
              img.onload = () => {
                resolve();
              };
              img.onerror = () => {
                console.error('Failed to restore image:', el.src);
                resolve();
              };
              img.src = el.src;
            });
          })
        ).then(() => {
          setImageElements(restoredImages);
          // Trigger redraw after a short delay to ensure all state is updated
          setTimeout(() => {
            if (drawCertRef.current) drawCertRef.current();
          }, 100);
        });
      } else {
        setImageElements([]);
        // Trigger redraw even if no images
        setTimeout(() => {
          if (drawCertRef.current) drawCertRef.current();
        }, 100);
      }

      return true;
    } catch (err) {
      console.error('Error restoring design state:', err);
      return false;
    }
  }, []);

  // EXPOSE METHOD TO PARENT
  useImperativeHandle(ref, () => ({
    exportToPNG: async () => {
      // 1. Deselect to remove handles from image (via REF for sync drawing)
      selectedElementRef.current = null;
      isEditingRef.current = false;

      // 2. Draw synchronously with clean state
      if (drawCertRef.current) drawCertRef.current();

      // 3. Export
      return new Promise(resolve => {
        const canvas = canvasRef.current;
        if (!canvas) resolve(null);
        else canvas.toBlob(blob => {
          // Restore state if needed (optional, but good UX to not lose selection)
          // But for "Issue Credential" usually we are done. 
          // Let's actually update the React state to match the visual reality
          // so the specific user sees the selection verify gone.
          setSelectedElement(null);
          setIsEditing(false);

          resolve(blob);
        }, 'image/png');
      });
    },
    exportToPNGWithName: async (employeeName) => {
      // Export with name replacement for bulk issuance
      selectedElementRef.current = null;
      isEditingRef.current = false;

      // Temporarily replace {employees_name} with actual name
      const originalTextElements = [...liveState.current.textElements];
      const modifiedTextElements = originalTextElements.map(el => ({
        ...el,
        text: el.text.replace(/{employees_name}/g, employeeName)
      }));

      // Update live state temporarily
      liveState.current.textElements = modifiedTextElements;

      // Draw with modified text
      if (drawCertRef.current) drawCertRef.current();

      // Export
      return new Promise(resolve => {
        const canvas = canvasRef.current;
        if (!canvas) {
          // Restore original state
          liveState.current.textElements = originalTextElements;
          resolve(null);
          return;
        }

        canvas.toBlob(blob => {
          // Restore original state
          liveState.current.textElements = originalTextElements;
          // Redraw with original text
          if (drawCertRef.current) drawCertRef.current();
          resolve(blob);
        }, 'image/png');
      });
    },
    restoreDesign: restoreDesignFromLocalStorage,
    restoreDraftById: (draftId) => {
      try {
        const drafts = JSON.parse(localStorage.getItem('credential_design_drafts') || '[]');
        const draft = drafts.find(d => d.id === draftId);
        if (!draft) return false;
        return restoreDesignState(draft);
      } catch (err) {
        console.error('Error restoring draft by ID:', err);
        return false;
      }
    },
    getAllDrafts: () => {
      try {
        return JSON.parse(localStorage.getItem('credential_design_drafts') || '[]');
      } catch {
        return [];
      }
    },
    deleteDraft: (draftId) => {
      try {
        const drafts = JSON.parse(localStorage.getItem('credential_design_drafts') || '[]');
        const filtered = drafts.filter(d => d.id !== draftId);
        localStorage.setItem('credential_design_drafts', JSON.stringify(filtered));
        return true;
      } catch {
        return false;
      }
    },
    hasSavedDesign: () => {
      try {
        const saved = localStorage.getItem('credential_design_draft');
        if (!saved) return false;
        const designState = JSON.parse(saved);
        return designState.templateUrl === templateUrl && designState.achieverUsername === achieverUsername;
      } catch {
        return false;
      }
    }
  }));

  // Fetch data
  useEffect(() => {
    if (!session) return;
    const ORG_CODE = session.organization_code;
    if (!ORG_CODE) return;

    const fetchData = async () => {
      try {
        const response = await apiFetch(`/organizations/code/${ORG_CODE}`);
        const result = await response.json();

        // Handle varying response formats (wrapped data vs direct object)
        console.log('Org Data Response:', result);
        if (result.success && result.data) {
          setOrgData(result.data);
        } else if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
          setOrgData(result.data);
        } else if (result.logo || result.organization_code || result.name) {
          setOrgData(result);
        }
      } catch (err) {
        console.error('Error fetching organization data:', err);
      }
    };
    fetchData();
  }, [session]);

  // Set default text - UPDATED: Allow updating even if textElements exist
  useEffect(() => {
    const displayText = isBulkMode ? '{employees_name}' : achieverUsername;

    if (displayText) {
      // Check if we already have a name element to update instead of replacing everything?
      // For now, let's just ensure if it's the initial simple state we update it.
      // Or simpler: just overwrite if it's a "fresh" load or user switch.
      // But to be safe and fix the issue "Preview not updating", we should update the text.

      // Better approach: Find the main name element and update it, or add it if missing.
      // Assuming single name element flow for this fix as per "Preview not updating" issue.

      setTextElements(prev => {
        // If empty, add it
        if (prev.length === 0) {
          return [{
            id: `text-${Date.now()}`,
            text: displayText,
            x: 300,
            y: 250,
            fontSize: 48,
            fontFamily: 'Georgia, serif',
            color: '#000000',
            fontWeight: 'bold',
            bold: true,
            italic: false,
            underline: false,
            selectionStart: displayText.length,
            selectionEnd: displayText.length,
            cursorPosition: displayText.length // Backwards compat just in case
          }];
        }
        // If not empty, maybe we shouldn't wipe user's custom text? 
        // But the issue says "Preview is not being updated", implying when they switch user, the name stays old.
        // So we should probably update the *first* element or the one that looks like a name?
        // Let's doing a complete reset for now as that seems to be the expected behavior when switching users in this simple app context,
        // OR better, try to preserve position if possible, but simplest fix for "not updating" is to allow the update.

        return [{
          id: `text-${Date.now()}`,
          text: displayText,
          x: 300,  // Could try to preserve prev[0].x if desired, but sticking to safe default
          y: 250,
          fontSize: 48,
          fontFamily: 'Georgia, serif',
          color: '#000000',
          fontWeight: 'bold',
          bold: true,
          italic: false,
          underline: false,
          selectionStart: displayText.length,
          selectionEnd: displayText.length,
          cursorPosition: displayText.length // Backwards compat just in case
        }];
      });
    }
  }, [achieverUsername, isBulkMode]);

  // Load Template
  useEffect(() => {
    if (!templateUrl) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.current.template = img;
      if (canvasRef.current) {
        canvasRef.current.width = img.naturalWidth || img.width;
        canvasRef.current.height = img.naturalHeight || img.height;
        setCanvasLoaded(true);
      }
    };
    img.src = templateUrl;
  }, [templateUrl]);

  // Load Images
  // Load Logo from Org Data or Custom Upload
  // Load Logo (Custom > Org)
  useEffect(() => {
    const src = customLogo || orgData?.logo;
    if (src) {
      console.log("Attempting to load logo:", src);
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageCache.current.logo = img;
        if (drawCertRef.current) drawCertRef.current();
      };
      img.onerror = () => console.error("Logo failed to load:", src);
      // Only cache-bust if it's a remote URL (likely from orgData), not a data URL (upload)
      img.src = src.startsWith('data:') ? src : `${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`;
    }
  }, [orgData?.logo, customLogo]);

  // Load Signature from Org Data or Custom Upload
  // Load Signature (Custom > Org)
  useEffect(() => {
    const src = customSignature || orgData?.signature;
    if (src) {
      console.log("Attempting to load signature:", src);
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageCache.current.signature = img;
        if (drawCertRef.current) drawCertRef.current();
      };
      img.onerror = () => console.error("Signature failed to load:", src);
      img.src = src.startsWith('data:') ? src : `${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`;
    }
  }, [orgData?.signature, customSignature]);

  useEffect(() => {
    if (!credentialCode) return;
    QRCode.toDataURL(`https://app.ebadgeid.com/verifications/credentials/${credentialCode}`, { width: 150, margin: 1 })
      .then(url => {
        setQrCodeImage(url);
        const img = new window.Image();
        img.src = url;
        img.onload = () => {
          imageCache.current.qr = img;
          if (drawCertRef.current) drawCertRef.current();
        };
      });
  }, [credentialCode]);

  // Core Drawing Function
  const drawCertificate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasLoaded) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Read from LIVE state for smooth updates, falling back to React state if needed?
    // Actually, liveState.current should check if it's "dirty" or just use provided args?
    // Easier: Always read from liveState.current in this function, as it's synced.
    const state = liveState.current;

    // 1. Draw Template
    if (imageCache.current.template) {
      ctx.drawImage(imageCache.current.template, 0, 0, canvas.width, canvas.height);
    }

    // Helper: Draw Enhanced Handles (4 Corners)
    const drawEnhancedSelection = (x, y, w, h) => {
      ctx.save(); // Save state to prevent style pollution
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]); // Dashed line
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]); // Reset

      // Draw 4 Corner Handles
      const handleSize = 8;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;

      const corners = [
        { x: x - handleSize / 2, y: y - handleSize / 2 }, // TL
        { x: x + w - handleSize / 2, y: y - handleSize / 2 }, // TR
        { x: x - handleSize / 2, y: y + h - handleSize / 2 }, // BL
        { x: x + w - handleSize / 2, y: y + h - handleSize / 2 } // BR
      ];

      corners.forEach(c => {
        ctx.beginPath();
        ctx.rect(c.x, c.y, handleSize, handleSize);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore(); // Restore state
    };

    // 2. Draw Text Elements
    state.textElements.forEach(el => {
      ctx.font = `${el.italic ? 'italic ' : ''}${el.fontWeight} ${el.fontSize}px ${el.fontFamily}`;
      ctx.fillStyle = el.color;
      ctx.textBaseline = 'top';

      const lines = el.text.split('\n');
      const lineHeight = el.fontSize * 1.3;
      const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width), 100);
      const totalHeight = lines.length * lineHeight;

      // Draw Selection Highlight (Ctrl+A)
      // Use REFS for drawing logic to ensure export catches the override
      if (isEditingRef.current && selectedElementRef.current === el.id && (el.selectionStart !== el.selectionEnd)) {
        ctx.save();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)'; // Light blue selection
        ctx.fillRect(el.x - 5, el.y - 5, maxWidth + 10, totalHeight + 10);
        ctx.restore();
      }

      ctx.fillStyle = el.color; // Force text color reset

      if (selectedElementRef.current === el.id) {
        drawEnhancedSelection(el.x - 5, el.y - 5, maxWidth + 10, totalHeight + 10);
      }

      lines.forEach((line, i) => {
        const y = el.y + i * lineHeight;
        ctx.fillText(line, el.x, y);
        if (el.underline) {
          const metrics = ctx.measureText(line);
          ctx.beginPath();
          ctx.strokeStyle = el.color;
          ctx.lineWidth = el.fontSize * 0.08;
          ctx.moveTo(el.x, y + el.fontSize);
          ctx.lineTo(el.x + metrics.width, y + el.fontSize);
          ctx.stroke();
        }
      });

      // Cursor
      if (isEditingRef.current && selectedElementRef.current === el.id && cursorVisible && el.selectionStart === el.selectionEnd) {
        const before = el.text.substring(0, el.selectionStart);
        const linesBefore = before.split('\n');
        const lineIdx = linesBefore.length - 1;
        const cursorX = el.x + ctx.measureText(linesBefore[lineIdx] || '').width;
        const cursorY = el.y + lineIdx * lineHeight;
        ctx.strokeStyle = el.color;
        ctx.lineWidth = 2; // Make cursor visible
        ctx.beginPath();
        ctx.moveTo(cursorX, cursorY);
        ctx.lineTo(cursorX, cursorY + el.fontSize);
        ctx.stroke();
      }
    });

    // 2b. Draw Shape Elements
    state.shapeElements.forEach(el => {
      ctx.fillStyle = el.color;
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.lineWidth || 3;

      ctx.beginPath();
      if (el.type === 'square') {
        ctx.fillRect(el.x, el.y, el.width, el.height);
      } else if (el.type === 'circle') {
        ctx.beginPath();
        // Ellipse logic if width != height, or just circle based on width?
        // Let's do ellipse to allow stretching
        ctx.ellipse(el.x + el.width / 2, el.y + el.height / 2, Math.abs(el.width / 2), Math.abs(el.height / 2), 0, 0, 2 * Math.PI);
        ctx.fill();
      } else if (el.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        // If dragging handle changes width/height, we draw to x+w, y+h
        ctx.lineTo(el.x + el.width, el.y + el.height);
        ctx.stroke();
      } else if (el.type === 'star') {
        // Star drawing
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        const outerRadius = Math.min(Math.abs(el.width), Math.abs(el.height)) / 2;
        const innerRadius = outerRadius / 2.5;
        const spikes = 5;

        let rot = Math.PI / 2 * 3;
        let x = cx;
        let y = cy;
        const step = Math.PI / spikes;

        ctx.beginPath();
        ctx.moveTo(cx, cy - outerRadius);
        for (let i = 0; i < spikes; i++) {
          x = cx + Math.cos(rot) * outerRadius;
          y = cy + Math.sin(rot) * outerRadius;
          ctx.lineTo(x, y);
          rot += step;

          x = cx + Math.cos(rot) * innerRadius;
          y = cy + Math.sin(rot) * innerRadius;
          ctx.lineTo(x, y);
          rot += step;
        }
        ctx.lineTo(cx, cy - outerRadius);
        ctx.closePath();
        ctx.fill();
      }

      if (selectedElementRef.current === el.id) {
        drawEnhancedSelection(el.x - 5, el.y - 5, el.width + 10, el.height + 10);
      }
    });

    // 3. Draw Extra Images
    const drawAsset = (img, pos, w, h, id) => {
      if (!img) return;
      if (selectedElementRef.current === id) {
        drawEnhancedSelection(pos.x - 5, pos.y - 5, w + 10, h + 10);
      }
      ctx.drawImage(img, pos.x, pos.y, w, h);
    };

    if (visibleElements.logo) drawAsset(imageCache.current.logo, state.logoPosition, 80 * state.logoScale, 80 * state.logoScale, 'logo');
    if (visibleElements.qr) drawAsset(imageCache.current.qr, state.qrPosition, 100 * state.qrScale, 100 * state.qrScale, 'qr-code');
    if (visibleElements.signature) drawAsset(imageCache.current.signature, state.signaturePosition, 150 * state.signatureScale, 80 * state.signatureScale, 'signature');

    // 4. Draw Uploaded Image Elements (use liveState for smooth dragging)
    (state.imageElements || imageElements).forEach(el => {
      if (el.img && el.img.complete) {
        const w = el.width * el.scale;
        const h = el.height * el.scale;
        drawAsset(el.img, { x: el.x, y: el.y }, w, h, el.id);
      }
    });

  }, [canvasLoaded, isEditing, cursorVisible, selectedElement, visibleElements]);
  // Keep ref updated
  useEffect(() => {
    drawCertRef.current = drawCertificate;
  }, [drawCertificate]);

  // Trigger draw on state changes (MOVED HERE to avoid "before initialization" error)
  useEffect(() => {
    drawCertificate();
  }, [textElements, logoPosition, qrPosition, signaturePosition, logoScale, signatureScale, qrScale, drawCertificate, visibleElements, imageElements]);

  // Cursor Blinking
  useEffect(() => {
    if (!isEditing) return;
    const interval = setInterval(() => setCursorVisible(v => !v), 530);
    return () => clearInterval(interval);
  }, [isEditing]);


  // Interaction Helper: Check if point is near handle
  // Interaction Helper: Check if point is near handle (4 Corners)
  const checkHandleHit = (x, y, bx, by, bw, bh) => {
    const handleSize = 20; // Increased size for easier grabbing
    // TL
    if (x >= bx - 10 && x <= bx + handleSize && y >= by - 10 && y <= by + handleSize) return 'tl';
    // TR
    if (x >= bx + bw - 10 && x <= bx + bw + handleSize && y >= by - 10 && y <= by + handleSize) return 'tr';
    // BL
    if (x >= bx - 10 && x <= bx + handleSize && y >= by + bh - 10 && y <= by + bh + handleSize) return 'bl';
    // BR
    if (x >= bx + bw - 10 && x <= bx + bw + handleSize && y >= by + bh - 10 && y <= by + bh + handleSize) return 'br';

    return null;
  };

  // Robust Global Event Listeners via Effect
  useEffect(() => {
    // Helper to get consistent coordinates
    const getPointerPos = (e) => {
      if (e.changedTouches && e.changedTouches.length > 0) {
        return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
      }
      return { x: e.clientX, y: e.clientY };
    };

    if (!draggingType) return;

    const handleGlobalPointerMove = (e) => {
      if (!dragRef.current.active) return;
      // Prevent scrolling on mobile while dragging
      if (e.type === 'touchmove') e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const pos = getPointerPos(e);
      const rect = canvas.getBoundingClientRect();
      const x = (pos.x - rect.left) * (canvas.width / rect.width);
      const y = (pos.y - rect.top) * (canvas.height / rect.height);
      const dx = x - dragRef.current.startX; // Re-calc dx based on new x/startX logic if needed, 
      // but actually startX is fixed. 
      // Wait, previous logic was: const dx = x - startX; 
      // Yes, that works.

      const { type, startX, initialData, offsetX, offsetY, id, initialFontSize } = dragRef.current;
      // const dx = x - startX; // This was in original, let's keep it clean.

      // Direct Update Logic
      if (type === 'resize-logo') {
        const newScale = Math.max(0.2, initialData.logoScale + dx / 100);
        liveState.current.logoScale = newScale;
      } else if (type === 'resize-signature') {
        const newScale = Math.max(0.2, initialData.signatureScale + dx / 100);
        liveState.current.signatureScale = newScale;
      } else if (type === 'resize-qr') {
        const delta = x - startX;
        const newScale = Math.max(0.2, initialData.qrScale + delta / 100);
        liveState.current.qrScale = newScale;
      } else if (type === 'resize-text') {
        const newSize = Math.max(10, initialFontSize + (x - startX) / 5);
        liveState.current.textElements = liveState.current.textElements.map(el => el.id === id ? { ...el, fontSize: newSize } : el);
      } else if (type === 'resize-shape') {
        const newW = Math.max(10, initialData.width + (x - startX));
        const newH = Math.max(10, initialData.height + (y - dragRef.current.startY));

        liveState.current.shapeElements = liveState.current.shapeElements.map(el => el.id === id ? { ...el, width: newW, height: newH } : el);
      } else if (type === 'resize-image') {
        const delta = x - startX;
        const newScale = Math.max(0.2, Math.min(5, dragRef.current.initialScale + delta / 100));
        liveState.current.imageElements = liveState.current.imageElements.map(el => el.id === id ? { ...el, scale: newScale } : el);
      } else if (type === 'logo') {
        liveState.current.logoPosition = { x: x - offsetX, y: y - offsetY };
      } else if (type === 'qr') {
        liveState.current.qrPosition = { x: x - offsetX, y: y - offsetY };
      } else if (type === 'signature') {
        liveState.current.signaturePosition = { x: x - offsetX, y: y - offsetY };
      } else if (type === 'text') {
        liveState.current.textElements = liveState.current.textElements.map(el => el.id === id ? { ...el, x: x - offsetX, y: y - offsetY } : el);
      } else if (type === 'shape') {
        liveState.current.shapeElements = liveState.current.shapeElements.map(el => el.id === id ? { ...el, x: x - offsetX, y: y - offsetY } : el);
      } else if (type === 'image') {
        liveState.current.imageElements = liveState.current.imageElements.map(el => el.id === id ? { ...el, x: x - offsetX, y: y - offsetY } : el);
      }

      // 60FPS Draw Loop Trigger
      drawCertificate();
    };

    const handleGlobalPointerUp = (e) => {
      if (dragRef.current.active) {
        // Commit changes to React State
        setLogoPosition(liveState.current.logoPosition);
        setQrPosition(liveState.current.qrPosition);
        setSignaturePosition(liveState.current.signaturePosition);
        setLogoScale(liveState.current.logoScale);
        setSignatureScale(liveState.current.signatureScale);
        setQrScale(liveState.current.qrScale);
        setTextElements(liveState.current.textElements);
        setShapeElements(liveState.current.shapeElements);
        setImageElements(liveState.current.imageElements);

        dragRef.current.active = false;
        setDraggingType(null); // This triggers Effect cleanup
      }
    };

    const handleRightClick = (e) => {
      e.preventDefault();
      handleGlobalPointerUp(e);
      setSelectedElement(null);
    };

    window.addEventListener('mousemove', handleGlobalPointerMove);
    window.addEventListener('mouseup', handleGlobalPointerUp);
    window.addEventListener('touchmove', handleGlobalPointerMove, { passive: false });
    window.addEventListener('touchend', handleGlobalPointerUp);
    window.addEventListener('contextmenu', handleRightClick);

    return () => {
      window.removeEventListener('mousemove', handleGlobalPointerMove);
      window.removeEventListener('mouseup', handleGlobalPointerUp);
      window.removeEventListener('touchmove', handleGlobalPointerMove);
      window.removeEventListener('touchend', handleGlobalPointerUp);
      window.removeEventListener('contextmenu', handleRightClick);
    };
  }, [draggingType, drawCertificate]);

  // Save state to undo history
  const saveToHistory = useCallback(() => {
    const currentState = {
      textElements: [...textElements],
      shapeElements: [...shapeElements],
      imageElements: imageElements.map(el => ({
        id: el.id,
        src: el.src,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        scale: el.scale
      })),
      timestamp: Date.now()
    };

    setUndoHistory(prev => {
      const newHistory = prev.slice(0, undoHistoryIndex + 1);
      newHistory.push(currentState);
      // Limit history size
      if (newHistory.length > maxHistorySize) {
        newHistory.shift();
        return newHistory;
      }
      return newHistory;
    });
    setUndoHistoryIndex(prev => Math.min(prev + 1, maxHistorySize - 1));
  }, [textElements, shapeElements, imageElements, undoHistoryIndex]);

  // Copy selected elements
  const copySelectedElements = useCallback(() => {
    if (!selectedElement) return;

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const copyData = { elements: [] };

    if (selectedElement.startsWith('text-')) {
      const el = textElements.find(t => t.id === selectedElement);
      if (el) {
        copyData.elements.push({ type: 'text', data: { ...el } });
      }
    } else if (selectedElement.startsWith('shape-')) {
      const el = shapeElements.find(s => s.id === selectedElement);
      if (el) {
        copyData.elements.push({ type: 'shape', data: { ...el } });
      }
    } else if (selectedElement.startsWith('img-')) {
      const el = imageElements.find(img => img.id === selectedElement);
      if (el) {
        copyData.elements.push({
          type: 'image',
          data: {
            id: el.id,
            src: el.src,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            scale: el.scale
          }
        });
      }
    }

    if (copyData.elements.length > 0) {
      setClipboard(copyData);
      // Also copy to system clipboard as JSON
      try {
        navigator.clipboard.writeText(JSON.stringify(copyData));
      } catch (err) {
        console.warn('Failed to write to clipboard:', err);
      }
    }
  }, [selectedElement, textElements, shapeElements, imageElements]);

  // Helper function to paste elements from data
  const pasteElementsFromData = useCallback((data) => {
    if (!data.elements || data.elements.length === 0) return;

    saveToHistory();

    const offset = 20; // Offset pasted elements slightly
    const newSelectedIds = [];

    data.elements.forEach(element => {
      if (element.type === 'text') {
        const newId = `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setTextElements(prev => [...prev, {
          ...element.data,
          id: newId,
          x: element.data.x + offset,
          y: element.data.y + offset
        }]);
        newSelectedIds.push(newId);
      } else if (element.type === 'shape') {
        const newId = `shape-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setShapeElements(prev => [...prev, {
          ...element.data,
          id: newId,
          x: element.data.x + offset,
          y: element.data.y + offset
        }]);
        newSelectedIds.push(newId);
      } else if (element.type === 'image') {
        const newId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          setImageElements(prev => [...prev, {
            id: newId,
            src: element.data.src,
            img: img,
            x: element.data.x + offset,
            y: element.data.y + offset,
            width: element.data.width,
            height: element.data.height,
            scale: element.data.scale
          }]);
        };
        img.src = element.data.src;
        newSelectedIds.push(newId);
      }
    });

    // Select the first pasted element
    if (newSelectedIds.length > 0) {
      setSelectedElement(newSelectedIds[0]);
    }
  }, [saveToHistory]);

  // Paste elements from clipboard
  const pasteElements = useCallback(() => {
    if (!clipboard || !clipboard.elements || clipboard.elements.length === 0) {
      // Try to read from system clipboard
      navigator.clipboard.readText().then(text => {
        try {
          const parsed = JSON.parse(text);
          if (parsed.elements && parsed.elements.length > 0) {
            setClipboard(parsed);
            pasteElementsFromData(parsed);
          }
        } catch (err) {
          // Not JSON, ignore
        }
      }).catch(() => {
        // Clipboard read failed, ignore
      });
      return;
    }
    pasteElementsFromData(clipboard);
  }, [clipboard, pasteElementsFromData]);

  // Undo last action
  const undoAction = useCallback(() => {
    if (undoHistoryIndex < 0 || undoHistory.length === 0) return;

    const stateToRestore = undoHistory[undoHistoryIndex];
    if (stateToRestore) {
      setTextElements([...stateToRestore.textElements]);
      setShapeElements([...stateToRestore.shapeElements]);

      // Restore image elements (need to reload images)
      const restoredImages = stateToRestore.imageElements.map(el => {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.src = el.src;
        return {
          ...el,
          img: img
        };
      });
      setImageElements(restoredImages);

      setUndoHistoryIndex(prev => Math.max(0, prev - 1));
    }
  }, [undoHistory, undoHistoryIndex]);

  // Global Keyboard Shortcuts (Delete, Copy, Paste, Undo)
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      const isModifierPressed = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, Cmd on Mac

      // Handle Copy (Ctrl/Cmd + C)
      if (isModifierPressed && e.key === 'c' && !e.shiftKey) {
        if (!isEditing) {
          e.preventDefault();
          copySelectedElements();
        }
        return;
      }

      // Handle Paste (Ctrl/Cmd + V)
      if (isModifierPressed && e.key === 'v' && !e.shiftKey) {
        if (!isEditing) {
          e.preventDefault();
          pasteElements();
        }
        return;
      }

      // Handle Undo (Ctrl/Cmd + Z)
      if (isModifierPressed && e.key === 'z' && !e.shiftKey) {
        if (!isEditing) {
          e.preventDefault();
          undoAction();
        }
        return;
      }

      // Ignore if editing text (let input handle chars)
      if (isEditing) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElement) {
          saveToHistory();
          if (selectedElement.startsWith('text-')) {
            setTextElements(prev => prev.filter(t => t.id !== selectedElement));
          } else if (selectedElement.startsWith('shape-')) {
            setShapeElements(prev => prev.filter(s => s.id !== selectedElement));
          } else if (selectedElement.startsWith('img-')) {
            setImageElements(prev => prev.filter(img => img.id !== selectedElement));
          } else if (['logo', 'signature', 'qr-code'].includes(selectedElement)) {
            const map = { 'logo': 'logo', 'signature': 'signature', 'qr-code': 'qr' };
            const key = map[selectedElement];
            if (key) setVisibleElements(prev => ({ ...prev, [key]: false }));
          }
          setSelectedElement(null);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isEditing, selectedElement, copySelectedElements, pasteElements, undoAction, saveToHistory]);

  const handlePointerDown = (e) => {
    // Prevent default scrolling only if it's a touch event on a drag handle? 
    // Actually, 'touch-action: none' works best.
    if (e.type === 'touchstart') {
      // e.preventDefault(); // Don't prevent default indiscriminately or input focus breaks?
    }

    const getPointerPos = (evt) => {
      if (evt.touches && evt.touches.length > 0) return { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
      return { x: evt.clientX, y: evt.clientY };
    };

    const pos = getPointerPos(e);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (pos.x - rect.left) * (canvas.width / rect.width);
    const y = (pos.y - rect.top) * (canvas.height / rect.height);

    // Manual Double Tap Detection
    const now = Date.now();
    if (now - lastClickTimeRef.current < 300) {
      // Double tap detected
      // Check if text hit?
      // Re-run hit test for Text
      const state = liveState.current;
      for (let i = state.textElements.length - 1; i >= 0; i--) {
        const el = state.textElements[i];
        const ctx = canvas.getContext('2d');
        ctx.font = `${el.italic ? 'italic ' : ''}${el.fontWeight} ${el.fontSize}px ${el.fontFamily}`;
        const lines = el.text.split('\n');
        const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width), 100);
        const totalHeight = lines.length * (el.fontSize * 1.3);

        if (x >= el.x && x <= el.x + maxWidth && y >= el.y && y <= el.y + totalHeight) {
          // Trigger Edit
          setSelectedElement(el.id);
          setIsEditing(true);
          setTimeout(() => hiddenInputRef.current?.focus({ preventScroll: true }), 0);
          return;
        }
      }
    }
    lastClickTimeRef.current = now;

    // Initialize Ref State for Dragging
    dragRef.current = {
      active: true,
      startX: x,
      startY: y,
      initialData: { ...liveState.current } // Snapshot current state
    };

    const state = liveState.current;

    // Helper to check handles
    const checkElementHandles = (elId, pos, w, h) => {
      if (selectedElement === elId) {
        const handle = checkHandleHit(x, y, pos.x - 5, pos.y - 5, w + 10, h + 10);
        if (handle) return handle;
      }
      return null;
    };

    let dragging = false;

    // 1. Check Resize Handles
    let handle = null;

    // Check Shapes First for Resizing
    if (selectedElement && selectedElement.startsWith('shape-')) {
      const el = state.shapeElements.find(s => s.id === selectedElement);
      if (el) {
        handle = checkHandleHit(x, y, el.x - 5, el.y - 5, el.width + 10, el.height + 10);
        if (handle) {
          setDraggingType('resize-shape');
          dragRef.current.type = 'resize-shape';
          dragRef.current.id = el.id;
          dragRef.current.initialData = { ...el }; // Save shape specific initial data
          dragging = true;
        }
      }
    }

    if (!dragging) {
      // Logo
      handle = checkElementHandles('logo', state.logoPosition, 80 * state.logoScale, 80 * state.logoScale);
      if (handle) {
        setDraggingType('resize-logo');
        dragRef.current.type = 'resize-logo';
        dragging = true;
      }
      // QR
      else if ((handle = checkElementHandles('qr-code', state.qrPosition, 100 * state.qrScale, 100 * state.qrScale))) {
        setDraggingType('resize-qr');
        dragRef.current.type = 'resize-qr';
        dragging = true;
      }
      // Signature
      else if ((handle = checkElementHandles('signature', state.signaturePosition, 150 * state.signatureScale, 80 * state.signatureScale))) {
        setDraggingType('resize-signature');
        dragRef.current.type = 'resize-signature';
        dragging = true;
      }
      // Text
      else if (selectedElement && selectedElement.startsWith('text-')) {
        const el = state.textElements.find(t => t.id === selectedElement);
        if (el) {
          const ctx = canvas.getContext('2d');
          ctx.font = `${el.italic ? 'italic ' : ''}${el.fontWeight} ${el.fontSize}px ${el.fontFamily}`;
          const lines = el.text.split('\n');
          const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width), 100);
          const totalHeight = lines.length * (el.fontSize * 1.3);

          handle = checkHandleHit(x, y, el.x - 5, el.y - 5, maxWidth + 10, totalHeight + 10);
          if (handle) {
            setDraggingType('resize-text');
            dragRef.current.type = 'resize-text';
            dragRef.current.id = el.id;
            dragRef.current.initialFontSize = el.fontSize;
            dragging = true;
          }
        }
      }
    }

    if (!dragging) {
      // Check Image Elements for Resizing
      const currentImageElements = liveState.current.imageElements || imageElements;
      for (let i = currentImageElements.length - 1; i >= 0; i--) {
        const el = currentImageElements[i];
        if (el.id === selectedElement) {
          const w = el.width * el.scale;
          const h = el.height * el.scale;
          handle = checkHandleHit(x, y, el.x - 5, el.y - 5, w + 10, h + 10);
          if (handle) {
            setDraggingType('resize-image');
            dragRef.current.type = 'resize-image';
            dragRef.current.id = el.id;
            dragRef.current.initialData = { ...el };
            dragRef.current.initialScale = el.scale;
            dragging = true;
            break;
          }
        }
      }
    }

    if (!dragging) {
      // 2. Check Hit for Dragging (Move)

      // Check Image Elements Loop
      const currentImageElements = liveState.current.imageElements || imageElements;
      for (let i = currentImageElements.length - 1; i >= 0; i--) {
        const el = currentImageElements[i];
        const w = el.width * el.scale;
        const h = el.height * el.scale;
        if (x >= el.x && x <= el.x + w && y >= el.y && y <= el.y + h) {
          dragRef.current.offsetX = x - el.x;
          dragRef.current.offsetY = y - el.y;
          dragRef.current.id = el.id;

          setDraggingType('image');
          dragRef.current.type = 'image';
          setSelectedElement(el.id);
          setIsEditing(false);
          dragging = true;
          break;
        }
      }

      // Check Shapes Loop
      if (!dragging) {
        for (let i = state.shapeElements.length - 1; i >= 0; i--) {
          const el = state.shapeElements[i];
          // Simple box hit test
          if (x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) {
            dragRef.current.offsetX = x - el.x;
            dragRef.current.offsetY = y - el.y;
            dragRef.current.id = el.id;

            setDraggingType('shape');
            dragRef.current.type = 'shape';
            setSelectedElement(el.id);
            dragging = true;
            break;
          }
          // Line specific hit test (bit generous)
          if (el.type === 'line') {
            // Check proximity to line
            // Rough box for now:
            const minX = Math.min(el.x, el.x + el.width);
            const maxX = Math.max(el.x, el.x + el.width);
            const minY = Math.min(el.y, el.y + el.height);
            const maxY = Math.max(el.y, el.y + el.height);
            if (x >= minX - 10 && x <= maxX + 10 && y >= minY - 10 && y <= maxY + 10) {
              dragRef.current.offsetX = x - el.x;
              dragRef.current.offsetY = y - el.y;
              dragRef.current.id = el.id;

              setDraggingType('shape');
              dragRef.current.type = 'shape';
              setSelectedElement(el.id);
              dragging = true;
              break;
            }
          }
        }
      }

      if (!dragging) {
        // Logo
        if (x >= state.logoPosition.x && x <= state.logoPosition.x + (80 * state.logoScale) && y >= state.logoPosition.y && y <= state.logoPosition.y + (80 * state.logoScale)) {
          dragRef.current.offsetX = x - state.logoPosition.x;
          dragRef.current.offsetY = y - state.logoPosition.y;
          setDraggingType('logo');
          dragRef.current.type = 'logo';
          setSelectedElement('logo');
          setIsEditing(false);
          dragging = true;
        }
        // QR
        else if (x >= state.qrPosition.x && x <= state.qrPosition.x + 100 * state.qrScale && y >= state.qrPosition.y && y <= state.qrPosition.y + 100 * state.qrScale) {
          dragRef.current.offsetX = x - state.qrPosition.x;
          dragRef.current.offsetY = y - state.qrPosition.y;
          setDraggingType('qr');
          dragRef.current.type = 'qr';
          setSelectedElement('qr-code');
          setIsEditing(false);
          dragging = true;
        }
        // Signature
        else if (x >= state.signaturePosition.x && x <= state.signaturePosition.x + (150 * state.signatureScale) && y >= state.signaturePosition.y && y <= state.signaturePosition.y + (80 * state.signatureScale)) {
          dragRef.current.offsetX = x - state.signaturePosition.x;
          dragRef.current.offsetY = y - state.signaturePosition.y;
          setDraggingType('signature');
          dragRef.current.type = 'signature';
          setSelectedElement('signature');
          setIsEditing(false);
          dragging = true;
        }
        // Text
        else {
          for (let i = state.textElements.length - 1; i >= 0; i--) {
            const el = state.textElements[i];
            const ctx = canvas.getContext('2d');
            ctx.font = `${el.italic ? 'italic ' : ''}${el.fontWeight} ${el.fontSize}px ${el.fontFamily}`;
            const lines = el.text.split('\n');
            const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width), 100);
            const totalHeight = lines.length * (el.fontSize * 1.3);

            if (x >= el.x && x <= el.x + maxWidth && y >= el.y && y <= el.y + totalHeight) {
              dragRef.current.offsetX = x - el.x;
              dragRef.current.offsetY = y - el.y;
              dragRef.current.id = el.id;

              setDraggingType('text');
              dragRef.current.type = 'text';
              setSelectedElement(el.id);
              setIsEditing(false);
              dragging = true;
              break;
            }
          }
        }
      }
    }

    if (!dragging) {
      // Only deselect if not a double tap (which we handled above)
      // Though if double tap logic ran, we returned early.
      setSelectedElement(null);
      setIsEditing(false);
      dragRef.current.active = false;
    }
  };

  const handleMouseMove = (e) => {
    // Only used for hover cursor now
    if (dragRef.current.active) return; // Ignore if global drag is active (though global listener handles it)

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check hover for cursor
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / canvas.width;
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    // Simple cursor logic here if desired, or leave it cleaner
    canvas.style.cursor = 'default';
  };

  const handleKeyDown = (e) => {
    if (!selectedElement || ['logo', 'qr-code', 'signature'].includes(selectedElement)) return;

    // Capture scroll position immediately to prevent auto-scroll on small screens
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;

    // Restore scroll position after any state updates
    const preserveScroll = () => {
      requestAnimationFrame(() => {
        window.scrollTo(scrollX, scrollY);
      });
    };

    const el = textElements.find(t => t.id === selectedElement);
    if (!el) return;

    const isModifierPressed = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, Cmd on Mac

    // CTRL+A Text Selection
    if (isModifierPressed && e.key === 'a') {
      e.preventDefault();
      setTextElements(prev => prev.map(t => t.id === selectedElement ? {
        ...t,
        selectionStart: 0,
        selectionEnd: t.text.length
      } : t));
      setIsEditing(true);
      preserveScroll();
      return;
    }

    if (!isEditing) return;

    // Handle Copy (Ctrl/Cmd + C) for text
    if (isModifierPressed && e.key === 'c' && !e.shiftKey) {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selectedText = el.text.slice(Math.min(start, end), Math.max(start, end));
      if (selectedText) {
        try {
          navigator.clipboard.writeText(selectedText);
        } catch (err) {
          console.warn('Failed to copy text:', err);
        }
      }
      preserveScroll();
      return;
    }

    // Handle Paste (Ctrl/Cmd + V) for text
    if (isModifierPressed && e.key === 'v' && !e.shiftKey) {
      e.preventDefault();
      navigator.clipboard.readText().then(pastedText => {
        if (pastedText) {
          let text = el.text;
          let start = el.selectionStart;
          let end = el.selectionEnd;
          const min = Math.min(start, end);
          const max = Math.max(start, end);
          text = text.slice(0, min) + pastedText + text.slice(max);
          start = min + pastedText.length;
          end = start;

          // Save to history before pasting
          saveToHistory();

          setTextElements(prev => prev.map(t => t.id === selectedElement ? {
            ...t,
            text,
            selectionStart: start,
            selectionEnd: end
          } : t));
          preserveScroll();
        }
      }).catch(err => {
        console.warn('Failed to paste text:', err);
      });
      return;
    }

    // Handle Undo (Ctrl/Cmd + Z) for text
    if (isModifierPressed && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undoAction();
      preserveScroll();
      return;
    }

    // Prevent default browser behavior for handled keys to avoid scroll
    if (['Backspace', 'Enter', 'ArrowLeft', 'ArrowRight'].includes(e.key) || (e.key.length === 1 && !isModifierPressed)) {
      e.preventDefault();
    }

    let text = el.text;
    let start = el.selectionStart;
    let end = el.selectionEnd;

    const hasSelection = start !== end;
    let textChanged = false;

    if (e.key === 'Backspace') {
      if (hasSelection) {
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        text = text.slice(0, min) + text.slice(max);
        start = min;
        end = min;
        textChanged = true;
      } else if (start > 0) {
        text = text.slice(0, start - 1) + text.slice(start);
        start--;
        end--;
        textChanged = true;
      }
    } else if (e.key === 'Enter') {
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      text = text.slice(0, min) + '\n' + text.slice(max);
      start = min + 1;
      end = start;
      textChanged = true;
    } else if (e.key.length === 1 && !isModifierPressed) {
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      text = text.slice(0, min) + e.key + text.slice(max);
      start = min + 1;
      end = start;
      textChanged = true;
    } else if (e.key === 'ArrowLeft') {
      start = Math.max(0, start - 1);
      if (!e.shiftKey) end = start;
    } else if (e.key === 'ArrowRight') {
      start = Math.min(text.length, start + 1);
      if (!e.shiftKey) end = start;
    }

    // Save to history when text changes
    if (textChanged) {
      saveToHistory();
    }

    setTextElements(prev => prev.map(t => t.id === selectedElement ? { ...t, text, selectionStart: start, selectionEnd: end } : t));
    preserveScroll();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      // Create a new draggable image element
      const id = `img-${Date.now()}`;
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // Calculate dimensions, max 200px width
        const maxWidth = 200;
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = (img.height * maxWidth) / img.width;
          width = maxWidth;
        }

        setImageElements(prev => [...prev, {
          id,
          src: dataUrl,
          img,
          x: 100 + (prev.length * 50), // Offset each new image slightly
          y: 100 + (prev.length * 50),
          width,
          height,
          scale: 1
        }]);

        // Select the newly added image
        setTimeout(() => {
          setSelectedElement(id);
        }, 100);

        // Trigger redraw
        if (drawCertRef.current) drawCertRef.current();
      };
      img.onerror = () => console.error("Image failed to load:", dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Toolbar actions
  const updateElement = (updates) => {
    if (selectedElement && selectedElement.startsWith('text-')) {
      setTextElements(prev => prev.map(el => el.id === selectedElement ? { ...el, ...updates } : el));
    } else if (selectedElement && selectedElement.startsWith('shape-')) {
      setShapeElements(prev => prev.map(el => el.id === selectedElement ? { ...el, ...updates } : el));
    }
  };
  const { t } = useLocale();
  const addShape = (type) => {
    const id = `shape-${Date.now()}`;
    // Default starting props
    const defaults = {
      id,
      type,
      x: 150,
      y: 150,
      color: '#000000',
      lineWidth: 3
    };

    if (type === 'line') {
      setShapeElements(prev => [...prev, { ...defaults, width: 200, height: 0 }]); // Start horizontal
    } else if (type === 'star') {
      setShapeElements(prev => [...prev, { ...defaults, width: 100, height: 100, spikes: 5, innerRadius: 20, outerRadius: 50 }]);
    } else {
      // Circle, Square
      setShapeElements(prev => [...prev, { ...defaults, width: 100, height: 100 }]);
    }
    setSelectedElement(id);
  };

  const selectedElementData = textElements.find(el => el.id === selectedElement) || shapeElements.find(el => el.id === selectedElement) || imageElements.find(el => el.id === selectedElement);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-50 bg-white border-b p-4 flex items-center justify-between gap-4 flex-wrap shadow-sm">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => {
            const id = `text-${Date.now()}`;
            setTextElements([...textElements, { id, text: 'New Text', x: 100, y: 100, fontSize: 24, fontFamily: 'Arial, sans-serif', color: '#000000', fontWeight: 'normal', selectionStart: 8, selectionEnd: 8 }]);
            setSelectedElement(id);
          }} className="bg-green-600 hover:bg-green-700"><Plus className="h-4 w-4 mr-1" /> {t('add_text')}</Button>

          <Button size="sm" variant="outline" onClick={() => imageInputRef.current?.click()} title="Upload Image"><Upload className="h-4 w-4 mr-1" /> {t('upload_image')}</Button>
          <input type="file" ref={imageInputRef} className="hidden" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" onChange={handleFileUpload} />

          <div className="bg-slate-200 w-px h-8 mx-1"></div>


          <Button size="sm" variant="outline" onClick={() => addShape('line')} title="Add Line"><Minus className="h-4 w-4" /></Button>


          {selectedElementData && (
            <Button size="sm" variant="outlined" onClick={() => {
              if (selectedElement.startsWith('text-')) setTextElements(prev => prev.filter(t => t.id !== selectedElement));
              else if (selectedElement.startsWith('shape-')) setShapeElements(prev => prev.filter(s => s.id !== selectedElement));
              else if (selectedElement.startsWith('img-')) setImageElements(prev => prev.filter(img => img.id !== selectedElement));
              setSelectedElement(null);
            }}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
          )}
        </div>

        {selectedElementData && (
          <div className="flex items-center gap-2">
            {selectedElement.startsWith('text-') && (
              <>
                <Button size="sm" variant={selectedElementData.fontWeight === 'bold' ? 'default' : 'outline'} onClick={() => updateElement({ fontWeight: selectedElementData.fontWeight === 'bold' ? 'normal' : 'bold' })}><Bold className="h-4 w-4" /></Button>
                <Button size="sm" variant={selectedElementData.italic ? 'default' : 'outline'} onClick={() => updateElement({ italic: !selectedElementData.italic })}><Italic className="h-4 w-4" /></Button>
                <Button size="sm" variant={selectedElementData.underline ? 'default' : 'outline'} onClick={() => updateElement({ underline: !selectedElementData.underline })}><Underline className="h-4 w-4" /></Button>

                <Select value={selectedElementData.fontFamily} onValueChange={v => updateElement({ fontFamily: v })}>
                  <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{AVAILABLE_FONTS.map(f => <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.name}</SelectItem>)}</SelectContent>
                </Select>

                <Select value={String(selectedElementData.fontSize)} onValueChange={v => updateElement({ fontSize: parseInt(v, 10) })}>
                  <SelectTrigger className="w-20 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{AVAILABLE_FONT_SIZES.map(size => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
                </Select>
              </>
            )}
            <Input type="color" value={selectedElementData.color} onChange={e => updateElement({ color: e.target.value })} className="w-10 h-9 p-1" />
          </div>
        )}


      </div>

      <div className="relative border-2 border-slate-300 rounded-lg overflow-hidden bg-slate-100 shadow-inner w-full">
        {!canvasLoaded && (
          <div className="flex flex-col items-center justify-center h-96 bg-white">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500 mb-2" />
            <p className="text-slate-500">Initializing Canvas...</p>
          </div>
        )}
        <canvas
          ref={canvasRef}
          onMouseDown={handlePointerDown}
          onMouseMove={handleMouseMove} // Local hover effect
          onTouchStart={handlePointerDown}
          onTouchMove={(e) => {
            // Optional: Local touch move if needed for hover effects? 
            // Usually global listener handles dragging. 
            // But we need to prevent scrolling here too maybe?
            // 'touch-action: none' handles it.
          }}
          onDoubleClick={(e) => {
            if (selectedElementData && selectedElement.startsWith('text-')) {
              setIsEditing(true);
              // Small timeout to ensure render happens before focus
              setTimeout(() => hiddenInputRef.current?.focus({ preventScroll: true }), 0);
            }
          }}
          style={{
            width: '100%',
            height: 'auto',
            maxWidth: '100%',
            cursor: dragging ? 'grabbing' : 'crosshair',
            display: canvasLoaded ? 'block' : 'none',
            touchAction: 'none', // Critical for dragging on touch devices
            objectFit: 'contain'
          }}
        />
        <input
          ref={hiddenInputRef}
          type="text"
          onKeyDown={handleKeyDown}
          onBlur={() => setIsEditing(false)}
          onFocus={(e) => {
            // Prevent any scroll behavior when input receives focus
            e.target.scrollIntoView = () => { };
            // Save scroll position
            const scrollY = window.scrollY;
            const scrollX = window.scrollX;
            // Restore after potential scroll
            requestAnimationFrame(() => {
              window.scrollTo(scrollX, scrollY);
            });
          }}
          onInput={(e) => {
            // Prevent scroll on input events
            const scrollY = window.scrollY;
            const scrollX = window.scrollX;
            requestAnimationFrame(() => {
              window.scrollTo(scrollX, scrollY);
            });
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: -1,
            // Prevent iOS zoom
            fontSize: '16px',
            transform: 'translateX(-100%)'
          }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
      </div>

      <Alert className="bg-blue-50 border-blue-200">
        <Move className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-900 text-xs">
          <strong>{t('tip')}:</strong> {t('tip_desc')}
        </AlertDescription>
      </Alert>
    </div>
  );
});

CertificateCanvas.displayName = 'CertificateCanvas';

// Memoized pagination component
const Pagination = React.memo(({ pagination, currentPage, setCurrentPage }) => {
  if (!pagination.total_pages || pagination.total_pages <= 1) return null;

  const renderPageButtons = () => {
    const currentPageNum = pagination.current_page;
    const totalPages = pagination.total_pages;
    const maxButtons = 5;
    let startPage = Math.max(1, currentPageNum - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    const pages = [];

    if (startPage > 1) {
      pages.push(1);
      if (startPage > 2) {
        pages.push('...');
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push('...');
      }
      pages.push(totalPages);
    }

    return pages.map((pageNum, idx) => {
      if (pageNum === '...') {
        return (
          <span key={`ellipsis-${idx}`} className="px-3 py-2 text-slate-400">
            ...
          </span>
        );
      }
      return (
        <Button
          key={pageNum}
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(pageNum)}
          className={`min-w-[40px] h-9 ${pageNum === currentPageNum
            ? "bg-black hover:bg-zinc-900 text-white"
            : "border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
        >
          {pageNum}
        </Button>
      );
    });
  };

  return (
    <div className="flex items-center justify-between mt-6">
      <div className="text-sm text-slate-600">
        {(() => {
          const start = (pagination.current_page - 1) * pagination.limit_per_page + 1;
          const end = Math.min(pagination.current_page * pagination.limit_per_page, pagination.total_items);
          const total = pagination.total_items;
          return start === end
            ? t('showing_entry', { count: start, total: total })
            : t('showing_entries', { start, end, total });
        })()}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
          disabled={!pagination.has_prev_page}
          className="h-9 px-4 border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <div className="flex items-center gap-1">
          {renderPageButtons()}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(Math.min(pagination.total_pages, currentPage + 1))}
          disabled={!pagination.has_next_page}
          className="h-9 px-4 border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
});

Pagination.displayName = 'Pagination';

// Memoized employee search component
const EmployeeSearch = React.memo(({
  employeeSearch,
  setEmployeeSearch,
  employees,
  employeesLoading,
  selectedEmployee,
  setSelectedEmployee,
  setSingleForm
}) => {
  return (
    <div className="space-y-3">
      <label className="text-sm font-semibold text-slate-700">Select Achiever</label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search employees..."
          value={employeeSearch}
          onChange={(e) => setEmployeeSearch(e.target.value)}
          className="w-full pl-10 border-slate-300"
        />
      </div>

      {(employeesLoading || (employeeSearch && employees.length > 0)) && (
        <div className="border border-slate-200 rounded-md max-h-60 overflow-y-auto bg-white shadow-sm">
          {employeesLoading ? (
            <div className="p-4 text-center text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              Loading employees...
            </div>
          ) : (
            employees
              .filter(emp => {
                const q = employeeSearch.toLowerCase();
                const name = `${emp.first_name || emp.name || ''} ${emp.last_name || ''}`.toLowerCase();
                const username = (emp.username || emp.user_name || '').toLowerCase();
                const email = (emp.email || '').toLowerCase();
                return name.includes(q) || username.includes(q) || email.includes(q);
              })
              .slice(0, 30)
              .map((emp) => {
                const employeeName = `${emp.first_name || emp.name || ''} ${emp.last_name || ''}`.trim();
                return (
                  <button
                    key={emp._id || emp.id}
                    onClick={() => {
                      const username = emp.username || emp.user_name || emp.email;
                      setSingleForm(prev => ({ ...prev, achiever_username: username }));
                      setSelectedEmployee({ ...emp, displayName: employeeName });
                      setEmployeeSearch('');
                    }}
                    className="w-full text-left p-3 hover:bg-slate-50 flex items-center gap-3 border-b border-slate-100 transition-colors"
                  >
                    <Avatar className="h-10 w-10">
                      {emp.avatar_url || emp.profile_pic ? (
                        <AvatarImage src={emp.avatar_url || emp.profile_pic} />
                      ) : (
                        <AvatarFallback className="bg-slate-200 text-sm">
                          {getInitials(emp.first_name || emp.name, emp.last_name)}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {employeeName}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        @{emp.username || emp.user_name || emp.email?.split('@')[0]}
                      </div>
                    </div>
                  </button>
                );
              })
          )}
        </div>
      )}

      {selectedEmployee && (
        <Card className="border-green-200 bg-green-50/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  {selectedEmployee.avatar_url || selectedEmployee.profile_pic ? (
                    <AvatarImage src={selectedEmployee.avatar_url || selectedEmployee.profile_pic} />
                  ) : (
                    <AvatarFallback className="bg-slate-200">
                      {getInitials(selectedEmployee.first_name || selectedEmployee.name, selectedEmployee.last_name)}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div>
                  <div className="font-semibold text-base">
                    {selectedEmployee.displayName}
                  </div>
                  <div className="text-sm text-slate-600">
                    @{selectedEmployee.username || selectedEmployee.user_name || selectedEmployee.email?.split('@')[0]}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedEmployee(null);
                  setSingleForm(prev => ({ ...prev, achiever_username: '' }));
                }}
                className="border-slate-300 hover:bg-slate-50"
              >
                Change
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
});

EmployeeSearch.displayName = 'EmployeeSearch';

// Helper function
const getInitials = (firstName, lastName) => {
  return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
};

// Helper function to extract design type from design_code
const extractDesignType = (designCode) => {
  if (!designCode) return null;
  const parts = designCode.split('_');
  if (parts.length >= 1) {
    return parts[0]; // Returns VER, HRZ, SDC, BDG, etc.
  }
  return null;
};

// Helper function to get design type label
const getDesignTypeLabel = (type) => {
  const labels = {
    'VER': 'Vertical Design',
    'HRZ': 'Horizontal Design',
    'SDC': 'Student Card Design',
    'BDG': 'Badge Design'
  };
  return labels[type] || type;
};

// Helper function to get unique design types from designs
const getUniqueDesignTypes = (designs) => {
  const types = new Set();
  designs.forEach(design => {
    const type = extractDesignType(design.design_code);
    if (type) {
      types.add(type);
    }
  });
  return Array.from(types).sort();
};

// Helper function to parse emails from CSV or comma-separated string
const parseEmails = async (input, file) => {
  let emails = [];

  if (file) {
    // Parse CSV file
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim());
    lines.forEach(line => {
      // Handle CSV format - take first column or split by comma
      const parts = line.split(',').map(p => p.trim()).filter(p => p);
      if (parts.length > 0) {
        const email = parts[0];
        if (email.includes('@')) {
          emails.push(email);
        }
      }
    });
  } else if (input) {
    // Parse comma-separated string
    emails = input
      .split(',')
      .map(email => email.trim())
      .filter(email => email && email.includes('@'));
  }

  return [...new Set(emails)]; // Remove duplicates
};

// Helper function to fetch employee by email
const fetchEmployeeByEmail = async (email, orgCode) => {
  try {
    const response = await apiFetch(`/users/org/${orgCode}`);
    const data = await response.json();
    const employees = Array.isArray(data) ? data : [];
    const employee = employees.find(emp =>
      emp.email?.toLowerCase() === email.toLowerCase() ||
      emp.username?.toLowerCase() === email.toLowerCase() ||
      emp.user_name?.toLowerCase() === email.toLowerCase()
    );
    return employee;
  } catch (err) {
    console.error('Error fetching employee:', err);
    return null;
  }
};

export default function CredentialManagementPage() {
  const { session } = useSession();
  const [search, setSearch] = useState('');
  const [credentials, setCredentials] = useState([]);
  const [designs, setDesigns] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [credentialToRevoke, setCredentialToRevoke] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [error, setError] = useState('');
  const { t } = useLocale();
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);
  const [pagination, setPagination] = useState({
    total_items: 0,
    current_page: 1,
    limit_per_page: 20,
    total_pages: 1,
    has_next_page: false,
    has_prev_page: false
  });

  const [currentCredentialCode, setCurrentCredentialCode] = useState('');

  const generateNewCredentialCode = useCallback(() => {
    const newCode = `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setCurrentCredentialCode(newCode);
    localStorage.setItem('current_credential_code', newCode);
    return newCode;
  }, []);

  useEffect(() => {
    const storedCode = localStorage.getItem('current_credential_code');
    if (storedCode) {
      setCurrentCredentialCode(storedCode);
    } else {
      generateNewCredentialCode();
    }
  }, [generateNewCredentialCode]);

  const [singleForm, setSingleForm] = useState({
    achiever_username: '',
    selected_template_url: null
  });
  const [selectedDesignType, setSelectedDesignType] = useState('');

  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [hasSavedDesign, setHasSavedDesign] = useState(false);
  const [showDraftsDialog, setShowDraftsDialog] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState([]);

  // Bulk issuance state
  const [issuanceMode, setIssuanceMode] = useState('single'); // 'single' or 'bulk'
  const [bulkEmails, setBulkEmails] = useState('');
  const [bulkEmailFile, setBulkEmailFile] = useState(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, results: [] });

  // Ref for accessing export capability of canvas properly
  const canvasRef = useRef(null);
  const templateUploadInputRef = useRef(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  const ORG_CODE = session?.organization_code;

  const fetchEmployees = useCallback(async () => {
    try {
      setEmployeesLoading(true);
      const res = await apiFetch(`/users/org/${ORG_CODE}`);
      const data = await res.json();
      const list = data;
      setEmployees(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Error fetching employees:', err);
      setEmployees([]);
    } finally {
      setEmployeesLoading(false);
    }
  }, [ORG_CODE]);

  const fetchCredentials = useCallback(async (page = 1, searchTerm = '', status = 'all') => {
    try {
      const statusParam = status !== 'all' ? `&status=${status}` : '';
      const searchParam = searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : '';
      const response = await apiFetch(
        `/credentials/by-organization/${ORG_CODE}?page=${page}&limit=${itemsPerPage}${statusParam}${searchParam}`
      );
      const data = await response.json();

      if (data.status === 'success') {
        setCredentials(data.data || []);
        setPagination(data.pagination || {
          total_items: 0,
          current_page: page,
          limit_per_page: itemsPerPage,
          total_pages: 1,
          has_next_page: false,
          has_prev_page: false
        });
        setCurrentPage(data.pagination?.current_page || page);
      } else {
        setCredentials([]);
      }
    } catch (err) {
      console.error('Error fetching credentials:', err);
      setCredentials([]);
    }
  }, [ORG_CODE, itemsPerPage]);

  useEffect(() => {
    // session resolves asynchronously via useSession()'s /auth/me call --
    // wait for it so ORG_CODE is populated before fetching.
    if (!session) return;
    // Fetch on initial load and when filter/current page changes
    if (currentPage === 1) {
      fetchDesigns();
    }
    fetchCredentials(currentPage, '', statusFilter);
  }, [session, currentPage, statusFilter, fetchCredentials]);

  // Frontend-only search filtering
  const filteredCredentials = useMemo(() => {
    if (!search.trim()) return credentials;
    const q = search.toLowerCase().trim();
    return credentials.filter((cred) => {
      const achieverName = `${cred.achiever_details?.first_name || ''} ${cred.achiever_details?.last_name || ''}`.toLowerCase();
      const achieverUsername = (cred.achiever_username || '').toLowerCase();
      const credTitle = (cred.credential_title || '').toLowerCase();
      const credCode = (cred.credential_code || '').toLowerCase();
      const orgName = (cred.organization_detail?.name || '').toLowerCase();
      const orgCode = (cred.organization_detail?.code || '').toLowerCase();
      return (
        achieverName.includes(q) ||
        achieverUsername.includes(q) ||
        credTitle.includes(q) ||
        credCode.includes(q) ||
        orgName.includes(q) ||
        orgCode.includes(q)
      );
    });
  }, [search, credentials]);

  useEffect(() => {
    if (!session || !showInviteModal) return;
    fetchEmployees();
  }, [session, showInviteModal, fetchEmployees]);

  // Check for saved design when template and user are selected
  useEffect(() => {
    if (singleForm.selected_template_url && selectedEmployee) {
      // Wait a bit for canvas to be ready
      const checkSavedDesign = () => {
        if (canvasRef.current && canvasRef.current.hasSavedDesign) {
          const hasSaved = canvasRef.current.hasSavedDesign() || false;
          setHasSavedDesign(hasSaved);
        } else {
          // Retry after a short delay if canvas not ready yet
          setTimeout(checkSavedDesign, 200);
        }
      };
      checkSavedDesign();
    } else {
      setHasSavedDesign(false);
    }
  }, [singleForm.selected_template_url, selectedEmployee]);

  // Handler to restore saved design
  const handleResumeDesign = useCallback(() => {
    if (canvasRef.current && canvasRef.current.restoreDesign) {
      const restored = canvasRef.current.restoreDesign();
      if (restored) {
        setSuccess('Design restored successfully!');
        setHasSavedDesign(false);
      } else {
        setError('No saved design found or design does not match current template/user.');
      }
    }
  }, []);

  // Handler to open drafts dialog
  const handleViewDrafts = useCallback(() => {
    // Refresh drafts list from localStorage directly to ensure we have the latest
    try {
      const drafts = JSON.parse(localStorage.getItem('credential_design_drafts') || '[]');
      setSavedDrafts(drafts);
      setShowDraftsDialog(true);
    } catch (err) {
      console.error('Error loading drafts:', err);
      setSavedDrafts([]);
      setShowDraftsDialog(true);
    }
  }, []);

  // Handler to restore a specific draft
  const handleRestoreDraft = useCallback((draftId) => {
    const draft = savedDrafts.find(d => d.id === draftId);
    if (!draft) {
      setError('Draft not found.');
      return;
    }

    // Find the design type from the template URL
    const matchingDesign = designs.find(design =>
      design.template_url === draft.templateUrl ||
      design.main_template_url === draft.templateUrl
    );
    if (matchingDesign) {
      const designType = extractDesignType(matchingDesign.design_code);
      setSelectedDesignType(designType);
    }

    // First, update the form to match the draft's template and user
    setSingleForm(prev => ({
      ...prev,
      selected_template_url: draft.templateUrl,
      achiever_username: draft.achieverUsername || ''
    }));

    // Restore employee: First try to use saved employeeData, then try to find from employees list
    let employee = null;

    if (draft.employeeData) {
      // Try to find the employee in the current employees list using saved employeeData
      employee = employees.find(emp => {
        // Match by multiple possible identifiers
        return (
          (draft.employeeData.username && (emp.username === draft.employeeData.username || emp.user_name === draft.employeeData.username)) ||
          (draft.employeeData.email && emp.email === draft.employeeData.email) ||
          (draft.employeeData._id && emp._id === draft.employeeData._id) ||
          (draft.employeeData.id && emp.id === draft.employeeData.id) ||
          (draft.employeeData.user_name && (emp.user_name === draft.employeeData.user_name || emp.username === draft.employeeData.user_name))
        );
      });

      // If not found in list, use the saved employeeData directly (for cases where employee might not be in current list)
      if (!employee && draft.employeeData) {
        // Create employee object from saved data, ensuring displayName is set
        employee = {
          ...draft.employeeData,
          displayName: draft.employeeData.displayName ||
            `${draft.employeeData.first_name || ''} ${draft.employeeData.last_name || ''}`.trim() ||
            draft.employeeData.name ||
            draft.achieverUsername
        };
      }
    }

    // Fallback: Try to find by achieverUsername if employeeData wasn't saved (backward compatibility)
    if (!employee) {
      employee = employees.find(emp =>
        emp.username === draft.achieverUsername ||
        emp.email === draft.achieverUsername ||
        emp.user_name === draft.achieverUsername ||
        (emp.first_name && emp.last_name && `${emp.first_name} ${emp.last_name}`.trim() === draft.achieverUsername) ||
        (emp.name === draft.achieverUsername)
      );
    }

    if (employee) {
      // Ensure displayName is set for the employee
      if (!employee.displayName) {
        employee.displayName = employee.first_name && employee.last_name
          ? `${employee.first_name} ${employee.last_name}`.trim()
          : employee.name || employee.username || employee.user_name || employee.email?.split('@')[0] || 'Employee';
      }
      setSelectedEmployee(employee);
    } else {
      setSelectedEmployee(null);
      setError('Employee not found. The employee may have been removed from the organization.');
    }

    // Open the modal if not already open
    if (!showInviteModal) {
      setShowInviteModal(true);
    }

    // Close drafts dialog
    setShowDraftsDialog(false);

    // Wait for the canvas to be ready, then restore the design
    // The employee should already be set above, and the canvas will render when both template and employee are set
    // Use a retry mechanism to ensure canvas is ready
    let retryCount = 0;
    const maxRetries = 15;
    const retryInterval = 200;

    const attemptRestore = () => {
      if (canvasRef.current && canvasRef.current.restoreDraftById) {
        const restored = canvasRef.current.restoreDraftById(draftId);
        if (restored) {
          setSuccess('Draft restored successfully!');
        } else {
          setError('Failed to restore draft. Please try again.');
        }
      } else if (retryCount < maxRetries) {
        retryCount++;
        setTimeout(attemptRestore, retryInterval);
      } else {
        setError('Failed to restore draft. Canvas not ready. Please ensure template and employee are selected.');
      }
    };

    // Start the restore attempt after a short delay to allow state updates and canvas rendering
    setTimeout(attemptRestore, 500);
  }, [savedDrafts, employees, showInviteModal, designs]);

  // Handler to delete a draft
  const handleDeleteDraft = useCallback((draftId, e) => {
    e?.stopPropagation();
    if (canvasRef.current && canvasRef.current.deleteDraft) {
      const deleted = canvasRef.current.deleteDraft(draftId);
      if (deleted) {
        // Refresh drafts list
        try {
          const drafts = JSON.parse(localStorage.getItem('credential_design_drafts') || '[]');
          setSavedDrafts(drafts);
          setSuccess('Draft deleted successfully!');
        } catch (err) {
          const updatedDrafts = savedDrafts.filter(d => d.id !== draftId);
          setSavedDrafts(updatedDrafts);
          setSuccess('Draft deleted successfully!');
        }
      } else {
        setError('Failed to delete draft.');
      }
    }
  }, [savedDrafts]);

  const fetchDesigns = useCallback(async () => {
    try {
      const response = await apiFetch(`/designs/organization/${ORG_CODE}`);
      const result = await response.json();
      if (result.success) {
        setDesigns(result.data);
      }
    } catch (err) {
      console.error('Error fetching designs:', err);
    }
  }, [ORG_CODE]);

  useEffect(() => {
    checkAuth('admin');
  }, []);

  const uploadCertificateToStorage = useCallback(async (blob, certificate_code) => {
    const file = new File([blob], `${certificate_code}.png`, { type: 'image/png' });
    return uploadFile(file);
  }, []);

  const handleTemplateUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, JPEG, etc.)');
      e.target.value = '';
      return;
    }

    setUploadingTemplate(true);
    setError('');
    setSuccess('');

    try {
      const templateUrl = await uploadFile(file);

      if (!templateUrl) {
        throw new Error('Failed to get template URL from upload response');
      }

      // Set the uploaded template URL
      setSingleForm(prev => ({ ...prev, selected_template_url: templateUrl }));
      setSuccess('Custom template uploaded successfully!');

      // Clear the file input
      e.target.value = '';
    } catch (err) {
      console.error('Error uploading template:', err);
      setError(err.message || 'Failed to upload template. Please try again.');
    } finally {
      setUploadingTemplate(false);
    }
  }, []);

  const createCredential = useCallback(async (credential_pic_url, achiever_username, credential_code) => {
    const response = await apiFetch('/credentials/create', {
      method: 'POST',
      body: JSON.stringify({
        credential_pic_url,
        achiever_username,
        credential_code
      })
    });

    if (!response.ok) {
      throw new Error('Credential creation failed');
    }

    return await response.json();
  }, []);

  const revokeCredential = useCallback(async (credential_code) => {
    setRevokeLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await apiFetch(`/credentials/revoke/${credential_code}`, {
        method: 'PUT',
      });

      if (!response.ok) {
        throw new Error('Failed to revoke credential');
      }

      setSuccess(`Credential ${credential_code} has been revoked successfully`);
      fetchCredentials(currentPage, '', statusFilter);
      setShowRevokeDialog(false);
      setCredentialToRevoke(null);
    } catch (err) {
      console.error('Error revoking credential:', err);
      setError('Failed to revoke credential: ' + err.message);
    } finally {
      setRevokeLoading(false);
    }
  }, [currentPage, statusFilter, fetchCredentials]);

  const handleRevokeClick = useCallback((credential) => {
    setCredentialToRevoke(credential);
    setShowRevokeDialog(true);
  }, []);

  const handleSingleCredentialSubmit = useCallback(async () => {
    if (!singleForm.achiever_username || !singleForm.selected_template_url) {
      setError('Please fill all required fields');
      return;
    }

    if (!canvasRef.current) {
      setError('Certificate preview not ready');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const blob = await canvasRef.current.exportToPNG(); // Call function directly on ref
      const certificate_code = currentCredentialCode;
      const finalUrl = await uploadCertificateToStorage(blob, certificate_code);

      if (!finalUrl) {
        console.error("Upload response missing URL");
        throw new Error("Failed to get image URL from upload response");
      }

      await createCredential(finalUrl, singleForm.achiever_username, certificate_code);

      setSuccess('Credential issued successfully!');
      // Clear saved design after successful issuance
      localStorage.removeItem('credential_design_draft');
      setHasSavedDesign(false);
      setSelectedDesignType('');
      setSingleForm({
        achiever_username: '',
        selected_template_url: null
      });
      setSelectedEmployee(null);
      setShowInviteModal(false);
      generateNewCredentialCode();
      fetchCredentials(currentPage, '', statusFilter);
    } catch (err) {
      console.error('Error creating credential:', err);
      setError('Failed to issue credential: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [
    singleForm,
    // canvasExporter removed
    currentCredentialCode,
    uploadCertificateToStorage,
    createCredential,
    generateNewCredentialCode,
    fetchCredentials,
    currentPage,
    statusFilter
  ]);

  const handleBulkCredentialSubmit = useCallback(async () => {
    if (!singleForm.selected_template_url) {
      setError('Please select a template');
      return;
    }

    if (!bulkEmails && !bulkEmailFile) {
      setError('Please provide emails (comma-separated or CSV file)');
      return;
    }

    if (!canvasRef.current) {
      setError('Certificate preview not ready');
      return;
    }

    setBulkProcessing(true);
    setError('');
    setSuccess('');

    try {
      // Parse emails
      const emails = await parseEmails(bulkEmails, bulkEmailFile);

      if (emails.length === 0) {
        setError('No valid emails found');
        setBulkProcessing(false);
        return;
      }

      setBulkProgress({ current: 0, total: emails.length, results: [] });
      const results = [];

      // Process each email
      for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        setBulkProgress(prev => ({ ...prev, current: i + 1 }));

        try {
          // Fetch employee data
          const employee = await fetchEmployeeByEmail(email, ORG_CODE);

          if (!employee) {
            results.push({ email, success: false, error: 'Employee not found' });
            continue;
          }

          // Get employee name
          const employeeName = `${employee.first_name || employee.name || ''} ${employee.last_name || ''}`.trim() || employee.username || employee.user_name || email;
          const username = employee.username || employee.user_name || email;

          // Export canvas with employee name
          const blob = await canvasRef.current.exportToPNGWithName(employeeName);
          if (!blob) {
            results.push({ email, success: false, error: 'Failed to generate certificate' });
            continue;
          }

          // Generate credential code
          const certificate_code = `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`;

          // Upload certificate
          const finalUrl = await uploadCertificateToStorage(blob, certificate_code);

          if (!finalUrl) {
            results.push({ email, success: false, error: 'Failed to upload certificate' });
            continue;
          }

          // Create credential
          await createCredential(finalUrl, username, certificate_code);

          results.push({ email, success: true, employeeName, credentialCode: certificate_code });
        } catch (err) {
          console.error(`Error processing ${email}:`, err);
          results.push({ email, success: false, error: err.message });
        }

        // Small delay to avoid overwhelming the API
        if (i < emails.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      setBulkProgress(prev => ({ ...prev, results }));
      setSuccess(`Bulk issuance completed: ${successCount} successful, ${failCount} failed`);

      // Clear form
      setBulkEmails('');
      setBulkEmailFile(null);
      setSelectedDesignType('');
      setSingleForm(prev => ({ ...prev, selected_template_url: null }));

      // Refresh credentials list
      fetchCredentials(currentPage, '', statusFilter);
    } catch (err) {
      console.error('Error in bulk issuance:', err);
      setError('Failed to process bulk issuance: ' + err.message);
    } finally {
      setBulkProcessing(false);
    }
  }, [
    singleForm.selected_template_url,
    bulkEmails,
    bulkEmailFile,
    uploadCertificateToStorage,
    createCredential,
    fetchCredentials,
    currentPage,
    statusFilter,
    ORG_CODE
  ]);

  const getStatusBadge = useCallback((status) => {
    switch (status?.toLowerCase()) {
      case 'issued':
        return <Badge className="bg-green-500 hover:bg-green-600">{t('active')}</Badge>;
      case 'revoked':
        return <Badge className="bg-red-500 hover:bg-red-600">{t('revoked')}</Badge>;
      case 'expired':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600">{t('expired')}</Badge>;
      case 'claimed':
        return <Badge className="bg-blue-500 hover:bg-blue-600">{t('claimed')}</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  }, []);

  const renderActionButtons = useCallback((credential) => {
    const status = credential.credential_status?.toLowerCase();
    const isRevokable = status === 'issued' || status === 'claimed';

    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => isRevokable && handleRevokeClick(credential)}
          disabled={!isRevokable}
          className={`text-xs px-3 py-1 h-8 ${isRevokable
            ? 'bg-black text-white hover:bg-zinc-900'
            : 'border-black text-black cursor-not-allowed opacity-50'
            }`}
        >
          <Ban className="h-3 w-3 mr-1" />
          Revoke
        </Button>
      </div>
    );
  }, [handleRevokeClick]);

  const stats = useMemo(() => ({
    total: pagination.total_items,
    active: credentials.filter(c => c.credential_status?.toLowerCase() === 'issued').length,
    revoked: credentials.filter(c => c.credential_status?.toLowerCase() === 'revoked').length,
    claimed: credentials.filter(c => c.credential_status?.toLowerCase() === 'claimed').length,
  }), [credentials, pagination.total_items]);

  return (
    <div className="min-h-screen ">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">{t("cred_management")}</h1>
            <p className="text-slate-600">{t('creds_management_desc')}</p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => {
                setShowInviteModal(true);
                // Check for saved design when opening modal
                setTimeout(() => {
                  if (singleForm.selected_template_url && selectedEmployee && canvasRef.current) {
                    const hasSaved = canvasRef.current.hasSavedDesign?.() || false;
                    setHasSavedDesign(hasSaved);
                  }
                }, 100);
              }}
              className="gap-2 bg-black hover:bg-zinc-900 text-white shadow-sm"
            >
              <Plus className="h-4 w-4" />
              {t('issue_credential')}
            </Button>
            <Button
              onClick={handleViewDrafts}
              variant="outline"
              className="gap-2 border-slate-300 text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              <FileText className="h-4 w-4" />
              {t('view_draft')}
            </Button>
            {hasSavedDesign && (
              <Button
                onClick={handleResumeDesign}
                variant="outline"
                className="gap-2 border-blue-500 text-blue-600 hover:bg-blue-50 shadow-sm"
              >
                <RotateCcw className="h-4 w-4" />
                {t('resume_design')}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-slate-500">{t('total_credentials')}</CardDescription>
              <CardTitle className="text-3xl">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-slate-500">{t('active')}</CardDescription>
              <CardTitle className="text-3xl text-green-600">{stats.active}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-slate-500">{t('revoked')}</CardDescription>
              <CardTitle className="text-3xl text-red-600">{stats.revoked}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-slate-500">{t('claimed')}</CardDescription>
              <CardTitle className="text-3xl text-blue-600">{stats.claimed}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="bg-green-50 border-green-200">
            <FileCheck className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">{success}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-4 flex-col sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={t('search_credentials')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-white border-slate-300 shadow-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => {
            setStatusFilter(value);
            setCurrentPage(1);
          }}>
            <SelectTrigger className="w-full sm:w-48 bg-white border-slate-300 shadow-sm">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('all_status')}</SelectItem>
              <SelectItem value="issued">{t('active')}</SelectItem>
              <SelectItem value="revoked">{t('revoked')}</SelectItem>
              <SelectItem value="expired">{t('expired')}</SelectItem>
              <SelectItem value="claimed">{t('claimed')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>{t('credentials')}</CardTitle>
            <CardDescription className="text-slate-600">
              {filteredCredentials.length > 0
                ? search.trim()
                  ? t(filteredCredentials.length === 1 ? 'showing_matching' : 'showing_matching_plural', {
                    count: filteredCredentials.length,
                    total: credentials.length
                  })
                  : (() => {
                    const start = (pagination.current_page - 1) * pagination.limit_per_page + 1;
                    const end = Math.min(pagination.current_page * pagination.limit_per_page, pagination.total_items);
                    const total = pagination.total_items;
                    return start === end
                      ? t('showing_entry', { count: start, total: total })
                      : t('showing_entries', { start, end, total });
                  })()
                : 'No credentials found'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-200">
                    <TableHead className="font-semibold text-slate-700">{t('achiever')}</TableHead>
                    <TableHead className="font-semibold text-slate-700">{t('credential_details')}</TableHead>
                    <TableHead className="font-semibold text-slate-700">{t('organization')}</TableHead>
                    <TableHead className="font-semibold text-slate-700">{t('status')}</TableHead>
                    <TableHead className="font-semibold text-slate-700">{t('blockchain_hash')}</TableHead>
                    <TableHead className="font-semibold text-slate-700">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCredentials.map((credential) => (
                    <TableRow key={credential._id} className="border-b border-slate-100 hover:bg-slate-50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={credential.achiever_details?.avatar_url} />
                            <AvatarFallback className="bg-slate-200 text-sm">
                              {getInitials(credential.achiever_details?.first_name, credential.achiever_details?.last_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-sm">
                              {credential.achiever_details?.first_name} {credential.achiever_details?.last_name}
                            </div>
                            <div className="text-xs text-slate-500">@{credential.achiever_username}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium text-sm">{credential.credential_title}</div>
                          <div className="text-xs text-slate-500">{credential.credential_code}</div>
                          <div className="text-xs text-slate-400">
                            {t('issued')}: {new Date(credential.credential_issue_date).toLocaleDateString()}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium text-sm">{credential.organization_detail?.name || 'N/A'}</div>
                          <div className="text-xs text-slate-500">{credential.organization_detail?.code}</div>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(credential.credential_status)}</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="text-xs text-slate-600 truncate max-w-[150px] cursor-help">
                                {credential.credential_blockchain_hashes || 'No hash'}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-xs">{credential.credential_blockchain_hashes || 'No blockchain hash available'}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>{renderActionButtons(credential)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {filteredCredentials.length === 0 && (
              <div className="text-center py-12">
                <FileX className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">{t('no_credentials_found')}</h3>
                <p className="text-slate-500 mb-4">
                  {search || statusFilter !== "all"
                    ? `${t('try_adjusting_search_or_filters')}`
                    : `${t('get_started_by_issuing_your_first_credential')}`}
                </p>
                <Button onClick={() => setShowInviteModal(true)} className="gap-2 bg-black hover:bg-zinc-900 text-white shadow-sm">
                  <Plus className="h-4 w-4" />
                  {t('issue_credential')}
                </Button>
              </div>
            )}

            <Pagination
              pagination={pagination}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
            />
          </CardContent>
        </Card>

        <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('revoke_credential')}</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-600">
                {t('are_you_sure_you_want_to_revoke_the_credential')}
                {credentialToRevoke?.credential_code} {t('for')}
                {credentialToRevoke?.achiever_details?.first_name} {credentialToRevoke?.achiever_details?.last_name}?
                {t('this_action_cannot_be_undone')}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => setCredentialToRevoke(null)}
                className="bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                {t('cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => revokeCredential(credentialToRevoke?.credential_code)}
                disabled={revokeLoading}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {revokeLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('revoking')}
                  </>
                ) : (
                  <>
                    <Ban className="mr-2 h-4 w-4" />
                    {t('revoke_credential')}
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={showInviteModal} onOpenChange={(open) => {
          setShowInviteModal(open);
          if (!open) {
            // Reset form when modal closes
            setIssuanceMode('single');
            setSelectedDesignType('');
            setSingleForm({
              achiever_username: '',
              selected_template_url: null
            });
            setSelectedEmployee(null);
            setEmployeeSearch('');
            setBulkEmails('');
            setBulkEmailFile(null);
            setBulkProgress({ current: 0, total: 0, results: [] });
          }
        }}>
          <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto p-0">
            <DialogHeader className="p-6 pb-0">
              <DialogTitle className="text-2xl font-bold text-slate-900">{t('issue_credential')}</DialogTitle>
              <DialogDescription className="text-slate-600">{t('design_and_issue_a_custom_certificate_to_an_achiever')}</DialogDescription>
            </DialogHeader>

            {/* Tabs for Single/Bulk Issuance */}
            <div className="px-6 pt-4 border-b border-slate-200">
              <div className="flex gap-2 items-center justify-between">
                <div className="flex gap-2">
                  <Button
                    variant={issuanceMode === 'single' ? 'default' : 'outline'}
                    onClick={() => {
                      setIssuanceMode('single');
                      setBulkEmails('');
                      setBulkEmailFile(null);
                    }}
                    className={issuanceMode === 'single' ? 'bg-black text-white hover:bg-zinc-900' : ''}
                  >
                    {t('single_issuance')}
                  </Button>
                  <Button
                    variant={issuanceMode === 'bulk' ? 'default' : 'outline'}
                    onClick={() => {
                      setIssuanceMode('bulk');
                      setSelectedEmployee(null);
                      setSingleForm(prev => ({ ...prev, achiever_username: '' }));
                    }}
                    className={issuanceMode === 'bulk' ? 'bg-black text-white hover:bg-zinc-900' : ''}
                  >
                    {t('bulk_issuance')}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => templateUploadInputRef.current?.click()}
                  disabled={uploadingTemplate || bulkProcessing}
                  className="h-8 text-xs"
                >
                  {uploadingTemplate ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      {t('upload')}...
                    </>
                  ) : (
                    <>
                      <Upload className="h-3 w-3 mr-1" />
                      {t('upload_custom_template')}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Hidden file input for template upload */}
            <input
              ref={templateUploadInputRef}
              type="file"
              accept="image/*"
              onChange={handleTemplateUpload}
              style={{ display: 'none' }}
            />

            <div className="space-y-6 p-6 pt-4">
              {issuanceMode === 'single' ? (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <EmployeeSearch
                      employeeSearch={employeeSearch}
                      setEmployeeSearch={setEmployeeSearch}
                      employees={employees}
                      employeesLoading={employeesLoading}
                      selectedEmployee={selectedEmployee}
                      setSelectedEmployee={setSelectedEmployee}
                      setSingleForm={setSingleForm}
                    />

                    <div className="space-y-3">
                      <label className="text-sm font-semibold text-slate-700">{t('select_design_type')}</label>
                      <Select
                        value={selectedDesignType}
                        onValueChange={(value) => {
                          setSelectedDesignType(value);
                          // Clear selected template when design type changes
                          setSingleForm(prev => ({ ...prev, selected_template_url: null }));
                        }}
                      >
                        <SelectTrigger className="bg-white border-slate-300">
                          <SelectValue placeholder="Choose a design type" />
                        </SelectTrigger>
                        <SelectContent>
                          {getUniqueDesignTypes(designs).map((type) => (
                            <SelectItem key={type} value={type}>
                              {getDesignTypeLabel(type)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {selectedDesignType && (
                        <>
                          <div>
                            <label className="text-sm font-semibold text-slate-700">{t('select_certificate_template')}</label>
                          </div>
                          {designs.filter(design => extractDesignType(design.design_code) === selectedDesignType).length === 0 ? (
                            <Alert className="bg-yellow-50 border-yellow-200">
                              <AlertTriangle className="h-4 w-4 text-yellow-600" />
                              <AlertDescription className="text-yellow-800 text-sm">
                                {t('no_template_available')}
                              </AlertDescription>
                            </Alert>
                          ) : (
                            <Select
                              value={singleForm.selected_template_url || ''}
                              onValueChange={(value) => {
                                setSingleForm(prev => ({ ...prev, selected_template_url: value }));
                              }}
                            >
                              <SelectTrigger className="bg-white border-slate-300">
                                <SelectValue placeholder="Choose a template" />
                              </SelectTrigger>
                              <SelectContent>
                                {designs
                                  .filter(design => extractDesignType(design.design_code) === selectedDesignType)
                                  .map((design) => (
                                    <SelectItem key={design.design_code} value={design.template_url || design.main_template_url}>
                                      <span className="font-medium text-sm">{design.design_code}</span>
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          )}
                        </>
                      )}

                      {singleForm.selected_template_url && (
                        <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 bg-slate-50">
                          <p className="text-xs text-slate-600 mb-2 text-center">{t('template_preview')}</p>
                          <div className="relative h-40 w-full">
                            <Image
                              src={singleForm.selected_template_url}
                              alt="Template preview"
                              fill
                              className="rounded-lg object-contain border shadow-sm"
                              sizes="(max-width: 300px) 100vw, 300px"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {singleForm.selected_template_url && selectedEmployee && (
                    <div className="space-y-4 border-t pt-6">
                      <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                        <Type className="h-5 w-5" />
                        {t('design_your_certificate')}
                      </h3>
                      <CertificateCanvas
                        ref={canvasRef}
                        templateUrl={singleForm.selected_template_url}
                        achieverUsername={selectedEmployee.displayName}
                        credentialCode={currentCredentialCode}
                        isBulkMode={false}
                        employeeData={selectedEmployee}
                      />
                    </div>
                  )}

                  {hasSavedDesign && singleForm.selected_template_url && selectedEmployee && (
                    <Button
                      variant="outline"
                      className="w-full border-blue-500 text-blue-600 hover:bg-blue-50 h-12 text-base font-semibold shadow-sm"
                      onClick={handleResumeDesign}
                    >
                      <RotateCcw className="mr-2 h-5 w-5" />
                      {t('resume_design')}
                    </Button>
                  )}

                  <Button
                    className="w-full bg-black hover:bg-zinc-900 text-white h-12 text-base font-semibold shadow-sm"
                    onClick={handleSingleCredentialSubmit}
                    disabled={loading || !singleForm.achiever_username || !singleForm.selected_template_url}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        {t('processing_certificate')}...
                      </>
                    ) : (
                      <>
                        <Award className="mr-2 h-5 w-5" />
                        {t('issue_credential')}
                      </>
                    )}
                  </Button>
                </>
              ) : (
                /* Bulk Issuance Form */
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="text-sm font-semibold text-slate-700">{t('employee_emails')}</label>
                      <div className="space-y-2">
                        <Input
                          placeholder="email1@example.com, email2@example.com, ..."
                          value={bulkEmails}
                          onChange={(e) => setBulkEmails(e.target.value)}
                          className="bg-white border-slate-300"
                          disabled={bulkProcessing || !!bulkEmailFile}
                        />
                        <div className="text-xs text-slate-500">
                          {t('enter_comma_separated_emails_or_upload_a_csv_file')}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          onClick={() => document.getElementById('bulk-email-file')?.click()}
                          disabled={bulkProcessing || !!bulkEmails}
                          className="w-full border-slate-300"
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          {t('upload_csv_file')}
                        </Button>
                        <input
                          id="bulk-email-file"
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files?.[0]) {
                              setBulkEmailFile(e.target.files[0]);
                              setBulkEmails('');
                            }
                          }}
                          disabled={bulkProcessing}
                        />
                        {bulkEmailFile && (
                          <div className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-200">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-slate-600" />
                              <span className="text-sm text-slate-700">{bulkEmailFile.name}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setBulkEmailFile(null);
                                document.getElementById('bulk-email-file').value = '';
                              }}
                              disabled={bulkProcessing}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-semibold text-slate-700">{t('select_design_type')}</label>
                      <Select
                        value={selectedDesignType}
                        onValueChange={(value) => {
                          setSelectedDesignType(value);
                          setSingleForm(prev => ({ ...prev, selected_template_url: null }));
                        }}
                        disabled={bulkProcessing}
                      >
                        <SelectTrigger className="bg-white border-slate-300">
                          <SelectValue placeholder="Choose a design type" />
                        </SelectTrigger>
                        <SelectContent>
                          {getUniqueDesignTypes(designs).map((type) => (
                            <SelectItem key={type} value={type}>
                              {getDesignTypeLabel(type)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {selectedDesignType && (
                        <>
                          <div>
                            <label className="text-sm font-semibold text-slate-700">{t('select_certificate_template')}</label>
                          </div>
                          {designs.filter(design => extractDesignType(design.design_code) === selectedDesignType).length === 0 ? (
                            <Alert className="bg-yellow-50 border-yellow-200">
                              <AlertTriangle className="h-4 w-4 text-yellow-600" />
                              <AlertDescription className="text-yellow-800 text-sm">
                                {t('no_template_available')}
                              </AlertDescription>
                            </Alert>
                          ) : (
                            <Select
                              value={singleForm.selected_template_url || ''}
                              onValueChange={(value) => {
                                setSingleForm(prev => ({ ...prev, selected_template_url: value }));
                              }}
                              disabled={bulkProcessing}
                            >
                              <SelectTrigger className="bg-white border-slate-300">
                                <SelectValue placeholder="Choose a template" />
                              </SelectTrigger>
                              <SelectContent>
                                {designs
                                  .filter(design => extractDesignType(design.design_code) === selectedDesignType)
                                  .map((design) => (
                                    <SelectItem key={design.design_code} value={design.template_url || design.main_template_url}>
                                      <span className="font-medium text-sm">{design.design_code}</span>
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {singleForm.selected_template_url && (
                    <div className="space-y-4 border-t pt-6">
                      <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                        <Type className="h-5 w-5" />
                        {t('design_your_certificate_bulk_preview')}
                      </h3>
                      <Alert className="bg-blue-50 border-blue-200">
                        <AlertTriangle className="h-4 w-4 text-blue-600" />
                        <AlertDescription className="text-blue-800 text-sm">
                          {t('placeholder_replacement_info')}
                        </AlertDescription>
                      </Alert>
                      <CertificateCanvas
                        ref={canvasRef}
                        templateUrl={singleForm.selected_template_url}
                        achieverUsername="{employees_name}"
                        credentialCode={currentCredentialCode}
                        isBulkMode={true}
                      />
                    </div>
                  )}

                  {bulkProcessing && (
                    <Card className="border-blue-200 bg-blue-50/30">
                      <CardContent className="p-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-700">{t('processing')}...</span>
                            <span className="text-sm text-slate-600">
                              {bulkProgress.current} / {bulkProgress.total}
                            </span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                            />
                          </div>
                          {bulkProgress.results.length > 0 && (
                            <div className="max-h-40 overflow-y-auto space-y-1 mt-2">
                              {bulkProgress.results.map((result, idx) => (
                                <div key={idx} className="text-xs flex items-center gap-2">
                                  {result.success ? (
                                    <>
                                      <FileCheck className="h-3 w-3 text-green-600" />
                                      <span className="text-green-700">{result.email} - {t('success')}</span>
                                    </>
                                  ) : (
                                    <>
                                      <FileX className="h-3 w-3 text-red-600" />
                                      <span className="text-red-700">{result.email} - {result.error}</span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Button
                    className="w-full bg-black hover:bg-zinc-900 text-white h-12 text-base font-semibold shadow-sm"
                    onClick={handleBulkCredentialSubmit}
                    disabled={bulkProcessing || !singleForm.selected_template_url || (!bulkEmails && !bulkEmailFile)}
                  >
                    {bulkProcessing ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        {t('processing_bulk_issuance')}...
                      </>
                    ) : (
                      <>
                        <Award className="mr-2 h-5 w-5" />
                        {t('issue_credentials_in_bulk')}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Drafts Dialog */}
        <Dialog open={showDraftsDialog} onOpenChange={setShowDraftsDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-slate-900">{t('saved_drafts')}</DialogTitle>
              <DialogDescription className="text-slate-600">
                {t('select_draft_to_resume')}
              </DialogDescription>
            </DialogHeader>

            {savedDrafts.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">{t('no_drafts_found')}</h3>
                <p className="text-slate-500">
                  {t('start_designing_to_create_draft')}
                </p>
              </div>
            ) : (
              <div className="space-y-3 mt-4">
                {savedDrafts
                  .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
                  .map((draft) => (
                    <Card
                      key={draft.id}
                      className="border-slate-200 hover:border-slate-300 transition-colors cursor-pointer"
                      onClick={() => handleRestoreDraft(draft.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3">
                              <div className="flex-shrink-0">
                                {draft.templateUrl && (
                                  <div className="relative h-16 w-24 rounded border border-slate-200 overflow-hidden bg-slate-50">
                                    <Image
                                      src={draft.templateUrl}
                                      alt="Template preview"
                                      fill
                                      className="object-cover"
                                      sizes="96px"
                                    />
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-slate-900 truncate">
                                  {draft.name || `Draft ${new Date(draft.savedAt).toLocaleString()}`}
                                </h4>
                                <p className="text-sm text-slate-600 mt-1">
                                  {t('user')}: <span className="font-medium">{draft.achieverUsername || 'N/A'}</span>
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                  {t('saved')}: {new Date(draft.savedAt).toLocaleString()}
                                </p>
                                <div className="flex gap-2 mt-2">
                                  {draft.textElements?.length > 0 && (
                                    <Badge variant="outline" className="text-xs">
                                      {draft.textElements.length} {t('text')}
                                    </Badge>
                                  )}
                                  {draft.shapeElements?.length > 0 && (
                                    <Badge variant="outline" className="text-xs">
                                      {draft.shapeElements.length} {t('shapes')}
                                    </Badge>
                                  )}
                                  {draft.imageElements?.length > 0 && (
                                    <Badge variant="outline" className="text-xs">
                                      {draft.imageElements.length} {t('images')}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRestoreDraft(draft.id);
                              }}
                              className="bg-black hover:bg-zinc-900 text-white"
                            >
                              {t('resume')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm('Are you sure you want to delete this draft?')) {
                                  handleDeleteDraft(draft.id, e);
                                }
                              }}
                              className="border-red-300 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}