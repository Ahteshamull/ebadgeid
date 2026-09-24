// controllers/invitationController.js
const Invitation = require('../models/invitation_schema');
const encryptionService = require('../utils/cryptoHelper');
const { sendInvitationEmail } = require('../utils/mailer');
const crypto = require('crypto');

class InvitationController {
    // Generate invitation
    async generateInvitation(req, res) {
        try {
            const email = String(req.body.email || '').trim().toLowerCase();
            const { designation } = req.body;
            const organization_code = req.user.organization_code;
            const six_digit_code = crypto.randomInt(100000, 1000000).toString();

            // Validation
            if (!email || !organization_code) {
                return res.status(400).json({
                    success: false,
                    message: 'Email and an administrator organization are required'
                });
            }

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid email format'
                });
            }

            // Generate encrypted invitation code first to check for existing invitations
            const encryptedToken = encryptionService.generateInvitationToken(
                email, 
                organization_code,
                six_digit_code,
                designation
            );

            // Check if invitation already exists for this combination
            const emailHash = crypto.createHash('sha256').update(email).digest('hex');
            const existingInvitation = await Invitation.findOne({
                email_hash: emailHash,
                organization_code,
                status: 'Active',
                expires_at: { $gt: new Date() },
            });

            if (existingInvitation) {
                return res.status(400).json({
                    success: false,
                    message: 'Employee already invited wait until he/she accept or decline invitation'
                });
            }

            // Save to database
            const invitation = new Invitation({
                invitation_code: encryptedToken,
                email_hash: emailHash,
                organization_code,
                designation,
                status: 'Active'
            });

            await invitation.save();
            
            // FIXED: Correct parameter order - email, designation, invitationCode
            await sendInvitationEmail(email, designation, encryptedToken);
            
            res.status(201).json({
                success: true,
                message: 'Invitation generated successfully',
                data: {
                    invitation_code: encryptedToken,
                    status: 'Active',
                    created_at: invitation.created_at,
                    expires_at: invitation.expires_at
                }
            });

        } catch (error) {
            console.error('Error generating invitation:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

            res.status(200).json({
                success: true,
                message: 'Invitation verified successfully',
                data: {
                    email: verificationResult.email,
                    organization_code: verificationResult.orgCode,
                    six_digit_code: verificationResult.sixDigitCode,
                    designation: verificationResult.designation,
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
