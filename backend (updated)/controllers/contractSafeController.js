const crypto = require('crypto');
const ContractAccess = require('../models/contractAccess');
const { hashAccessToken } = require('../middleware/authMiddleware');
// Shared with every other asset-reference validation in the app -- this
// used to be a local copy that only recognized the legacy /uploads/ path,
// silently rejecting every new /api/files/:storageKey URL the storage
// service returns for an authenticated upload (see managedStorage.js and
// digitalContractController.js's identical fix for the full context).
const { isManagedStorageUrl, belongsToOrganization } = require('../utils/managedStorage');

const CONTRACT_STATUSES = new Set(['active', 'in_discussion', 'on_hold', 'terminated', 'disputed']);
const partyFor = (contract, email) => contract.contract_parties.find(party => party.party_email === email);
const isManagedUploadUrl = isManagedStorageUrl;

exports.updateContract = async (req, res) => {
  try {
    const contract = req.contract;
    const email = req.user?.email || req.contractAccess?.email;
    const party = partyFor(contract, email);
    if (!party) return res.status(403).json({ message: 'You are not a party to this contract' });
    if (!party.accepted && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Accept the invitation before updating the contract' });
    }
    if (req.user?.role !== 'admin' && !req.contractPermissions?.update) {
      return res.status(403).json({ message: 'Contract update permission required' });
    }

    const changes = {};
    for (const field of ['contract_title', 'contract_start_date', 'contract_end_date', 'contract_attachments']) {
      if (req.body[field] !== undefined) changes[field] = req.body[field];
    }
    if (req.body.contract_status !== undefined) {
      if (!CONTRACT_STATUSES.has(req.body.contract_status)) {
        return res.status(400).json({ message: 'Invalid contract status' });
      }
      changes.contract_status = req.body.contract_status;
    }
    if (changes.contract_title !== undefined) changes.contract_title = String(changes.contract_title).trim().slice(0, 200);
    if (changes.contract_attachments !== undefined) {
      if (!Array.isArray(changes.contract_attachments) || changes.contract_attachments.length > 20) {
        return res.status(400).json({ message: 'Invalid contract attachments' });
      }
      changes.contract_attachments = changes.contract_attachments.map(value => String(value).slice(0, 2048));
      if (!changes.contract_attachments.every(isManagedUploadUrl)) {
        return res.status(400).json({ message: 'Contract attachments must be managed uploads' });
      }
      for (const attachmentUrl of changes.contract_attachments) {
        if (!await belongsToOrganization(attachmentUrl, contract.organization_code)) {
          return res.status(403).json({ message: 'One or more contract attachments do not belong to this contract\'s organization' });
        }
      }
    }
    if (Object.keys(changes).length === 0) return res.json({ message: 'No changes detected', contract });
    Object.assign(contract, changes);
    contract.timeline.push({
      event_title: 'Contract Updated',
      event_date: new Date(),
      description: `Contract updated by ${req.user?.username || email}`,
    });
    await contract.save();
    return res.json({ message: 'Contract updated successfully', changes, contract });
  } catch {
    return res.status(500).json({ message: 'Contract update failed' });
  }
};

exports.viewContract = async (req, res) => {
  try {
    const contract = req.contract;
    const email = req.user?.email || req.contractAccess?.email;
    const party = partyFor(contract, email);
    if (!party) return res.status(403).json({ message: 'Contract access denied' });
    if (!req.user && !party.accepted) {
      return res.status(403).json({ message: 'Please accept the invitation before viewing the contract', requires_acceptance: true });
    }
    if (req.user?.role !== 'admin' && !req.contractPermissions?.view) {
      return res.status(403).json({ message: 'Contract view permission required' });
    }
    const discussion = contract.discussion.map(entry => {
      const sender = partyFor(contract, entry.sender_email);
      return { ...entry.toObject(), sender_party_name: sender?.party_name || null };
    });
    const responseContract = contract.toObject();
    responseContract.discussion = discussion;
    responseContract.your_permissions = req.contractPermissions;
    responseContract.your_party = {
      party_name: party.party_name,
      party_side: party.party_side,
      party_role: party.party_role,
      status: party.status,
      signed: party.signed,
      signed_at: party.signed_at,
    };
    return res.json({
      message: 'Contract retrieved successfully',
      access_source: req.user ? 'jwt' : 'access_token',
      contract: responseContract,
    });
  } catch {
    return res.status(500).json({ message: 'Contract retrieval failed' });
  }
};

exports.refreshAccessToken = async (req, res) => {
  try {
    const accessToken = req.body?.access_token;
    if (typeof accessToken !== 'string' || !/^[a-f0-9]{64}$/i.test(accessToken)) {
      return res.status(400).json({ message: 'Invalid access token format' });
    }
    const tokenHash = hashAccessToken(accessToken);
    const current = await ContractAccess.findOne({
      $or: [{ access_token_hash: tokenHash }, { access_token: accessToken }],
      status: 'active',
    }).select('+access_token +access_token_hash');
    if (!current || new Date() > current.expires_at) {
      return res.status(403).json({ message: 'Access token is invalid or expired' });
    }
    current.status = 'revoked';
    await current.save();
    const newAccessToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await new ContractAccess({
      contract_code: current.contract_code,
      access_token: newAccessToken,
      permissions: current.permissions,
      expires_at: expiresAt,
      issued_to_email: current.issued_to_email,
    }).save();
    return res.json({ access_token: newAccessToken, expires_at: expiresAt });
  } catch {
    return res.status(500).json({ message: 'Access token refresh failed' });
  }
};
