const crypto = require('crypto');

function generateBlockchainHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

module.exports = generateBlockchainHash;