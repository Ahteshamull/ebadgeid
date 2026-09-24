// models/Ticket.js
const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
    ticket_code: { type: String, required: true, unique: true, index: true },
    organization_code: { type: String, required: true, index: true },
    ticket_title: { type: String, required: true },
    department: { type: String, required: false, maxlength: 100 },
    ticket_description: { type: String, required: true },
    last_activity: { type: String, required: true },
    ticket_members: [
        {
            user_type: { type: String, required: true },
            usernameOrEmail: { type: String, required: true }
        }
    ],
    status: {
        type: String,
        required: true,
        default: 'open',
        enum: ['open', 'pending', 'in_progress', 'resolved', 'closed']
    },
    priority: {
        type: String,
        required: true,
        enum: ['low', 'medium', 'high', 'urgent', 'critical']
    },
    // Real 1:1 assignment (audit finding: "Asignar ticket a un agente" did
    // not exist -- ticket_members above is a team-style membership list,
    // not an assignment; a ticket could have five members and still no
    // single agent responsible for it). Stores the assigned staff member's
    // normalized email, or null when unassigned -- see
    // ticketController.js's assignTicket.
    assigned_to: { type: String, default: null, index: true },
    messages: [
        {
            user_type: { type: String, required: true },
            username: { type: String, required: true },
            createdAt: { type: String, required: true },
            message_content: { type: String, required: true },
            attachment: [String] // optional
        }
    ],
    channel: {type:String, required: false} // Contact Form, Raise Ticket, Chatbot
}, { timestamps: true });

ticketSchema.index({ organization_code: 1, status: 1, last_activity: -1 });

module.exports = mongoose.model("Tickets", ticketSchema);
