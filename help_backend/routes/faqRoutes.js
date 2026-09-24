const express = require("express");
const router = express.Router();
const faqController = require("../controllers/faqController");
const authMiddleware = require("../middleware/authMiddleware");
const { requirePublicOrganization } = require("../middleware/publicOrganization");

// Public routes — anyone can access, but must identify which organization's
// FAQs they want (see middleware/publicOrganization.js).
router.get("/", requirePublicOrganization(), faqController.getAllFAQs);

// Protected routes — only accessible by 'admin'/'agent' user_type.
// (previously imported but never actually applied — every write here was
// public, see AUDIT_FIXES.md)
router.post("/create", authMiddleware(['admin', 'agent']), faqController.createFAQ);
router.get("/:id", requirePublicOrganization(), faqController.getFAQById);
router.put("/:id", authMiddleware(['admin', 'agent']), faqController.updateFAQ);
router.delete("/:id", authMiddleware(['admin']), faqController.deleteFAQ);

module.exports = router;
