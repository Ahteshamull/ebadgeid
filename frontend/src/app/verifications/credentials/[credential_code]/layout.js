import { API_BASE_URL } from '@/lib/api';

/**
 * Server-side metadata generator for dynamic OpenGraph & Twitter Cards
 * Ensures that when users share credential links on LinkedIn, X, Facebook,
 * or messaging apps, an interactive preview with credential thumbnail,
 * title, and verified issuer appears.
 */
export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const credentialCode = resolvedParams?.credential_code;

  if (!credentialCode) {
    return {
      title: 'Verify Credential | eBadgeID',
      description: 'Verify digital certificates and badges cryptographically on eBadgeID.',
    };
  }

  try {
    const res = await fetch(`${API_BASE_URL}/credentials/by-code/${encodeURIComponent(credentialCode)}`, {
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return {
        title: `Credential Verification [${credentialCode}] | eBadgeID`,
        description: 'Verify the authenticity and integrity of this digital credential.',
      };
    }

    const data = await res.json();
    const recipientName = `${data.achiever_details?.first_name || ''} ${data.achiever_details?.last_name || ''}`.trim() || 'Achiever';
    const orgName = data.organization_detail?.name || 'Verified Institution';
    const title = data.credential_title || 'Certified Digital Credential';
    const pageTitle = `${title} - ${recipientName} | eBadgeID Verified`;
    const description = `Authentic digital credential issued by ${orgName} to ${recipientName}. Cryptographic Content Hash & QR Code verified. Credential ID: ${credentialCode}`;
    const imageUrl = data.credential_pic_url || 'https://ebadgeid.com/og-default.png';

    return {
      title: pageTitle,
      description,
      openGraph: {
        title: pageTitle,
        description,
        url: `https://ebadgeid.com/verifications/credentials/${credentialCode}`,
        siteName: 'eBadgeID Credential Network',
        images: [
          {
            url: imageUrl,
            width: 1200,
            height: 630,
            alt: `${title} issued to ${recipientName}`,
          },
        ],
        type: 'article',
      },
      twitter: {
        card: 'summary_large_image',
        title: pageTitle,
        description,
        images: [imageUrl],
      },
    };
  } catch (err) {
    console.error('Failed to generate credential metadata:', err);
    return {
      title: `Credential Verification [${credentialCode}] | eBadgeID`,
      description: 'Verify the authenticity and integrity of this digital credential on eBadgeID.',
    };
  }
}

export default function CredentialVerificationLayout({ children }) {
  return <>{children}</>;
}
