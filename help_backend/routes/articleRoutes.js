const express = require('express');
const router = express.Router();
const {
  createArticle,
  getManagedArticles,
  getAllArticles,
  getArticleByCode,
  updateArticle,
  deleteArticle,
} = require('../controllers/articleController');
const authMiddleware = require('../middleware/authMiddleware');
const { requirePublicOrganization } = require('../middleware/publicOrganization');

// Help-center articles are meant to be publicly readable, scoped to the
// organization the caller identifies itself as (see publicOrganization.js).
router.get('/', requirePublicOrganization(), getAllArticles);
router.get('/manage', authMiddleware(['admin', 'agent']), getManagedArticles);
router.get('/:code', requirePublicOrganization(), getArticleByCode);

// Writing/editing/deleting content requires an authenticated agent/admin.
router.post('/', authMiddleware(['admin', 'agent']), createArticle);
router.put('/:code', authMiddleware(['admin', 'agent']), updateArticle);
router.delete('/:code', authMiddleware(['admin']), deleteArticle);

module.exports = router;
