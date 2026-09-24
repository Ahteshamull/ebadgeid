'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { 
  Download, 
  Plus, 
  Loader2, 
  Ban, 
  AlertTriangle, 
  Search,
  Filter,
  Award,
  Shield,
  FileCheck,
  FileX,
  Upload,
  FileText,
  User,
  Hash,
  Building,
  MapPin
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Bulk-issue CSV parsing (splitCsvLine, parseBulkRecipients) lives in
// lib/bulk-csv-utils.mjs — plain, dependency-free logic pulled out for the
// same reason editor-utils.mjs was: it can be unit tested directly (see
// tests/bulk-csv-utils.test.mjs) instead of only through this component.
import { parseBulkRecipients, BULK_CSV_COLUMNS } from '@/lib/bulk-csv-utils.mjs';
import CredentialPreview from '@/components/CredentialPreview';

export default function CredentialManagementPage() {
  const { session } = useSession();
  const [search, setSearch] = useState('');
  const [credentials, setCredentials] = useState([]);
  const [designs, setDesigns] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  // The chosen CSV, parsed as soon as it is picked rather than at submit
  // time: the admin needs to see which of their columns became which field,
  // and how many rows are actually valid, BEFORE a batch is issued against
  // their plan quota. Holds { rawText, header, mapping, unmapped,
  // recipients, errors, needsMapping }.
  const [csvPreview, setCsvPreview] = useState(null);
  // Bulk certificates and bulk badges are the same machinery pointed at a
  // different kind of design. Filtering the design list by this is what
  // makes "Bulk Badge" a real flow rather than a certificate flow someone
  // happened to pick a badge design in.
  const [bulkKind, setBulkKind] = useState('certificate');
  // Same idea for issuing one at a time: a badge is issued from a badge
  // design, not from whichever design happened to be first in the list.
  const [issueKind, setIssueKind] = useState('certificate');
  // Which recipient the visual preview is showing.
  const [previewIndex, setPreviewIndex] = useState(0);
  // Remaining monthly credential allowance, read from the server before
  // confirming. Never computed here -- the browser must not be the thing
  // that decides whether a plan has room (see the same figures enforced by
  // POST /credentials/bulk-issue).
  const [bulkAllowance, setBulkAllowance] = useState(null);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [credentialToRevoke, setCredentialToRevoke] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total } while a bulk issuance runs
  const [bulkQueued, setBulkQueued] = useState(false); // true while polling a server-side batch (queues/bulkIssuanceQueue.js), false for the client-side fallback
  const unmountedRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [pagination, setPagination] = useState({
    total_items: 0,
    current_page: 1,
    limit_per_page: 20,
    total_pages: 1,
    has_next_page: false,
    has_prev_page: false
  });

  // Single credential form state
  const [singleForm, setSingleForm] = useState({
    achiever_username: '',
    selected_design: null
  });

  // Guest recipient — someone with no Users record in this organization at
  // all (see AUDIT_FIXES.md, "guest_recipient"). Kept separate from
  // singleForm rather than folded in, since toggling it swaps which fields
  // are even relevant instead of just adding to the same shape.
  const [isGuestRecipient, setIsGuestRecipient] = useState(false);
  const [guestRecipient, setGuestRecipient] = useState({
    first_name: '', last_name: '', email: '', designation: '', city: ''
  });

  // Bulk credential form state
  const [bulkForm, setBulkForm] = useState({
    usernames: '',
    csvFile: null,
    selected_design: null
  });

  // Employees state for the single-issue modal
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // Org-defined field values for the selected design (any text_attribute
  // besides recipient_name, see models/designSchema.js) -- keyed by
  // text_title, collected here and sent as custom_fields to both
  // generateCertificate and createCredential below.
  const [singleFormCustomFields, setSingleFormCustomFields] = useState({});
  // Set once a real certificate image has actually been rendered for this
  // recipient (see handleGeneratePreview) -- while set, the modal shows
  // that real image instead of the form, so an admin sees exactly what
  // will be issued before confirming, not just the blank template
  // background. null means "still filling out the form."
  const [certificatePreview, setCertificatePreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const organizationCode = session?.organization_code;

  const fetchEmployees = async () => {
    try {
      setEmployeesLoading(true);
      if (!organizationCode) return;
      const res = await apiFetch(`/users/org/${organizationCode}`);
      const data = await res.json();
      // Support multiple shapes returned by APIs
      const list = data.data || data.employees || data.users || data;
      if (Array.isArray(list)) {
        setEmployees(list);
      } else {
        setEmployees([]);
      }
    } catch (err) {
      console.error('Error fetching employees:', err);
      setError('Failed to fetch employees');
      setEmployees([]);
    } finally {
      setEmployeesLoading(false);
    }
  };

  const fetchCredentials = async (page = 1, searchTerm = '', status = 'all') => {
    // organizationCode comes from useSession(), which resolves async — the
    // effect below used to fire on mount before it was ready, calling this
    // with organizationCode literally undefined. The backend correctly
    // rejects "/by-organization/undefined" with 403, and apiFetch's 401/403
    // handler sends the browser straight to /auth/login — so every real
    // visit to this page bounced to the login screen before ever rendering,
    // even for an already-logged-in admin. Same guard fetchEmployees()
    // already has, for the same reason.
    if (!organizationCode) return;
    try {
      const statusParam = status !== 'all' ? `&status=${status}` : '';
      const searchParam = searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : '';
      const response = await apiFetch(
        `/credentials/by-organization/${organizationCode}?page=${page}&limit=${itemsPerPage}${statusParam}${searchParam}`
      );
      const data = await response.json();
      
      if (data.status === 'success') {
        setCredentials(data.data || []);
        setPagination(data.pagination || {
          total_items: 0,
          current_page: page,
          limit_per_page: itemsPerPage,
          total_pages: 1,
          has_next_page: false,
          has_prev_page: false
        });
        setCurrentPage(data.pagination?.current_page || page);
      } else {
        setError('Failed to fetch credentials');
        setCredentials([]);
      }
    } catch (err) {
      console.error('Error fetching credentials:', err);
      setError('Failed to fetch credentials');
      setCredentials([]);
    }
  };

  // Fetch credentials when page or status filter changes -- also re-runs
  // once organizationCode itself resolves (it starts undefined until
  // useSession()'s async /auth/me call returns; see the guards in
  // fetchCredentials/fetchDesigns above), so the very first load actually
  // fetches instead of silently no-op'ing on an undefined org code.
  useEffect(() => {
    fetchCredentials(currentPage, search, statusFilter);
    if (currentPage === 1) {
      fetchDesigns();
    }
  }, [currentPage, statusFilter, organizationCode]);

  // Separate effect for search with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1); // Reset to page 1 when searching
      fetchCredentials(1, search, statusFilter);
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [search]);

  // Fetch employees when single-issue modal opens
  useEffect(() => {
    if (showInviteModal) {
      fetchEmployees();
    }
  }, [showInviteModal]);

  // Guards the bulk-issuance status poll below from setting state after
  // this page has been navigated away from.
  useEffect(() => {
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);

  const fetchDesigns = async () => {
    if (!organizationCode) return; // see fetchCredentials() above — same race
    try {
      const response = await apiFetch(`/designs/organization/${organizationCode}`);
      const result = await response.json();
      if (result.success) {
        setDesigns(result.data);
      }
    } catch (err) {
      console.error('Error fetching designs:', err);
      setError('Failed to fetch certificate designs');
    }
  };

  useEffect(() => {
  }, []);

  // Reserves the real credential_code from the backend *before* generating
  // any image, so the QR baked into the certificate can point at this
  // credential's actual verification page instead of the design template's
  // code. See AUDIT_FIXES.md, "Diseño de certificados".
  const reserveCredentialCode = async () => {
    const response = await apiFetch('/credentials/reserve-code', { method: 'POST' });
    if (!response.ok) {
      throw new Error('Failed to reserve a credential code');
    }
    const { credential_code } = await response.json();
    return credential_code;
  };

  const generateCertificate = async (design, achiever_username, credential_code, guestRecipient = null, customFields = null) => {
    const certResponse = await apiFetch('/credentials/generate-certificate', {
      method: 'POST',
      body: JSON.stringify({
        design_code: design.design_code,
        achiever_username,
        credential_code,
        // Server skips the "must already be a registered User" check when
        // this is present — see certificateController.js.
        ...(guestRecipient ? { guest_recipient: true } : {}),
        // Values for any org-defined text field besides recipient_name
        // (see models/designSchema.js) -- sanitized server-side too, see
        // utils/customFields.js.
        ...(customFields && Object.keys(customFields).length ? { custom_fields: customFields } : {}),
      })
    });

    if (!certResponse.ok) {
      throw new Error('Certificate generation failed');
    }

    const generated = await certResponse.json();
    return generated.url;
  };

  const createCredential = async (credential_pic_url, achiever_username, credential_code, guestRecipient = null, customFields = null) => {
    // credential_code used to never be sent here at all, even though the
    // backend schema requires it — every call to this endpoint failed
    // validation. Now it's the code reserved up front in
    // reserveCredentialCode(), so it's guaranteed to exist and to match
    // what's already baked into the certificate's QR.
    const response = await apiFetch('/credentials/create', {
      method: 'POST',
      body: JSON.stringify({
        credential_pic_url,
        achiever_username,
        credential_code,
        // Full recipient details for someone with no Users record — the
        // server builds achiever_details and sends the notification email
        // from this instead of looking up a User. See
        // credentialController.js, createCredential.
        ...(guestRecipient ? { guest_recipient: guestRecipient } : {}),
        // Persisted on the credential for later display -- must be the
        // exact same values already burned into the image by
        // generateCertificate above, not recomputed.
        ...(customFields && Object.keys(customFields).length ? { custom_fields: customFields } : {}),
      })
    });

    if (!response.ok) {
      // Surfaces the backend's actual reason (e.g. a guest display name
      // colliding with a real employee's username, or "credential_code
      // already in use") instead of a generic message that leaves the
      // admin with no idea what to fix — same pattern already used by
      // enqueueBulkIssuance above.
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || body.message || 'Credential creation failed');
    }

    return await response.json();
  };

  const revokeCredential = async (credential_code) => {
    setRevokeLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await apiFetch(`/credentials/revoke/${credential_code}`, {
        method: 'PUT'
      });

      if (!response.ok) {
        throw new Error('Failed to revoke credential');
      }

      const result = await response.json();
      setSuccess(`Credential ${credential_code} has been revoked successfully`);
      fetchCredentials(currentPage, search, statusFilter); // Refresh the credentials list
      setShowRevokeDialog(false);
      setCredentialToRevoke(null);
    } catch (err) {
      console.error('Error revoking credential:', err);
      setError('Failed to revoke credential: ' + err.message);
    } finally {
      setRevokeLoading(false);
    }
  };

  const handleRevokeClick = (credential) => {
    setCredentialToRevoke(credential);
    setShowRevokeDialog(true);
  };

  // Step 1 of 2: renders the real certificate image (exactly what
  // generateCertificate would produce for the final issuance -- same code
  // path, not an approximation) so the admin can see it before anything is
  // actually persisted as an issued credential. Nothing in the Credentials
  // collection exists yet after this -- only createCredential (step 2,
  // handleConfirmIssue below) actually issues it.
  const handleGeneratePreview = async () => {
    const guestName = `${guestRecipient.first_name.trim()} ${guestRecipient.last_name.trim()}`.trim();
    const achieverUsername = isGuestRecipient ? guestName : singleForm.achiever_username;

    if (!achieverUsername || !singleForm.selected_design) {
      setError('Please fill all required fields');
      return;
    }
    if (isGuestRecipient && (!guestRecipient.first_name.trim() || !guestRecipient.last_name.trim() || !guestRecipient.email.trim())) {
      setError('Guest recipients need a first name, last name, and email');
      return;
    }

    setPreviewLoading(true);
    setError('');
    setSuccess('');

    try {
      const guestPayload = isGuestRecipient ? {
        first_name: guestRecipient.first_name.trim(),
        last_name: guestRecipient.last_name.trim(),
        email: guestRecipient.email.trim(),
        designation: guestRecipient.designation.trim(),
        city: guestRecipient.city.trim(),
      } : null;

      // Reserve the real credential_code first (see AUDIT_FIXES.md), then
      // generate the certificate image with that code baked into its QR.
      // This credential_code and image are reused as-is by
      // handleConfirmIssue below, so confirming never re-renders and can
      // never end up with a different image than what was actually shown.
      const credential_code = await reserveCredentialCode();
      const url = await generateCertificate(
        singleForm.selected_design,
        achieverUsername,
        credential_code,
        guestPayload,
        singleFormCustomFields
      );
      setCertificatePreview({ credential_code, url, achieverUsername, guestPayload });
    } catch (err) {
      console.error('Error generating certificate preview:', err);
      setError('Failed to generate certificate preview: ' + err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Step 2 of 2: actually issues the credential the admin just previewed,
  // using the exact same credential_code and image URL from step 1.
  const handleConfirmIssue = async () => {
    if (!certificatePreview) return;
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await createCredential(
        certificatePreview.url,
        certificatePreview.achieverUsername,
        certificatePreview.credential_code,
        certificatePreview.guestPayload,
        singleFormCustomFields
      );

      setSuccess(certificatePreview.guestPayload
        ? `Credential issued and emailed to ${certificatePreview.guestPayload.email}!`
        : 'Credential issued successfully!');
      setSingleForm({ achiever_username: '', selected_design: null });
      setSelectedEmployee(null);
      setIsGuestRecipient(false);
      setGuestRecipient({ first_name: '', last_name: '', email: '', designation: '', city: '' });
      setSingleFormCustomFields({});
      setCertificatePreview(null);
      setShowInviteModal(false);
      fetchCredentials(currentPage, search, statusFilter); // Refresh the credentials list
    } catch (err) {
      console.error('Error creating credential:', err);
      setError('Failed to issue credential: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Discards the previewed render without issuing it -- back to the form
  // to change something. The already-rendered image and reserved code are
  // simply abandoned (same as any dropped issuance today, e.g. a closed
  // tab between generate and create).
  const handleDiscardPreview = () => {
    setCertificatePreview(null);
    setError('');
  };

  // Enqueues onto the real backend job queue (queues/bulkIssuanceQueue.js —
  // a job per credential, with retries, that survives this tab closing
  // mid-batch). Returns null if the server reports the queue isn't
  // configured (503, no REDIS_URL set) so the caller can fall back instead
  // of failing the whole operation outright — mirrors how that endpoint
  // itself degrades explicitly rather than silently.
  // `recipients` is an array of { achiever_username, guest_recipient? } —
  // see parseBulkRecipients below for how a CSV row becomes one of these.
  const enqueueBulkIssuance = async (recipients, design) => {
    const response = await apiFetch('/credentials/bulk-issue', {
      method: 'POST',
      body: JSON.stringify({
        recipients,
        design_code: design.design_code,
        credential_title: design.credential_title || design.design_code,
      }),
    });
    if (response.status === 503) return null;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Failed to queue bulk issuance');
    }
    return await response.json(); // { batchId, total }
  };

  // Polls GET /credentials/bulk-issue/:batchId until every job in the batch
  // has either completed or failed, updating bulkProgress as it goes so the
  // modal's progress bar reflects real server-side state instead of a
  // client-side guess.
  const pollBulkIssuanceStatus = (batchId, total) => new Promise((resolve, reject) => {
    const POLL_INTERVAL_MS = 3000;
    const MAX_ATTEMPTS = 200; // ~10 minutes at 3s — a batch still running past that needs attention either way, not a longer timeout
    let attempts = 0;

    const tick = async () => {
      if (unmountedRef.current) return; // navigated away — stop polling silently, the batch keeps running server-side regardless
      attempts += 1;
      try {
        const response = await apiFetch(`/credentials/bulk-issue/${batchId}`);
        if (!response.ok) throw new Error('Failed to check bulk issuance status');
        const status = await response.json();
        if (!unmountedRef.current) {
          setBulkProgress({ done: status.completed + status.failed, total: status.total || total });
        }
        if (status.completed + status.failed >= status.total) {
          resolve(status);
          return;
        }
      } catch (err) {
        // A transient poll failure shouldn't abandon a batch that's still
        // running server-side — keep polling until MAX_ATTEMPTS instead of
        // failing the whole batch over one dropped request.
        console.error('Error polling bulk issuance status:', err);
      }
      if (attempts >= MAX_ATTEMPTS) {
        reject(new Error('Timed out waiting for bulk issuance to finish — it may still complete on the server; check the credentials list shortly.'));
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();
  });

  // A ready-to-fill example matching exactly what parseBulkRecipients above
  // expects — one registered-user row (just a username, other columns
  // blank) and one guest row (no username, real name + email instead), so
  // opening the file in a spreadsheet makes the two supported row shapes
  // obvious without reading documentation.
  const downloadBulkCsvTemplate = () => {
    // Only the three fields an issuance actually needs. BULK_CSV_COLUMNS is
    // deliberately NOT used here: the parser still accepts username,
    // designation and city so older files keep working, but offering six
    // columns made people think all six were required and invited half-filled
    // rows. Three columns, one obvious job each.
    const csv = [
      'first_name,last_name,email',
      'Jane,Smith,jane.smith@example.com',
    ].join('\n');
    // Leading \uFEFF is a UTF-8 BOM. Without it Excel on Windows opens the
    // file as Latin-1 and mangles every accented name -- most names in this
    // market -- and those mangled names are what gets printed on the
    // credential that actually reaches the recipient.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk-credential-recipients-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Deferred: Safari cancels the download when the object URL is revoked
    // in the same frame as the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Parses the picked file straight away so the mapping and preview panels
  // can show what this file will actually do.
  const handleCsvFileSelected = async (file) => {
    setBulkForm((prev) => ({ ...prev, csvFile: file || null }));
    setCsvPreview(null);
    setBulkAllowance(null);
    setPreviewIndex(0);
    if (!file) return;
    try {
      const rawText = await file.text();
      setCsvPreview({ rawText, ...parseBulkRecipients(rawText) });
    } catch {
      setError('That file could not be read. Save it as a plain .csv and try again.');
    }
  };

  // Re-parses the same file under a mapping the admin corrected by hand.
  // Passing an empty mapping falls back to automatic detection rather than
  // parsing every column as nothing.
  const applyCsvMapping = (column, rawIndex) => {
    setCsvPreview((prev) => {
      if (!prev) return prev;
      const mapping = { ...(prev.mapping || {}) };
      if (rawIndex === '') {
        delete mapping[column];
      } else {
        const index = Number(rawIndex);
        // One CSV column can only feed one field -- claiming it for a new
        // field releases it from whichever field held it before.
        Object.keys(mapping).forEach((key) => { if (mapping[key] === index) delete mapping[key]; });
        mapping[column] = index;
      }
      const hasMapping = Object.keys(mapping).length > 0;
      const reparsed = hasMapping
        ? parseBulkRecipients(prev.rawText, { mapping })
        : parseBulkRecipients(prev.rawText);
      return { ...prev, ...reparsed, mapping: hasMapping ? mapping : (reparsed.mapping || {}) };
    });
    setBulkAllowance(null);
  };

  // Asks the server how much monthly quota is left. The answer is the
  // server's, not a number computed here -- POST /bulk-issue enforces the
  // very same figures, so the confirmation screen and the refusal can never
  // disagree.
  const checkBulkAllowance = async (requested) => {
    try {
      const res = await apiFetch(`/credentials/bulk-issue/allowance?requested=${encodeURIComponent(requested)}`);
      if (!res.ok) return null;
      const allowance = await res.json();
      setBulkAllowance(allowance);
      return allowance;
    } catch {
      // A failed pre-flight must not block issuance: POST /bulk-issue does
      // the authoritative check and will refuse with the real numbers.
      return null;
    }
  };

  const handleBulkCredentialSubmit = async () => {
    if (!bulkForm.selected_design || (!bulkForm.usernames && !bulkForm.csvFile)) {
      setError('Please select a design and provide usernames');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      let recipients = [];

      if (bulkForm.csvFile) {
        // Reuse exactly what the preview showed, including any mapping the
        // admin corrected -- re-parsing from scratch here would silently
        // discard that correction and issue a different batch from the one
        // they just reviewed.
        const parsed = csvPreview?.rawText
          ? csvPreview
          : parseBulkRecipients(await bulkForm.csvFile.text());
        if (parsed.errors.length > 0) {
          setError(`Fix these rows and re-upload: ${parsed.errors.join('; ')}`);
          setLoading(false);
          return;
        }
        recipients = parsed.recipients;
      } else {
        // Plain comma-separated usernames — unchanged, this box has never
        // supported guest recipients (that needs a name + email per row,
        // which doesn't fit a one-line text box); use the CSV upload for that.
        recipients = bulkForm.usernames.split(',').map(u => u.trim()).filter(u => u).map((achiever_username) => ({ achiever_username }));
      }

      if (recipients.length === 0) {
        setError('No valid recipients found — check the file has at least one row with a username or an email.');
        setLoading(false);
        return;
      }

      // Ask the server what this organization has left BEFORE starting.
      // Without this the admin finds out mid-batch, with some recipients
      // issued and the rest refused -- the worst possible moment.
      const allowance = await checkBulkAllowance(recipients.length);
      if (allowance && allowance.can_issue === false) {
        setError(
          `This batch needs ${recipients.length} credentials but only ${allowance.remaining} remain this month `
          + `on the ${allowance.plan_name} plan (${allowance.used} of ${allowance.limit} used). `
          + `Reduce the batch or upgrade the plan.`
        );
        setLoading(false);
        return;
      }

      // Prefer the real server-side queue over the client-side fallback
      // below — a job per credential, with retries, that survives this tab
      // closing mid-batch, instead of losing all progress on a refresh.
      const queued = await enqueueBulkIssuance(recipients, bulkForm.selected_design);

      if (queued) {
        setBulkQueued(true);
        setBulkProgress({ done: 0, total: queued.total });

        const finalStatus = await pollBulkIssuanceStatus(queued.batchId, queued.total);
        if (unmountedRef.current) return;

        if (finalStatus.failed > 0) {
          setError(`Bulk issuance finished: ${finalStatus.completed} succeeded, ${finalStatus.failed} failed. Check server logs for details on the failures.`);
        } else {
          setSuccess(`Successfully issued ${finalStatus.completed} credentials`);
        }
        setBulkForm({ usernames: '', csvFile: null, selected_design: null });
        setCsvPreview(null);
        setBulkAllowance(null);
        setShowBulkModal(false);
        fetchCredentials(currentPage, search, statusFilter);
        return;
      }

      // --- Fallback: this server has no REDIS_URL configured, so the real
      // queue above returned null (503) instead of accepting the batch.
      // Same bounded-concurrency approach as before the queue existed.
      setBulkQueued(false);
      const results = [];
      const errors = [];

      const CONCURRENCY = 5;
      let cursor = 0;
      setBulkProgress({ done: 0, total: recipients.length });

      const worker = async () => {
        while (cursor < recipients.length) {
          const recipient = recipients[cursor++];
          const { achiever_username, guest_recipient } = recipient;
          try {
            const credential_code = await reserveCredentialCode();
            const certificateUrl = await generateCertificate(bulkForm.selected_design, achiever_username, credential_code, guest_recipient || null);
            await createCredential(certificateUrl, achiever_username, credential_code, guest_recipient || null);
            results.push(achiever_username);
          } catch (err) {
            console.error(`Error processing ${achiever_username}:`, err);
            errors.push(`${achiever_username}: ${err.message}`);
          }
          setBulkProgress({ done: results.length + errors.length, total: recipients.length });
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, recipients.length) }, worker));

      if (results.length > 0) {
        setSuccess(`Successfully issued ${results.length} credentials`);
      }
      if (errors.length > 0) {
        setError(`Errors: ${errors.join(', ')}`);
      }

      setBulkForm({ usernames: '', csvFile: null, selected_design: null });
      setCsvPreview(null);
      setBulkAllowance(null);
      setShowBulkModal(false);
      fetchCredentials(currentPage, search, statusFilter); // Refresh the credentials list
    } catch (err) {
      console.error('Error in bulk credential creation:', err);
      setError('Failed to process bulk credentials: ' + err.message);
    } finally {
      if (!unmountedRef.current) {
        setLoading(false);
        setBulkProgress(null);
      }
    }
  };

  const getStatusBadge = (status) => {
    switch (status?.toLowerCase()) {
      case 'issued':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
            <FileCheck className="h-3 w-3 mr-1" />
            Active
          </Badge>
        );
      case 'revoked':
        return (
          <Badge variant="destructive" className="text-xs text-white px-3 py-1">
            <FileX className="h-3 w-3 mr-1" />
            Revoked
          </Badge>
        );
      case 'expired':
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Expired
          </Badge>
        );
      case 'claimed':
        return (
          <Badge variant="outline" className="border-blue-500 text-blue-600">
            <Shield className="h-3 w-3 mr-1" />
            Claimed
          </Badge>
        );
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const renderActionButtons = (credential) => {
    const status = credential.credential_status?.toLowerCase();
    const isRevokable = status === 'issued' || status === 'claimed';
    
    return (
      <div className="flex gap-2">
        <Button
          variant={isRevokable ? "default" : "outline"}
          size="sm"
          onClick={() => isRevokable && handleRevokeClick(credential)}
          disabled={!isRevokable}
          className={`text-xs px-3 py-1 h-8 ${
            isRevokable 
              ? 'bg-black text-white hover:bg-zinc-900' 
              : 'border-black text-black cursor-not-allowed opacity-50'
          }`}
        >
          <Ban className="h-3 w-3 mr-1" />
          Revoke
        </Button>
      </div>
    );
  };

  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  const stats = {
    total: pagination.total_items,
    active: credentials.filter(c => c.credential_status?.toLowerCase() === 'issued').length,
    revoked: credentials.filter(c => c.credential_status?.toLowerCase() === 'revoked').length,
    claimed: credentials.filter(c => c.credential_status?.toLowerCase() === 'claimed').length,
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Credential Management
            </h1>
            <p className="text-muted-foreground mt-2">
              Issue, manage, and verify digital credentials and certificates
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { setIssueKind('certificate'); setShowInviteModal(true); }} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-xs">
              <FileCheck className="h-4 w-4" />
              Issue Certificate
            </Button>
            <Button onClick={() => { setIssueKind('badge'); setShowInviteModal(true); }} className="gap-2 bg-purple-600 hover:bg-purple-700 text-white shadow-xs">
              <Award className="h-4 w-4" />
              Issue Badge
            </Button>
            <Button onClick={() => setShowBulkModal(true)} variant="outline" className="gap-2 border-border text-foreground hover:bg-muted">
              <Upload className="h-4 w-4" />
              Bulk Issue
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Credentials</p>
                  <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                </div>
                <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                  <Award className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold text-foreground">{stats.active}</p>
                </div>
                <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg">
                  <FileCheck className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Revoked</p>
                  <p className="text-2xl font-bold text-foreground">{stats.revoked}</p>
                </div>
                <div className="p-2 bg-rose-500/10 text-rose-500 rounded-lg">
                  <FileX className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Claimed</p>
                  <p className="text-2xl font-bold text-foreground">{stats.claimed}</p>
                </div>
                <div className="p-2 bg-purple-500/10 text-purple-500 rounded-lg">
                  <Shield className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Alerts */}
        {error && (
          <Alert variant="destructive" className="bg-rose-500/10 border-rose-500/30 text-rose-500">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-rose-600 dark:text-rose-400">{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="bg-emerald-500/10 border-emerald-500/30 text-emerald-500">
            <FileCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <AlertDescription className="text-emerald-700 dark:text-emerald-300">{success}</AlertDescription>
          </Alert>
        )}

        {/* Search and Filters */}
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex flex-1 gap-4 items-center">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search credentials by code or username..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 bg-background border-border text-foreground"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(value) => {
                  setStatusFilter(value);
                  setCurrentPage(1);
                }}>
                  <SelectTrigger className="w-[180px] bg-background border-border text-foreground" aria-label="Filter by status">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="issued">Active</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="claimed">Claimed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-muted-foreground">
                Showing {(pagination.current_page - 1) * pagination.limit_per_page + 1}-{Math.min(pagination.current_page * pagination.limit_per_page, pagination.total_items)} of {pagination.total_items} credentials
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Credentials Table */}
        <Card className="bg-card border-border overflow-hidden shadow-sm">
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-xl flex items-center gap-2 text-foreground">
              <Award className="h-5 w-5" />
              Credentials
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-b border-border">
                    <TableHead className="w-16 text-muted-foreground font-medium">Achiever</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Credential Details</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Organization</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Blockchain Hash</TableHead>
                    <TableHead className="text-muted-foreground font-medium text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credentials.map((credential, index) => (
                    <TableRow 
                      key={index} 
                      className="border-b border-border hover:bg-muted/40 transition-colors"
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10 border-2 border-border shadow-sm flex-shrink-0">
                            <AvatarImage 
                              src={credential.credential_pic_url} 
                              alt={credential.achiever_username}
                              className="object-cover"
                            />
                            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs font-semibold">
                              {getInitials(credential.achiever_details?.first_name, credential.achiever_details?.last_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate">
                              {credential.achiever_details?.first_name} {credential.achiever_details?.last_name}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              @{credential.achiever_username}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="text-sm text-foreground font-medium">
                            {credential.credential_title}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Hash className="h-3 w-3" />
                            {credential.credential_code}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Issued: {new Date(credential.credential_issue_date).toLocaleDateString()}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-sm text-foreground">
                            <Building className="h-3 w-3" />
                            {credential.organization_detail?.name || 'N/A'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {credential.organization_detail?.code}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(credential.credential_status)}
                      </TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1 text-sm text-muted-foreground cursor-help max-w-[200px]">
                                <Hash className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate font-mono text-xs">
                                  {credential.credential_blockchain_hashes || 'No hash'}
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="bg-popover text-popover-foreground border-border">
                              <p className="font-mono text-xs max-w-xs break-all">
                                {credential.credential_blockchain_hashes || 'No blockchain hash available'}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {renderActionButtons(credential)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            
            {credentials.length === 0 && (
              <div className="text-center py-12">
                <Award className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-lg font-medium text-foreground mb-2">No credentials found</h2>
                <p className="text-muted-foreground mb-4">
                  {search || statusFilter !== "all" 
                    ? "Try adjusting your search or filters" 
                    : "Get started by issuing your first credential"
                  }
                </p>
                <Button onClick={() => setShowInviteModal(true)} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                  <Plus className="mr-2 h-4 w-4" />
                  Issue Credential
                </Button>
              </div>
            )}
            
            {/* Pagination Controls */}
            {credentials.length > 0 && (
              <div className="bg-muted/50 border-t border-border p-4 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Page {pagination.current_page} of {pagination.total_pages}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={!pagination.has_prev_page}
                    className="border-border text-foreground hover:bg-muted"
                  >
                    Previous
                  </Button>
                  
                  <div className="flex items-center gap-1">
                    {(() => {
                      const currentPageNum = pagination.current_page;
                      const totalPages = pagination.total_pages;
                      const maxButtons = 5;
                      let startPage = Math.max(1, currentPageNum - Math.floor(maxButtons / 2));
                      let endPage = Math.min(totalPages, startPage + maxButtons - 1);
                      
                      // Adjust start page if we're near the end
                      if (endPage - startPage < maxButtons - 1) {
                        startPage = Math.max(1, endPage - maxButtons + 1);
                      }
                      
                      const pages = [];
                      
                      // Show first page if not in range
                      if (startPage > 1) {
                        pages.push(1);
                        if (startPage > 2) {
                          pages.push('...');
                        }
                      }
                      
                      // Show page range
                      for (let i = startPage; i <= endPage; i++) {
                        pages.push(i);
                      }
                      
                      // Show last page if not in range
                      if (endPage < totalPages) {
                        if (endPage < totalPages - 1) {
                          pages.push('...');
                        }
                        pages.push(totalPages);
                      }
                      
                      return pages.map((pageNum, idx) => {
                        if (pageNum === '...') {
                          return <span key={`ellipsis-${idx}`} className="text-muted-foreground px-2">...</span>;
                        }
                        return (
                          <Button
                            key={pageNum}
                            variant={pageNum === currentPageNum ? "default" : "outline"}
                            size="sm"
                            onClick={() => setCurrentPage(pageNum)}
                            className={pageNum === currentPageNum ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border-border text-foreground hover:bg-muted"}
                          >
                            {pageNum}
                          </Button>
                        );
                      });
                    })()}
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.min(pagination.total_pages, currentPage + 1))}
                    disabled={!pagination.has_next_page}
                    className="border-border text-foreground hover:bg-muted"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
              Revoke Credential
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to revoke the credential <strong>{credentialToRevoke?.credential_code}</strong> 
              for <strong>{credentialToRevoke?.achiever_details?.first_name} {credentialToRevoke?.achiever_details?.last_name}</strong>?
              <br /><br />
              This action cannot be undone. The credential will be permanently marked as revoked and will no longer be valid.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => setCredentialToRevoke(null)}
              className="border-border text-foreground hover:bg-muted"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeCredential(credentialToRevoke?.credential_code)}
              disabled={revokeLoading}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {revokeLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Revoking...
                </>
              ) : (
                <>
                  <Ban className="mr-2 h-4 w-4" />
                  Revoke Credential
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Single Credential Modal */}
      <Dialog
        open={showInviteModal}
        onOpenChange={(open) => {
          setShowInviteModal(open);
          if (!open) {
            // Closing without issuing abandons whatever was previewed --
            // reopening starts from a clean form, not a stale preview for
            // whatever recipient/design was last selected.
            setCertificatePreview(null);
            setSingleFormCustomFields({});
          }
        }}
      >
        {/* Capped and scrollable. With the column-mapping panel and the
            per-recipient visual preview, this dialog grew taller than the
            viewport and the "Issue Bulk Credentials" button ended up below
            the fold with nothing to scroll -- the primary action of the
            whole flow was simply unreachable. Found by driving the modal in
            a real browser; the button existed and the tests passed. */}
        <DialogContent className="sm:max-w-lg bg-card border-border text-foreground max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              {issueKind === 'badge' ? (
                <Award className="h-5 w-5 text-purple-600" />
              ) : (
                <FileCheck className="h-5 w-5 text-blue-600" />
              )}
              Issue {issueKind === 'badge' ? 'Digital Badge' : 'Certificate'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Issue a verified {issueKind === 'badge' ? 'digital achievement badge' : 'formal certificate'} to an achiever
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!certificatePreview && (
            <>
            <div className="flex items-center justify-between rounded-md border border-border p-2.5 bg-muted/40">
              <div>
                <p className="text-sm font-medium text-foreground">Recipient has no account here</p>
                <p className="text-xs text-muted-foreground">Issue directly to a name and email — no entry in Manage Users required.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isGuestRecipient}
                aria-label="Recipient has no account here"
                onClick={() => {
                  setIsGuestRecipient(v => !v);
                  setSingleForm({ ...singleForm, achiever_username: '' });
                  setSelectedEmployee(null);
                  setCertificatePreview(null);
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${isGuestRecipient ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background transition-transform ${isGuestRecipient ? 'translate-x-[18px]' : 'translate-x-1'}`} />
              </button>
            </div>

            {isGuestRecipient ? (
              <div className="space-y-2 border border-border rounded-md p-3">
                <label className="text-sm font-medium text-foreground">Guest Recipient</label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label="First name"
                    placeholder="First name"
                    value={guestRecipient.first_name}
                    onChange={(e) => setGuestRecipient({ ...guestRecipient, first_name: e.target.value })}
                    className="bg-background border-border text-foreground"
                  />
                  <Input
                    aria-label="Last name"
                    placeholder="Last name"
                    value={guestRecipient.last_name}
                    onChange={(e) => setGuestRecipient({ ...guestRecipient, last_name: e.target.value })}
                    className="bg-background border-border text-foreground"
                  />
                </div>
                <Input
                  type="email"
                  aria-label="Email"
                  placeholder="Email — where the credential link is sent"
                  value={guestRecipient.email}
                  onChange={(e) => setGuestRecipient({ ...guestRecipient, email: e.target.value })}
                  className="bg-background border-border text-foreground"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label="Designation (optional)"
                    placeholder="Designation (optional)"
                    value={guestRecipient.designation}
                    onChange={(e) => setGuestRecipient({ ...guestRecipient, designation: e.target.value })}
                    className="bg-background border-border text-foreground"
                  />
                  <Input
                    aria-label="City (optional)"
                    placeholder="City (optional)"
                    value={guestRecipient.city}
                    onChange={(e) => setGuestRecipient({ ...guestRecipient, city: e.target.value })}
                    className="bg-background border-border text-foreground"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  No login needed to view or download this credential — the email links straight to its public verification page.
                </p>
              </div>
            ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Select Achiever</label>
              <div className="relative">
                <input
                  placeholder="Search by name or username..."
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  className="w-full border border-border rounded-md p-2 bg-background text-foreground text-sm"
                />

                {/* Results dropdown */}
                {(employeesLoading || (employeeSearch && employees.length > 0)) && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-sm max-h-56 overflow-auto">
                    {employeesLoading ? (
                      <div className="p-3 text-sm text-muted-foreground">Loading employees...</div>
                    ) : (
                      employees
                        .filter(emp => {
                          const q = employeeSearch.toLowerCase();
                          const name = `${emp.first_name || emp.name || ''} ${emp.last_name || ''}`.toLowerCase();
                          const username = (emp.username || emp.user_name || emp.achiever_username || '').toLowerCase();
                          return q === '' || name.includes(q) || username.includes(q);
                        })
                        .slice(0, 30)
                        .map((emp) => (
                          <button
                            key={emp.id || emp.username || emp.user_name}
                            type="button"
                            onClick={() => {
                              const username = emp.username || emp.user_name || emp.achiever_username || emp.email;
                              setSingleForm({...singleForm, achiever_username: username});
                              setSelectedEmployee(emp);
                              setEmployeeSearch('');
                              setCertificatePreview(null);
                            }}
                            className="w-full text-left p-2 hover:bg-muted/40 flex items-center gap-3"
                          >
                            <Avatar className="h-8 w-8">
                              {emp.avatar_url || emp.profile_pic ? (
                                <AvatarImage src={emp.avatar_url || emp.profile_pic} alt={emp.first_name || emp.name} />
                              ) : (
                                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs font-semibold">
                                  {(emp.first_name || emp.name || '')[0] || (emp.username || '')[0] || ''}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground truncate">
                                {emp.first_name || emp.name} {emp.last_name || ''}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">@{emp.username || emp.user_name}</div>
                            </div>
                          </button>
                        ))
                    )}
                    {(!employeesLoading && employees.length === 0) && (
                      <div className="p-3 text-sm text-muted-foreground">No employees found for this organization.</div>
                    )}
                  </div>
                )}
              </div>

              {/* Selected employee preview */}
              {selectedEmployee && (
                <div className="mt-2 flex items-center gap-3 p-2 border border-border rounded-md bg-muted/40">
                  <Avatar className="h-10 w-10">
                    {selectedEmployee.avatar_url || selectedEmployee.profile_pic ? (
                      <AvatarImage src={selectedEmployee.avatar_url || selectedEmployee.profile_pic} alt={selectedEmployee.first_name || selectedEmployee.name} />
                    ) : (
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs font-semibold">
                        {(selectedEmployee.first_name || selectedEmployee.name || '')[0] || (selectedEmployee.username || '')[0] || ''}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {selectedEmployee.first_name || selectedEmployee.name} {selectedEmployee.last_name || ''}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">@{selectedEmployee.username || selectedEmployee.user_name}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setSelectedEmployee(null); setSingleForm({...singleForm, achiever_username: ''}); setCertificatePreview(null); }} className="ml-auto border-border text-foreground hover:bg-muted">Change</Button>
                </div>
              )}
            </div>
            )}
            </>
            )}

            {certificatePreview && (
              <div className="rounded-md border border-border p-3 bg-muted/40">
                <p className="text-xs text-muted-foreground">Issuing to</p>
                <p className="text-sm font-medium text-foreground">{certificatePreview.achieverUsername}</p>
                {certificatePreview.guestPayload && (
                  <p className="text-xs text-muted-foreground">{certificatePreview.guestPayload.email}</p>
                )}
              </div>
            )}

            {!certificatePreview && (
              <div className="space-y-2">
                {/* A badge is issued from a badge design. Without this the
                    single-issue flow could only ever produce certificates. */}
                <div className="flex gap-1 border-b border-border mb-2">
                  {['certificate', 'badge'].map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => {
                        setIssueKind(kind);
                        setSingleForm((prev) => ({ ...prev, selected_design: null }));
                        setCertificatePreview(null);
                      }}
                      className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition ${
                        issueKind === kind ? 'border-primary text-primary font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {kind === 'badge' ? 'Badge' : 'Certificate'}
                    </button>
                  ))}
                </div>
                <label className="text-sm font-medium text-foreground">
                  Select {issueKind === 'badge' ? 'Badge' : 'Certificate'} Design
                </label>
                <Select
                  value={singleForm.selected_design?.design_code || ''}
                  onValueChange={(value) => {
                    const design = designs.find(d => d.design_code === value);
                    setSingleForm({...singleForm, selected_design: design});
                    setSingleFormCustomFields({});
                    setCertificatePreview(null);
                  }}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Choose a design" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    {designs.filter((d) => (d.design_kind || 'certificate') === issueKind).map((design) => (
                      <SelectItem key={design.design_code} value={design.design_code}>
                        <div className="flex items-center gap-2">
                          <Image
                            src={design.main_template_url}
                            alt={design.design_code}
                            width={40}
                            height={30}
                            className="rounded object-cover border border-border"
                          />
                          <span className="font-medium">{design.design_code}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Org-defined dynamic fields */}
            {!certificatePreview && singleForm.selected_design?.text_attributes
              ?.filter(attr => attr.text_title !== 'recipient_name' && attr.text_title !== 'custom')
              .map(attr => (
                <div key={attr.text_title} className="space-y-1">
                  <label className="text-sm font-medium text-foreground capitalize">
                    {attr.text_title.replace(/_/g, ' ')}
                  </label>
                  <Input
                    placeholder={attr.text || attr.text_title}
                    value={singleFormCustomFields[attr.text_title] || ''}
                    onChange={(e) => setSingleFormCustomFields({ ...singleFormCustomFields, [attr.text_title]: e.target.value })}
                    className="bg-background border-border text-foreground"
                  />
                </div>
              ))}

            {!certificatePreview && singleForm.selected_design && (
              <div className="border border-border rounded-lg p-4 bg-muted/30">
                <p className="text-sm font-medium text-foreground mb-2">Template background (not the final layout):</p>
                <div className="flex justify-center">
                  <Image
                    src={singleForm.selected_design.main_template_url}
                    alt="Selected design"
                    width={200}
                    height={150}
                    className="rounded-lg object-cover border border-border shadow-sm"
                  />
                </div>
              </div>
            )}

            {/* The real rendered certificate */}
            {certificatePreview && (
              <div className="border border-border rounded-lg p-4 bg-muted/30">
                <p className="text-sm font-medium text-foreground mb-2">This is exactly what will be issued:</p>
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={certificatePreview.url}
                    alt="Generated certificate preview"
                    className="rounded-lg border border-border shadow-sm max-w-full max-h-80 object-contain"
                  />
                </div>
              </div>
            )}

            {certificatePreview ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 border-border text-foreground hover:bg-muted"
                  onClick={handleDiscardPreview}
                  disabled={loading}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleConfirmIssue}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Issuing...
                    </>
                  ) : (
                    <>
                      <Award className="mr-2 h-4 w-4" />
                      Confirm & Issue
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <Button
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleGeneratePreview}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating preview...
                  </>
                ) : (
                  <>
                    <Award className="mr-2 h-4 w-4" />
                    Preview Certificate
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Upload Modal */}
      <Dialog open={showBulkModal} onOpenChange={setShowBulkModal}>
        {/* Capped and scrollable. With the column-mapping panel and the
            per-recipient visual preview, this dialog grew taller than the
            viewport and "Issue Bulk Credentials" ended up below the fold
            with nothing to scroll -- the primary action of the whole flow
            was unreachable. Found by driving the modal in a real browser:
            the button existed and every test passed. */}
        <DialogContent className="sm:max-w-lg bg-card border-border text-foreground max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Award className="h-5 w-5" />
              Bulk Credential Upload
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Issue multiple credentials at once using username list or CSV upload
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="emails" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-muted">
              <TabsTrigger value="emails">Username List</TabsTrigger>
              <TabsTrigger value="csv">CSV Upload</TabsTrigger>
            </TabsList>
            
            <TabsContent value="emails" className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Select Certificate Design</label>
                <Select
                  value={bulkForm.selected_design?.design_code || ''}
                  onValueChange={(value) => {
                    const design = designs.find(d => d.design_code === value);
                    setBulkForm({...bulkForm, selected_design: design});
                  }}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Choose a design" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    {designs.filter((d) => (d.design_kind || 'certificate') === bulkKind).map((design) => (
                      <SelectItem key={design.design_code} value={design.design_code}>
                        <div className="flex items-center gap-2">
                          <Image
                            src={design.main_template_url}
                            alt={design.design_code}
                            width={40}
                            height={30}
                            className="rounded object-cover border border-border"
                          />
                          <span className="font-medium">{design.design_code}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Enter Usernames</label>
                <textarea
                  placeholder="user1, user2, user3"
                  className="w-full border border-border rounded-md p-3 text-sm bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={6}
                  value={bulkForm.usernames}
                  onChange={(e) => setBulkForm({...bulkForm, usernames: e.target.value})}
                />
                <p className="text-xs text-muted-foreground">
                  Enter usernames separated by commas
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="csv" className="space-y-4">
              {/* Certificates and badges are both issued in bulk, through the
                  same pipeline, from their own designs. */}
              <div className="flex gap-1 border-b border-border">
                {['certificate', 'badge'].map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => { setBulkKind(kind); setBulkForm((prev) => ({ ...prev, selected_design: null })); }}
                    className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition ${
                      bulkKind === kind ? 'border-primary text-primary font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {kind === 'badge' ? 'Bulk Badges' : 'Bulk Certificates'}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Select {bulkKind === 'badge' ? 'Badge' : 'Certificate'} Design
                </label>
                <Select
                  value={bulkForm.selected_design?.design_code || ''}
                  onValueChange={(value) => {
                    const design = designs.find(d => d.design_code === value);
                    setBulkForm({...bulkForm, selected_design: design});
                  }}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Choose a design" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    {designs.filter((d) => (d.design_kind || 'certificate') === bulkKind).map((design) => (
                      <SelectItem key={design.design_code} value={design.design_code}>
                        <div className="flex items-center gap-2">
                          <Image
                            src={design.main_template_url}
                            alt={design.design_code}
                            width={40}
                            height={30}
                            className="rounded object-cover border border-border"
                          />
                          <span className="font-medium">{design.design_code}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-foreground">Upload CSV File</label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={downloadBulkCsvTemplate}
                    className="gap-2 border-border text-foreground hover:bg-muted shrink-0"
                  >
                    <Download className="h-4 w-4" />
                    Download CSV template
                  </Button>
                </div>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center bg-muted/30">
                  <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-foreground mb-2">
                    Drag and drop your CSV file here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    A CSV with a header row: <code className="bg-muted px-1 rounded">first_name,last_name,email</code>.
                    The recipients do not need an account here — the name and email in the file are all that is required.
                    Use <span className="font-medium">Download CSV template</span> above to start from the exact format.
                  </p>
                  <Input
                    type="file"
                    accept=".csv" 
                    className="hidden" 
                    id="csv-upload"
                    onChange={(e) => handleCsvFileSelected(e.target.files[0])}
                  />
                  <Button 
                    variant="outline" 
                    className="gap-2 border-border text-foreground hover:bg-muted"
                    onClick={() => document.getElementById('csv-upload').click()}
                  >
                    <FileText className="h-4 w-4" />
                    Choose File
                  </Button>
                  {bulkForm.csvFile && (
                    <p className="text-sm text-emerald-500 mt-2">
                      Selected: {bulkForm.csvFile.name}
                    </p>
                  )}
                </div>

                {/* Column mapping + preview */}
                {csvPreview && csvPreview.header && (
                  <div className="mt-4 border border-border rounded-lg p-4 bg-muted/20">
                    <p className="text-sm font-medium text-foreground mb-1">Match your columns</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      {csvPreview.needsMapping
                        ? 'None of these columns were recognized. Choose which one holds each field.'
                        : 'These were matched automatically. Change any that are wrong.'}
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {BULK_CSV_COLUMNS.map((column) => (
                        <label key={column} className="flex items-center gap-3 text-xs">
                          <span className="w-28 shrink-0 text-muted-foreground capitalize">{column.replace(/_/g, ' ')}</span>
                          <select
                            className="flex-1 border border-border rounded px-2 py-1 text-xs bg-background text-foreground"
                            value={csvPreview.mapping?.[column] ?? ''}
                            onChange={(e) => applyCsvMapping(column, e.target.value)}
                          >
                            <option value="">— not in this file —</option>
                            {csvPreview.header.map((cell, index) => (
                              <option key={index} value={index}>{cell || `(column ${index + 1})`}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>

                    {csvPreview.unmapped?.length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                        Not used: {csvPreview.unmapped.join(', ')} — these columns will be ignored.
                      </p>
                    )}

                    <div className="mt-4 border-t border-border pt-3">
                      <p className="text-sm font-medium text-foreground mb-2">
                        {csvPreview.recipients.length} recipient{csvPreview.recipients.length === 1 ? '' : 's'} ready
                        {csvPreview.errors.length > 0 && `, ${csvPreview.errors.length} row${csvPreview.errors.length === 1 ? '' : 's'} to fix`}
                      </p>
                      {csvPreview.recipients.length > 0 && (
                        <div className="mt-2">
                          {bulkForm.selected_design ? (
                            <>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-medium text-muted-foreground">
                                  Preview — recipient {Math.min(previewIndex + 1, csvPreview.recipients.length)} of {csvPreview.recipients.length}
                                </p>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                                    disabled={previewIndex === 0}
                                    className="px-2 py-1 text-xs border border-border rounded disabled:opacity-40 hover:bg-muted text-foreground"
                                  >
                                    ← Previous
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPreviewIndex((i) => Math.min(csvPreview.recipients.length - 1, i + 1))}
                                    disabled={previewIndex >= csvPreview.recipients.length - 1}
                                    className="px-2 py-1 text-xs border border-border rounded disabled:opacity-40 hover:bg-muted text-foreground"
                                  >
                                    Next →
                                  </button>
                                </div>
                              </div>
                              <div className="flex justify-center bg-muted/40 rounded-lg p-3 border border-border">
                                <CredentialPreview
                                  design={bulkForm.selected_design}
                                  recipient={csvPreview.recipients[Math.min(previewIndex, csvPreview.recipients.length - 1)]}
                                  maxWidth={380}
                                />
                              </div>
                              <p className="text-xs text-muted-foreground mt-2">
                                One master design, replicated for every recipient. Only the
                                dashed fields, the Credential ID and the QR change per person.
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              Select a design above to see how each credential will look.
                            </p>
                          )}
                        </div>
                      )}
                      {csvPreview.errors.length > 0 && (
                        <ul className="mt-2 text-xs text-rose-500 list-disc list-inside space-y-0.5">
                          {csvPreview.errors.slice(0, 5).map((rowError, index) => <li key={index}>{rowError}</li>)}
                          {csvPreview.errors.length > 5 && <li>…and {csvPreview.errors.length - 5} more</li>}
                        </ul>
                      )}
                      {bulkAllowance && bulkAllowance.unlimited === false && (
                        <p className={`text-xs mt-2 ${bulkAllowance.can_issue === false ? 'text-rose-500' : 'text-muted-foreground'}`}>
                          Plan {bulkAllowance.plan_name}: {bulkAllowance.used} of {bulkAllowance.limit} credentials used this month, {bulkAllowance.remaining} remaining.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {bulkForm.selected_design && (
            <div className="border border-border rounded-lg p-4 bg-muted/30">
              <p className="text-sm font-medium text-foreground mb-2">Selected Design Preview:</p>
              <div className="flex justify-center">
                <Image
                  src={bulkForm.selected_design.main_template_url}
                  alt="Selected design"
                  width={150}
                  height={100}
                  className="rounded-lg object-cover border border-border shadow-sm"
                />
              </div>
            </div>
          )}

          {bulkProgress && (
            <div className="mb-3">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Issuing credentials…</span>
                <span>{bulkProgress.done} / {bulkProgress.total}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          <Button 
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90" 
            onClick={handleBulkCredentialSubmit}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {bulkProgress
                  ? `${bulkQueued ? 'Queued' : 'Processing'} ${bulkProgress.done}/${bulkProgress.total}...`
                  : 'Processing...'}
              </>
            ) : (
              <>
                <Award className="mr-2 h-4 w-4" />
                Issue Bulk Credentials
              </>
            )}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
