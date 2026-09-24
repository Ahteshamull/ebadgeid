"use client"
import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
    MousePointer,
    ChevronLeft,
    ChevronRight,
    ZoomOut,
    ZoomIn,
    FileText,
    PenTool,
    Move,
    X,
    CheckCircle2,
    AlertCircle
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';

// Import CSS with error handling
try {
    require('react-pdf/dist/Page/AnnotationLayer.css');
    require('react-pdf/dist/Page/TextLayer.css');
} catch (e) {
    console.warn('[PDF] CSS files not found, continuing without them');
}

// Set worker - using the exact version that matches pdfjs
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

import { API_BASE_URL } from '@/lib/config';

const PDFViewerWithSignature = ({ pdfUrl, accessToken, onPositionSelect, onCancel, signatureData }) => {
    const containerRef = useRef(null);
    const pdfPageRef = useRef(null);
    const signatureBoxRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [position, setPosition] = useState({ x: 100, y: 100 });
    const [numPages, setNumPages] = useState(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [scale, setScale] = useState(1.0);
    const [pdfError, setPdfError] = useState(null);
    const [pdfLoading, setPdfLoading] = useState(true);
    const [pdfData, setPdfData] = useState(null);
    const [debugInfo, setDebugInfo] = useState([]);

    // Debug logging helper — feeds the in-UI debug panel (debugInfo state,
    // rendered for troubleshooting a signing session); no longer mirrors to
    // the browser console on every call.
    const addDebugInfo = (message) => {
        setDebugInfo(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    };

    const handleMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const boxRect = signatureBoxRef.current.getBoundingClientRect();
        const offsetX = e.clientX - boxRect.left;
        const offsetY = e.clientY - boxRect.top;
        setDragOffset({ x: offsetX, y: offsetY });
        setIsDragging(true);
    };

    const handleMouseMove = (e) => {
        if (!isDragging || !pdfPageRef.current || !signatureBoxRef.current) return;

        const pdfRect = pdfPageRef.current.getBoundingClientRect();
        const boxWidth = signatureBoxRef.current.offsetWidth;
        const boxHeight = signatureBoxRef.current.offsetHeight;

        const x = e.clientX - pdfRect.left - dragOffset.x;
        const y = e.clientY - pdfRect.top - dragOffset.y;

        const maxX = pdfRect.width - boxWidth;
        const maxY = pdfRect.height - boxHeight;

        setPosition({
            x: Math.max(0, Math.min(x, maxX)),
            y: Math.max(0, Math.min(y, maxY))
        });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleConfirmPosition = () => {
        onPositionSelect(position);
    };

    const changePage = (offset) => {
        setPageNumber(prevPageNumber => {
            const newPageNumber = prevPageNumber + offset;
            if (newPageNumber >= 1 && newPageNumber <= numPages) {
                return newPageNumber;
            }
            return prevPageNumber;
        });
    };

    const zoomIn = () => setScale(prev => Math.min(prev + 0.1, 3.0));
    const zoomOut = () => setScale(prev => Math.max(prev - 0.1, 0.5));

    useEffect(() => {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset]);

    // Fetch PDF data
    useEffect(() => {
        let isMounted = true;
        let blobUrl = null;

        const fetchPdfData = async () => {
            if (!pdfUrl) {
                const error = 'No PDF URL provided';
                addDebugInfo(error);
                setPdfError(error);
                setPdfLoading(false);
                return;
            }

            try {
                setPdfLoading(true);
                setPdfError(null);
                addDebugInfo(`📄 Starting PDF fetch for: ${pdfUrl}`);

                let url = pdfUrl.startsWith('http')
                    ? pdfUrl
                    : `${API_BASE_URL}/contracts/${pdfUrl}/document`;

                const headers = {
                    'Accept': 'application/pdf'
                };

                if (accessToken) {
                    addDebugInfo('🔑 Access token added');
                }

                addDebugInfo(`🌐 Fetching from: ${url}`);

                const response = await fetch(url, {
                    headers,
                    credentials: 'include',
                    mode: 'cors'
                });

                addDebugInfo(`📥 Response: ${response.status}`);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const blob = await response.blob();
                addDebugInfo(`📦 Blob: ${blob.size} bytes`);

                if (blob.size === 0) {
                    throw new Error('Empty PDF file');
                }

                if (!isMounted) return;

                blobUrl = URL.createObjectURL(blob);
                addDebugInfo(`🔗 Blob URL: ${blobUrl}`);

                // Pass the blob URL directly as a string
                setPdfData(blobUrl);
                addDebugInfo('✅ Calling setPdfData - should trigger Document render');

            } catch (error) {
                console.error('[PDFViewer] Error:', error);
                addDebugInfo(`❌ ERROR: ${error.message}`);
                if (isMounted) {
                    setPdfError(`Failed to load PDF: ${error.message}`);
                    setPdfLoading(false);
                }
            }
        };

        fetchPdfData();

        return () => {
            isMounted = false;
            if (blobUrl) {
                URL.revokeObjectURL(blobUrl);
            }
        };
    }, [pdfUrl, accessToken]);

    const onDocumentLoadSuccess = ({ numPages }) => {
        addDebugInfo(`✅ Document loaded! Pages: ${numPages}`);
        setNumPages(numPages);
        setPdfLoading(false);
        setPdfError(null);
    };

    const onDocumentLoadError = (error) => {
        console.error('[PDF] ❌ onDocumentLoadError:', error);
        addDebugInfo(`❌ Load error: ${error?.message || String(error)}`);
        setPdfError(`Failed to load PDF: ${error?.message || 'Unknown error'}`);
        setPdfLoading(false);
    };

    const onSourceError = (error) => {
        console.error('[PDF] ⚠️ onSourceError:', error);
        addDebugInfo(`⚠️ Source error: ${error?.message || String(error)}`);
    };

    return (
        <div className="relative w-full px-4">


            <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 text-blue-700 mb-2">
                    <MousePointer className="h-5 w-5" />
                    <span className="font-medium">Instructions:</span>
                </div>
                <p className="text-sm text-blue-700">
                    Please drag the red box to where you want to place your signature on the document.
                    Once positioned, click &quot;Confirm Position&quot; to proceed.
                </p>
            </div>

            {/* PDF Controls */}
            <div className="flex items-center justify-between mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => changePage(-1)}
                            disabled={pageNumber <= 1 || pdfLoading}
                            className="h-8 w-8 p-0"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm min-w-[100px] text-center">
                            Page {pageNumber} of {numPages || '?'}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => changePage(1)}
                            disabled={pageNumber >= numPages || pdfLoading}
                            className="h-8 w-8 p-0"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={zoomOut}
                            className="h-8 w-8 p-0"
                            disabled={pdfLoading}
                        >
                            <ZoomOut className="h-4 w-4" />
                        </Button>
                        <span className="text-sm w-16 text-center">
                            {Math.round(scale * 100)}%
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={zoomIn}
                            className="h-8 w-8 p-0"
                            disabled={pdfLoading}
                        >
                            <ZoomIn className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="text-sm text-gray-600">
                    {pdfLoading ? 'Loading...' : 'Drag the red box to position your signature'}
                </div>
            </div>

            <div
                ref={containerRef}
                className="relative border rounded-lg overflow-hidden bg-gray-100"
                style={{ height: '90vh', minHeight: '800px' }}
            >
                {/* PDF Document */}
                <div className="w-full h-full overflow-auto flex justify-center p-4">
                    {pdfLoading && !pdfData && (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                                <p className="text-gray-600 font-medium">Loading PDF document...</p>
                                <p className="text-xs text-gray-500 mt-2">Fetching file...</p>
                            </div>
                        </div>
                    )}

                    {pdfError && (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center p-8 bg-white rounded-lg shadow max-w-md">
                                <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
                                <p className="text-gray-800 font-medium mb-2">Error Loading PDF</p>
                                <p className="text-sm text-gray-600 mb-4">{pdfError}</p>
                                <div className="text-xs text-left bg-gray-50 p-3 rounded">
                                    <p className="font-medium mb-1">Troubleshooting:</p>
                                    <ul className="list-disc list-inside space-y-1 text-gray-600">
                                        <li>Check if backend server is running</li>
                                        <li>Verify PDF URL is correct</li>
                                        <li>Check browser console for errors</li>
                                        <li>Try refreshing the page</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}

                    {pdfData && !pdfError && (
                        <>
                            <Document
                                file={pdfData}
                                onLoadSuccess={onDocumentLoadSuccess}
                                onLoadError={onDocumentLoadError}
                                onSourceError={onSourceError}
                                loading={
                                    <div className="flex items-center justify-center h-full">
                                        <div className="text-center">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                                            <p className="text-sm text-gray-600">Rendering PDF...</p>
                                        </div>
                                    </div>
                                }
                                error={
                                    <div className="flex items-center justify-center h-full">
                                        <div className="text-center p-8 bg-white rounded-lg shadow">
                                            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                                            <p className="text-gray-800 font-medium">Failed to render PDF</p>
                                            <p className="text-sm text-gray-600 mt-2">Check console for details</p>
                                        </div>
                                    </div>
                                }
                            >
                                {/* PDF Page Wrapper with relative positioning for signature box */}
                                <div ref={pdfPageRef} className="relative inline-block">
                                    <Page
                                        pageNumber={pageNumber}
                                        scale={scale}
                                        renderTextLayer={true}
                                        renderAnnotationLayer={true}
                                        className="shadow-lg"
                                    />

                                    {/* Movable Signature Box - Now inside PDF page wrapper */}
                                    {!pdfLoading && numPages && (
                                        <div
                                            ref={signatureBoxRef}
                                            className={`absolute w-[180px] h-[80px] border-4 border-red-500 bg-red-50/30 cursor-move ${isDragging ? 'shadow-2xl ring-4 ring-red-300' : 'shadow-lg'
                                                }`}
                                            style={{
                                                left: `${position.x}px`,
                                                top: `${position.y}px`,
                                                cursor: isDragging ? 'grabbing' : 'grab',
                                                transition: isDragging ? 'none' : 'box-shadow 0.2s',
                                                zIndex: 10
                                            }}
                                            onMouseDown={handleMouseDown}
                                        >
                                            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                                                {signatureData ? (
                                                    <img
                                                        src={signatureData}
                                                        alt="Signature Preview"
                                                        className="max-w-full max-h-full object-contain pointer-events-none"
                                                        draggable={false}
                                                    />
                                                ) : (
                                                    <div className="text-center">
                                                        <PenTool className="h-6 w-6 text-red-500 mx-auto mb-1" />
                                                        <span className="text-xs font-bold text-red-600">SIGN HERE</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg">
                                                <Move className="h-4 w-4" />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Document>
                        </>
                    )}
                </div>

                {/* Signature box is now inside the PDF page wrapper above */}
            </div>

            <div className="flex justify-between mt-6 gap-4">
                <Button variant="outline" size="lg" onClick={onCancel} className="px-8">
                    <X className="h-5 w-5 mr-2" />
                    Cancel
                </Button>
                <Button size="lg" onClick={handleConfirmPosition} disabled={pdfLoading || pdfError} className="px-8">
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                    Confirm Position
                </Button>
            </div>
        </div>
    );
};

export default PDFViewerWithSignature;
