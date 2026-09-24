"use client"
import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle, XCircle, AlertCircle, User, Building, MapPin, Mail, Phone, Shield, Hash, Clock, Download, Share2, Twitter, Linkedin, ExternalLink, Loader2, Award } from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';

const CredentialVerifyPage = () => {
  const params = useParams();
  const router = useRouter();
  const credential_code = params?.credential_code;

  const [credentialData, setCredentialData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [verificationStep, setVerificationStep] = useState(0);
  const [showVerificationAnimation, setShowVerificationAnimation] = useState(true);
  const [shareSuccess, setShareSuccess] = useState('');

  // Verification steps for animation
  const verificationSteps = [
    { text: "Connecting to blockchain...", icon: <Loader2 className="w-5 h-5 animate-spin" /> },
    { text: "Validating credential hash...", icon: <Hash className="w-5 h-5" /> },
    { text: "Verifying issuer signature...", icon: <Shield className="w-5 h-5" /> },
    { text: "Checking credential status...", icon: <CheckCircle className="w-5 h-5" /> },
    { text: "Verification complete!", icon: <Award className="w-5 h-5 text-green-500" /> }
  ];

  useEffect(() => {
    if (credential_code) {
      simulateVerification();
    }
  }, [credential_code]);

  const simulateVerification = async () => {
    setShowVerificationAnimation(true);

    // Animate through verification steps
    for (let i = 0; i < verificationSteps.length; i++) {
      setVerificationStep(i);
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // Wait a bit more then fetch actual data
    await new Promise(resolve => setTimeout(resolve, 500));
    setShowVerificationAnimation(false);
    fetchCredentialData();
  };

  const fetchCredentialData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/credentials/by-code/${credential_code}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setCredentialData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addToLinkedInProfile = (credential) => {
    const currentDate = new Date();
    const expiryDate = new Date(currentDate.getFullYear() + 2, currentDate.getMonth(), currentDate.getDate());

    const certificationData = {
      name: credential.credential_code || 'Professional Credential',
      organization: credential.organization_detail?.name || 'Professional Organization',
      issueYear: currentDate.getFullYear(),
      issueMonth: currentDate.getMonth() + 1,
      expirationYear: expiryDate.getFullYear(),
      expirationMonth: expiryDate.getMonth() + 1,
      credentialId: credential.credential_code || "123",
      credentialUrl: `https://app.ebadgeid.com/verifications/credentials/${credential.credential_code}`,
      description: `Professional credential earned from ${credential.organization_detail?.name}. 
This certification validates expertise and commitment to professional excellence.
Credential ID: ${credential.credential_code}
Issued: ${currentDate.toLocaleDateString()}
Expires: ${expiryDate.toLocaleDateString()}`
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

  const shareOnTwitter = (credential) => {
    const userName = `${credential.achiever_details?.first_name} ${credential.achiever_details?.last_name}`;
    const orgName = credential.organization_detail?.name;
    const text = `🎉 Excited to share my new credential from ${orgName}! Credential ID: ${credential.credential_code}`;
    const url = encodeURIComponent(credential.credential_pic_url);
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`;
    window.open(twitterUrl, '_blank', 'width=600,height=400');
    setShareSuccess('Opening Twitter to share your credential!');
    setTimeout(() => setShareSuccess(''), 3000);
  };

  const downloadCredential = async (credentialUrl, credentialCode) => {
    try {
      setShareSuccess('Preparing your download...');

      const response = await fetch(credentialUrl);
      if (!response.ok) throw new Error('Network response was not ok');

      const blobData = await response.blob();
      const url = window.URL.createObjectURL(blobData);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Credential-${credentialCode}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setShareSuccess('Credential downloaded successfully!');
      setTimeout(() => setShareSuccess(''), 3000);
    } catch (err) {
      console.error('Error downloading credential:', err);
      // Fallback to simple link if fetch fails (e.g. CORS)
      const link = document.createElement('a');
      link.href = credentialUrl;
      link.target = '_blank';
      link.download = `${credentialCode}.jpg`;
      link.click();
      setShareSuccess('Opening image in new tab (Download failed)');
      setTimeout(() => setShareSuccess(''), 3000);
    }
  };

  const getStatusInfo = (status) => {
    switch (status?.toLowerCase()) {
      case 'active':
      case 'verified':
        return {
          icon: <CheckCircle className="w-8 h-8 text-green-500" />,
          text: 'Verified',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          textColor: 'text-green-800'
        };
      case 'revoked':
        return {
          icon: <XCircle className="w-8 h-8 text-red-500" />,
          text: 'Revoked',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          textColor: 'text-red-800'
        };
      case 'pending':
        return {
          icon: <AlertCircle className="w-8 h-8 text-yellow-500" />,
          text: 'Pending',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          textColor: 'text-yellow-800'
        };
      default:
        return {
          icon: <CheckCircle className="w-8 h-8 text-green-500" />,
          text: 'Verified',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          textColor: 'text-green-800'
        };
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    return new Date(parseInt(timestamp)).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const extractTimestamp = (credentialCode) => {
    const match = credentialCode?.match(/CRD-(\d+)/);
    return match ? match[1] : Date.now().toString();
  };

  // Loading state with verification animation
  if (loading || showVerificationAnimation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl p-8 animate-fade-in">
            <img
              src="/logo.webp"
              alt="Credential Verification Logo"
              className="w-16 h-16 mx-auto mb-6 animate-pulse"
            />
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Verifying Credential</h2>

            <div className="space-y-4">
              {verificationSteps.map((step, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-center p-3 rounded-lg transition-all duration-500 ${index <= verificationStep
                    ? 'bg-indigo-50 border-indigo-200 border-2'
                    : 'bg-gray-50 border-gray-200 border'
                    }`}
                >
                  <div className={`mr-3 transition-all duration-300 ${index <= verificationStep ? 'text-indigo-600' : 'text-gray-400'
                    }`}>
                    {step.icon}
                  </div>
                  <span className={`text-sm font-medium transition-all duration-300 ${index <= verificationStep ? 'text-indigo-800' : 'text-gray-500'
                    }`}>
                    {step.text}
                  </span>
                  {index < verificationStep && (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-auto animate-scale-in" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-pink-50 to-red-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center animate-slide-up">
          <XCircle className="w-20 h-20 text-red-500 mx-auto mb-6 animate-bounce" />
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Credential Not Found</h1>
          <p className="text-gray-600 mb-6">The credential you&apos;re looking for could not be verified or does not exist.</p>
          <button
            onClick={() => router.push('/')}
            className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 hover:scale-105"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const statusInfo = getStatusInfo(credentialData?.credential_status);
  const issuedDate = extractTimestamp(credentialData?.credential_code);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 py-8 px-4">
      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.5); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .animate-fade-in { animation: fade-in 0.6s ease-out; }
        .animate-slide-up { animation: slide-up 0.8s ease-out; }
        .animate-scale-in { animation: scale-in 0.3s ease-out; }
        .animate-float { animation: float 3s ease-in-out infinite; }
      `}</style>

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in">
          <img
            src="/logo.webp"
            alt="Credential Verification Logo"
            className="w-16 h-16 mx-auto mb-4 animate-float"
          />
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Credential Verification</h1>
          <p className="text-gray-600">Digital credential verification and details</p>
        </div>

        {/* Success Message */}
        {shareSuccess && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-center animate-slide-up">
            {shareSuccess}
          </div>
        )}

        {/* Status Card */}
        <div className={`${statusInfo.bgColor} ${statusInfo.borderColor} border-2 rounded-2xl p-6 mb-8 text-center animate-scale-in`}>
          <div className="flex items-center justify-center mb-4 transform hover:scale-110 transition-transform duration-200">
            {statusInfo.icon}
          </div>
          <h2 className={`text-2xl font-bold ${statusInfo.textColor} mb-2`}>
            Credential {statusInfo.text}
          </h2>
          <p className="text-gray-600">
            This credential has been {statusInfo.text.toLowerCase()} and is {statusInfo.text === 'Verified' ? 'authentic' : 'no longer valid'}
          </p>

          {/* Action Buttons for Verified Credentials */}
          {statusInfo.text === 'Verified' && (
            <div className="flex flex-wrap justify-center gap-3 mt-6">
              <button
                onClick={() => downloadCredential(credentialData.credential_pic_url, credentialData.credential_code)}
                className="flex items-center gap-2 bg-white text-indigo-600 px-4 py-2 rounded-lg font-medium border border-indigo-200 hover:bg-indigo-50 transition-all duration-200 hover:scale-105"
              >
                <Download className="w-4 h-4" />
                Download
              </button>

              <button
                onClick={() => addToLinkedInProfile(credentialData)}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-all duration-200 hover:scale-105"
              >
                <Linkedin className="w-4 h-4" />
                Add to LinkedIn
              </button>

              <button
                onClick={() => shareOnTwitter(credentialData)}
                className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-lg font-medium hover:bg-neutral-800 transition-all duration-200 hover:scale-105"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Share on X
              </button>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Credential Details */}
          <div className="bg-white rounded-2xl shadow-xl p-8 animate-slide-up hover:shadow-2xl transition-shadow duration-300">
            <div className="flex items-center mb-6">
              <User className="w-6 h-6 text-indigo-600 mr-3" />
              <h3 className="text-xl font-bold text-gray-900">Credential Holder</h3>
            </div>

            <div className="space-y-4">
              <div className="transform hover:scale-105 transition-transform duration-200 p-3 rounded-lg hover:bg-gray-50">
                <label className="text-sm font-medium text-gray-500">Full Name</label>
                <p className="text-lg font-semibold text-gray-900">
                  {credentialData?.achiever_details?.first_name} {credentialData?.achiever_details?.last_name}
                </p>
              </div>

              <div className="transform hover:scale-105 transition-transform duration-200 p-3 rounded-lg hover:bg-gray-50">
                <label className="text-sm font-medium text-gray-500">Designation</label>
                <p className="text-lg text-gray-700">{credentialData?.achiever_details?.designation}</p>
              </div>

              <div className="flex items-center transform hover:scale-105 transition-transform duration-200 p-3 rounded-lg hover:bg-gray-50">
                <MapPin className="w-4 h-4 text-gray-400 mr-2" />
                <span className="text-gray-700">{credentialData?.achiever_details?.city}</span>
              </div>
            </div>

            {/* Credential Info */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors duration-200">
                  <span className="text-sm font-medium text-gray-500">Credential Code</span>
                  <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded hover:bg-gray-200 transition-colors duration-200">
                    {credentialData?.credential_code}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors duration-200">
                  <span className="text-sm font-medium text-gray-500">Issue Date</span>
                  <span className="text-sm text-gray-700">
                    {formatDate(issuedDate)}
                  </span>
                </div>

                {credentialData?.credential_blockchain_hashes && (
                  <div className="mt-4 p-3 rounded-lg hover:bg-gray-50 transition-colors duration-200">
                    <label className="text-sm font-medium text-gray-500 flex items-center mb-2">
                      <Hash className="w-4 h-4 mr-1" />
                      Blockchain Hash
                    </label>
                    <p className="text-xs font-mono bg-gray-50 p-2 rounded border break-all hover:bg-gray-100 transition-colors duration-200">
                      {credentialData.credential_blockchain_hashes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Organization Details */}
          <div className="bg-white rounded-2xl shadow-xl p-8 animate-slide-up hover:shadow-2xl transition-shadow duration-300" style={{ animationDelay: '0.2s' }}>
            <div className="flex items-center mb-6">
              <Building className="w-6 h-6 text-indigo-600 mr-3" />
              <h3 className="text-xl font-bold text-gray-900">Issuing Organization</h3>
            </div>

            <div className="space-y-4">
              <div className="transform hover:scale-105 transition-transform duration-200 p-3 rounded-lg hover:bg-gray-50">
                <label className="text-sm font-medium text-gray-500">Organization Name</label>
                <p className="text-lg font-semibold text-gray-900">
                  {credentialData?.organization_detail?.name}
                </p>
              </div>

              <div className="flex items-center transform hover:scale-105 transition-transform duration-200 p-3 rounded-lg hover:bg-gray-50">
                <MapPin className="w-4 h-4 text-gray-400 mr-2" />
                <span className="text-gray-700">
                  {credentialData?.organization_detail?.city}, {credentialData?.organization_detail?.state}, {credentialData?.organization_detail?.country}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center transform hover:scale-105 transition-transform duration-200 p-3 rounded-lg hover:bg-gray-50">
                  <Mail className="w-4 h-4 text-gray-400 mr-2" />
                  <a
                    href={`mailto:${credentialData?.organization_detail?.support_email}`}
                    className="text-indigo-600 hover:text-indigo-800 transition-colors duration-200"
                  >
                    {credentialData?.organization_detail?.support_email}
                  </a>
                </div>

                <div className="flex items-center transform hover:scale-105 transition-transform duration-200 p-3 rounded-lg hover:bg-gray-50">
                  <Phone className="w-4 h-4 text-gray-400 mr-2" />
                  <a
                    href={`tel:${credentialData?.organization_detail?.support_phone}`}
                    className="text-indigo-600 hover:text-indigo-800 transition-colors duration-200"
                  >
                    {credentialData?.organization_detail?.support_phone}
                  </a>
                </div>
              </div>
            </div>

            {/* Credential Image */}
            {credentialData?.credential_pic_url && (
              <div className="mt-8 pt-6 border-t border-gray-200">
                <label className="text-sm font-medium text-gray-500 mb-3 block">Credential Certificate</label>
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <img
                    src={credentialData.credential_pic_url}
                    alt="Credential Certificate"
                    className="max-w-full h-auto rounded-lg shadow-sm mx-auto transform hover:scale-105 transition-transform duration-300 cursor-pointer"
                    onClick={() => window.open(credentialData.credential_pic_url, '_blank')}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'block';
                    }}
                  />
                  <div className="hidden text-gray-500">
                    <div className="w-16 h-16 bg-gray-200 rounded-lg mx-auto mb-2 flex items-center justify-center">
                      <Download className="w-6 h-6" />
                    </div>
                    <p className="text-sm">Certificate image not available</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-12 p-6 bg-white rounded-2xl shadow-xl animate-fade-in">
          <p className="text-gray-600 mb-4">
            This credential has been digitally verified and authenticated using blockchain technology.
          </p>
          <div className="flex items-center justify-center space-x-4 text-sm text-gray-500">
            <div className="flex items-center transform hover:scale-105 transition-transform duration-200">
              <Clock className="w-4 h-4 mr-1" />
              <span>Verified on {new Date().toLocaleDateString()}</span>
            </div>
            <div className="flex items-center transform hover:scale-105 transition-transform duration-200">
              <Shield className="w-4 h-4 mr-1" />
              <span>Secured by eBadge ID | A platform by Tara Solutions</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CredentialVerifyPage;