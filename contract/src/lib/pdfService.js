"use client";

import { PDFDocument } from 'pdf-lib';

import { API_BASE_URL } from '@/lib/config';

/**
 * PDF Service Utility for generating signed PDFs
 * Handles PDF manipulation, localStorage caching, and file upload
 */

/**
 * Generates a signed PDF by embedding the signature image at the specified position
 * @param {string} pdfUrl - URL of the original PDF document
 * @param {string} signatureDataUrl - Base64 data URL of the signature image
 * @param {Object} position - {x, y} position in pixels on the rendered page
 * @param {number} pageNumber - Page number where signature should be placed (1-indexed)
 * @param {number} scale - Scale factor used when rendering the PDF page
 * @param {string} accessToken - Access token for authentication
 * @returns {Promise<{blob: Blob, base64: string}>} - Signed PDF as blob and base64
 */
export async function generateSignedPdf(pdfUrl, signatureDataUrl, position, pageNumber = 1, scale = 1.0, accessToken = null) {

    // Validation
    if (!pdfUrl) {
        throw new Error('PDF URL is required');
    }
    if (!signatureDataUrl) {
        throw new Error('Signature data is required');
    }
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
        throw new Error('Valid position {x, y} is required');
    }

    try {
        // Step 1: Fetch the original PDF
        let fetchUrl = pdfUrl;

        // If it's a relative URL, make it absolute
        if (!pdfUrl.startsWith('http')) {
            fetchUrl = `${API_BASE_URL}/contracts/${pdfUrl}/document`;
        }

        const pdfResponse = await fetch(fetchUrl, {
            credentials: 'include',
            mode: 'cors',
        });

        if (!pdfResponse.ok) {
            throw new Error(`Failed to fetch PDF: ${pdfResponse.status} ${pdfResponse.statusText}`);
        }

        const pdfArrayBuffer = await pdfResponse.arrayBuffer();

        if (pdfArrayBuffer.byteLength === 0) {
            throw new Error('PDF file is empty');
        }

        // Step 2: Load the PDF document
        const pdfDoc = await PDFDocument.load(pdfArrayBuffer);
        const pages = pdfDoc.getPages();

        if (pageNumber > pages.length || pageNumber < 1) {
            throw new Error(`Invalid page number: ${pageNumber}. PDF has ${pages.length} pages.`);
        }

        const page = pages[pageNumber - 1];
        const { width: pageWidth, height: pageHeight } = page.getSize();

        // Step 3: Embed the signature image

        // Convert data URL to bytes
        const base64Data = signatureDataUrl.split(',')[1];
        if (!base64Data) {
            throw new Error('Invalid signature data URL format');
        }

        const signatureBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

        // Detect image type and embed accordingly
        let signatureImage;
        if (signatureDataUrl.includes('image/png')) {
            signatureImage = await pdfDoc.embedPng(signatureBytes);
        } else if (signatureDataUrl.includes('image/jpeg') || signatureDataUrl.includes('image/jpg')) {
            signatureImage = await pdfDoc.embedJpg(signatureBytes);
        } else {
            // Default to PNG (most canvas exports are PNG)
            signatureImage = await pdfDoc.embedPng(signatureBytes);
        }

        const originalDims = signatureImage.scale(1);

        // Step 4: Calculate position in PDF coordinates
        // PDF coordinates: origin at bottom-left, Y increases upward
        // Browser coordinates: origin at top-left, Y increases downward

        // The signature box in the UI is 180px x 80px
        const sigBoxWidth = 180;
        const sigBoxHeight = 80;

        // Scale the signature to fit in the box while maintaining aspect ratio
        const scaleRatio = Math.min(sigBoxWidth / originalDims.width, sigBoxHeight / originalDims.height) * 0.8;
        const sigWidth = originalDims.width * scaleRatio;
        const sigHeight = originalDims.height * scaleRatio;

        // Convert position from screen pixels to PDF points
        // Account for the scale factor used when rendering
        const pdfX = position.x / scale;
        const pdfY = pageHeight - (position.y / scale) - sigHeight; // Flip Y coordinate

        // Draw the signature on the page
        page.drawImage(signatureImage, {
            x: Math.max(0, pdfX),
            y: Math.max(0, pdfY),
            width: sigWidth,
            height: sigHeight,
        });

        // Step 5: Save the modified PDF
        const modifiedPdfBytes = await pdfDoc.save();
        const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });

        // Convert to base64 for localStorage
        const base64 = await blobToBase64(blob);

        return { blob, base64 };
    } catch (error) {
        console.error('[PDFService] ====== PDF Generation Failed ======');
        console.error('[PDFService] Error:', error.message);
        console.error('[PDFService] Stack:', error.stack);
        throw error;
    }
}

/**
 * Uploads the signed PDF to the storage server
 * @param {Blob} pdfBlob - The signed PDF blob
 * @param {string} contractCode - Contract code for naming
 * @param {string} accessToken - Access token for authentication
 * @param {string} contractTitle - Title for naming the file
 * @returns {Promise<string>} - URL of the uploaded signed PDF
 */
export async function uploadSignedPdf(pdfBlob, contractCode, accessToken, contractTitle = 'contract') {

    try {
        // Create FormData with the PDF file
        const formData = new FormData();
        const filename = `signed_${contractTitle.replace(/\s+/g, '_')}_${contractCode}_${Date.now()}.pdf`;

        // The storage server expects 'file' as the field name
        formData.append('file', pdfBlob, filename);

        // Storage server upload URL
        const uploadUrl = `${API_BASE_URL}/contracts/${encodeURIComponent(contractCode)}/signed-upload`;

        const response = await fetch(uploadUrl, {
            method: 'POST',
            // Don't set Content-Type header - let browser set it with boundary for FormData
            credentials: 'include',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            console.error('[PDFService] Upload failed:', errorText);
            throw new Error(`Upload failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();

        if (!data.url) {
            throw new Error('No URL returned from storage server');
        }

        return data.url;
    } catch (error) {
        console.error('[PDFService] Upload error:', error);

        // Never persist a large data URL as a contract attachment. The
        // caller keeps its temporary local backup and can retry safely.
        throw error;
    }
}

/**
 * Caches PDF data to localStorage
 * @param {string} data - Base64 data to cache
 * @param {string} key - Storage key
 */
export function cacheToLocalStorage(data, key) {
    if (typeof window === 'undefined') return;

    try {
        localStorage.setItem(key, data);
    } catch (error) {
        console.error('[PDFService] localStorage caching failed:', error);
        // If localStorage is full, try to clear old cached PDFs
        clearOldCachedPdfs();
    }
}

/**
 * Retrieves cached PDF from localStorage
 * @param {string} key - Storage key
 * @returns {string|null} - Cached data or null
 */
export function getFromLocalStorage(key) {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(key);
}

/**
 * Clears cached PDF from localStorage
 * @param {string} key - Storage key
 */
export function clearLocalStorageCache(key) {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
}

/**
 * Clears old cached PDFs to free up space
 */
function clearOldCachedPdfs() {
    if (typeof window === 'undefined') return;

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('signed_pdf_')) {
            keysToRemove.push(key);
        }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
}

/**
 * Converts a Blob to base64 string
 * @param {Blob} blob - Blob to convert
 * @returns {Promise<string>} - Base64 data URL
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Downloads a PDF blob as a file
 * @param {Blob} blob - PDF blob
 * @param {string} filename - Name for the download
 */
export function downloadPdf(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
