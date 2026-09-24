const Notifications = require('../models/notificationsSchema');
const logger = require('./logger');

/**
 * Creates an in-app notification for a given email address.
 * Safely degrades if database error occurs so parent operation does not fail.
 *
 * @param {Object} params
 * @param {string} params.email - Recipient email
 * @param {string} params.title - Notification title
 * @param {string} params.description - Notification message/body
 * @returns {Promise<Object|null>} Created notification document or null
 */
async function sendInAppNotification({ email, title, description }) {
  if (!email || !title) return null;
  try {
    const notif = await Notifications.create({
      email: String(email).trim().toLowerCase(),
      notification_title: title,
      notification_description: description || '',
      issued_at: new Date().toISOString(),
      read: false,
    });
    return notif;
  } catch (error) {
    logger.error('in_app_notification_creation_failed', {
      email,
      title,
      message: error.message,
    });
    return null;
  }
}

module.exports = {
  sendInAppNotification,
};
