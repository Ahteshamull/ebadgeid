// routes/ticketRoutes.js
const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/ticketController");
const authMiddleware = require("../middleware/authMiddleware");

// Public create ticket
router.post("/", ticketController.createTicket);

// Get all tickets (requires admin or agent)
router.get("/", authMiddleware(["admin", "agent"]), ticketController.getAllTickets);

// Get ticket by code
router.get("/:ticket_code", authMiddleware(["user", "otp", "agent", "admin"]), ticketController.getTicketByCode);

// Update ticket (admin or agent)
router.put("/:ticket_code", authMiddleware(["admin", "agent"]), ticketController.updateTicket);

// Delete ticket (admin or agent) -- previously the frontend's "Delete
// ticket" button called this exact route shape with no backend
// implementation at all (found during an audit round).
router.delete("/:ticket_code", authMiddleware(["admin", "agent"]), ticketController.deleteTicket);

// Add message (protected - allows users to join unassigned tickets)
router.post("/:ticket_code/messages", authMiddleware(["user", "otp", "agent", "admin"]), ticketController.addMessage);

// Change status (admin or agent)
router.patch("/:ticket_code/status", authMiddleware(["admin", "agent"]), ticketController.changeStatus);

// Add member to ticket
router.post('/:ticket_code/add-member', authMiddleware(["agent", "admin"]), ticketController.AddMemberToTicket);

// Assign ticket to a single agent/admin -- distinct from add-member above
// (a team-style membership list, not a 1:1 owner).
router.patch('/:ticket_code/assign', authMiddleware(["agent", "admin"]), ticketController.assignTicket);

// Get tickets by email
router.get('/email/:email', authMiddleware(["user", "otp", "agent", "admin"]), ticketController.getTicketsByEmail);

module.exports = router;
