const Notifications = require("../models/notificationsSchema");
const Users = require("../models/user_model");

// Format notification object
const formatNotification = (notification, user) => {
  const initials = `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase();

  return {
    id: notification._id,
    type: "general",
    title: notification.notification_title,
    message: notification.notification_description,
    timestamp: notification.issued_at,
    read: notification.read || false,

    user: {
      name: `${user.first_name} ${user.last_name}`,
      avatar: user.profile_picture_url || null,
      initials
    }
  };
};



// GET /api/notifications/:username
exports.getNotificationByUser = async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user.username) return res.status(403).json({ message: 'Access denied' });

    // Find user by username
    const user = await Users.findOne({ username, organization_code: req.user.organization_code });
    if (!user) return res.status(404).json({ message: "User not found" });
    // Use user's email to find notifications
    const notifications = await Notifications.find({ email: user.email }).sort({ issued_at: -1 });
    
    const formatted = notifications.map(n => formatNotification(n, user));
    res.status(200).json({
      total: formatted.length,
      notifications: formatted
    });

  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// PATCH /api/notifications/read/:id
exports.readNotificationByUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findOne({
      username: req.user.username,
      organization_code: req.user.organization_code,
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const notif = await Notifications.findOneAndUpdate(
      { _id: id, email: user.email },
      { read: true },
      { returnDocument: 'after' }
    );

    if (!notif) return res.status(404).json({ message: "Notification not found" });

    res.status(200).json({ message: "Notification marked as read" });

  } catch (error) {
    console.error("Error marking read:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// DELETE /api/notifications/delete-notification/:id
exports.deleteNotificationById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await Users.findOne({
      username: req.user.username,
      organization_code: req.user.organization_code,
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found', errorType: 'USER_NOT_FOUND' });
    }

    const deleted = await Notifications.findOneAndDelete({
      _id: id,
      email: user.email,
    });

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Notification not found or access denied', errorType: 'NOTIFICATION_NOT_FOUND' });
    }

    res.status(200).json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ success: false, message: 'Internal server error while deleting notification', errorType: 'SERVER_ERROR' });
  }
};

// DELETE /api/notifications/clear/:username
exports.clearUserNotifications = async (req, res) => {
  try {
    const { username } = req.params;
    if (username !== req.user.username) return res.status(403).json({ message: 'Access denied' });

    // Find user by username
    const user = await Users.findOne({ username, organization_code: req.user.organization_code });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Clear notifications for that user's email
    await Notifications.deleteMany({ email: user.email });

    res.status(200).json({ message: "All notifications cleared for user" });

  } catch (error) {
    console.error("Error clearing notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
};
