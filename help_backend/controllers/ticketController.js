const Ticket = require("../models/tickets");
const User = require("../models/User");
const { getCurrentISOTime } = require("../utils/timeUtils");
const { resolvePublicOrganizationCode } = require("../middleware/publicOrganization");
const crypto = require('crypto');

const normalizeIdentity = value => String(value || '').trim().toLowerCase();

// E2E audit finding H-04: attachment used to be accepted with only
// Array.isArray()/slice(0,10) -- any string could be stored and later
// rendered by the frontend as a "ticket attachment", with no guarantee it
// pointed at a real, managed upload. Same origin + managed-filename-shape
// check articleController.js's managedMarkdownUrl already applies to
// article content, generalized to the actual file types the shared
// storage service's upload endpoint accepts (see backend (updated)/
// controllers/uploadController.js's ALLOWED_MIME).
const managedUploadUrl = value => {
  if (typeof value !== 'string') return false;
  try {
    const candidate = new URL(value);
    const allowedOrigin = new URL(process.env.PUBLIC_STORAGE_BASE_URL).origin;
    return candidate.origin === allowedOrigin && /^\/uploads\/[a-f0-9]+\.(png|jpe?g|webp|pdf)$/i.test(candidate.pathname);
  } catch {
    return false;
  }
};

const ticketAccessFilter = (req, ticketCode) => {
    const identity = normalizeIdentity(req.user?.email || req.user?.username);
    const filter = { ticket_code: ticketCode };
    filter.organization_code = req.user?.org_code || '__missing_org__';
    if (!['admin', 'agent'].includes(req.user?.user_type)) {
        filter['ticket_members.usernameOrEmail'] = identity;
    }
    return filter;
};

exports.createTicket = async (req, res) => {
    try {
        const { ticket_title, department, ticket_description, priority, usernameOrEmail } = req.body;
        if (!ticket_title?.trim() || !ticket_description?.trim() || !usernameOrEmail?.trim()) {
            return res.status(400).json({ error: 'Title, description and contact email are required' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(usernameOrEmail) || !['low', 'medium', 'high', 'urgent', 'critical'].includes(priority)) {
            return res.status(400).json({ error: 'Invalid email or priority' });
        }
        const now = getCurrentISOTime();
        const contact = normalizeIdentity(usernameOrEmail);
        // Resolve the tenant before looking up an existing identity. Email
        // is intentionally no longer global in the helpdesk: the same
        // person can legitimately exist in two organizations. A supplied
        // but invalid organization must never silently fall back to the
        // default tenant (that was both confusing and cross-tenant-prone).
        const suppliedOrganizationCode = String(req.body.organization_code || '').trim();
        const requestedOrganizationCode = suppliedOrganizationCode
          ? await resolvePublicOrganizationCode(suppliedOrganizationCode)
          : null;
        if (suppliedOrganizationCode && !requestedOrganizationCode) {
            return res.status(400).json({ error: 'organization_code is invalid or does not exist' });
        }
        // DEFAULT_ORG_CODE remains a compatibility path only when the
        // caller omitted organization_code entirely in a single-tenant
        // deployment; it can never override an explicit invalid value.
        const organizationCode = requestedOrganizationCode || process.env.DEFAULT_ORG_CODE;
        if (!organizationCode) {
            return res.status(400).json({ error: 'This helpdesk is not configured to accept public tickets' });
        }
        const existingUser = await User.findOne({ email: contact, org_code: organizationCode }).select('org_code').lean();
        const ticket = new Ticket({
            ticket_code: `TKT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            ticket_title: ticket_title.trim().slice(0, 200),
            department: department?.trim().slice(0, 100),
            ticket_description: ticket_description.trim().slice(0, 5000),
            organization_code: organizationCode,
            priority,
            last_activity: now,
            ticket_members: [{ user_type: 'user', usernameOrEmail: contact }],
            messages: [{ user_type: 'user', username: contact, createdAt: now, message_content: ticket_description.trim().slice(0, 5000) }]
        });
        await ticket.save();
        res.status(201).json(ticket);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.AddMemberToTicket = async (req, res) => {
    try {
        const { ticket_code } = req.params;
        const { email } = req.body;

        // Find the ticket
        const ticket = await Ticket.findOne(ticketAccessFilter(req, ticket_code));
        if (!ticket) {
            return res.status(404).json({ error: "Ticket not found" });
        }

        const isStaff = ['admin', 'agent'].includes(req.user.user_type);
        if (!isStaff) return res.status(403).json({ error: 'Only helpdesk staff can add members' });

        // Check if user exists with this email
        const normalizedEmail = normalizeIdentity(email);
        const user = await User.findOne({ email: normalizedEmail, org_code: ticket.organization_code });
        if (!user) {
            return res.status(404).json({ error: "User with this email not found" });
        }

        // Check if user is already a member of this ticket
        const isAlreadyMember = ticket.ticket_members.some(
            member => normalizeIdentity(member.usernameOrEmail) === normalizedEmail
        );
        if (isAlreadyMember) {
            return res.status(400).json({ error: "User is already a member of this ticket" });
        }

        // Add user as a member to the ticket
        ticket.ticket_members.push({
            user_type: user.user_type,
            usernameOrEmail: normalizedEmail
        });

        ticket.last_activity = getCurrentISOTime();
        await ticket.save();

        res.status(200).json({
            message: "User added to ticket successfully",
            ticket
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.addMessage = async (req, res) => {
  try {
    const { ticket_code } = req.params;
    const { message_content, attachment = [] } = req.body;
    if (!message_content?.trim() && (!Array.isArray(attachment) || attachment.length === 0)) {
      return res.status(400).json({ error: 'Message content or attachment required' });
    }
    if (attachment.length && !attachment.every(managedUploadUrl)) {
      return res.status(400).json({ error: 'Each attachment must be a real, previously uploaded managed-storage file URL' });
    }
    const createdAt = getCurrentISOTime();

    const ticket = await Ticket.findOne(ticketAccessFilter(req, ticket_code));
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    const isMember = ticket.ticket_members.some(
      member =>
        member.usernameOrEmail === req.user.email ||
        member.usernameOrEmail === req.user.username
    );

    const isStaff = ['admin', 'agent'].includes(req.user.user_type);
    if (!isMember && !isStaff) {
      return res.status(403).json({ message: "You are not allowed to post a message on this ticket" });
    }

    ticket.messages.push({
      message_content: message_content?.trim().slice(0, 5000) || 'Attachment',
      attachment: Array.isArray(attachment) ? attachment.slice(0, 10) : [],
      createdAt,
      username: req.user.username || req.user.email,
      user_type: req.user.user_type
    });
    ticket.last_activity = createdAt;

    await ticket.save();
    res.status(200).json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.changeStatus = async (req, res) => {
    try {
        const { ticket_code } = req.params;
        const { status } = req.body;
        if (!['open', 'pending', 'in_progress', 'resolved', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid ticket status' });
        }

        const ticket = await Ticket.findOneAndUpdate(
            { ticket_code, organization_code: req.user.org_code },
            { status, last_activity: getCurrentISOTime() },
            { new: true }
        );

        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        res.status(200).json(ticket);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Real 1:1 "assign ticket to an agent" (audit finding: only "Add member",
// a team-style membership list, existed -- there was no single owner
// field, endpoint, or UI at all). A null/empty email unassigns the
// ticket; otherwise the target must be a real admin/agent in the SAME
// organization as the ticket -- assigning to a plain 'user' or to staff
// from a different org would silently create a ticket no one on the
// correct team can act on.
exports.assignTicket = async (req, res) => {
    try {
        const { ticket_code } = req.params;
        const { email } = req.body;

        if (!email || !String(email).trim()) {
            const unassigned = await Ticket.findOneAndUpdate(
                { ticket_code, organization_code: req.user.org_code },
                { assigned_to: null, last_activity: getCurrentISOTime() },
                { new: true }
            );
            if (!unassigned) return res.status(404).json({ error: "Ticket not found" });
            return res.status(200).json(unassigned);
        }

        const normalizedEmail = normalizeIdentity(email);
        const agent = await User.findOne({ email: normalizedEmail, org_code: req.user.org_code });
        if (!agent || !['admin', 'agent'].includes(agent.user_type)) {
            return res.status(400).json({ error: 'Ticket can only be assigned to a helpdesk admin or agent in this organization' });
        }

        const ticket = await Ticket.findOneAndUpdate(
            { ticket_code, organization_code: req.user.org_code },
            { assigned_to: normalizedEmail, last_activity: getCurrentISOTime() },
            { new: true }
        );
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        res.status(200).json(ticket);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Bug found during an audit round: the "Delete ticket" button in
// helpdesk_frontend called DELETE /api/tickets/:id, a route that never
// existed on this backend -- it always failed with a 404. Same
// admin/agent-only, org-scoped pattern as changeStatus/updateTicket above.
exports.deleteTicket = async (req, res) => {
    try {
        const { ticket_code } = req.params;
        const deleted = await Ticket.findOneAndDelete({ ticket_code, organization_code: req.user.org_code });
        if (!deleted) return res.status(404).json({ error: "Ticket not found" });
        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateTicket = async (req, res) => {
    try {
        const { ticket_code } = req.params;
        const allowed = ['ticket_title', 'department', 'ticket_description', 'priority'];
        const data = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
        data.last_activity = getCurrentISOTime();

        const updated = await Ticket.findOneAndUpdate(
            { ticket_code, organization_code: req.user.org_code },
            data,
            { new: true, runValidators: true }
        );
        if (!updated) return res.status(404).json({ error: "Ticket not found" });

        res.status(200).json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getAllTickets = async (req, res) => {
    try {
        const limit = Math.min(Number.parseInt(req.query.limit, 10) || 100, 500);
        const skip = Math.max(Number.parseInt(req.query.skip, 10) || 0, 0);
        const tickets = await Ticket.find({ organization_code: req.user.org_code })
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit);
        res.status(200).json(tickets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getTicketByCode = async (req, res) => {
  const { ticket_code } = req.params;
  const ticket = await Ticket.findOne(ticketAccessFilter(req, ticket_code));
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  return res.status(200).json(ticket);
};

exports.getTicketsByEmail = async (req, res) => {
    try {
        const { email } = req.params;

        const normalizedEmail = normalizeIdentity(email);
        const isStaff = req.user.user_type === "admin" || req.user.user_type === "agent";
        const isOwner = normalizeIdentity(req.user.email) === normalizedEmail || normalizeIdentity(req.user.username) === normalizedEmail;
        const isOtpOwner = req.user.user_type === "otp" && normalizeIdentity(req.user.email) === normalizedEmail;
        if (!isStaff && !isOwner && !isOtpOwner) {
            return res.status(403).json({ error: "Access denied" });
        }

        // First check if the requesting user is an admin/agent or the same user
      

        // Find tickets with only specific fields
        const tickets = await Ticket.find(
            {
                organization_code: req.user.org_code,
                'ticket_members.usernameOrEmail': normalizedEmail
            },
            { 
                ticket_code: 1,
                ticket_title: 1,
                ticket_description: 1,
                status: 1,
                priority: 1,
                last_activity: 1,
                _id: 0  // Exclude the MongoDB _id field
            }
        );

        res.status(200).json(tickets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
