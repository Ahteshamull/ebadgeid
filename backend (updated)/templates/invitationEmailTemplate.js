// backend (updated)/templates/invitationEmailTemplate.js
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
 * Generates an executive, responsive HTML email for team member invitations.
 * 
 * @param {Object} params
 * @param {string} params.recipientEmail - The recipient's email address
 * @param {string} params.designation - The job role/designation
 * @param {string} params.invitationCode - The encrypted unique invitation code
 * @param {string} params.appBaseUrl - Base frontend URL for self-signup
 * @param {string} [params.organizationName] - Name of the inviting organization
 * @returns {{ subject: string, html: string, text: string }}
 */
function generateInvitationEmailTemplate({
  recipientEmail = '',
  designation = 'Team Member',
  invitationCode = '',
  appBaseUrl = 'https://app.ebadgeid.com',
  organizationName = 'eBadgeID Verified Organization',
}) {
  const safeJobTitle = escapeHtml(designation || 'Team Member');
  const safeOrgName = escapeHtml(organizationName || 'eBadgeID Verified Organization');
  const safeRecipientEmail = escapeHtml(recipientEmail);
  const cleanBaseUrl = String(appBaseUrl || 'https://app.ebadgeid.com').replace(/\/$/, '');
  const verificationLink = `${cleanBaseUrl}/auth/self_signup/${encodeURIComponent(invitationCode)}`;

  const subject = `🎉 Welcome aboard! You're invited to join ${safeOrgName} as ${safeJobTitle}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to Join ${safeOrgName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #1e293b;
      background-color: #f8fafc;
      padding: 24px 12px;
    }
    .email-wrapper {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04);
      border: 1px solid #e2e8f0;
    }
    .header-banner {
      background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
      padding: 40px 32px;
      text-align: center;
      color: #ffffff;
    }
    .header-badge {
      display: inline-block;
      padding: 6px 14px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .header-banner h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    .header-banner p {
      font-size: 15px;
      color: rgba(255, 255, 255, 0.9);
    }
    .content-body {
      padding: 36px 32px;
    }
    .welcome-text {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 16px;
    }
    .description {
      font-size: 15px;
      color: #475569;
      line-height: 1.7;
      margin-bottom: 24px;
    }
    .role-card {
      background: #f1f5f9;
      border-left: 4px solid #2563eb;
      border-radius: 0 12px 12px 0;
      padding: 16px 20px;
      margin-bottom: 28px;
    }
    .role-label {
      font-size: 12px;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 600;
      letter-spacing: 0.05em;
    }
    .role-title {
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
      margin-top: 2px;
    }
    .cta-container {
      text-align: center;
      margin: 32px 0;
    }
    .cta-button {
      display: inline-block;
      background: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      padding: 16px 36px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 16px;
      box-shadow: 0 4px 14px 0 rgba(37, 99, 235, 0.39);
    }
    .cta-button:hover {
      background: #1d4ed8;
    }
    .expiry-alert {
      background: #fffbeb;
      border: 1px solid #fef3c7;
      border-radius: 10px;
      padding: 14px 18px;
      font-size: 13px;
      color: #92400e;
      margin-top: 24px;
      display: flex;
      align-items: center;
    }
    .footer {
      background: #f8fafc;
      padding: 24px 32px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 13px;
      color: #94a3b8;
    }
    .footer-org {
      font-weight: 600;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header-banner">
      <div class="header-badge">Team Invitation</div>
      <h1>🎉 You're Invited!</h1>
      <p>Join ${safeOrgName} on eBadgeID</p>
    </div>

    <div class="content-body">
      <div class="welcome-text">Hello 👋</div>
      <p class="description">
        You have been invited to join <strong>${safeOrgName}</strong> as a team member.
        Please click the button below to accept your invitation, complete your profile, and start issuing & managing credentials.
      </p>

      <div class="role-card">
        <div class="role-label">Assigned Role / Designation</div>
        <div class="role-title">${safeJobTitle}</div>
      </div>

      <div class="cta-container">
        <a href="${verificationLink}" class="cta-button" target="_blank" rel="noopener noreferrer">
          Accept Invitation & Get Started &rarr;
        </a>
      </div>

      <div class="expiry-alert">
        ⏰ <strong>Security Notice:</strong> This invitation link is personalized for ${safeRecipientEmail} and expires in 7 days.
      </div>
    </div>

    <div class="footer">
      <p>Sent by <span class="footer-org">${safeOrgName}</span> via eBadgeID Credential Network.</p>
      <p style="margin-top: 6px;">If you did not expect this invitation, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Hello!

You have been invited to join ${organizationName || 'our organization'} as ${designation || 'Team Member'}.

Please accept your invitation and complete your profile by visiting this link:
${verificationLink}

Note: This invitation is time-sensitive and will expire in 7 days.

Best regards,
${organizationName || 'The Team'}
  `.trim();

  return { subject, html, text };
}

module.exports = {
  generateInvitationEmailTemplate,
};
