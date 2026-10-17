// controllers/invitationController.js
const Invitation = require('../models/invitation_schema');
const Users = require('../models/user_model');
const Organization = require('../models/organization_schema');
const encryptionService = require('../utils/cryptoHelper');
const logger = require('../utils/logger');
const { sendInvitationEmail } = require('../utils/mailer');
const crypto = require('crypto');

class InvitationController {
    // Generate invitation
    async generateInvitation(req, res) {
        try {
            const email = String(req.body.email || '').trim().toLowerCase();
            const designation = String(req.body.designation || '').trim();
            const organization_code = req.user.organization_code;
            const six_digit_code = crypto.randomInt(100000, 1000000).toString();

            // Validation
            if (!email || !organization_code) {
                return res.status(400).json({
                    success: false,
                    errorType: 'VALIDATION_ERROR',
                    message: 'Email and an administrator organization are required.'
                });
            }

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    errorType: 'INVALID_EMAIL',
                    message: 'Please provide a valid email address.'
                });
            }

            // Check if user already exists as an active member in this organization
            const existingUser = await Users.findOne({ email, organization_code }).lean();
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    errorType: 'USER_ALREADY_EXISTS',
                    message: `A user with email ${email} is already a member of your organization.`
                });
            }

            // Fetch organization details for high-fidelity branding in email
            const org = await Organization.findOne({ organization_code }).select('name').lean();
            const organizationName = org?.name || organization_code;

            // Check if active unexpired invitation already exists for this email
            const emailHash = crypto.createHash('sha256').update(email).digest('hex');
            const existingInvitation = await Invitation.findOne({
                email_hash: emailHash,
                organization_code,
                status: 'Active',
                expires_at: { $gt: new Date() },
            });

            if (existingInvitation) {
                // INC-02: Instead of throwing a blocking error, re-dispatch the invitation
                // and refresh the expiration window. Retrying does not create duplicate documents.
                existingInvitation.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);
                if (designation) {
                    existingInvitation.designation = designation;
                }
                await existingInvitation.save();

                sendInvitationEmail(email, existingInvitation.designation || 'Team Member', existingInvitation.invitation_code, organizationName)
                    .catch((emailError) => {
                        logger.error('invitation_email_resend_failed', {
                            email,
                            organization_code,
                            invitation_code: existingInvitation.invitation_code,
                            error: emailError.message,
                        });
                    });

                return res.status(200).json({
                    success: true,
                    isResend: true,
                    message: `Invitation refreshed and re-sent successfully to ${email}.`,
                    data: {
                        invitation_code: existingInvitation.invitation_code,
                        email,
                        designation: existingInvitation.designation,
                        status: 'Active',
                        created_at: existingInvitation.created_at,
                        expires_at: existingInvitation.expires_at
                    }
                });
            }

            // Clean up any stale expired invitations for this email/org
            await Invitation.deleteMany({
                email_hash: emailHash,
                organization_code,
                status: 'Expired',
            });

            // Generate encrypted invitation code
            const encryptedToken = encryptionService.generateInvitationToken(
                email, 
                organization_code,
                six_digit_code,
                designation || 'Team Member'
            );

            // Save invitation record to database
            const invitation = new Invitation({
                invitation_code: encryptedToken,
                email_hash: emailHash,
                organization_code,
                designation: designation || 'Team Member',
                status: 'Active'
            });

            await invitation.save();

            // Non-blocking asynchronous email delivery so HTTP response does not block UI
            sendInvitationEmail(email, designation || 'Team Member', encryptedToken, organizationName)
                .catch((emailError) => {
                    logger.error('invitation_email_failed', {
                        email,
                        organization_code,
                        invitation_code: encryptedToken,
                        error: emailError.message,
                    });
                });
            
            return res.status(201).json({
                success: true,
                message: `Invitation generated and dispatched successfully to ${email}.`,
                data: {
                    invitation_code: encryptedToken,
                    email,
                    designation: designation || 'Team Member',
                    status: 'Active',
                    created_at: invitation.created_at,
                    expires_at: invitation.expires_at
                }
            });

        } catch (error) {
            logger.error('generate_invitation_error', { error: error.message, stack: error.stack });
            return res.status(500).json({
                success: false,
                errorType: 'INVITATION_GENERATION_FAILED',
                message: 'Failed to process invitation. Please verify the provided details and try again.'
            });
        }
    }

    // Verify invitation
    async verifyInvitation(req, res) {
        try {
            const { encrypted_verification_code } = req.params;

            if (!encrypted_verification_code) {
                return res.status(400).json({
                    success: false,
                    message: 'Encrypted verification code is required'
                });
            }

            // Check if invitation exists in database
            const invitation = await Invitation.findOne({
                invitation_code: encrypted_verification_code
            });

            if (!invitation) {
                return res.status(404).json({
                    success: false,
                    message: 'Invalid invitation code'
                });
            }

            // Check if invitation is expired
            if (invitation.status === 'Expired' || new Date() > invitation.expires_at) {
                if (invitation.status !== 'Expired') {
                    invitation.status = 'Expired';
                    await invitation.save();
                }

                return res.status(400).json({
                    success: false,
                    message: 'Invitation has expired'
                });
            }

            // Decrypt and return data
            const verificationResult = encryptionService.verifyInvitationToken(encrypted_verification_code);

            if (!verificationResult.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid token',
                    error: verificationResult.error
                });
            }

            const org = await Organization.findOne({ organization_code: verificationResult.orgCode }).select('name').lean();
            const organizationName = org?.name || verificationResult.orgCode;

            res.status(200).json({
                success: true,
                message: 'Invitation verified successfully',
                data: {
                    email: verificationResult.email,
                    organization_code: verificationResult.orgCode,
                    organization_name: organizationName,
                    six_digit_code: verificationResult.sixDigitCode,
                    designation: verificationResult.designation || invitation.designation || 'Team Member',
                    status: invitation.status
                }
            });

        } catch (error) {
            console.error('Error verifying invitation:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // Get invitation status (optional utility endpoint)
    async getInvitationStatus(req, res) {
        try {
            const { invitation_code } = req.params;

            const invitation = await Invitation.findOne({
                invitation_code: invitation_code
            });

            if (!invitation) {
                return res.status(404).json({
                    success: false,
                    message: 'Invitation not found'
                });
            }

            // Check if expired
            const isExpired = new Date() > invitation.expires_at;
            if (isExpired && invitation.status !== 'Expired') {
                invitation.status = 'Expired';
                await invitation.save();
            }

            res.status(200).json({
                success: true,
                data: {
                    status: invitation.status,
                    created_at: invitation.created_at,
                    expires_at: invitation.expires_at,
                    is_expired: isExpired
                }
            });

        } catch (error) {
            console.error('Error getting invitation status:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

module.exports = new InvitationController();
