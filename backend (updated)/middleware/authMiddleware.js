const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const ContractAccess = require('../models/contractAccess');
const DigitalContract = require('../models/digitalContract');
const Users = require('../models/user_model');

const hashAccessToken = value => crypto.createHash('sha256').update(value).digest('hex');

const sessionToken = req => {
  const authHeader = req.headers.authorization;
  return (authHeader && authHeader.split(' ')[1]) || req.cookies?.ebadge_token;
};

async function attachJwtIdentity(req, token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  const username = decoded.username || decoded.id;
  const userDetails = await Users.findOne({
    username,
    organization_code: decoded.organization_code,
  }).lean();
  if (!userDetails) throw new Error('Session user profile not found');
  req.user = {
    id: decoded.id,
    username,
    role: decoded.role,
    organization_code: decoded.organization_code,
    email: userDetails.email,
  };

  if (req.params.contract_code) {
    const contract = await DigitalContract.findOne({
      contract_code: req.params.contract_code,
      organization_code: decoded.organization_code,
    });
    if (!contract) throw Object.assign(new Error('Contract not found'), { statusCode: 404 });
    const party = contract.contract_parties.find(item => item.party_email === userDetails.email);
    if (decoded.role !== 'admin' && !party) {
      throw Object.assign(new Error('Contract access denied'), { statusCode: 403 });
    }
    req.contract = contract;
    req.contractPermissions = decoded.role === 'admin'
      ? { view: true, write: true, update: true, add_discussion: true, add_timeline_event: true }
      : party.contract_permissions;
  }
}

const authenticateToken = async (req, res, next) => {
  const token = sessionToken(req);
  if (!token) return res.status(401).json({ message: 'Access token required' });
  try {
    await attachJwtIdentity(req, token);
    return next();
  } catch (error) {
    return res.status(error.statusCode || 403).json({ message: error.statusCode ? error.message : 'Invalid or expired token' });
  }
};

const authenticateContractAccess = async (req, res, next) => {
  const token = sessionToken(req);
  if (token) {
    try {
      await attachJwtIdentity(req, token);
      return next();
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
      // An invalid JWT is not treated as a contract token; continue only
      // if a dedicated contract cookie is present.
    }
  }

  const accessToken = req.cookies?.contract_access;
  if (!accessToken || !/^[a-f0-9]{64}$/i.test(accessToken)) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  try {
    const tokenHash = hashAccessToken(accessToken);
    const contractAccess = await ContractAccess.findOne({
      $or: [{ access_token_hash: tokenHash }, { access_token: accessToken }],
      status: 'active',
    }).select('+access_token +access_token_hash');
    if (!contractAccess) return res.status(401).json({ message: 'Invalid access token' });
    if (new Date() > contractAccess.expires_at) {
      contractAccess.status = 'expired';
      await contractAccess.save();
      return res.status(403).json({ message: 'Access token has expired' });
    }
    if (req.params.contract_code && contractAccess.contract_code !== req.params.contract_code) {
      return res.status(403).json({ message: 'Access token is not valid for this contract' });
    }
    if (!contractAccess.access_token_hash) {
      contractAccess.access_token_hash = tokenHash;
      contractAccess.access_token = undefined;
      await contractAccess.save();
    }
    const contract = await DigitalContract.findOne({ contract_code: contractAccess.contract_code });
    if (!contract) return res.status(404).json({ message: 'Contract not found' });
    req.contract = contract;
    req.contractPermissions = contractAccess.permissions;
    req.contractAccess = {
      email: contractAccess.issued_to_email,
      permissions: contractAccess.permissions,
      contract_code: contractAccess.contract_code,
    };
    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Contract authentication failed' });
  }
};

module.exports = { authenticateToken, authenticateContractAccess, hashAccessToken };
