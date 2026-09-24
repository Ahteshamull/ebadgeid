// E2E audit finding H-03: jobTitle/fullName below are interpolated into
// real HTML emails and originate from admin-controlled but arbitrary
// text (designation on an invitation, a user's own name) -- reusing the
// same escapeHtml() services/emailService.js already exports rather than
// a second, unescaped implementation.
const { escapeHtml } = require('../services/emailService');
const { transporter } = require('./smtpTransporter');

/**
 * Sends a beautifully formatted invitation email
 * @param {string} to - Recipient email address
 * @param {string} designation - Job title/role for the invitation
 * @param {string} invitationCode - Unique invitation code
 * @returns {Promise} - Email sending promise
 */
const sendInvitationEmail = async (to, designation, invitationCode) => {
    // Provide default designation if not provided
    const jobTitle = escapeHtml(designation || 'Team Member');

    // Was hardcoded to the production domain regardless of environment, so
    // every invitation sent from staging/self-hosted/local deployments
    // pointed invitees at the real production frontend instead of the
    // deployment that actually issued the invite. PUBLIC_APP_URL is the
    // same env var every other outbound link in this codebase already uses
    // for the main frontend (see api.js, services/emailService.js).
    const appBaseUrl = (process.env.PUBLIC_APP_URL || 'https://app.ebadgeid.com').replace(/\/$/, '');
    const verificationLink = `${appBaseUrl}/auth/self_signup/${encodeURIComponent(invitationCode)}`;
    
    const htmlTemplate = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Join Our Team</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Arial', sans-serif;
                line-height: 1.6;
                color: #333;
                background-color: #f4f4f4;
            }
            
            .email-container {
                max-width: 600px;
                margin: 0 auto;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 0;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            }
            
            .header {
                background: rgba(255, 255, 255, 0.1);
                padding: 40px 30px;
                text-align: center;
                backdrop-filter: blur(10px);
            }
            
            .header h1 {
                color: #fff;
                font-size: 28px;
                font-weight: 300;
                margin-bottom: 10px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            
            .header .subtitle {
                color: rgba(255, 255, 255, 0.9);
                font-size: 16px;
                font-weight: 300;
            }
            
            .content {
                background: #fff;
                padding: 50px 40px;
                position: relative;
            }
            
            .content::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, #667eea, #764ba2);
            }
            
            .greeting {
                font-size: 18px;
                color: #333;
                margin-bottom: 25px;
                font-weight: 500;
            }
            
            .message {
                font-size: 16px;
                color: #666;
                line-height: 1.8;
                margin-bottom: 35px;
            }
            
            .designation-highlight {
                background: linear-gradient(135deg, #667eea, #764ba2);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                font-weight: 600;
                font-size: 18px;
            }
            
            .cta-button {
                display: inline-block;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                text-decoration: none;
                padding: 16px 32px;
                border-radius: 50px;
                font-weight: 600;
                font-size: 16px;
                text-align: center;
                transition: all 0.3s ease;
                box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
                margin: 20px 0;
            }
            
            .cta-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
            }
            
            .cta-container {
                text-align: center;
                margin: 40px 0;
            }
            
            .warning {
                background: #fff3cd;
                border-left: 4px solid #ffc107;
                padding: 15px 20px;
                margin: 30px 0;
                border-radius: 0 8px 8px 0;
            }
            
            .warning-text {
                color: #856404;
                font-size: 14px;
                margin: 0;
            }
            
            .footer {
                background: #f8f9fa;
                padding: 30px 40px;
                text-align: center;
                border-top: 1px solid #e9ecef;
            }
            
            .footer-text {
                color: #6c757d;
                font-size: 14px;
                margin-bottom: 15px;
            }
            
            .company-name {
                color: #667eea;
                font-weight: 600;
                text-decoration: none;
            }
            
            .divider {
                height: 1px;
                background: linear-gradient(90deg, transparent, #ddd, transparent);
                margin: 30px 0;
            }
            
            @media (max-width: 600px) {
                .content {
                    padding: 30px 25px;
                }
                
                .header {
                    padding: 30px 25px;
                }
                
                .header h1 {
                    font-size: 24px;
                }
                
                .cta-button {
                    display: block;
                    width: 100%;
                    box-sizing: border-box;
                }
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <h1>🎉 You're Invited!</h1>
                <p class="subtitle">Join our amazing team</p>
            </div>
            
            <div class="content">
                <div class="greeting">
                    Hello there! 👋
                </div>
                
                <div class="message">
                    We're excited to invite you to join our organization as a 
                    <span class="designation-highlight">${jobTitle}</span>. 
                    Your skills and experience would be a valuable addition to our team, 
                    and we can't wait to work with you!
                </div>
                
                <div class="divider"></div>
                
                <div class="message">
                    Click the button below to accept your invitation and get started on this exciting journey with us.
                </div>
                
                <div class="cta-container">
                    <a href="${verificationLink}" class="cta-button">
                        Accept Invitation & Join Us →
                    </a>
                </div>
                
                <div class="warning">
                    <p class="warning-text">
                        ⏰ <strong>Time-sensitive:</strong> This invitation link will expire soon. 
                        Don't miss out – accept your invitation today!
                    </p>
                </div>
                
                <div class="message">
                    If you have any questions or need assistance, feel free to reach out to our team. 
                    We're here to help make your onboarding process as smooth as possible.
                </div>
            </div>
            
            <div class="footer">
                <p class="footer-text">
                    This invitation was sent by <a href="#" class="company-name">Your Company Name</a>
                </p>
                <p class="footer-text">
                    If you didn't expect this invitation, you can safely ignore this email.
                </p>
            </div>
        </div>
    </body>
    </html>
    `;

    const mailOptions = {
        from: `"eBadge Invite" <${process.env.EMAIL_USER}>`,
        to,
        subject: `🎉 Welcome aboard! You're invited to join us as ${jobTitle}`,
        html: htmlTemplate,
        // Plain text fallback for email clients that don't support HTML
        text: `
Hello!

You have been invited to join our organization as ${jobTitle}.

Please click the link below to accept the invitation:
${verificationLink}

This invitation will expire soon, so don't wait too long!

If you have any questions, feel free to reach out to our team.

Best regards,
        `
    };

    try {
        const result = await transporter.sendMail(mailOptions);
        console.log('Invitation email sent successfully:', result.messageId);
        return result;
    } catch (error) {
        console.error('Error sending invitation email:', error);
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