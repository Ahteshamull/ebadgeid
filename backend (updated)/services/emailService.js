// services/emailService.js
const { transporter } = require('../utils/smtpTransporter');

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sanitizeForHtml = value => {
  if (typeof value === 'string') return escapeHtml(value);
  if (value instanceof Date || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeForHtml);
  if (typeof value === 'object') {
    const source = typeof value.toObject === 'function' ? value.toObject() : value;
    return Object.fromEntries(Object.entries(source).map(([key, nested]) => [key, sanitizeForHtml(nested)]));
  }
  return value;
};

const safeSubject = value => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);

// Email Templates
class EmailService {
  constructor() {
    // By explicit choice of the product owner, every outbound email (not
    // just contracts) now goes out from the same real mailbox this
    // backend authenticates as -- see utils/smtpTransporter.js.
    this.fromEmail = process.env.EMAIL_USER;
    this.baseUrl = (process.env.CONTRACT_APP_URL || 'https://contract.ebadgeid.com').replace(/\/$/, '');
    const parsedBaseUrl = new URL(this.baseUrl);
    if (process.env.NODE_ENV === 'production' && parsedBaseUrl.protocol !== 'https:') {
      throw new Error('CONTRACT_APP_URL must use HTTPS in production');
    }
    // Separate from this.baseUrl (which is the *contracts* Next.js app, used
    // for /collaborate/... links). sendWelcomeEmail below builds a link to
    // /auth/activate, which only exists in the main frontend app — that
    // route was previously built from this.baseUrl (CONTRACT_APP_URL),
    // sending every new-organization and free-trial activation email to a
    // domain with no such page, breaking account activation entirely
    // whenever CONTRACT_APP_URL and PUBLIC_APP_URL differ (the documented
    // production setup — see PRODUCTION_RUNBOOK.md).
    this.appBaseUrl = (process.env.PUBLIC_APP_URL || 'https://app.ebadgeid.com').replace(/\/$/, '');
    const parsedAppBaseUrl = new URL(this.appBaseUrl);
    if (process.env.NODE_ENV === 'production' && parsedAppBaseUrl.protocol !== 'https:') {
      throw new Error('PUBLIC_APP_URL must use HTTPS in production');
    }
  }

  // Helper to generate contract link with access token
  generateContractLink(contract_code, accessToken) {
    const base = `${this.baseUrl}/collaborate/${encodeURIComponent(contract_code)}`;
    return accessToken ? `${base}#accessToken=${encodeURIComponent(accessToken)}` : base;
  }

  // Commercial lead notification. It deliberately says "requires payment
  // confirmation": a customer browser redirect is useful for scheduling
  // onboarding, but never treated as proof that funds were captured.
  async sendOnboardingRequest(recipientEmail, { organization, admin, plan_name, payment_reference, expected_amount_cents, expected_currency }) {
    if (!recipientEmail) return { skipped: true, reason: 'ONBOARDING_NOTIFICATION_EMAIL is not configured' };
    const safe = sanitizeForHtml({ organization, admin, plan_name, payment_reference, expected_amount_cents, expected_currency });
    const amount = (Number(safe.expected_amount_cents || 0) / 100).toFixed(2);
    const response = await transporter.sendMail({
      from: this.fromEmail,
      to: recipientEmail,
      subject: safeSubject(`New onboarding request — ${safe.organization?.name || 'Organization'}`),
      text: `New onboarding request. Organization: ${safe.organization?.name}; contact: ${safe.admin?.first_name} ${safe.admin?.last_name} <${safe.admin?.email}>; plan: ${safe.plan_name}; order: ${safe.payment_reference}; expected: ${amount} ${safe.expected_currency}. Verify the transaction in Tilopay before treating this as a completed payment. An eBadgeID team member will contact the customer within 18 hours with further details.`,
      html: `<h2>New onboarding request</h2><p>A customer returned from the payment flow and requested onboarding.</p><ul><li><strong>Organization:</strong> ${safe.organization?.name}</li><li><strong>Contact:</strong> ${safe.admin?.first_name} ${safe.admin?.last_name} (${safe.admin?.email})</li><li><strong>Plan:</strong> ${safe.plan_name}</li><li><strong>Order:</strong> ${safe.payment_reference}</li><li><strong>Expected:</strong> ${amount} ${safe.expected_currency}</li></ul><p><strong>Action:</strong> verify the transaction in Tilopay, then contact the customer to schedule onboarding. This email is not payment proof.</p><p><strong>Customer commitment:</strong> an eBadgeID team member will contact the customer within 18 hours with further details.</p>`,
    });
    return { success: true, messageId: response.messageId };
  }

  // Customer-facing acknowledgement. It intentionally acknowledges only
  // the onboarding request, not a completed payment, because the return
  // URL is not authenticated proof that funds were captured.
  async sendCustomerOnboardingConfirmation(recipientEmail, { organization, plan_name, payment_reference }) {
    if (!recipientEmail) return { skipped: true, reason: 'customer email is not available' };
    const safe = sanitizeForHtml({ organization, plan_name, payment_reference });
    const response = await transporter.sendMail({
      from: this.fromEmail,
      to: recipientEmail,
      subject: safeSubject(`We received your onboarding request — ${safe.organization?.name || 'eBadgeID'}`),
      text: `We received your onboarding request for ${safe.organization?.name || 'your organization'} (${safe.plan_name || 'selected plan'}), reference ${safe.payment_reference}. An eBadgeID team member will contact you within 18 hours with further details.`,
      html: `<h2>We received your onboarding request</h2><p>Thank you for choosing eBadgeID for <strong>${safe.organization?.name || 'your organization'}</strong>.</p><p>Your selected plan is <strong>${safe.plan_name || 'the selected plan'}</strong> and your reference is <strong>${safe.payment_reference}</strong>.</p><p><strong>An eBadgeID team member will contact you within 18 hours with further details.</strong></p>`,
    });
    return { success: true, messageId: response.messageId };
  }

  // 1. Send Contract Invitation Email
  async sendContractInvitation(recipientEmail, contractData, accessToken) {
    const contractLink = this.generateContractLink(contractData.contract_code, accessToken);
    contractData = sanitizeForHtml(contractData);
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
          .content { padding: 30px; }
          .contract-info { background: #f8f9fa; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .contract-info h3 { margin: 0 0 10px 0; color: #667eea; font-size: 16px; }
          .contract-info p { margin: 5px 0; font-size: 14px; }
          .cta-button { display: inline-block; background: #667eea; color: #ffffff; text-decoration: none; padding: 14px 30px; border-radius: 6px; font-weight: 600; margin: 20px 0; text-align: center; }
          .cta-button:hover { background: #5568d3; }
          .info-box { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 4px; margin: 20px 0; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; }
          .party-details { margin: 15px 0; }
          .party-details strong { color: #495057; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📄 You've Been Invited to a Contract</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>You have been invited to participate in a digital contract. Please review the details below:</p>
            
            <div class="contract-info">
              <h3>${contractData.contract_title || 'Digital Contract'}</h3>
              <p><strong>Contract Code:</strong> ${contractData.contract_code}</p>
              <p><strong>Organization:</strong> ${contractData.organization_detail?.name || 'N/A'}</p>
              <p><strong>Issue Date:</strong> ${new Date(contractData.contract_issue_date).toLocaleDateString()}</p>
              ${contractData.contract_start_date ? `<p><strong>Start Date:</strong> ${new Date(contractData.contract_start_date).toLocaleDateString()}</p>` : ''}
              ${contractData.contract_end_date ? `<p><strong>End Date:</strong> ${new Date(contractData.contract_end_date).toLocaleDateString()}</p>` : ''}
              <p><strong>Status:</strong> <span style="text-transform: capitalize;">${contractData.contract_status}</span></p>
            </div>

            <div class="party-details">
              <p><strong>Your Role:</strong> ${contractData.userRole || 'Contract Party'}</p>
              <p><strong>Invited By:</strong> ${contractData.creator_details?.first_name} ${contractData.creator_details?.last_name}</p>
            </div>

            <div class="info-box">
              <strong>⚠️ Important:</strong> This is your personal access link. Do not share it with others. The link contains your unique access token.
            </div>

            <center>
              <a href="${contractLink}" class="cta-button">View & Sign Contract</a>
            </center>

            <p style="margin-top: 30px; font-size: 14px; color: #6c757d;">
              If you have any questions, please contact the contract administrator at ${contractData.creator_details?.email}.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} eBadgeID Contract Management System</p>
            <p>This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: safeSubject(`Contract Invitation: ${contractData.contract_title || contractData.contract_code}`),
        html: htmlContent,
      });

      console.log(JSON.stringify({ level: 'info', event: 'contract_invitation_email_sent', message_id: response.messageId }));
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'contract_invitation_email_failed', message: error.message }));
      throw error;
    }
  }

  // 2. Send Access Token Email
  async sendAccessToken(recipientEmail, contractData, accessToken, expiresAt) {
    const contractLink = this.generateContractLink(contractData.contract_code, accessToken);
    const expiryDate = new Date(expiresAt).toLocaleDateString();
    contractData = sanitizeForHtml(contractData);
    const displayToken = escapeHtml(accessToken);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #00c6ff 0%, #0072ff 100%); color: #ffffff; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px; }
          .token-box { background: #f8f9fa; border: 2px dashed #0072ff; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center; }
          .token-box .token { font-family: 'Courier New', monospace; font-size: 12px; word-break: break-all; color: #0072ff; background: #e7f3ff; padding: 10px; border-radius: 4px; margin: 10px 0; }
          .cta-button { display: inline-block; background: #0072ff; color: #ffffff; text-decoration: none; padding: 14px 30px; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .warning-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔑 Your Contract Access Token</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Your access token for the contract "<strong>${contractData.contract_title || contractData.contract_code}</strong>" has been generated.</p>
            
            <div class="token-box">
              <h3 style="margin-top: 0; color: #0072ff;">Access Token</h3>
              <div class="token">${displayToken}</div>
              <p style="margin-bottom: 0; font-size: 14px; color: #6c757d;">Expires: ${expiryDate}</p>
            </div>

            <div class="warning-box">
              <strong>🔒 Security Notice:</strong>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>Keep this token confidential</li>
                <li>Do not share with unauthorized persons</li>
                <li>The token will expire on ${expiryDate}</li>
                <li>Contact admin if you need a new token</li>
              </ul>
            </div>

            <center>
              <a href="${contractLink}" class="cta-button">Access Contract Now</a>
            </center>

            <p style="margin-top: 30px; font-size: 14px; color: #6c757d;">
              Alternatively, you can manually enter the access token when prompted on the contract platform.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} eBadgeID Contract Management System</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: safeSubject(`Access Token for Contract: ${contractData.contract_code}`),
        html: htmlContent,
      });

      console.log(JSON.stringify({ level: 'info', event: 'contract_access_email_sent', message_id: response.messageId }));
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'contract_access_email_failed', message: error.message }));
      throw error;
    }
  }

  // 3. Send New Discussion/Message Notification
  async sendDiscussionNotification(recipientEmail, contractData, discussionData, accessToken) {
    const contractLink = this.generateContractLink(contractData.contract_code, accessToken);
    contractData = sanitizeForHtml(contractData);
    discussionData = sanitizeForHtml(discussionData);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: #ffffff; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px; }
          .message-box { background: #f8f9fa; border-left: 4px solid #38ef7d; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .message-header { display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #dee2e6; }
          .sender { font-weight: 600; color: #11998e; }
          .timestamp { font-size: 12px; color: #6c757d; }
          .message-content { color: #495057; line-height: 1.8; }
          .attachments { margin-top: 15px; padding-top: 15px; border-top: 1px solid #dee2e6; }
          .attachment-item { background: #e7f3ff; padding: 8px 12px; margin: 5px 0; border-radius: 4px; font-size: 14px; }
          .cta-button { display: inline-block; background: #11998e; color: #ffffff; text-decoration: none; padding: 14px 30px; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .contract-info { background: #fff; border: 1px solid #e9ecef; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💬 New Discussion Message</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>A new message has been added to the contract discussion:</p>
            
            <div class="contract-info">
              <strong>${contractData.contract_title || 'Contract'}</strong><br>
              <span style="font-size: 14px; color: #6c757d;">Code: ${contractData.contract_code}</span>
            </div>

            <div class="message-box">
              <div class="message-header">
                <span class="sender">📧 ${discussionData.sender_email}</span>
                <span class="timestamp">${new Date(discussionData.timestamp).toLocaleString()}</span>
              </div>
              <div class="message-content">
                ${discussionData.message}
              </div>
              ${discussionData.attachments && discussionData.attachments.length > 0 ? `
                <div class="attachments">
                  <strong style="font-size: 14px; color: #495057;">📎 Attachments (${discussionData.attachments.length}):</strong>
                  ${discussionData.attachments.map(att => `
                    <div class="attachment-item">
                      ${att.split('/').pop()}
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>

            <center>
              <a href="${contractLink}" class="cta-button">View Full Discussion</a>
            </center>

            <p style="margin-top: 30px; font-size: 14px; color: #6c757d;">
              Reply to this message by accessing the contract and adding your comments in the discussion section.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} eBadgeID Contract Management System</p>
            <p style="margin-top: 10px;">
              <a href="${contractLink}" style="color: #6c757d; text-decoration: none;">Unsubscribe from notifications</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: safeSubject(`New Message in Contract: ${contractData.contract_title || contractData.contract_code}`),
        html: htmlContent,
      });

      console.log('✅ Discussion notification sent:', response);
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('❌ Error sending discussion notification:', error);
      throw error;
    }
  }

  // 4. Send Contract Update Notification
  async sendContractUpdateNotification(recipientEmail, contractData, updateDetails, accessToken) {
    const contractLink = this.generateContractLink(contractData.contract_code, accessToken);
    contractData = sanitizeForHtml(contractData);
    updateDetails = sanitizeForHtml(updateDetails);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: #ffffff; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px; }
          .update-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .update-item { margin: 10px 0; padding: 10px 0; border-bottom: 1px solid #e9ecef; }
          .update-item:last-child { border-bottom: none; }
          .update-label { font-weight: 600; color: #495057; font-size: 14px; }
          .update-value { color: #f5576c; margin-left: 10px; }
          .cta-button { display: inline-block; background: #f5576c; color: #ffffff; text-decoration: none; padding: 14px 30px; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔄 Contract Updated</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>The contract "<strong>${contractData.contract_title || contractData.contract_code}</strong>" has been updated.</p>
            
            <div class="update-box">
              <h3 style="margin-top: 0; color: #f5576c;">📋 Update Details</h3>
              <div class="update-item">
                <span class="update-label">Updated By:</span>
                <span class="update-value">${updateDetails.updated_by}</span>
              </div>
              <div class="update-item">
                <span class="update-label">Update Time:</span>
                <span class="update-value">${new Date(updateDetails.timestamp).toLocaleString()}</span>
              </div>
              ${updateDetails.changes ? `
                <div class="update-item">
                  <span class="update-label">Changes:</span>
                  <div style="margin-top: 10px;">
                    ${Object.entries(updateDetails.changes).map(([key, value]) => `
                      <div style="margin: 5px 0; font-size: 14px;">
                        • <strong>${key}:</strong> ${value}
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              ${updateDetails.description ? `
                <div class="update-item">
                  <span class="update-label">Description:</span>
                  <div style="margin-top: 5px; color: #495057;">${updateDetails.description}</div>
                </div>
              ` : ''}
            </div>

            <center>
              <a href="${contractLink}" class="cta-button">Review Changes</a>
            </center>

            <p style="margin-top: 30px; font-size: 14px; color: #6c757d;">
              Please review the updated contract and take any necessary actions.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} eBadgeID Contract Management System</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: safeSubject(`Contract Updated: ${contractData.contract_title || contractData.contract_code}`),
        html: htmlContent,
      });

      console.log('✅ Update notification sent:', response);
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('❌ Error sending update notification:', error);
      throw error;
    }
  }

  // 5. Send Contract Signed Notification
  async sendContractSignedNotification(recipientEmail, contractData, signerEmail, accessToken) {
    const contractLink = this.generateContractLink(contractData.contract_code, accessToken);
    contractData = sanitizeForHtml(contractData);
    signerEmail = escapeHtml(signerEmail);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px; }
          .signature-box { background: #d4edda; border-left: 4px solid #28a745; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .progress-box { background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .progress-bar { background: #e9ecef; height: 24px; border-radius: 12px; overflow: hidden; margin: 15px 0; }
          .progress-fill { background: linear-gradient(90deg, #28a745 0%, #20c997 100%); height: 100%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 12px; }
          .party-list { list-style: none; padding: 0; margin: 15px 0; }
          .party-item { padding: 10px; margin: 5px 0; background: #fff; border: 1px solid #e9ecef; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; }
          .signed { color: #28a745; }
          .pending { color: #ffc107; }
          .cta-button { display: inline-block; background: #28a745; color: #ffffff; text-decoration: none; padding: 14px 30px; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Contract Signed</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Great news! A party has signed the contract "<strong>${contractData.contract_title || contractData.contract_code}</strong>".</p>
            
            <div class="signature-box">
              <h3 style="margin-top: 0; color: #28a745;">✍️ Signed By</h3>
              <p style="font-size: 16px; margin: 0;">
                <strong>${signerEmail}</strong><br>
                <span style="font-size: 14px; color: #6c757d;">on ${new Date().toLocaleString()}</span>
              </p>
            </div>

            <div class="progress-box">
              <h3 style="margin-top: 0; color: #495057;">Signature Progress</h3>
              ${this.generateSignatureProgress(contractData.contract_parties)}
              
              <ul class="party-list">
                ${contractData.contract_parties.map(party => `
                  <li class="party-item">
                    <span>
                      ${party.signed ? '✅' : '⏳'} ${party.party_email}
                      <br><small style="color: #6c757d;">${party.party_role}</small>
                    </span>
                    <span class="${party.signed ? 'signed' : 'pending'}">
                      ${party.signed ? 'Signed' : 'Pending'}
                    </span>
                  </li>
                `).join('')}
              </ul>
            </div>

            ${contractData.contract_status === 'active' ? `
              <div style="background: #d4edda; border: 1px solid #28a745; padding: 15px; border-radius: 4px; margin: 20px 0;">
                <strong style="color: #28a745;">🎉 Contract is Now Active!</strong><br>
                <span style="font-size: 14px; color: #495057;">All parties have signed. The contract is now in effect.</span>
              </div>
            ` : ''}

            <center>
              <a href="${contractLink}" class="cta-button">View Contract</a>
            </center>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} eBadgeID Contract Management System</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: safeSubject(`Contract Signed by ${signerEmail}`),
        html: htmlContent,
      });

      console.log('✅ Signature notification sent:', response);
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('❌ Error sending signature notification:', error);
      throw error;
    }
  }

  // Helper: Generate signature progress bar
  generateSignatureProgress(parties) {
    const totalParties = parties.length;
    const signedParties = parties.filter(p => p.signed).length;
    const percentage = totalParties ? Math.round((signedParties / totalParties) * 100) : 0;

    return `
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${percentage}%;">
          ${signedParties} of ${totalParties} signed (${percentage}%)
        </div>
      </div>
    `;
  }

  // 6. Send Invitation Accepted Confirmation Email (NEW)
  async sendInvitationAcceptedEmail(recipientEmail, contractData, userRole, accessToken) {
    const contractLink = this.generateContractLink(contractData.contract_code, accessToken);
    contractData = sanitizeForHtml(contractData);
    userRole = escapeHtml(userRole);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 40px 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
          .header .icon { font-size: 48px; margin-bottom: 10px; }
          .content { padding: 40px 30px; }
          .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 20px; margin: 25px 0; border-radius: 4px; }
          .success-box h3 { margin: 0 0 10px 0; color: #28a745; font-size: 18px; }
          .contract-info { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 6px; }
          .contract-info h3 { margin: 0 0 15px 0; color: #495057; font-size: 16px; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
          .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
          .info-row:last-child { border-bottom: none; }
          .info-label { font-weight: 600; color: #6c757d; font-size: 14px; }
          .info-value { color: #495057; font-size: 14px; text-align: right; }
          .role-badge { background: #667eea; color: white; padding: 6px 16px; border-radius: 20px; display: inline-block; font-weight: 600; font-size: 14px; margin: 10px 0; }
          .cta-button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; margin: 25px 0; font-size: 16px; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3); }
          .cta-button:hover { box-shadow: 0 6px 8px rgba(102, 126, 234, 0.4); }
          .next-steps { background: #fff3cd; border: 1px solid #ffc107; padding: 20px; border-radius: 6px; margin: 25px 0; }
          .next-steps h4 { margin: 0 0 12px 0; color: #856404; }
          .next-steps ul { margin: 10px 0; padding-left: 20px; }
          .next-steps li { margin: 8px 0; color: #856404; }
          .footer { background: #f8f9fa; padding: 25px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; }
          .footer a { color: #667eea; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="icon">✅</div>
            <h1>Invitation Accepted!</h1>
          </div>
          <div class="content">
            <div class="success-box">
              <h3>🎉 Welcome Aboard!</h3>
              <p style="margin: 0; color: #155724;">You have successfully accepted the invitation to participate in this contract. You now have full access to all your assigned permissions.</p>
            </div>

            <p>Hello,</p>
            <p>Thank you for accepting the invitation! You are now an active participant in the following contract:</p>
            
            <div class="contract-info">
              <h3>📄 Contract Details</h3>
              <div class="info-row">
                <span class="info-label">Contract Title:</span>
                <span class="info-value"><strong>${contractData.contract_title || 'Digital Contract'}</strong></span>
              </div>
              <div class="info-row">
                <span class="info-label">Contract Code:</span>
                <span class="info-value">${contractData.contract_code}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Organization:</span>
                <span class="info-value">${contractData.organization_detail?.name || 'N/A'}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Status:</span>
                <span class="info-value" style="text-transform: capitalize; color: #667eea; font-weight: 600;">${contractData.contract_status}</span>
              </div>
              ${contractData.contract_start_date ? `
              <div class="info-row">
                <span class="info-label">Start Date:</span>
                <span class="info-value">${new Date(contractData.contract_start_date).toLocaleDateString()}</span>
              </div>
              ` : ''}
              ${contractData.contract_end_date ? `
              <div class="info-row">
                <span class="info-label">End Date:</span>
                <span class="info-value">${new Date(contractData.contract_end_date).toLocaleDateString()}</span>
              </div>
              ` : ''}
            </div>

            <div style="text-align: center; margin: 20px 0;">
              <p style="margin: 5px 0; color: #6c757d; font-size: 14px;">Your Role:</p>
              <span class="role-badge">${userRole}</span>
            </div>

            <div class="next-steps">
              <h4>📋 What's Next?</h4>
              <ul>
                <li>Review the complete contract document</li>
                <li>Participate in discussions with other parties</li>
                <li>Add your comments and feedback</li>
                <li>Sign the contract when ready</li>
                <li>Track contract progress and updates</li>
              </ul>
            </div>

            <center>
              <a href="${contractLink}" class="cta-button">Access Contract Now →</a>
            </center>

            <p style="margin-top: 30px; font-size: 14px; color: #6c757d; text-align: center;">
              You can access the contract anytime using the link above or from your dashboard.
            </p>

            <div style="background: #e7f3ff; border-left: 4px solid #0072ff; padding: 15px; margin: 25px 0; border-radius: 4px;">
              <strong style="color: #0056b3;">💡 Pro Tip:</strong>
              <p style="margin: 8px 0 0 0; color: #495057; font-size: 14px;">
                Bookmark the contract link for quick access. You'll receive email notifications for all important updates, discussions, and changes.
              </p>
            </div>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} eBadgeID Contract Management System</p>
            <p style="margin-top: 10px;">
              Need help? Contact us at <a href="mailto:support@ebadgeid.com">support@ebadgeid.com</a>
            </p>
            <p style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #dee2e6;">
              This is an automated confirmation message. Please do not reply to this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: safeSubject(`Invitation Accepted - ${contractData.contract_title || contractData.contract_code}`),
        html: htmlContent,
      });

      console.log('✅ Invitation acceptance confirmation sent:', response);
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error('❌ Error sending acceptance confirmation:', error);
      throw error;
    }
  }

  // 7. Notify All Parties (Batch Email) - Updated
  async notifyAllParties(contractData, emailType, additionalData = {}) {
    const promises = [];

    for (const party of contractData.contract_parties) {
      try {
        // Generate or fetch access token for this party
        const accessToken = additionalData.accessTokens?.[party.party_email] || '';

        switch (emailType) {
          case 'invitation':
            promises.push(
              this.sendContractInvitation(party.party_email, {
                ...contractData,
                userRole: party.party_role
              }, accessToken)
            );
            break;

          case 'discussion':
            if (party.party_email !== additionalData.sender_email) {
              promises.push(
                this.sendDiscussionNotification(
                  party.party_email,
                  contractData,
                  additionalData.discussionData,
                  accessToken
                )
              );
            }
            break;

          case 'update':
            promises.push(
              this.sendContractUpdateNotification(
                party.party_email,
                contractData,
                additionalData.updateDetails,
                accessToken
              )
            );
            break;

          case 'signed':
            if (party.party_email !== additionalData.signerEmail) {
              promises.push(
                this.sendContractSignedNotification(
                  party.party_email,
                  contractData,
                  additionalData.signerEmail,
                  accessToken
                )
              );
            }
            break;
        }
      } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'contract_batch_email_failed', message: error.message }));
      }
    }

    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`📧 Batch email results: ${successful} sent, ${failed} failed`);
    
    return {
      total: results.length,
      successful,
      failed,
      results
    };
  }

  // 8. Send Welcome Email
  async sendWelcomeEmail(recipientEmail, organizationData, username, activationToken, { requiresPasswordSetup = false } = {}) {
    // Token data is deliberately kept in the fragment: it is available to
    // the browser client but never sent to web-server access logs or Referer.
    const activationLink = `${this.appBaseUrl}/auth/activate#username=${encodeURIComponent(username)}&token=${encodeURIComponent(activationToken)}${requiresPasswordSetup ? '&setup_password=1' : ''}`;
    const safeOrganization = sanitizeForHtml(organizationData);
    const displayUsername = escapeHtml(username);
    const logoUrl = `${this.appBaseUrl.replace(/\/$/, '')}/logo.webp`;
    const passwordInstruction = requiresPasswordSetup
      ? 'Use the secure link below to set your password and activate your account.'
      : 'Use the secure link below to activate your account.';
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
      <body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;color:#172033;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;padding:24px 12px;"><tr><td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr><td align="center" style="background:#11183a;padding:28px 24px;color:#ffffff;">
              <img src="${logoUrl}" width="48" height="48" alt="eBadge ID fingerprint logo" style="display:block;border:0;margin:0 auto 12px;" />
              <div style="font-size:26px;font-weight:700;">eBadge ID</div>
              <div style="font-size:14px;opacity:.82;margin-top:4px;">Digital Identity</div>
            </td></tr>
            <tr><td style="padding:32px 34px;line-height:1.55;font-size:16px;">
              <h1 style="font-size:24px;margin:0 0 18px;color:#172033;">Welcome to eBadge ID</h1>
              <p style="margin:0 0 16px;">Your Administrator account has been created and is ready to be activated.</p>
              <p style="margin:0 0 16px;"><strong>Account:</strong> ${displayUsername}</p>
              <p style="margin:0 0 16px;"><strong>Organization:</strong> ${safeOrganization.name || 'eBadge ID organization'}</p>
              <p style="margin:0 0 24px;">${passwordInstruction} This single-use link expires in 1 hour.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;"><tr><td style="background:#4f46e5;border-radius:8px;">
                <a href="${activationLink}" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;font-weight:700;">Activate Account</a>
              </td></tr></table>
              <p style="margin:0;color:#526079;font-size:14px;">If you did not request this account, contact <a href="mailto:support@ebadgeid.com" style="color:#4f46e5;">support@ebadgeid.com</a>.</p>
            </td></tr>
            <tr><td align="center" style="background:#f8fafc;padding:18px 24px;color:#64748b;font-size:12px;">This is an automated eBadge ID message. Please do not reply.</td></tr>
          </table>
        </td></tr></table>
      </body></html>`;
    const textContent = `Welcome to eBadge ID\n\nYour Administrator account has been created and is ready to be activated.\n\nAccount: ${username}\nOrganization: ${organizationData?.name || 'eBadge ID organization'}\n\n${passwordInstruction} This single-use link expires in 1 hour:\n${activationLink}\n\nIf you did not request this account, contact support@ebadgeid.com.`;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: 'Welcome to eBadge | Your Administrator Account Is Ready',
        html: htmlContent,
        text: textContent,
      });

      console.log(JSON.stringify({ level: 'info', event: 'welcome_email_sent', message_id: response.messageId }));
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'welcome_email_failed', message: error.message }));
      throw error;
    }
  }

  // Self-service password reset -- link shape mirrors sendWelcomeEmail's
  // activation link exactly (token in the URL fragment, never the query
  // string, so it's never sent to the server in logs/Referer). Sent for
  // every forgotPassword request that resolves to a real, active account;
  // callers must still return the same generic response either way (see
  // authController.js) so this method's existence alone never confirms an
  // account exists.
  // `options.appBaseUrl` is the origin the user actually started recovery
  // from, already validated against an allowlist by authController's
  // resolveResetAppBaseUrl -- this must never be handed a raw
  // client-supplied value, or this mailer becomes a way to send genuine
  // eBadgeID reset emails pointing at an attacker's host. Falls back to
  // the main app, preserving the previous behavior exactly.
  // `options.otp` is the 6-digit variant of the same single reset grant
  // (see models/AuthCredentials.js) -- the onboarding app asks the user
  // to type it instead of following the link.
  async sendPasswordResetEmail(recipientEmail, username, resetToken, options = {}) {
    const appBaseUrl = (options.appBaseUrl || this.appBaseUrl).replace(/\/$/, '');
    const resetLink = `${appBaseUrl}/auth/reset-password#username=${encodeURIComponent(username)}&token=${encodeURIComponent(resetToken)}`;
    const displayUsername = escapeHtml(username);
    const otp = typeof options.otp === 'string' && /^\d{6}$/.test(options.otp) ? options.otp : null;
    const otpBlock = otp ? `
            <p style="margin-top: 24px;">Or enter this code on the page you started from:</p>
            <center>
              <div style="display: inline-block; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 26px; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 30px; font-weight: 700; letter-spacing: 7px; color: #1e293b;">${escapeHtml(otp)}</div>
            </center>
            <p style="font-size: 14px; color: #6c757d; text-align: center;">This code expires in 15 minutes and can only be used once.</p>` : '';
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
        <div style="max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">🔑 Reset your password</h1>
          </div>
          <div style="padding: 30px;">
            <p>Hello,</p>
            <p>We received a request to reset the password for account <strong>${displayUsername}</strong>.</p>
            <p style="margin-top: 10px;">Use the secure, single-use link below to choose a new password. It expires in 1 hour and can only be used once.</p>
            <center><a href="${resetLink}" style="display: inline-block; background: #667eea; color: #fff; text-decoration: none; padding: 14px 30px; border-radius: 6px; font-weight: 600; margin: 20px 0;">Reset password →</a></center>${otpBlock}
            <p style="margin-top: 20px; font-size: 14px; color: #6c757d;">If you did not request this, you can safely ignore this email -- your password will not change.</p>
          </div>
          <div style="background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef;">
            <p>This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: 'Reset your eBadgeID password',
        html: htmlContent,
      });
      console.log(JSON.stringify({ level: 'info', event: 'password_reset_email_sent', message_id: response.messageId }));
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'password_reset_email_failed', message: error.message }));
      throw error;
    }
  }

  // Credential expiring soon -- used by scripts/notifyExpiringCredentials.js
  // for both the recipient ("your credential expires soon") and the
  // issuing org's admin ("a credential you issued expires soon") variants;
  // `recipientLabel` is the only thing that differs between the two.
  async sendCredentialExpiryNotice(recipientEmail, { credential_title, credential_code, expiry_date, days_left, recipientLabel = 'recipient' }) {
    const safeTitle = escapeHtml(credential_title || 'Your credential');
    const verifyLink = `${this.appBaseUrl}/verifications/credentials/${encodeURIComponent(credential_code)}`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
        <div style="max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #d97706 0%, #b45309 100%); color: #ffffff; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 22px;">⏰ Expiring in ${Number(days_left)} day${Number(days_left) === 1 ? '' : 's'}</h1>
          </div>
          <div style="padding: 30px;">
            <p><strong>${safeTitle}</strong> ${recipientLabel === 'admin' ? 'that you issued ' : ''}will expire on <strong>${escapeHtml(expiry_date)}</strong>.</p>
            <p style="margin-top: 20px;"><a href="${verifyLink}" style="display: inline-block; background: #d97706; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600;">View credential →</a></p>
          </div>
          <div style="background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef;">
            <p>This is an automated reminder. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: `⏰ "${credential_title || 'Credential'}" expires in ${Number(days_left)} day${Number(days_left) === 1 ? '' : 's'}`,
        html: htmlContent,
      });
      console.log(JSON.stringify({ level: 'info', event: 'expiry_notice_email_sent', message_id: response.messageId, credential_code }));
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'expiry_notice_email_failed', message: error.message, credential_code }));
      throw error;
    }
  }

  // 9. Send 0 Dollar Invoice Trial Period Notice
  async sendTrialInvoiceEmail(recipientEmail, organizationData) {
    organizationData = sanitizeForHtml(organizationData);
    const pdfLink = `${this.baseUrl}/organizations/${organizationData.organization_code}/invoice/0-dollar.pdf`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #ffd452 0%, #ff9500 100%); color: #ffffff; padding: 40px 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
          .header .icon { font-size: 48px; margin-bottom: 10px; }
          .content { padding: 40px 30px; }
          .notice-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 25px 0; border-radius: 4px; }
          .notice-box h3 { margin: 0 0 10px 0; color: #856404; font-size: 18px; }
          .org-info { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 6px; }
          .org-info h3 { margin: 0 0 15px 0; color: #495057; font-size: 16px; border-bottom: 2px solid #ff9500; padding-bottom: 10px; }
          .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
          .info-row:last-child { border-bottom: none; }
          .info-label { font-weight: 600; color: #6c757d; font-size: 14px; }
          .info-value { color: #495057; font-size: 14px; text-align: right; }
          .cta-button { display: inline-block; background: linear-gradient(135deg, #ffd452 0%, #ff9500 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; margin: 25px 0; font-size: 16px; box-shadow: 0 4px 6px rgba(255, 149, 0, 0.3); }
          .footer { background: #f8f9fa; padding: 25px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; }
          .footer a { color: #ff9500; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="icon">📄</div>
            <h1>Trial Period Notice</h1>
          </div>
          <div class="content">
            <div class="notice-box">
              <h3>0 Dollar Invoice</h3>
              <p style="margin: 0; color: #856404;">You are currently on a trial period with no charges. Download your invoice below.</p>
            </div>

            <p>Hello,</p>
            <p>Your organization is set up on a trial basis. Here are the details:</p>
            
            <div class="org-info">
              <h3>🏢 Organization Details</h3>
              <div class="info-row">
                <span class="info-label">Name:</span>
                <span class="info-value"><strong>${organizationData.name || 'N/A'}</strong></span>
              </div>
              <div class="info-row">
                <span class="info-label">Code:</span>
                <span class="info-value">${organizationData.organization_code || 'N/A'}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Status:</span>
                <span class="info-value" style="text-transform: capitalize; color: #ff9500; font-weight: 600;">${organizationData.status}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Invoice Amount:</span>
                <span class="info-value">$0.00</span>
              </div>
            </div>

            <center>
              <a href="${pdfLink}" class="cta-button">Download Invoice PDF</a>
            </center>

            <p style="margin-top: 30px; font-size: 14px; color: #6c757d; text-align: center;">
              Enjoy your trial period! Upgrade anytime from your dashboard.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} eBadgeID Contract Management System</p>
            <p style="margin-top: 10px;">
              Need help? Contact us at <a href="mailto:support@ebadgeid.com">support@ebadgeid.com</a>
            </p>
            <p style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #dee2e6;">
              This is an automated notice. Please do not reply to this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const response = await transporter.sendMail({
        from: this.fromEmail,
        to: recipientEmail,
        subject: `Subscription invoice - Trial`,
        html: htmlContent,
      });

      console.log(JSON.stringify({ level: 'info', event: 'trial_invoice_email_sent', message_id: response.messageId }));
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'trial_invoice_email_failed', message: error.message }));
      throw error;
    }
  }

  

}

// escapeHtml is also attached to the exported singleton (not just used
// internally) so other real-HTML-email senders in this codebase --
// utils/mailer.js's invitation/welcome emails, previously unescaped, see
// E2E-audit finding H-03 -- reuse the exact same escaping instead of a
// second, divergent implementation.
module.exports = Object.assign(new EmailService(), { escapeHtml });
