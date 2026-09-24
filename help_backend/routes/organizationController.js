const express = require("express");
const router = express.Router();
const organizationController = require("../controllers/organizationController");
const authMiddleware = require("../middleware/authMiddleware");

// Routes
router.post("/", authMiddleware(['admin']), organizationController.createOrganization);
router.get("/", authMiddleware(['admin']), organizationController.getAllOrganizations);
router.get("/code/:code", authMiddleware(['admin', 'agent']), organizationController.getOrganizationByCode);
router.get("/:id", authMiddleware(['admin', 'agent']), organizationController.getOrganizationById);
router.put("/:id", authMiddleware(['admin']), organizationController.updateOrganization);
router.delete("/:id", authMiddleware(['admin']), organizationController.deleteOrganization);

module.exports = router;
