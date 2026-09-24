const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    // E2E audit finding H-11: every query in notificationController.js
    // (list, mark-as-read, delete) filters by email, which had no index
    // at all -- a full collection scan on every "get my notifications" call.
    email: {type:String, required: true, index: true},
    notification_title: {type:String, required: true},
    notification_description: {type:String, required: true},
    issued_at: {type:String, required: true},
    read: {type:Boolean, required: false}
});

module.exports = mongoose.model('Notifications', notificationSchema);