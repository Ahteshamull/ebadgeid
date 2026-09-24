// backend (updated)/templates/credentialEmailTemplate.js
//
// Complies with User Rule: "For any email sent, ALWAYS create a separate template file to store the HTML structure instead of writing inline HTML in the service or controller."

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Generates an executive, responsive HTML email for issued credentials
 * Includes:
 * - Direct verification link
 * - Embedded high-res scannable QR Code
 * - Cryptographic Content-Integrity Hash (SHA-256)
 * - Credential preview card and issuer details
 */
function generateCredentialEmail({
  userDetails = {},
  organizationDetails = {},
  credentialCode = '',
  credentialTitle = '',
  issueDate = '',
  expiryDate = '',
  credentialPicUrl = '',
  contentHash = '',
  qrCodeDataUrl = '',
  verifyUrl = '',
}) {
  const safeRecipientName = escapeHtml(`${userDetails.first_name || ''} ${userDetails.last_name || ''}`.trim() || userDetails.username || 'Achiever');
  const safeOrgName = escapeHtml(organizationDetails.name || 'Verified Institution');
  const safeOrgSupportEmail = escapeHtml(organizationDetails.support_email || organizationDetails.email || 'support@ebadgeid.com');
  const safeOrgCity = escapeHtml(organizationDetails.city || '');
  const safeOrgCountry = escapeHtml(organizationDetails.country || '');
  const safeLocation = [safeOrgCity, safeOrgCountry].filter(Boolean).join(', ');
  const safeTitle = escapeHtml(credentialTitle || 'Certificate of Achievement');
  const safeCode = escapeHtml(credentialCode);
  const safeIssueDate = escapeHtml(issueDate || new Date().toISOString().split('T')[0]);
  const safeExpiryDate = escapeHtml(expiryDate || 'No Expiry');
  const safeHash = escapeHtml(contentHash || '');
  const safeVerifyUrl = escapeHtml(verifyUrl);

  const subject = `🎉 Congratulations! Your Verified Digital Credential Has Been Issued [${safeCode}]`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    .container { max-width: 620px; margin: 30px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 36px 30px; text-align: center; color: #ffffff; }
    .header-badge { display: inline-block; background-color: rgba(255, 255, 255, 0.15); backdrop-filter: blur(8px); padding: 6px 14px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; color: #38bdf8; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 700; line-height: 1.3; }
    .content { padding: 36px 32px; color: #334155; line-height: 1.6; font-size: 15px; }
    .recipient-lead { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 14px; }
    .card-preview { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center; }
    .cert-image { max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 1px solid #cbd5e1; margin-bottom: 16px; }
    .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    .details-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    .details-table td.label { font-weight: 600; color: #64748b; width: 38%; }
    .details-table td.val { color: #0f172a; font-weight: 500; }
    .hash-box { background-color: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px 18px; margin: 24px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #334155; word-break: break-all; }
    .hash-title { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 6px; display: flex; align-items: center; }
    .qr-section { text-align: center; padding: 20px 0 10px; }
    .qr-img { border: 2px solid #e2e8f0; border-radius: 12px; padding: 6px; background-color: #ffffff; display: inline-block; }
    .cta-container { text-align: center; margin: 30px 0 20px; }
    .cta-button { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 16px 36px; border-radius: 50px; font-weight: 700; font-size: 16px; text-decoration: none; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4); }
    .share-banner { background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px 18px; text-align: center; margin: 24px 0; font-size: 13px; color: #1e40af; }
    .footer { background-color: #f8fafc; padding: 24px 30px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    .footer a { color: #64748b; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-badge">Verified Credential Issued</div>
      <h1>${safeTitle}</h1>
      <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 14px;">Issued by ${safeOrgName}</p>
    </div>

    <div class="content">
      <div class="recipient-lead">Hello ${safeRecipientName},</div>
      <p>
        Congratulations on your achievement! <strong>${safeOrgName}</strong> has officially issued your verified digital credential. Your credential record has been cryptographically secured and is ready for public verification and sharing.
      </p>

      ${credentialPicUrl ? `
      <div class="card-preview">
        <a href="${safeVerifyUrl}" target="_blank" rel="noopener noreferrer">
          <img src="${escapeHtml(credentialPicUrl)}" alt="${safeTitle}" class="cert-image" />
        </a>
        <div style="font-size: 12px; color: #64748b;">Click above to view full high-resolution document</div>
      </div>
      ` : ''}

      <table class="details-table">
        <tr>
          <td class="label">Credential ID:</td>
          <td class="val"><code style="font-family: monospace; font-size: 13px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${safeCode}</code></td>
        </tr>
        <tr>
          <td class="label">Recipient:</td>
          <td class="val">${safeRecipientName}</td>
        </tr>
        <tr>
          <td class="label">Issuing Organization:</td>
          <td class="val">${safeOrgName}</td>
        </tr>
        ${safeLocation ? `
        <tr>
          <td class="label">Location:</td>
          <td class="val">${safeLocation}</td>
        </tr>` : ''}
        <tr>
          <td class="label">Issue Date:</td>
          <td class="val">${safeIssueDate}</td>
        </tr>
        <tr>
          <td class="label">Expiry Date:</td>
          <td class="val">${safeExpiryDate}</td>
        </tr>
      </table>

      ${safeHash ? `
      <div class="hash-box">
        <div class="hash-title">🛡️ Cryptographic Content Hash (SHA-256 Integrity Verification)</div>
        <div style="color: #475569; font-size: 11px; margin-bottom: 6px;">This unique hash guarantees that your credential has not been altered or tampered with:</div>
        <code>${safeHash}</code>
      </div>
      ` : ''}

      <div class="cta-container">
        <a href="${safeVerifyUrl}" class="cta-button" target="_blank" rel="noopener noreferrer">
          🔍 View & Verify Credential Online →
        </a>
      </div>

      ${qrCodeDataUrl ? `
      <div class="qr-section">
        <div class="qr-img">
          <img src="${qrCodeDataUrl}" alt="Scan to Verify" width="140" height="140" style="display: block;" />
        </div>
        <div style="font-size: 12px; color: #64748b; margin-top: 8px;">Scan with any smartphone camera to verify authenticity</div>
      </div>
      ` : ''}

      <div class="share-banner">
        💼 <strong>Share with your network:</strong> Open your credential page to add it directly to your <strong>LinkedIn Certifications</strong> or share on <strong>X</strong>!
      </div>

      <p style="font-size: 13px; color: #64748b; margin-top: 24px;">
        For inquiries regarding this credential, please contact the issuing organization at <a href="mailto:${safeOrgSupportEmail}" style="color: #2563eb;">${safeOrgSupportEmail}</a>.
      </p>
    </div>

    <div class="footer">
      <p style="margin: 0 0 8px 0;">This is an automated issuance message from eBadgeID on behalf of ${safeOrgName}.</p>
      <p style="margin: 0;">Secured with cryptographic integrity. <a href="${safeVerifyUrl}">Verify record</a></p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Congratulations ${safeRecipientName}!

Your digital credential "${safeTitle}" has been officially issued by ${safeOrgName}.

Credential Details:
- Credential Code: ${safeCode}
- Recipient: ${safeRecipientName}
- Issuing Organization: ${safeOrgName}
- Issue Date: ${safeIssueDate}
- Expiry Date: ${safeExpiryDate}
${safeHash ? `- Cryptographic Hash (SHA-256): ${safeHash}\n` : ''}
Verify online at:
${verifyUrl}

Scan your QR code or click the link above to view, download, or add to your LinkedIn profile.

Best regards,
${safeOrgName} & eBadgeID
  `.trim();

  return { subject, html, text };
}

module.exports = {
  generateCredentialEmail,
};
