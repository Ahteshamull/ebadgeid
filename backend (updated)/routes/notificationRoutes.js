const express = require("express");
const router = express.Router();
const {
  getNotificationByUser,
  readNotificationByUser,
  deleteNotificationById,
  clearUserNotifications
} = require("../controllers/notificationController");
const { requireAuth } = require('../middleware/requireAuth');

router.get("/:username", requireAuth, getNotificationByUser);
router.patch("/read/:id", requireAuth, readNotificationByUser);
router.delete("/delete-notification/:id", requireAuth, deleteNotificationById);
router.delete("/:id", requireAuth, deleteNotificationById);
router.delete("/clear/:username", requireAuth, clearUserNotifications);
module.exports = router;
