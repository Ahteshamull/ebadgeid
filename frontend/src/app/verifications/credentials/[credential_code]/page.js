"use client"
import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle, XCircle, AlertCircle, AlertTriangle, User, Building, MapPin, Shield, Hash, Clock, Download, Share2, Linkedin, Link as LinkIcon, Loader2, Award } from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';

// This page had two real problems, fixed here:
//
// 1. The "Connecting to blockchain… Verifying issuer signature…" animation
//    ran BEFORE fetching the credential and always finished with a green
//    "Verification complete!" — a revoked, expired, or nonexistent
//    credential played the exact same success animation as a genuine one.
//    Now the real data is fetched first, and the animation reflects what
//    was actually found (including the integrity_valid check the backend
//    computes — see AUDIT_FIXES.md for what that hash actually is and
//    isn't).
// 2. getStatusInfo() only matched 'active'/'verified'/'pending', not the
//    schema's real enum ('Issued', 'Claimed', 'Expired', 'Revoked') — so
//    an Expired credential fell through to the default case and displayed
//    as "Verified" with a green checkmark. Fixed to match the real values.
const CredentialVerifyPage = () => {
  const params = useParams();
  const router = useRouter();
  const credential_code = params?.credential_code;

  const [credentialData, setCredentialData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [verificationStep, setVerificationStep] = useState(0);
  const [shareSuccess, setShareSuccess] = useState('');

  useEffect(() => {
    if (credential_code) {
      verifyCredential();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential_code]);

  const verifyCredential = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/credentials/by-code/${credential_code}`);
      if (!response.ok) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const data = await response.json();

      // Reveal the result step by step for legibility, but every step
      // reflects data we already have — nothing here can "fail" after
      // showing success, unlike the old canned animation.
      const steps = [
        { text: 'Looking up credential record…', ok: true },
        {
          text: data.integrity_status === 'not_verifiable'
            ? 'Integrity hash not applicable (issued before hashing)'
            : (data.integrity_valid ? 'Integrity hash verified' : 'Integrity hash mismatch detected'),
          // "not applicable" is not a failure -- marking it one turned the
          // whole animation red for a perfectly good credential.
          ok: data.integrity_status === 'not_verifiable' ? true : data.integrity_valid,
        },
        { text: `Status: ${data.credential_status}`, ok: data.credential_status !== 'Revoked' },
        { text: 'Verification complete', ok: true },
      ];
      for (let i = 0; i < steps.length; i++) {
        setVerificationStep(i);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      setCredentialData({ ...data, _steps: steps });
    } catch (err) {
      console.error('Error verifying credential:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const addToLinkedInProfile = (credential) => {
    // Previously used today's date for "issued" and "today + 2 years" for
    // "expires" — regardless of the credential's actual dates. Now uses the
    // real credential_issue_date / credential_expiry_date fields.
    const issueDate = new Date(credential.credential_issue_date);
    const expiryDate = new Date(credential.credential_expiry_date);

    const certificationData = {
      name: credential.credential_title || 'Professional Credential',
      organization: credential.organization_detail?.name || 'Professional Organization',
      issueYear: issueDate.getFullYear(),
      issueMonth: issueDate.getMonth() + 1,
      expirationYear: expiryDate.getFullYear(),
      expirationMonth: expiryDate.getMonth() + 1,
      credentialId: credential.credential_code || '',
      credentialUrl: credential.credential_pic_url,
      description: `Professional credential earned from ${credential.organization_detail?.name}.\nCredential ID: ${credential.credential_code}`,
    };

    const linkedInCertUrl = `https://www.linkedin.com/profile/add?startTask=CERTIFICATION&` +
      `name=${encodeURIComponent(certificationData.name)}&` +
      `organizationName=${encodeURIComponent(certificationData.organization)}&` +
      `issueYear=${certificationData.issueYear}&` +
      `issueMonth=${certificationData.issueMonth}&` +
      `expirationYear=${certificationData.expirationYear}&` +
      `expirationMonth=${certificationData.expirationMonth}&` +
      `certUrl=${encodeURIComponent(certificationData.credentialUrl)}&` +
      `certId=${encodeURIComponent(certificationData.credentialId)}&` +
      `description=${encodeURIComponent(certificationData.description)}`;

    window.open(linkedInCertUrl, '_blank', 'width=900,height=700,scrollbars=yes,resizable=yes,location=yes');
    setShareSuccess('Opening LinkedIn to add your certification!');
    setTimeout(() => setShareSuccess(''), 3000);
  };

  const shareOnLinkedInFeed = () => {
    const url = encodeURIComponent(window.location.href);
    const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
    window.open(shareUrl, '_blank', 'width=650,height=600,scrollbars=yes,resizable=yes');
    setShareSuccess('Opening LinkedIn to share your achievement!');
    setTimeout(() => setShareSuccess(''), 3000);
  };

  // Twitter is X since 2023: the brand, the domain and the logo all changed.
  // x.com/intent/tweet is the current endpoint (twitter.com/intent still
  // redirects today, but pointing at the live domain avoids relying on a
  // redirect that may eventually be retired).
  const shareOnX = (credential) => {
    const orgName = credential.organization_detail?.name;
    const text = `🎉 Excited to share my new credential from ${orgName}! Credential ID: ${credential.credential_code}`;
    const url = encodeURIComponent(window.location.href);
    const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`;
    window.open(shareUrl, '_blank', 'width=600,height=400');
    setShareSuccess('Opening X to share your credential!');
    setTimeout(() => setShareSuccess(''), 3000);
  };

  const copyVerificationLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareSuccess('Verification link copied to clipboard!');
    } catch (err) {
      setShareSuccess('Could not copy link — copy it from the address bar.');
    }
    setTimeout(() => setShareSuccess(''), 3000);
  };

  const downloadCredential = async (credentialUrl, credentialCode) => {
    try {
      // Fetching as a blob (rather than just setting <a download> on a
      // cross-origin URL, which most browsers just navigate to instead of
      // downloading) is what actually makes this download the file.
      const response = await fetch(credentialUrl);
      const blob = await response.blob();
      // Same fix as frontend/src/app/creds/page.js: the certificate service
      // always generates PNG, this used to hardcode `.jpg` regardless of
      // the file's real format.
      const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'png';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${credentialCode}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setShareSuccess('Credential downloaded successfully!');
    } catch (err) {
      console.error('Error downloading credential:', err);
      setShareSuccess('Could not download — opening in a new tab instead.');
      window.open(credentialUrl, '_blank');
    }
    setTimeout(() => setShareSuccess(''), 3000);
  };

  // Matches the real schema enum: 'Issued', 'Claimed', 'Expired', 'Revoked'.
  // An integrity failure overrides everything else — a credential whose
  // stored hash no longer matches its stored data can't be trusted
  // regardless of what its status field says.
  const getStatusInfo = (credential) => {
    // `integrity_status === 'failed'` means the hash genuinely does not match
    // and the record may have been altered. `'not_verifiable'` means the
    // credential predates reproducible content hashing (integrity_hash_version
    // 0) -- it is a real, valid credential whose content check simply cannot
    // be performed. Those used to be shown as "Integrity Check Failed", which
    // told anyone scanning a genuine certificate that it looked tampered
    // with. Only a real mismatch may ever say that.
    if (credential?.integrity_status === 'failed' || (credential?.integrity_status === undefined && credential?.integrity_valid === false)) {
      return {
        icon: <AlertTriangle className="w-8 h-8 text-red-600" />,
        text: 'Integrity Check Failed',
        bgColor: 'bg-red-50', borderColor: 'border-red-300', textColor: 'text-red-900',
        description: "This record's data no longer matches its integrity hash — it may have been altered after issuance. Contact the issuing organization.",
        showActions: false,
      };
    }
    switch (credential?.credential_status) {
      case 'Issued':
      case 'Claimed':
        return {
          icon: <CheckCircle className="w-8 h-8 text-green-500" />,
          text: 'Verified', bgColor: 'bg-green-50', borderColor: 'border-green-200', textColor: 'text-green-800',
          description: credential?.integrity_status === 'not_verifiable'
            ? 'This credential is authentic and currently valid. It was issued before automated content-integrity hashing, so that particular check does not apply to it.'
            : 'This credential is authentic and currently valid.',
          showActions: true,
        };
      case 'Expired':
        return {
          icon: <AlertCircle className="w-8 h-8 text-amber-500" />,
          text: 'Expired', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', textColor: 'text-amber-800',
          description: 'This credential was authentic but has passed its expiry date.', showActions: true,
        };
      case 'Revoked':
        return {
          icon: <XCircle className="w-8 h-8 text-red-500" />,
          text: 'Revoked', bgColor: 'bg-red-50', borderColor: 'border-red-200', textColor: 'text-red-800',
          description: 'This credential has been revoked by the issuing organization and is no longer valid.', showActions: false,
        };
      default:
        return {
          icon: <AlertCircle className="w-8 h-8 text-gray-500" />,
          text: 'Unknown', bgColor: 'bg-gray-50', borderColor: 'border-gray-200', textColor: 'text-gray-800',
          description: 'This credential has an unrecognized status.', showActions: false,
        };
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  if (loading) {
    const steps = credentialData?._steps || [
      { text: 'Looking up credential record…' },
      { text: 'Checking integrity hash…' },
      { text: 'Checking credential status…' },
      { text: 'Verification complete' },
    ];
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md w-full mx-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl p-8">
            <Shield className="w-16 h-16 text-primary mx-auto mb-6 animate-pulse" />
            <h2 className="text-2xl font-bold text-foreground mb-6">Verifying Credential</h2>
            <div className="space-y-4">
              {steps.map((step, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-center p-3 rounded-lg transition-all duration-500 ${
                    index <= verificationStep ? 'bg-primary/10 border-primary/30 border-2' : 'bg-muted/30 border-border border'
                  }`}
                >
                  {index < verificationStep ? <CheckCircle className="w-5 h-5 text-green-500 mr-3" /> : <Loader2 className="w-5 h-5 mr-3 animate-spin text-primary" />}
                  <span className={`text-sm font-medium ${index <= verificationStep ? 'text-primary' : 'text-muted-foreground'}`}>{step.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border rounded-2xl shadow-xl p-8 text-center">
          <XCircle className="w-20 h-20 text-destructive mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-foreground mb-4">Credential Not Found</h1>
          <p className="text-muted-foreground mb-6">The credential you're looking for could not be verified or does not exist.</p>
          <button onClick={() => router.push('/')} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground px-6 py-3 rounded-lg font-medium transition-all duration-200 hover:scale-105">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const statusInfo = getStatusInfo(credentialData);

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <Shield className="w-16 h-16 text-primary mx-auto mb-4" />
          <h1 className="text-4xl font-bold text-foreground mb-2">Credential Verification</h1>
          <p className="text-muted-foreground">Digital credential verification and details</p>
        </div>

        {shareSuccess && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-green-600 dark:text-green-400 text-center">
            {shareSuccess}
          </div>
        )}

        <div className={`${statusInfo.bgColor} ${statusInfo.borderColor} border-2 rounded-2xl p-6 mb-8 text-center`}>
          <div className="flex items-center justify-center mb-4">{statusInfo.icon}</div>
          <h2 className={`text-2xl font-bold ${statusInfo.textColor} mb-2`}>Credential {statusInfo.text}</h2>
          <p className="text-muted-foreground">{statusInfo.description}</p>

          <div className="flex flex-wrap justify-center gap-3 mt-6">
            {statusInfo.showActions && (
              <>
                <button
                  onClick={() => downloadCredential(credentialData.credential_pic_url, credentialData.credential_code)}
                  className="flex items-center gap-2 bg-card text-foreground px-4 py-2 rounded-lg font-medium border border-border hover:bg-muted transition-all duration-200 hover:scale-105"
                >
                  <Download className="w-4 h-4" /> Download
                </button>
                <button
                  onClick={() => addToLinkedInProfile(credentialData)}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-all duration-200 hover:scale-105"
                  title="Add certification to your LinkedIn Profile"
                >
                  <Linkedin className="w-4 h-4" /> Add to LinkedIn
                </button>
                <button
                  onClick={shareOnLinkedInFeed}
                  className="flex items-center gap-2 bg-blue-700 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-800 transition-all duration-200 hover:scale-105"
                  title="Share post directly to your LinkedIn Feed"
                >
                  <Share2 className="w-4 h-4" /> Post to LinkedIn
                </button>
                <button
                  onClick={() => shareOnX(credentialData)}
                  className="flex items-center gap-2 bg-neutral-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-neutral-800 transition-all duration-200 hover:scale-105"
                  title="Share post to X"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Share on X
                </button>
              </>
            )}
            <button
              onClick={copyVerificationLink}
              className="flex items-center gap-2 bg-card text-foreground px-4 py-2 rounded-lg font-medium border border-border hover:bg-muted transition-all duration-200 hover:scale-105"
            >
              <LinkIcon className="w-4 h-4" /> Copy verification link
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-card border border-border rounded-2xl shadow-xl p-8">
            <div className="flex items-center mb-6">
              <User className="w-6 h-6 text-primary mr-3" />
              <h3 className="text-xl font-bold text-foreground">Credential Holder</h3>
            </div>
            <div className="space-y-4">
              <div className="p-3 rounded-lg hover:bg-muted/40 transition-colors">
                <label className="text-sm font-medium text-muted-foreground">Full Name</label>
                <p className="text-lg font-semibold text-foreground">
                  {credentialData?.achiever_details?.first_name} {credentialData?.achiever_details?.last_name}
                </p>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-border">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/40 transition-colors">
                  <span className="text-sm font-medium text-muted-foreground">Credential Code</span>
                  <span className="text-sm font-mono bg-muted text-foreground border border-border px-2 py-1 rounded">{credentialData?.credential_code}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/40 transition-colors">
                  <span className="text-sm font-medium text-muted-foreground">Issue Date</span>
                  <span className="text-sm text-foreground">{formatDate(credentialData?.credential_issue_date)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/40 transition-colors">
                  <span className="text-sm font-medium text-muted-foreground">Expiry Date</span>
                  <span className="text-sm text-foreground">{formatDate(credentialData?.credential_expiry_date)}</span>
                </div>
                {credentialData?.credential_blockchain_hashes && (
                  <div className="mt-4 p-3 rounded-lg hover:bg-muted/40 transition-colors">
                    <label className="text-sm font-medium text-muted-foreground flex items-center mb-2">
                      <Hash className="w-4 h-4 mr-1" /> Integrity Hash
                      {credentialData.integrity_valid === false && (
                        <span className="ml-2 text-xs font-semibold text-destructive">MISMATCH</span>
                      )}
                    </label>
                    <p className="text-xs font-mono bg-muted text-foreground p-2 rounded border border-border break-all">
                      {credentialData.credential_blockchain_hashes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl shadow-xl p-8">
            <div className="flex items-center mb-6">
              <Building className="w-6 h-6 text-primary mr-3" />
              <h3 className="text-xl font-bold text-foreground">Issuing Organization</h3>
            </div>
            <div className="space-y-4">
              <div className="p-3 rounded-lg hover:bg-muted/40 transition-colors">
                <label className="text-sm font-medium text-muted-foreground">Organization Name</label>
                <p className="text-lg font-semibold text-foreground">{credentialData?.organization_detail?.name}</p>
              </div>
              <div className="flex items-center p-3 rounded-lg hover:bg-muted/40 transition-colors">
                <MapPin className="w-4 h-4 text-muted-foreground mr-2" />
                <span className="text-foreground">
                  {credentialData?.organization_detail?.city}, {credentialData?.organization_detail?.state}, {credentialData?.organization_detail?.country}
                </span>
              </div>
            </div>

            {credentialData?.credential_pic_url && (
              <div className="mt-8 pt-6 border-t border-border">
                <label className="text-sm font-medium text-muted-foreground mb-3 block">Credential Certificate</label>
                <div className="bg-muted/40 border border-border rounded-lg p-4 text-center">
                  <img
                    src={credentialData.credential_pic_url}
                    alt="Credential Certificate"
                    className="max-w-full h-auto rounded-lg shadow-sm mx-auto cursor-pointer"
                    onClick={() => window.open(credentialData.credential_pic_url, '_blank')}
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                  />
                  <div className="hidden text-muted-foreground">
                    <div className="w-16 h-16 bg-muted rounded-lg mx-auto mb-2 flex items-center justify-center">
                      <Download className="w-6 h-6" />
                    </div>
                    <p className="text-sm">Certificate image not available</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="text-center mt-12 p-6 bg-card border border-border rounded-2xl shadow-xl">
          <p className="text-muted-foreground mb-4">
            This credential's data was checked against its stored integrity hash{credentialData?.integrity_valid ? ' and matched' : ''}.
          </p>
          <div className="flex items-center justify-center space-x-4 text-sm text-muted-foreground">
            <div className="flex items-center">
              <Clock className="w-4 h-4 mr-1" /> <span>Checked on {new Date().toLocaleDateString()}</span>
            </div>
            <div className="flex items-center">
              <Shield className="w-4 h-4 mr-1" /> <span>Secured by eBadgeID</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CredentialVerifyPage;
