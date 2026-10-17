// E2E audit finding H-03: jobTitle/fullName below are interpolated into
// real HTML emails and originate from admin-controlled but arbitrary
// text (designation on an invitation, a user's own name) -- reusing the
// same escapeHtml() services/emailService.js already exports rather than
// a second, unescaped implementation.
const { escapeHtml } = require('../services/emailService');
const { transporter } = require('./smtpTransporter');
const { generateInvitationEmailTemplate } = require('../templates/invitationEmailTemplate');
const logger = require('./logger');

/**
 * Sends a beautifully formatted invitation email
 * @param {string} to - Recipient email address
 * @param {string} designation - Job title/role for the invitation
 * @param {string} invitationCode - Unique invitation code
 * @param {string} [organizationName] - Name of the organization
 * @returns {Promise} - Email sending promise
 */
const sendInvitationEmail = async (to, designation, invitationCode, organizationName = '') => {
    const appBaseUrl = (process.env.PUBLIC_APP_URL || 'https://app.ebadgeid.com').replace(/\/$/, '');
    const { subject, html, text } = generateInvitationEmailTemplate({
        recipientEmail: to,
        designation,
        invitationCode,
        appBaseUrl,
        organizationName,
    });

    const mailOptions = {
        from: `"eBadge Invite" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html,
        text,
    };

    try {
        const result = await transporter.sendMail(mailOptions);
        logger.info('invitation_email_sent', { recipient: to, messageId: result.messageId });
        return result;
    } catch (error) {
        logger.error('invitation_email_failed', { recipient: to, error: error.message });
        throw error;
    }
};

const sendWelcomeEmail = async (to, fullName = '') => {
  const htmlContent = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border-radius: 10px; background: #f4f4f4;">
    <h2 style="color: #4a90e2;">🎉 Welcome to Our Team!</h2>
    <p>Hi ${escapeHtml(fullName) || 'there'},</p>
    <p>We're thrilled to have you on board! Your account has been successfully created and you're now part of our growing community.</p>
    <p>If you have any questions or need help getting started, don’t hesitate to contact us.</p>
    <br/>
    <p>Warm regards,<br/>The eBadge Team</p>
  </div>
  `;

  const mailOptions = {
    from: `"eBadge Notifications" <${process.env.EMAIL_USER}>`,
    to,
    subject: "🎉 Welcome! You've successfully joined us",
    html: htmlContent,
    text: `Hi ${fullName || ''},\n\nWelcome to the team! Your account has been successfully created.\n\n– The eBadge Team`
  };

  try {
    const result = await transporter.sendMail(mailOptions);
    console.log('Welcome email sent:', result.messageId);
    return result;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
};


module.exports = { 
    sendInvitationEmail,
      sendWelcomeEmail, // Export it here
    transporter // Export transporter for testing purposes
};