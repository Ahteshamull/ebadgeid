const express = require('express');
const router = express.Router();
const { getAnchorProofForCredential } = require('../services/blockchainAnchor');

// Public, same reasoning as GET /credentials/by-code/:code — a Merkle
// proof is only useful if anyone (not just this platform's own frontend)
// can pull it and verify it independently.
router.get('/verify/:credential_code', async (req, res) => {
  try {
    const proof = await getAnchorProofForCredential(req.params.credential_code);
    if (!proof) {
      return res.status(404).json({ message: 'This credential has not been included in an anchor batch yet' });
    }
    res.json(proof);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

module.exports = router;
