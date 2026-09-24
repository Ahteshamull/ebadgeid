// controllers/contractController.js (Updated with Email Notifications)
const DigitalContract = require('../models/digitalContract');
const ContractAccess = require('../models/contractAccess');
const Users = require('../models/user_model');
const Organization = require('../models/organization_schema');
const emailService = require('../services/emailService');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Helper functions remain the same
const generateContractCode = () => {
  return `CNT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};

const generateMessageId = () => {
  return `MSG-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

const generateAccessToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Shared with every other asset-reference validation in the app (credential
// images, brand kit logos, organization assets -- see utils/managedStorage.js).
// This used to be a local copy that only recognized the legacy /uploads/
// path, which meant it silently rejected every new /api/files/:storageKey
// URL the storage service returns for any authenticated upload since the
// private-uploads migration (uploadController.js's fileUrl()). Found live
// during an audit round: creating or updating a contract with a freshly
// uploaded document or attachment was broken end to end on any deployment
// with MONGO_URI configured on the storage service -- i.e. every real one.
const { isManagedStorageUrl, belongsToOrganization } = require('../utils/managedStorage');
const isManagedUploadUrl = isManagedStorageUrl;

// Signed copies are legal documents and live in the private-files route
// (uploadController.js's PRIVATE_CONTRACT_DIR), never the public
// /uploads path the check above validates against.
const isPrivateSignedContractUrl = (value, req, contractCode) => {
  try {
    const candidate = new URL(value);
    const configuredBase = process.env.PUBLIC_API_BASE_URL;
    const expectedOrigin = configuredBase ? new URL(configuredBase).origin : `${req.protocol}://${req.get('host')}`;
    const expectedPath = new RegExp(`^/api/contracts/${encodeURIComponent(contractCode)}/private-files/signed-[a-f0-9]{32}\\.pdf$`, 'i');
    return candidate.origin === expectedOrigin && expectedPath.test(candidate.pathname);
  } catch {
    return false;
  }
};

const generateContractHash = (contractData) => {
  const hashData = JSON.stringify({
    contract_code: contractData.contract_code,
    contract_title: contractData.contract_title,
    contract_content_url: contractData.contract_content_url,
    timestamp: Date.now()
  });
  return crypto.createHash('sha256').update(hashData).digest('hex');
};

// 1. Create Contract (with email notifications to all parties)
exports.createContract = async (req, res) => {
  try {
    const { username, organization_code } = req.user;
    const {
      contract_title,
      contract_start_date,
      contract_end_date,
      contract_attachments,
      contract_content_url,
      contract_parties
    } = req.body;

    const employee = await Users.findOne({ username, organization_code });
    if (!employee) {
      return res.status(403).json({ message: 'You are not an employee of this organization' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can create contracts' });
    }

    if (!isManagedUploadUrl(contract_content_url)) {
      return res.status(400).json({ message: 'Contract content must be a managed upload' });
    }
    if (!Array.isArray(contract_attachments || []) || (contract_attachments || []).length > 20 || !(contract_attachments || []).every(isManagedUploadUrl)) {
      return res.status(400).json({ message: 'Contract attachments must be managed uploads' });
    }
    // Contracts are confidential legal documents -- a managed-storage URL
    // being well-formed isn't enough, it must actually belong to the
    // creating organization (same check every other asset reference in the
    // app already gets; this one was missing it).
    if (!await belongsToOrganization(contract_content_url, organization_code)) {
      return res.status(403).json({ message: 'Contract content does not belong to your organization' });
    }
    for (const attachmentUrl of contract_attachments || []) {
      if (!await belongsToOrganization(attachmentUrl, organization_code)) {
        return res.status(403).json({ message: 'One or more contract attachments do not belong to your organization' });
      }
    }

    const organization = await Organization.findOne({ organization_code });
    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    const contract_code = generateContractCode();
    const contract_security_hashes = generateContractHash({
      contract_code,
      contract_title,
      contract_content_url
    });

    // Create creator party object with admin role and all permissions
    const creatorParty = {
      party_name: `${employee.first_name} ${employee.last_name}`,
      party_side: 'admin', // Set party_side as 'admin'
      party_role: 'admin', // Set party_role as 'admin'
      party_email: employee.email,
      contract_permissions: {
        view: true,
        write: true,
        update: true,
        add_discussion: true,
        add_timeline_event: true
      },
      invited_at: new Date(),
      accepted: true, // Auto-accept for creator
      accepted_at: new Date(),
      status: 'accepted',
      signed: false
    };

    // Combine creator party with other parties, ensuring creator is first
    const allParties = [creatorParty, ...(contract_parties || [])];

    const newContract = new DigitalContract({
      contract_code,
      contract_title,
      contract_issue_date: new Date().toISOString(),
      contract_start_date,
      contract_end_date,
      contract_attachments: contract_attachments || [],
      contract_status: 'in_discussion',
      contract_content_url,
      contract_parties: allParties, // Use the combined parties array
      discussion: [],
      timeline: [{
        event_title: 'Contract Created',
        event_date: new Date(),
        description: `Contract created by ${username}`
      }],
      contract_security_hashes,
      organization_code,
      organization_detail: {
        name: organization.name,
        email: organization.email,
        phone: organization.phone,
        logo: organization.logo
      },
      creator_username: username,
      creator_details: {
        first_name: employee.first_name,
        last_name: employee.last_name,
        email: employee.email,
        designation: employee.designation
      }
    });

    await newContract.save();

    // Generate access tokens and send invitation emails to all parties EXCEPT the creator
    const accessTokens = {};
    const emailPromises = [];

    for (const party of newContract.contract_parties) {
      try {
        // Skip access token generation for creator since they're already authenticated
        if (party.party_email === employee.email) {
          continue;
        }

        // Generate access token for each party
        const access_token = generateAccessToken();
        const expires_at = new Date();
        expires_at.setDate(expires_at.getDate() + 30);

        const contractAccess = new ContractAccess({
          contract_code,
          access_token,
          permissions: party.contract_permissions,
          issued_at: new Date(),
          expires_at,
          issued_to_email: party.party_email,
          status: 'active'
        });

        await contractAccess.save();
        accessTokens[party.party_email] = access_token;

        // Add email sending promise
        emailPromises.push(
          emailService.sendContractInvitation(
            party.party_email,
            {
              ...newContract.toObject(),
              userRole: party.party_role
            },
            access_token
          ).catch(err => {
            console.error(JSON.stringify({ level: 'error', event: 'contract_invitation_email_failed', message: err.message }));
            return { error: true, email: party.party_email };
          })
        );
      } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'contract_party_processing_failed', message: error.message }));
      }
    }

    // Send all emails in parallel
    const emailResults = await Promise.all(emailPromises);
    const successfulEmails = emailResults.filter(r => !r?.error).length;
    const failedEmails = emailResults.filter(r => r?.error).length;

    console.log(`📧 Email Summary: ${successfulEmails} sent, ${failedEmails} failed`);

    res.status(201).json({
      message: 'Contract created successfully and invitations sent to all parties',
      contract: newContract,
      email_summary: {
        total_parties: newContract.contract_parties.length,
        emails_sent: successfulEmails,
        emails_failed: failedEmails,
        creator_added: true
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 10. Accept Contract Invitation (NEW)
exports.acceptInvitation = async (req, res) => {
  try {
    const { contract_code } = req.params;
    const user_email = req.user?.email || req.contractAccess?.email;

    if (!user_email) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Find contract
    const contract = req.contract;

    // Find party
    const partyIndex = contract.contract_parties.findIndex(p => p.party_email === user_email);
    if (partyIndex === -1) {
      return res.status(403).json({ message: 'You are not invited to this contract' });
    }

    // Check if already accepted
    if (contract.contract_parties[partyIndex].accepted) {
      return res.status(400).json({ message: 'You have already accepted this invitation' });
    }

    // Accept invitation
    contract.contract_parties[partyIndex].accepted = true;
    contract.contract_parties[partyIndex].status = 'accepted';
    contract.contract_parties[partyIndex].accepted_at = new Date();

    // Add timeline event
    contract.timeline.push({
      event_title: 'Invitation Accepted',
      event_date: new Date(),
      description: `${user_email} accepted the contract invitation`
    });

    await contract.save();

    // Get or find access token for confirmation email
    let accessToken = req.contractAccess?.contract_code ? 
      req.headers['x-access-token'] || req.query.access_token : null;

    // If no access token exists, find the most recent one
    if (!accessToken) {
      const tokenDoc = await ContractAccess.findOne({
        contract_code,
        issued_to_email: user_email,
        status: 'active'
      }).sort({ issued_at: -1 });
      
      if (tokenDoc) {
        accessToken = tokenDoc.access_token;
      }
    }

    // Send acceptance confirmation email
    try {
      await emailService.sendInvitationAcceptedEmail(
        user_email,
        contract.toObject(),
        contract.contract_parties[partyIndex].party_role,
        accessToken
      );
      console.log(JSON.stringify({ level: 'info', event: 'contract_acceptance_email_sent' }));
    } catch (emailError) {
      console.error(JSON.stringify({ level: 'error', event: 'contract_acceptance_email_failed', message: emailError.message }));
    }

    res.status(200).json({
      message: 'Invitation accepted successfully. Confirmation email sent.',
      contract,
      party: contract.contract_parties[partyIndex]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 2. Invite User to Contract (with email notification)
exports.inviteUserToContract = async (req, res) => {
  try {
    const { contract_code } = req.params;
    const { username, organization_code } = req.user;
    const {
      party_name,
      party_side,
      party_role,
      party_email,
      contract_permissions
    } = req.body;

    // E2E audit finding H-12: reuses req.contract (set by authenticateToken's
    // attachJwtIdentity, already scoped to req.user.organization_code and
    // permission-checked) instead of re-querying by bare contract_code
    // with no organization filter of its own.
    const contract = req.contract;
    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    const isCreator = contract.creator_username === username;
    const userParty = contract.contract_parties.find(p => p.party_email === req.user.email);
    const hasWritePermission = userParty?.contract_permissions?.write;

    if (!isCreator && !hasWritePermission) {
      return res.status(403).json({ message: 'You do not have permission to invite users' });
    }

    const existingParty = contract.contract_parties.find(p => p.party_email === party_email);
    if (existingParty) {
      return res.status(400).json({ message: 'User already invited to this contract' });
    }

    contract.contract_parties.push({
      party_name,
      party_side,
      party_role,
      party_email,
      contract_permissions: contract_permissions || {
        view: true,
        write: false,
        update: false,
        add_discussion: true,
        add_timeline_event: false
      },
      invited_at: new Date(),
      accepted: false,
      status: 'invited',
      signed: false
    });

    contract.timeline.push({
      event_title: 'User Invited',
      event_date: new Date(),
      description: `${party_email} invited as ${party_role}`
    });

    await contract.save();

    // Generate access token for the invited user
    const access_token = generateAccessToken();
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + 30);

    const contractAccess = new ContractAccess({
      contract_code,
      access_token,
      permissions: contract_permissions || {
        view: true,
        add_discussion: true
      },
      issued_at: new Date(),
      expires_at,
      issued_to_email: party_email,
      status: 'active'
    });

    await contractAccess.save();

    // Send invitation email with access token
    try {
      await emailService.sendContractInvitation(
        party_email,
        {
          ...contract.toObject(),
          userRole: party_role
        },
        access_token
      );
      console.log(JSON.stringify({ level: 'info', event: 'contract_invitation_email_sent' }));
    } catch (emailError) {
      console.error(JSON.stringify({ level: 'error', event: 'contract_invitation_email_failed', message: emailError.message }));
      // Don't fail the request if email fails
    }

    res.status(200).json({
      message: 'User invited successfully and email sent',
      contract
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 3. Add Discussion (with invitation acceptance check and email notifications)
exports.addDiscussion = async (req, res) => {
  try {
    const { contract_code } = req.params;
    const { message, attachments } = req.body;
    const sender_email = req.user?.email || req.contractAccess?.email;

    const contract = req.contract;

    // Check if user is a party and get their status
    const party = contract.contract_parties.find(p => p.party_email === sender_email);
    if (!party) {
      return res.status(403).json({ message: 'You are not a party to this contract' });
    }

    // Check if invitation is accepted
    if (party.status === 'invited' && !party.accepted) {
      return res.status(403).json({ 
        message: 'You must accept the invitation before performing any actions. Please accept the invitation first.' 
      });
    }

    // Check permissions
    if (!party.contract_permissions?.add_discussion) {
      return res.status(403).json({ message: 'You do not have permission to add discussions' });
    }

    if (typeof message !== 'string' || !message.trim() || message.length > 5000) {
      return res.status(400).json({ message: 'Discussion message is required and cannot exceed 5000 characters' });
    }
    if (!Array.isArray(attachments || []) || (attachments || []).length > 10 || !(attachments || []).every(isManagedUploadUrl)) {
      return res.status(400).json({ message: 'Discussion attachments must be managed uploads' });
    }
    for (const attachmentUrl of attachments || []) {
      if (!await belongsToOrganization(attachmentUrl, contract.organization_code)) {
        return res.status(403).json({ message: 'One or more discussion attachments do not belong to this contract\'s organization' });
      }
    }

    const message_id = generateMessageId();

    const newDiscussion = {
      message_id,
      sender_email,
      message: message.trim(),
      timestamp: new Date(),
      attachments: attachments || []
    };

    contract.discussion.push(newDiscussion);
    await contract.save();

    // Send email notifications to all other parties
    try {
      // Get access tokens for all parties
      const accessTokens = {};
      for (const party of contract.contract_parties) {
        if (party.party_email !== sender_email) {
          const tokenDoc = await ContractAccess.findOne({
            contract_code,
            issued_to_email: party.party_email,
            status: 'active'
          }).sort({ issued_at: -1 });
          
          if (tokenDoc) {
            accessTokens[party.party_email] = tokenDoc.access_token;
          }
        }
      }

      await emailService.notifyAllParties(contract, 'discussion', {
        discussionData: newDiscussion,
        sender_email,
        accessTokens
      });

      console.log('✅ Discussion notifications sent to all parties');
    } catch (emailError) {
      console.error('⚠️ Failed to send discussion notifications:', emailError);
    }

    res.status(200).json({
      message: 'Discussion added successfully and notifications sent',
      discussion: newDiscussion
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 4. Fetch Organization Contracts (no changes)
exports.fetchOrganizationContracts = async (req, res) => {
  try {
    const { organization_code } = req.params;
    const { username, organization_code: userOrganizationCode } = req.user;

    if (organization_code !== userOrganizationCode) {
      return res.status(403).json({ message: 'You do not have access to this organization' });
    }

    const contracts = await DigitalContract.find({ organization_code });

    res.status(200).json({
      message: 'Contracts fetched successfully',
      count: contracts.length,
      contracts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 6. Sign Contract (with invitation acceptance check and email notifications)
exports.signContract = async (req, res) => {
  try {
    const { contract_code } = req.params;
    const user_email = req.user?.email || req.contractAccess?.email;
    const attachmentUrl = req.body.attachment_url;
    if (!isPrivateSignedContractUrl(attachmentUrl, req, contract_code)) {
      return res.status(400).json({ message: 'Signed copy must be uploaded through the managed contract upload endpoint' });
    }

    const preCheck = req.contract;

    const partyIndex = preCheck.contract_parties.findIndex(p => p.party_email === user_email);
    if (partyIndex === -1) {
      return res.status(403).json({ message: 'You are not a party to this contract' });
    }

    // Check if invitation is accepted
    if (preCheck.contract_parties[partyIndex].status === 'invited' && !preCheck.contract_parties[partyIndex].accepted) {
      return res.status(403).json({
        message: 'You must accept the invitation before signing the contract. Please accept the invitation first.'
      });
    }

    if (preCheck.contract_parties[partyIndex].signed) {
      return res.status(400).json({ message: 'You have already signed this contract' });
    }

    // Read-modify-save on req.contract (loaded by middleware, above) had a
    // real TOCTOU window: two requests signing the same party at nearly the
    // same time could both pass the `signed` check above against their own
    // stale copy, both mutate, and both save. Mongoose's default versioning
    // would likely reject the second .save() as a VersionError, but that
    // surfaced as an opaque 500 instead of a clean "already signed"
    // response — and relying on an incidental side effect of versioning
    // isn't the same as the update actually being conditioned on the state
    // we checked. This makes the transition atomic and explicit: the query
    // itself requires `signed` to still be false for this party, so only
    // one concurrent request can ever flip it.
    const signedUpdate = await DigitalContract.findOneAndUpdate(
      {
        contract_code,
        contract_parties: { $elemMatch: { party_email: user_email, signed: { $ne: true } } },
      },
      {
        $set: {
          'contract_parties.$[party].signed': true,
          'contract_parties.$[party].signed_at': new Date(),
          'contract_parties.$[party].status': 'accepted',
          'contract_parties.$[party].accepted': true,
        },
        $push: {
          timeline: {
            event_title: 'Contract Signed',
            event_date: new Date(),
            description: `Contract signed by ${user_email}`,
          },
          signed_copies: {
            party_email: user_email,
            signed_copy_url: attachmentUrl,
            signed_at: new Date(),
            attachment_name: req.body.attachment_name,
          },
        },
      },
      { arrayFilters: [{ 'party.party_email': user_email }], new: true }
    );
    if (!signedUpdate) {
      // The pre-check above passed, so the only realistic way to land here
      // is a concurrent request that signed this same party first.
      return res.status(400).json({ message: 'You have already signed this contract' });
    }

    let contract = signedUpdate;
    const allSigned = contract.contract_parties.every(p => p.signed);
    if (allSigned) {
      // Same reasoning as above: condition on contract_status not already
      // being 'active' so two parties finishing at nearly the same moment
      // can't both push a duplicate "Contract Activated" timeline entry.
      const activated = await DigitalContract.findOneAndUpdate(
        { contract_code, contract_status: { $ne: 'active' } },
        {
          $set: { contract_status: 'active' },
          $push: {
            timeline: {
              event_title: 'Contract Activated',
              event_date: new Date(),
              description: 'All parties have signed the contract',
            },
          },
        },
        { new: true }
      );
      if (activated) contract = activated;
    }

    // Send signature notifications to all other parties
    try {
      const accessTokens = {};
      for (const party of contract.contract_parties) {
        const tokenDoc = await ContractAccess.findOne({
          contract_code,
          issued_to_email: party.party_email,
          status: 'active'
        }).sort({ issued_at: -1 });
        
        if (tokenDoc) {
          accessTokens[party.party_email] = tokenDoc.access_token;
        }
      }

      await emailService.notifyAllParties(contract, 'signed', {
        signerEmail: user_email,
        accessTokens
      });

      console.log('✅ Signature notifications sent to all parties');
    } catch (emailError) {
      console.error('⚠️ Failed to send signature notifications:', emailError);
    }

    res.status(200).json({
      message: 'Contract signed successfully and notifications sent',
      contract,
      allSigned
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 7. Generate Access Token (with email notification)
exports.generateAccessToken = async (req, res) => {
  try {
    const { contract_code } = req.params;
    const { email, permissions, expires_in_days } = req.body;

    // E2E audit finding H-12: see the identical note in inviteUserToContract
    // above -- req.contract is already organization-scoped and permission-
    // checked by the authenticateToken middleware this route runs behind.
    const contract = req.contract;
    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    const party = contract.contract_parties.find(p => p.party_email === email);
    if (!party) {
      return res.status(403).json({ 
        message: 'Email is not associated with this contract. Cannot generate access token.' 
      });
    }

    const isCreator = contract.creator_username === req.user.username;
    if (!isCreator && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only creator or admin can generate access tokens' });
    }

    const access_token = generateAccessToken();
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + (expires_in_days || 30));

    const contractAccess = new ContractAccess({
      contract_code,
      access_token,
      permissions: permissions || party.contract_permissions,
      issued_at: new Date(),
      expires_at,
      issued_to_email: email,
      status: 'active'
    });

    await contractAccess.save();

    // Send access token email
    try {
      await emailService.sendAccessToken(
        email,
        contract.toObject(),
        access_token,
        expires_at
      );
      console.log(JSON.stringify({ level: 'info', event: 'contract_access_email_sent' }));
    } catch (emailError) {
      console.error(JSON.stringify({ level: 'error', event: 'contract_access_email_failed', message: emailError.message }));
    }

    res.status(201).json({
      message: 'Access token generated successfully and email sent',
      access_token,
      expires_at,
      permissions: contractAccess.permissions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 9. Remove User (no changes)
exports.removeUser = async (req, res) => {
  try {
    const { contract_code, party_email } = req.params;
    const { username, role, email } = req.user;

    // E2E audit finding H-12: see the identical note in inviteUserToContract
    // above -- req.contract is already organization-scoped and permission-
    // checked by the authenticateToken middleware this route runs behind.
    const contract = req.contract;
    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    const isCreator = contract.creator_username === username;
    const userParty = contract.contract_parties.find(p => p.party_email === email);
    const hasWritePermission = userParty?.contract_permissions?.write;

    if (!isCreator && role !== 'admin' && !hasWritePermission) {
      return res.status(403).json({ 
        message: 'Only creator, admin, or users with write permission can remove users' 
      });
    }

    if (party_email === contract.creator_details.email) {
      return res.status(403).json({ message: 'Cannot remove contract creator' });
    }

    const partyIndex = contract.contract_parties.findIndex(p => p.party_email === party_email);
    if (partyIndex === -1) {
      return res.status(404).json({ message: 'User not found in contract' });
    }

    contract.contract_parties.splice(partyIndex, 1);

    contract.timeline.push({
      event_title: 'User Removed',
      event_date: new Date(),
      description: `${party_email} removed from contract by ${username}`
    });

    await ContractAccess.updateMany(
      { contract_code, issued_to_email: party_email, status: 'active' },
      { status: 'revoked' }
    );

    await contract.save();

    res.status(200).json({
      message: 'User removed successfully',
      contract
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
