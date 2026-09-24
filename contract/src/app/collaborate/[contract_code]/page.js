"use client"
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  FileText,
  Users,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  Download,
  AlertCircle,
  Building2,
  Mail,
  Phone,
  Calendar,
  PenTool,
  Edit3,
  Linkedin,
  Twitter,
  Github,
  X,
  Upload,
  Type,
  MousePointer,
  Move,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
  generateSignedPdf,
  uploadSignedPdf,
  cacheToLocalStorage,
  clearLocalStorageCache
} from '@/lib/pdfService';

import { API_BASE_URL } from '@/lib/config';
import { exchangeInvitation, readInvitation } from '@/lib/contract-session.mjs';

import dynamic from 'next/dynamic';

const PDFViewerWithSignature = dynamic(
  () => import('@/components/PDFViewerWithSignature'),
  { ssr: false }
);

// Signature Canvas Component
const SignatureCanvas = ({ width, height, onSignatureComplete }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lineWidth, setLineWidth] = useState(2);
  const [lineColor, setLineColor] = useState('#000000');

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (onSignatureComplete) {
      onSignatureComplete(canvasRef.current.toDataURL());
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm">Thickness:</span>
            <Slider
              value={[lineWidth]}
              onValueChange={([value]) => setLineWidth(value)}
              min={1}
              max={10}
              step={1}
              className="w-32"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">Color:</span>
            <input
              type="color"
              value={lineColor}
              onChange={(e) => setLineColor(e.target.value)}
              className="w-8 h-8 cursor-pointer"
            />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={clearCanvas}>
          Clear
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="border-2 border-dashed border-gray-300 rounded-md cursor-crosshair bg-white"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={(e) => {
          e.preventDefault();
          startDrawing(e.touches[0]);
        }}
        onTouchMove={(e) => {
          e.preventDefault();
          draw(e.touches[0]);
        }}
        onTouchEnd={stopDrawing}
      />
    </div>
  );
};



// Main Signature Dialog Component
const SignatureDialog = ({
  open,
  onOpenChange,
  contractCode,
  accessToken,
  contractTitle,
  pdfUrl,
  onSignatureComplete
}) => {
  const [step, setStep] = useState(1);
  const [signaturePosition, setSignaturePosition] = useState(null);
  const [signatureData, setSignatureData] = useState(null);
  const [signatureMethod, setSignatureMethod] = useState('');
  const [signatureImage, setSignatureImage] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressStatus, setProgressStatus] = useState('');

  // Handle position selection
  const handlePositionSelect = (position) => {
    setSignaturePosition(position);
    setStep(2);
  };

  // Handle signature creation
  const handleSignatureComplete = (dataUrl) => {
    setSignatureData(dataUrl);
  };

  // Handle file upload
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check if PNG
    if (file.type !== 'image/png') {
      setUploadError('Please upload a PNG image only');
      return;
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File size must be less than 5MB');
      return;
    }

    setUploadError('');
    const reader = new FileReader();
    reader.onload = (event) => {
      setSignatureImage(event.target.result);
      setSignatureData(event.target.result);
    };
    reader.readAsDataURL(file);
  };

  // Submit signature
  const handleSubmitSignature = async () => {
    if (!signatureData) {
      alert('Please create or upload a signature first');
      return;
    }

    setIsSubmitting(true);
    setProgressStatus('Generating signed PDF...');

    const cacheKey = `signed_pdf_temp_${contractCode}_${Date.now()}`;

    try {
      // Step 1: Generate signed PDF with signature embedded
      console.log('[SignatureDialog] Starting PDF generation');
      const { blob: pdfBlob, base64: pdfBase64 } = await generateSignedPdf(
        pdfUrl,
        signatureData,
        signaturePosition,
        1, // Page number (default to first page)
        1.0, // Scale
        accessToken
      );
      console.log('[SignatureDialog] PDF generated successfully');

      // Step 2: Cache to localStorage temporarily as backup
      setProgressStatus('Caching document...');
      cacheToLocalStorage(pdfBase64, cacheKey);
      console.log('[SignatureDialog] PDF cached to localStorage');

      // Step 3: Upload to storage server
      setProgressStatus('Uploading signed document...');
      const signedPdfUrl = await uploadSignedPdf(
        pdfBlob,
        contractCode,
        accessToken,
        contractTitle
      );
      console.log('[SignatureDialog] PDF uploaded, URL:', signedPdfUrl);

      // Step 4: Clear localStorage cache after successful upload
      clearLocalStorageCache(cacheKey);
      console.log('[SignatureDialog] localStorage cache cleared');

      // Step 5: Update contract with signed copy
      setProgressStatus('Finalizing signature...');
      const response = await fetch(`${API_BASE_URL}/contracts/${contractCode}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          attachment_name: `signed_copy_of_${contractTitle.replace(/\s+/g, '_')}.pdf`,
          attachment_url: signedPdfUrl,
          signature_data: signatureData,
          signature_position: signaturePosition
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to sign contract');
      }

      console.log('[SignatureDialog] Contract signed successfully');

      // Close dialog and notify parent
      onSignatureComplete(data.contract);
      onOpenChange(false);

      // Reset state
      setStep(1);
      setSignaturePosition(null);
      setSignatureData(null);
      setSignatureMethod('');
      setSignatureImage(null);
      setProgressStatus('');

    } catch (error) {
      console.error('[SignatureDialog] Signature submission error:', error);
      // Keep the cache in case of error for recovery
      alert(`Failed to sign contract: ${error.message}`);
    } finally {
      setIsSubmitting(false);
      setProgressStatus('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-h-[95vh] overflow-y-auto sm:max-w-2/3 sm:max-h-2/3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenTool className="h-5 w-5" />
            Sign Document
          </DialogTitle>
          <DialogDescription>
            Follow the steps to sign {contractTitle}
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-center mb-6">
          <div className={`flex items-center ${step >= 1 ? 'text-primary' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-primary text-white' : 'bg-gray-200'}`}>
              1
            </div>
            <span className="ml-2 font-medium">Position</span>
          </div>
          <div className={`w-16 h-1 mx-2 ${step >= 2 ? 'bg-primary' : 'bg-gray-300'}`}></div>
          <div className={`flex items-center ${step >= 2 ? 'text-primary' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-primary text-white' : 'bg-gray-200'}`}>
              2
            </div>
            <span className="ml-2 font-medium">Signature</span>
          </div>
          <div className={`w-16 h-1 mx-2 ${step >= 3 ? 'bg-primary' : 'bg-gray-300'}`}></div>
          <div className={`flex items-center ${step >= 3 ? 'text-primary' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 3 ? 'bg-primary text-white' : 'bg-gray-200'}`}>
              3
            </div>
            <span className="ml-2 font-medium">Confirm</span>
          </div>
        </div>

        {/* Step Content */}
        <div className="py-4">
          {step === 1 && (
            <PDFViewerWithSignature
              pdfUrl={pdfUrl}
              accessToken={accessToken}
              onPositionSelect={handlePositionSelect}
              onCancel={() => onOpenChange(false)}
              signatureData={signatureData}
            />
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                <p className="text-sm text-yellow-800">
                  Signature will be placed at position: X: {signaturePosition?.x || 0}, Y: {signaturePosition?.y || 0}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Option 1: Draw Signature */}
                <Card className={`cursor-pointer hover:border-primary transition-colors ${signatureMethod === 'draw' ? 'border-primary border-2' : ''
                  }`} onClick={() => setSignatureMethod('draw')}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Type className="h-5 w-5" />
                      Draw Signature
                    </CardTitle>
                    <CardDescription>
                      Draw your signature using mouse or touch
                    </CardDescription>
                  </CardHeader>
                </Card>

                {/* Option 2: Upload Signature */}
                <Card className={`cursor-pointer hover:border-primary transition-colors ${signatureMethod === 'upload' ? 'border-primary border-2' : ''
                  }`} onClick={() => setSignatureMethod('upload')}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Upload className="h-5 w-5" />
                      Upload Signature
                    </CardTitle>
                    <CardDescription>
                      Upload a PNG image of your signature
                    </CardDescription>
                  </CardHeader>
                </Card>
              </div>

              {/* Signature Area */}
              {signatureMethod === 'draw' && (
                <div className="space-y-4">
                  <h3 className="font-medium">Draw your signature:</h3>
                  <SignatureCanvas
                    width={500}
                    height={200}
                    onSignatureComplete={handleSignatureComplete}
                  />
                </div>
              )}

              {signatureMethod === 'upload' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-medium">Upload signature image (PNG only):</h3>
                    <input
                      type="file"
                      accept=".png,image/png"
                      onChange={handleFileUpload}
                      className="w-full p-2 border rounded"
                    />
                    {uploadError && (
                      <Alert variant="destructive">
                        <AlertDescription>{uploadError}</AlertDescription>
                      </Alert>
                    )}
                  </div>

                  {signatureImage && (
                    <div className="space-y-2">
                      <h4 className="font-medium">Preview:</h4>
                      <div className="border rounded p-4 bg-white">
                        <img
                          src={signatureImage}
                          alt="Signature preview"
                          className="max-h-32 mx-auto"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {signatureData && (
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">Signature ready!</span>
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={!signatureData}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="font-medium text-blue-800 mb-2">Review and Confirm</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Document:</span>
                    <span className="font-medium">{contractTitle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Signature Position:</span>
                    <span className="font-medium">
                      X: {signaturePosition?.x}, Y: {signaturePosition?.y}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Signature Type:</span>
                    <span className="font-medium capitalize">{signatureMethod}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-medium text-lg border-b pb-2">Signature Preview</h3>
                <div className="border-2 border-dashed rounded-lg p-8 bg-gray-50 flex flex-col items-center justify-center min-h-[200px]">
                  {signatureMethod === 'draw' ? (
                    <div className="text-center w-full">
                      <p className="text-sm text-gray-500 mb-4 uppercase tracking-wider font-semibold">Drawn Signature</p>
                      <img
                        src={signatureData}
                        alt="Signature"
                        className="max-h-40 mx-auto object-contain"
                      />
                    </div>
                  ) : (
                    <div className="text-center w-full">
                      <p className="text-sm text-gray-500 mb-4 uppercase tracking-wider font-semibold">Uploaded Signature</p>
                      <img
                        src={signatureImage}
                        alt="Signature"
                        className="max-h-40 mx-auto object-contain"
                      />
                    </div>
                  )}
                </div>
              </div>

              <Alert className="bg-amber-50 border-amber-200">
                <AlertDescription className="text-amber-800">
                  By clicking &apos;Sign Document&apos;, you are legally binding yourself to this contract.
                  This action cannot be undone.
                </AlertDescription>
              </Alert>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  onClick={handleSubmitSignature}
                  disabled={isSubmitting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      {progressStatus || 'Signing...'}
                    </>
                  ) : (
                    <>
                      <PenTool className="h-4 w-4 mr-2" />
                      Sign Document
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Main Component
export default function ContractCollaborationPage() {
  const params = useParams();
  const contractCode = String(params?.contract_code || '');
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [discussionMessage, setDiscussionMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [requiresAcceptance, setRequiresAcceptance] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [showDatesDialog, setShowDatesDialog] = useState(false);
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [inviteSide, setInviteSide] = useState('buyer');
  const [invitePermissions, setInvitePermissions] = useState({
    view: true,
    write: false,
    update: false,
    add_discussion: true,
    add_timeline_event: false
  });
  const [showSignDialog, setShowSignDialog] = useState(false);

  const fetchContract = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const headers = { 'Content-Type': 'application/json' };
      const res = await fetch(`${API_BASE_URL}/contracts/${contractCode}`, { headers, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        if (data.requires_acceptance) {
          setRequiresAcceptance(true);
          setError(data.message);
        } else {
          throw new Error(data.message || 'Failed to fetch contract');
        }
        return;
      }
      setContract(data.contract);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [contractCode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const { contractCode: codeFromPath, accessToken: tokenFromQuery } = readInvitation(window.location);

      if (codeFromPath === contractCode && tokenFromQuery) {
        exchangeInvitation(API_BASE_URL, tokenFromQuery).then(() => {
          window.history.replaceState({}, '', window.location.pathname);
          setAccessToken('cookie');
          return fetchContract();
        }).catch(reason => {
          setError(reason.message);
          setLoading(false);
        });
      } else {
        queueMicrotask(() => {
          setError('Missing contract code or access token in URL');
          setLoading(false);
        });
      }
    }
  }, [contractCode, fetchContract]);

  const handleAcceptInvitation = async () => {
    try {
      setSubmitting(true);
      const headers = { 'Content-Type': 'application/json' };
      const res = await fetch(`${API_BASE_URL}/contracts/${contractCode}/accept-invitation`, { method: 'POST', headers, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to accept invitation');
      setRequiresAcceptance(false);
      setError(null);
      await fetchContract();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Updated signature handler
  const handleSignatureComplete = (updatedContract) => {
    setContract(updatedContract);
    setShowSignDialog(false);
  };

  const handleSendDiscussion = async () => {
    if (!discussionMessage.trim()) return;
    try {
      setSubmitting(true);
      const headers = { 'Content-Type': 'application/json' };
      const res = await fetch(`${API_BASE_URL}/contracts/${contractCode}/discussion`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ message: discussionMessage, attachments: [] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send message');
      setDiscussionMessage('');
      await fetchContract();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!newStatus) return;
    try {
      setSubmitting(true);
      const headers = { 'Content-Type': 'application/json' };
      const res = await fetch(`${API_BASE_URL}/contracts/${contractCode}`, { method: 'PUT', headers, credentials: 'include', body: JSON.stringify({ contract_status: newStatus }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update contract status');
      setShowStatusDialog(false);
      setNewStatus('');
      await fetchContract();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateDates = async () => {
    // Only allow if there's a change
    const body = {};
    if (startDateInput) body.contract_start_date = startDateInput;
    if (endDateInput) body.contract_end_date = endDateInput;
    if (Object.keys(body).length === 0) return setError('No date changes to update');

    try {
      setSubmitting(true);
      const headers = { 'Content-Type': 'application/json' };

      const res = await fetch(`${API_BASE_URL}/contracts/${contractCode}`, { method: 'PUT', headers, credentials: 'include', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update contract dates');
      setShowDatesDialog(false);
      setStartDateInput('');
      setEndDateInput('');
      await fetchContract();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveParty = async (party_email) => {
    if (!window.confirm(`Remove ${party_email} from this contract?`)) return;

    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE_URL}/contracts/${contractCode}/remove/${encodeURIComponent(party_email)}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to remove party');
      await fetchContract();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleInviteParty = async () => {
    if (!inviteEmail) return setError('Provide an email to invite');
    const body = {
      party_email: inviteEmail,
      party_name: inviteName,
      party_side: inviteSide,
      party_role: inviteRole,
      contract_permissions: invitePermissions
    };

    try {
      setSubmitting(true);
      const headers = { 'Content-Type': 'application/json' };
      const res = await fetch(`${API_BASE_URL}/contracts/${contractCode}/invite`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to invite party');
      setShowInviteDialog(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('');
      setInviteSide('buyer');
      setInvitePermissions({ view: true, write: false, update: false, add_discussion: true, add_timeline_event: false });
      await fetchContract();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const statusMeta = useMemo(() => ({
    in_discussion: { label: 'In Discussion', bg: 'bg-blue-50', text: 'text-blue-800' },
    active: { label: 'Active', bg: 'bg-green-50', text: 'text-green-800' },
    completed: { label: 'Completed', bg: 'bg-emerald-50', text: 'text-emerald-800' },
    terminated: { label: 'Terminated', bg: 'bg-red-50', text: 'text-red-800' },
    accepted: { label: 'Accepted', bg: 'bg-emerald-50', text: 'text-emerald-800' },
    invited: { label: 'Invited', bg: 'bg-slate-50', text: 'text-slate-800' },
    on_hold: { label: 'On Hold', bg: 'bg-yellow-50', text: 'text-yellow-800' },
    disputed: { label: 'Disputed', bg: 'bg-orange-50', text: 'text-orange-800' }
  }), []);

  const getStatusBadge = (status) => {
    const m = statusMeta[status] || { label: status || 'Unknown', bg: 'bg-slate-50', text: 'text-slate-800' };
    return <Badge className={`ml-3 px-3 py-1 rounded-full shadow-sm ${m.bg} ${m.text} border`}>{(m.label || 'Unknown').toUpperCase()}</Badge>;
  };

  const formatDate = (dateString) => new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatDateTime = (dateString) => new Date(dateString).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const getInitials = (name) => (name || '').split(' ').map(n => n[0] || '').join('').toUpperCase().slice(0, 2);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-6">
        <Card className="w-full max-w-lg shadow-lg">
          <CardContent className="pt-6 flex items-center gap-6">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
            <div>
              <p className="text-lg font-medium">Loading contract</p>
              <p className="text-sm text-muted-foreground">Fetching latest contract details…</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (requiresAcceptance) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-6">
        <Card className="w-full max-w-2xl shadow-lg">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-3"><AlertCircle className="h-6 w-6 text-amber-500" />Invitation Pending</CardTitle>
                <CardDescription>You need to accept the invitation to view this contract</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <div className="w-full flex gap-3">
              <Button onClick={handleAcceptInvitation} disabled={submitting} className="flex-1">{submitting ? 'Accepting...' : 'Accept Invitation'}</Button>
              <Button variant="ghost" onClick={fetchContract} className="flex-1">Retry</Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (error && !contract) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-6">
        <Card className="w-full max-w-lg shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" />Unable to load contract</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          </CardContent>
          <CardFooter>
            <div className="w-full flex gap-3">
              <Button onClick={fetchContract} variant="outline" className="flex-1">Try Again</Button>
              <Button onClick={() => { window.location.href = '/'; }} variant="ghost" className="flex-1">Home</Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (!contract) return null;

  const canAddDiscussion = contract.your_permissions?.add_discussion;
  const canUpdateContract = contract.your_permissions?.update;
  const canSign = !contract.your_party?.signed && contract.your_party?.status === 'accepted';

  const statusOptions = [
    { value: 'in_discussion', label: 'In Discussion', description: 'Contract is being discussed' },
    { value: 'active', label: 'Active', description: 'Contract is currently active' },
    { value: 'on_hold', label: 'On Hold', description: 'Contract is temporarily paused' },
    { value: 'terminated', label: 'Terminated', description: 'Contract has been terminated' },
    { value: 'disputed', label: 'Disputed', description: 'Contract is under dispute' }
  ];

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md shadow-md border-b border-slate-200">
        <div className="container mx-auto px-4 max-w-7xl py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 group cursor-pointer">
              <div className="rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 p-2.5 flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all duration-300">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-lg font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">eBadgeID</p>
                <p className="text-xs text-slate-500 font-medium">Digital Contract Management</p>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-8">
              <a href="#" className="text-sm font-medium text-slate-600 hover:text-primary transition-colors duration-200">Contracts</a>
              <a href="#" className="text-sm font-medium text-slate-600 hover:text-primary transition-colors duration-200">Dashboard</a>
              <a href="#" className="text-sm font-medium text-slate-600 hover:text-primary transition-colors duration-200">Support</a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <div className="py-8">
          <div className="container mx-auto px-4 max-w-7xl">
            <div className="mb-8">
              <div className="bg-white shadow-md rounded-lg overflow-hidden">
                <div className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="rounded-md bg-gradient-to-br from-primary/20 to-primary/10 p-3 flex items-center justify-center">
                      <FileText className="h-10 w-10 text-primary" />
                    </div>
                    <div>
                      <h1 className="text-2xl font-semibold flex items-center gap-2">{contract.contract_title}{getStatusBadge(contract.contract_status)}</h1>
                      <p className="text-sm text-muted-foreground mt-1">Code • <span className="font-mono">{contract.contract_code}</span></p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {contract.your_party?.signed && (
                      <div className="flex items-center gap-2 bg-emerald-50 text-emerald-800 px-3 py-2 rounded-md shadow-sm"><CheckCircle2 className="h-4 w-4" /><span className="text-sm font-medium">Signed</span></div>
                    )}

                    {canSign && (
                      <>
                        <Button onClick={() => setShowSignDialog(true)} className="flex items-center gap-2">
                          <PenTool className="h-4 w-4" />
                          Sign Document
                        </Button>

                        <SignatureDialog
                          open={showSignDialog}
                          onOpenChange={setShowSignDialog}
                          contractCode={contractCode}
                          accessToken={accessToken}
                          contractTitle={contract.contract_title}
                          pdfUrl={contract.contract_content_url}
                          onSignatureComplete={handleSignatureComplete}
                        />
                      </>
                    )}

                    {canUpdateContract && (
                      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="flex items-center gap-2"><Edit3 className="h-4 w-4" />Update</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Update Contract Status</DialogTitle>
                            <DialogDescription>Change the contract status. This will be recorded in the timeline.</DialogDescription>
                          </DialogHeader>
                          <div className="py-4 space-y-4">
                            <div>
                              <label className="text-sm font-medium">Current</label>
                              <div className="mt-2">{getStatusBadge(contract.contract_status)}</div>
                            </div>
                            <div>
                              <label className="text-sm font-medium">New Status</label>
                              <Select value={newStatus} onValueChange={setNewStatus}>
                                <SelectTrigger><SelectValue placeholder="Select new status" /></SelectTrigger>
                                <SelectContent>
                                  {statusOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value} disabled={option.value === contract.contract_status}>
                                      <div className="flex flex-col items-start"><span className="font-medium">{option.label}</span><span className="text-xs text-muted-foreground">{option.description}</span></div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => { setShowStatusDialog(false); setNewStatus(''); }}>Cancel</Button>
                            <Button onClick={handleUpdateStatus} disabled={submitting || !newStatus || newStatus === contract.contract_status}>{submitting ? 'Updating…' : 'Update'}</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    )}
                    {canUpdateContract && (
                      <>
                        <Dialog open={showDatesDialog} onOpenChange={setShowDatesDialog}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="flex items-center gap-2">Edit Dates</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Update Contract Dates</DialogTitle>
                              <DialogDescription>Change start and/or end dates for this contract.</DialogDescription>
                            </DialogHeader>
                            <div className="py-4 space-y-4">
                              <div>
                                <label className="text-sm font-medium">Start Date</label>
                                <input type="date" value={startDateInput} onChange={(e) => setStartDateInput(e.target.value)} className="mt-2 w-full p-2 border rounded" />
                              </div>
                              <div>
                                <label className="text-sm font-medium">End Date</label>
                                <input type="date" value={endDateInput} onChange={(e) => setEndDateInput(e.target.value)} className="mt-2 w-full p-2 border rounded" />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => { setShowDatesDialog(false); setStartDateInput(''); setEndDateInput(''); }}>Cancel</Button>
                              <Button onClick={handleUpdateDates} disabled={submitting || (!startDateInput && !endDateInput)}>{submitting ? 'Updating…' : 'Update Dates'}</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>

                        <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="flex items-center gap-2">Invite</Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Invite Party</DialogTitle>
                              <DialogDescription>Send an invitation to join this contract.</DialogDescription>
                            </DialogHeader>
                            <div className="py-4 space-y-4">
                              <div>
                                <label className="text-sm font-medium">Email *</label>
                                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="mt-2 w-full p-2 border rounded" placeholder="party@example.com" />
                              </div>
                              <div>
                                <label className="text-sm font-medium">Name (optional)</label>
                                <input type="text" value={inviteName} onChange={(e) => setInviteName(e.target.value)} className="mt-2 w-full p-2 border rounded" placeholder="Party Name" />
                              </div>
                              <div>
                                <label className="text-sm font-medium">Side</label>
                                <select value={inviteSide} onChange={(e) => setInviteSide(e.target.value)} className="mt-2 w-full p-2 border rounded">
                                  <option value="buyer">Buyer</option>
                                  <option value="seller">Seller</option>
                                  <option value="vendor">Vendor</option>
                                  <option value="partner">Partner</option>
                                  <option value="other">Other</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-sm font-medium">Role (optional)</label>
                                <input type="text" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="mt-2 w-full p-2 border rounded" placeholder="e.g., Manager, Approver" />
                              </div>
                              <Separator />
                              <div>
                                <p className="text-sm font-medium mb-3">Permissions</p>
                                <div className="space-y-2">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={invitePermissions.view} onChange={(e) => setInvitePermissions({ ...invitePermissions, view: e.target.checked })} />
                                    <span className="text-sm">View Contract</span>
                                  </label>
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={invitePermissions.write} onChange={(e) => setInvitePermissions({ ...invitePermissions, write: e.target.checked })} />
                                    <span className="text-sm">Write Access</span>
                                  </label>
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={invitePermissions.update} onChange={(e) => setInvitePermissions({ ...invitePermissions, update: e.target.checked })} />
                                    <span className="text-sm">Update Contract</span>
                                  </label>
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={invitePermissions.add_discussion} onChange={(e) => setInvitePermissions({ ...invitePermissions, add_discussion: e.target.checked })} />
                                    <span className="text-sm">Add Discussion</span>
                                  </label>
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={invitePermissions.add_timeline_event} onChange={(e) => setInvitePermissions({ ...invitePermissions, add_timeline_event: e.target.checked })} />
                                    <span className="text-sm">Add Timeline Event</span>
                                  </label>
                                </div>
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => { setShowInviteDialog(false); setInviteEmail(''); setInviteName(''); setInviteRole(''); setInviteSide('buyer'); setInvitePermissions({ view: true, write: false, update: false, add_discussion: true, add_timeline_event: false }); }}>Cancel</Button>
                              <Button onClick={handleInviteParty} disabled={submitting || !inviteEmail}>{submitting ? 'Inviting…' : 'Invite'}</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Summary</CardTitle>
                    <CardDescription>Quick overview & actions</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                      {contract.organization_detail.logo ? (<img src={contract.organization_detail.logo} alt="Org logo" className="h-12 w-12 object-contain rounded" />) : (<div className="h-12 w-12 rounded bg-slate-100 flex items-center justify-center">{contract.organization_detail.name?.[0]}</div>)}
                      <div>
                        <p className="font-semibold">{contract.organization_detail.name}</p>
                        <p className="text-xs text-muted-foreground">Created by {contract.creator_details.first_name} {contract.creator_details.last_name}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 p-3 rounded"><p className="text-xs text-muted-foreground">Issue</p><p className="font-medium">{formatDate(contract.contract_issue_date)}</p></div>
                      <div className="bg-slate-50 p-3 rounded"><p className="text-xs text-muted-foreground">Period</p><p className="font-medium">{formatDate(contract.contract_start_date)} — {formatDate(contract.contract_end_date)}</p></div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <p className="text-sm font-medium">Attachments</p>
                      {contract.contract_attachments.length === 0 ? (<p className="text-xs text-muted-foreground">No attachments</p>) : (<div className="space-y-2">{contract.contract_attachments.map((a, i) => (<a key={i} href={a} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Attachment {i + 1}</a>))}</div>)}
                    </div>

                    <div>
                      {accessToken && contract.contract_content_url && (
                        <Button asChild className="w-full">
                          <a
                            href={contract.contract_content_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View Document
                          </a>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Your Role</CardTitle>
                    <CardDescription>{contract.your_party?.party_name || contract.your_party?.party_email || 'Unknown'}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p className="text-sm">Role: <span className="font-medium">{contract.your_party?.party_role || 'N/A'}</span></p>
                      <p className="text-sm">Side: <span className="font-medium">{contract.your_party?.party_side || 'N/A'}</span></p>
                      <div className="mt-2">{getStatusBadge(contract.your_party?.status)}</div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="lg:col-span-2">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="bg-white rounded-lg shadow p-4">
                  <TabsList className="grid grid-cols-4 w-full mb-4"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="discussion">Discussion ({contract.discussion.length})</TabsTrigger><TabsTrigger value="timeline">Timeline ({contract.timeline.length})</TabsTrigger><TabsTrigger value="signed_copies">Signed Copies ({contract.signed_copies?.length || 0})</TabsTrigger></TabsList>

                  <TabsContent value="overview">
                    <div className="grid md:grid-cols-2 gap-6">
                      <Card>
                        <CardHeader><CardTitle>Details</CardTitle><CardDescription>All contract dates and metadata</CardDescription></CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Start</p><p className="font-medium">{formatDate(contract.contract_start_date)}</p></div><div><p className="text-xs text-muted-foreground">End</p><p className="font-medium">{formatDate(contract.contract_end_date)}</p></div></div>
                          <Separator />
                          <div><p className="text-sm">Organization</p><p className="font-medium">{contract.organization_detail.name}</p><p className="text-xs text-muted-foreground">{contract.organization_detail.email} • {contract.organization_detail.phone}</p></div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader><CardTitle>Parties ({contract.contract_parties.length})</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                          {contract.contract_parties.map((p, i) => (
                            <div key={i} className="flex items-center justify-between">
                              <div className="flex items-center gap-3"><Avatar className="h-10 w-10"><AvatarFallback>{getInitials(p.party_name || p.party_email)}</AvatarFallback></Avatar><div><p className="font-medium">{p.party_name || p.party_email}</p><p className="text-xs text-muted-foreground">{p.party_role || 'N/A'} • {p.party_side || 'N/A'}</p></div></div>
                              <div className="flex items-center gap-2">
                                {p.signed && <Badge className="px-3 py-1">Signed</Badge>}
                                {getStatusBadge(p.status)}
                                {canUpdateContract && p.party_email !== contract.creator_details?.email && (
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" disabled={submitting} onClick={() => handleRemoveParty(p.party_email)} title={`Remove ${p.party_email}`}>
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  <TabsContent value="discussion">
                    <Card>
                      <CardHeader><CardTitle>Messages</CardTitle><CardDescription className="text-sm">Team conversation about the contract</CardDescription></CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[420px] pr-4">
                          {contract.discussion.length === 0 ? (<div className="flex flex-col items-center justify-center h-full text-center py-12"><MessageSquare className="h-12 w-12 text-muted-foreground mb-4" /><p className="text-muted-foreground">No messages yet</p></div>) : (<div className="space-y-4">{contract.discussion.map((m) => (<div key={m.message_id} className="flex gap-3"><Avatar className="h-10 w-10"><AvatarFallback>{getInitials(m.sender_party_name || m.sender_email)}</AvatarFallback></Avatar><div className="flex-1"><div className="bg-slate-50 rounded-lg p-3"><div className="flex items-center justify-between mb-1"><p className="font-medium text-sm">{m.sender_party_name || m.sender_email}</p><span className="text-xs text-muted-foreground">{formatDateTime(m.timestamp)}</span></div><p className="text-sm">{m.message}</p></div></div></div>))}</div>)}
                        </ScrollArea>
                      </CardContent>

                      {canAddDiscussion && (<CardFooter><div className="w-full space-y-2"><Textarea placeholder="Write a message…" value={discussionMessage} onChange={(e) => setDiscussionMessage(e.target.value)} rows={3} /><div className="flex justify-end"><Button onClick={handleSendDiscussion} disabled={submitting || !discussionMessage.trim()}><Send className="h-4 w-4 mr-2" />{submitting ? 'Sending…' : 'Send'}</Button></div></div></CardFooter>)}
                    </Card>
                  </TabsContent>

                  <TabsContent value="timeline">
                    <Card>
                      <CardHeader><CardTitle>Timeline</CardTitle><CardDescription className="text-sm">Activity log & events</CardDescription></CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[420px] pr-4">
                          <div className="space-y-6">
                            {contract.timeline.map((ev, idx) => (
                              <div key={idx} className="flex gap-4">
                                <div className="flex flex-col items-center">
                                  <div className="rounded-full bg-primary/10 p-2"><Clock className="h-4 w-4 text-primary" /></div>
                                  {idx < contract.timeline.length - 1 && <div className="w-px h-full bg-border mt-2" />}
                                </div>
                                <div className="flex-1"><p className="font-medium">{ev.event_title}</p><p className="text-xs text-muted-foreground">{formatDateTime(ev.event_date)}</p><p className="text-sm mt-2">{ev.description}</p></div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="signed_copies">
                    <Card>
                      <CardHeader><CardTitle>Signed Copies</CardTitle><CardDescription className="text-sm">Download signed copies of the contract from each party</CardDescription></CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[420px] pr-4">
                          {(!contract.signed_copies || contract.signed_copies.length === 0) ? (
                            <div className="flex flex-col items-center justify-center h-full text-center py-12">
                              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                              <p className="text-muted-foreground">No signed copies available yet</p>
                              <p className="text-sm text-muted-foreground mt-2">Signed copies will appear here once parties sign the contract</p>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {contract.signed_copies.map((copy, idx) => (
                                <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border">
                                  <div className="flex items-center gap-4">
                                    <div className="rounded-full bg-primary/10 p-3">
                                      <FileText className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                      <p className="font-medium">{copy.party_name || copy.party_email}</p>
                                      <p className="text-xs text-muted-foreground">{copy.party_role || 'N/A'} • {copy.party_side || 'N/A'}</p>
                                      <p className="text-xs text-muted-foreground mt-1">Signed: {formatDateTime(copy.signed_at)}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <a
                                      href={copy.signed_copy_url}
                                      download={copy.attachment_name || `signed_contract_${idx + 1}.pdf`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors text-sm font-medium"
                                    >
                                      <Download className="h-4 w-4" />
                                      Download
                                    </a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="container mx-auto px-4 max-w-7xl py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              © 2025 eBadgeID. All rights reserved.
            </div>
            <div className="flex items-center gap-4">
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <Linkedin className="h-4 w-4" />
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <Twitter className="h-4 w-4" />
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <Github className="h-4 w-4" />
              </a>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">Digital Contract Policy</a>
              <span className="text-muted-foreground">•</span>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">Privacy Policy</a>
              <span className="text-muted-foreground">•</span>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">Cookie Policy</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
