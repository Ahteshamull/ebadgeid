"use client"
import React, { useState, useEffect } from 'react';
import { Search, Plus, Send, Key, FileText, Clock, MessageSquare, AlertTriangle, XCircle, Upload, X, File, Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { apiFetch, API_BASE_URL as ROOT_API_BASE_URL, UPLOAD_BASE_URL } from '@/lib/api';

const API_BASE_URL = `${ROOT_API_BASE_URL}/contracts`;
const STORAGE_API_URL = `${UPLOAD_BASE_URL}/api/uploads`;

export default function ContractManagement() {
  const [contracts, setContracts] = useState([]);
  const [filteredContracts, setFilteredContracts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  // The most recently generated access token -- shown in its own dialog
  // with a copy button (see the "New Access Token" dialog below) instead
  // of a plain alert(), which lost the token forever if dismissed by
  // accident.
  const [newAccessToken, setNewAccessToken] = useState(null);
  const [orgCode, setOrgCode] = useState(null);

  // File upload states
  const [contractFile, setContractFile] = useState(null);
  const [attachmentFiles, setAttachmentFiles] = useState([]);
  const [uploadingContract, setUploadingContract] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);

  // Form states
  const [createForm, setCreateForm] = useState({
    contract_title: '',
    contract_start_date: '',
    contract_end_date: '',
    contract_content_url: '',
    contract_attachments: [],
    contract_parties: []
  });

  const [inviteForm, setInviteForm] = useState({
    party_name: '',
    party_email: '',
    party_side: '',
    party_role: '',
    contract_permissions: {
      view: true,
      write: false,
      update: false,
      add_discussion: true,
      add_timeline_event: false
    }
  });

  const [tokenForm, setTokenForm] = useState({
    email: '',
    expires_in_days: 30
  });

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        apiFetch('/auth/me').then(async (response) => {
          if (response.ok) setOrgCode((await response.json()).organization_code);
        });
      }
    } catch (e) {
      console.error('Error loading session', e);
    }
  }, []);

  useEffect(() => {
    if (orgCode) {
      fetchContracts();
    }
  }, [orgCode]);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredContracts(contracts);
    } else {
      const filtered = contracts.filter(contract =>
        contract.contract_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contract.contract_title.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredContracts(filtered);
    }
  }, [searchQuery, contracts]);

  const fetchContracts = async () => {
    try {
      setLoading(true);
      if (!orgCode) {
        return;
      }
      const response = await apiFetch(`${API_BASE_URL}/organization/${orgCode}`);
      const data = await response.json();
      if (response.ok) {
        setContracts(data.contracts || []);
        setFilteredContracts(data.contracts || []);
      } else {
        toast.error(data.message || 'Failed to load contracts');
      }
    } catch (error) {
      console.error('Error fetching contracts:', error);
      toast.error('Failed to load contracts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Upload file to storage server
  const uploadFileToStorage = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    // Contract documents and attachments are confidential legal/business
    // files -- they must never default to the public visibility other,
    // less sensitive uploads (badge assets) keep for compatibility.
    formData.append('visibility', 'private');

    const response = await fetch(STORAGE_API_URL, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    const data = await response.json();
    return data.url;
  };

  // Handle contract file selection
  const handleContractFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setUploadingContract(true);
      const url = await uploadFileToStorage(file);
      setContractFile(file);
      setCreateForm({ ...createForm, contract_content_url: url });
      alert('Contract document uploaded successfully!');
    } catch (error) {
      console.error('Error uploading contract:', error);
      alert(error.message || 'Failed to upload contract document');
    } finally {
      setUploadingContract(false);
    }
  };

  // Handle attachment files selection
  const handleAttachmentFilesChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    try {
      setUploadingAttachments(true);
      const uploadPromises = files.map(file => uploadFileToStorage(file));
      const urls = await Promise.all(uploadPromises);
      
      setAttachmentFiles([...attachmentFiles, ...files]);
      setCreateForm({ 
        ...createForm, 
        contract_attachments: [...createForm.contract_attachments, ...urls] 
      });
      alert(`${files.length} attachment(s) uploaded successfully!`);
    } catch (error) {
      console.error('Error uploading attachments:', error);
      alert(error.message || 'Failed to upload attachments');
    } finally {
      setUploadingAttachments(false);
    }
  };

  // Remove attachment
  const removeAttachment = (index) => {
    const newAttachments = [...createForm.contract_attachments];
    newAttachments.splice(index, 1);
    const newFiles = [...attachmentFiles];
    newFiles.splice(index, 1);
    setAttachmentFiles(newFiles);
    setCreateForm({ ...createForm, contract_attachments: newAttachments });
  };

  // Calculate summary statistics
  const stats = {
    total: contracts.length,
    active: contracts.filter(c => c.contract_status === 'active').length,
    in_discussion: contracts.filter(c => c.contract_status === 'in_discussion').length,
    disputed: contracts.filter(c => c.contract_status === 'disputed').length,
    terminated: contracts.filter(c => c.contract_status === 'terminated').length
  };

  // Create contract
  const handleCreateContract = async () => {
    try {
      if (!createForm.contract_content_url) {
        alert('Please upload a contract document');
        return;
      }
      const response = await apiFetch(`${API_BASE_URL}/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(createForm)
      });
      const data = await response.json();
      if (response.ok) {
        alert('Contract created successfully!');
        setShowCreateModal(false);
        fetchContracts();
        resetCreateForm();
      } else {
        alert(data.message || 'Failed to create contract');
      }
    } catch (error) {
      console.error('Error creating contract:', error);
      alert('Error creating contract');
    }
  };

  // Invite party
  const handleInviteParty = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/${selectedContract.contract_code}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(inviteForm)
      });
      const data = await response.json();
      if (response.ok) {
        alert('Party invited successfully!');
        setShowInviteModal(false);
        fetchContracts();
        resetInviteForm();
      } else {
        alert(data.message || 'Failed to invite party');
      }
    } catch (error) {
      console.error('Error inviting party:', error);
      alert('Error inviting party');
    }
  };

  // Generate access token
  const handleGenerateToken = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/${selectedContract.contract_code}/generate-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(tokenForm)
      });
      const data = await response.json();
      if (response.ok) {
        setNewAccessToken({ token: data.access_token, expiresAt: data.expires_at });
        setShowTokenModal(false);
        resetTokenForm();
      } else {
        toast.error(data.message || 'Failed to generate token');
      }
    } catch (error) {
      console.error('Error generating token:', error);
      toast.error('Error generating token');
    }
  };

  const copyTokenToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Access token copied to clipboard');
  };

  const resetCreateForm = () => {
    setCreateForm({
      contract_title: '',
      contract_start_date: '',
      contract_end_date: '',
      contract_content_url: '',
      contract_attachments: [],
      contract_parties: []
    });
    setContractFile(null);
    setAttachmentFiles([]);
  };

  const resetInviteForm = () => {
    setInviteForm({
      party_name: '',
      party_email: '',
      party_side: '',
      party_role: '',
      contract_permissions: {
        view: true,
        write: false,
        update: false,
        add_discussion: true,
        add_timeline_event: false
      }
    });
  };

  const resetTokenForm = () => {
    setTokenForm({
      email: '',
      expires_in_days: 30
    });
  };

  const getStatusColor = (status) => {
    const colors = {
      active: 'bg-green-100 text-green-800 border-green-200',
      in_discussion: 'bg-blue-100 text-blue-800 border-blue-200',
      disputed: 'bg-red-100 text-red-800 border-red-200',
      terminated: 'bg-gray-100 text-gray-800 border-gray-200',
      on_hold: 'bg-yellow-100 text-yellow-800 border-yellow-200'
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Contract Management</h1>
            <p className="text-muted-foreground mt-1">Manage and monitor all your contracts</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <SummaryCard
            icon={<FileText className="w-5 h-5" />}
            title="Total Contracts"
            value={stats.total}
            color="bg-blue-500"
          />
          <SummaryCard
            icon={<Clock className="w-5 h-5" />}
            title="Active"
            value={stats.active}
            color="bg-green-500"
          />
          <SummaryCard
            icon={<MessageSquare className="w-5 h-5" />}
            title="In Discussion"
            value={stats.in_discussion}
            color="bg-purple-500"
          />
          <SummaryCard
            icon={<AlertTriangle className="w-5 h-5" />}
            title="Disputed"
            value={stats.disputed}
            color="bg-red-500"
          />
          <SummaryCard
            icon={<XCircle className="w-5 h-5" />}
            title="Terminated"
            value={stats.terminated}
            color="bg-gray-500"
          />
        </div>

        {/* Search and Create */}
        <div className="bg-card rounded-lg shadow-sm border border-border p-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
              <input
                type="text"
                placeholder="Search contracts by code or title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <Plus className="w-5 h-5" />
              Create Contract
            </button>
          </div>
        </div>

        {/* Contracts Table */}
        <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Code</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Created At</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-8 text-center text-muted-foreground">
                      Loading contracts...
                    </td>
                  </tr>
                ) : filteredContracts.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-8 text-center text-muted-foreground">
                      No contracts found
                    </td>
                  </tr>
                ) : (
                  filteredContracts.map((contract) => (
                    <tr key={contract.contract_code} className="hover:bg-muted/40 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono text-sm text-foreground font-medium">{contract.contract_code}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-foreground">{contract.contract_title}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(contract.contract_issue_date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(contract.contract_status)}`}>
                          {contract.contract_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedContract(contract);
                              setShowInviteModal(true);
                            }}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-500/10 px-3 py-1.5 rounded transition-colors"
                          >
                            <Send className="w-4 h-4" />
                            Invite
                          </button>
                          <button
                            onClick={() => {
                              setSelectedContract(contract);
                              setShowTokenModal(true);
                            }}
                            className="flex items-center gap-1 text-purple-600 hover:text-purple-700 hover:bg-purple-500/10 px-3 py-1.5 rounded transition-colors"
                          >
                            <Key className="w-4 h-4" />
                            Token
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Contract Modal */}
        <Dialog open={showCreateModal} onOpenChange={(open) => setShowCreateModal(open)}>
          <DialogContent className="sm:max-w-2xl bg-card border-border text-foreground max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-foreground">Create New Contract</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Contract Title</label>
                <input
                  type="text"
                  value={createForm.contract_title}
                  onChange={(e) => setCreateForm({ ...createForm, contract_title: e.target.value })}
                  className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="Enter contract title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Start Date</label>
                  <input
                    type="date"
                    value={createForm.contract_start_date}
                    onChange={(e) => setCreateForm({ ...createForm, contract_start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">End Date</label>
                  <input
                    type="date"
                    value={createForm.contract_end_date}
                    onChange={(e) => setCreateForm({ ...createForm, contract_end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              {/* Contract Document Upload */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Contract Document <span className="text-red-500">*</span>
                </label>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-blue-500 transition-colors bg-muted/30">
                  <input
                    type="file"
                    id="contract-file"
                    onChange={handleContractFileChange}
                    accept=".pdf,.docx,.doc"
                    className="hidden"
                    disabled={uploadingContract}
                  />
                  <label htmlFor="contract-file" className="cursor-pointer">
                    <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-foreground">
                      {uploadingContract ? 'Uploading...' : 'Click to upload contract document'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, DOCX (Max 100MB)</p>
                  </label>
                  {contractFile && (
                    <div className="mt-3 flex items-center justify-center gap-2 text-sm text-emerald-500">
                      <File className="w-4 h-4" />
                      <span>{contractFile.name}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Attachments Upload */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Attachments (Optional)
                </label>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-blue-500 transition-colors bg-muted/30">
                  <input
                    type="file"
                    id="attachment-files"
                    onChange={handleAttachmentFilesChange}
                    accept=".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg,.mp4"
                    multiple
                    className="hidden"
                    disabled={uploadingAttachments}
                  />
                  <label htmlFor="attachment-files" className="cursor-pointer">
                    <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-foreground">
                      {uploadingAttachments ? 'Uploading...' : 'Click to upload attachments'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX, CSV, Images, Videos</p>
                  </label>
                </div>
                
                {/* Display uploaded attachments */}
                {createForm.contract_attachments.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {createForm.contract_attachments.map((url, index) => (
                      <div key={index} className="flex items-center justify-between bg-muted/50 p-2 rounded border border-border">
                        <div className="flex items-center gap-2">
                          <File className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm text-foreground">
                            {attachmentFiles[index]?.name || `Attachment ${index + 1}`}
                          </span>
                        </div>
                        <button
                          onClick={() => removeAttachment(index)}
                          className="text-rose-500 hover:text-rose-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateContract}
                  disabled={!createForm.contract_content_url || uploadingContract || uploadingAttachments}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Contract
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Invite Party Modal */}
        <Dialog open={showInviteModal && !!selectedContract} onOpenChange={(open) => { if (!open) setShowInviteModal(false); }}>
          <DialogContent className="sm:max-w-lg bg-card border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="text-foreground">{selectedContract ? `Invite Party to ${selectedContract.contract_code}` : 'Invite Party'}</DialogTitle>
            </DialogHeader>
            {selectedContract && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Party Name</label>
                  <input
                    type="text"
                    value={inviteForm.party_name}
                    onChange={(e) => setInviteForm({ ...inviteForm, party_name: e.target.value })}
                    className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                  <input
                    type="email"
                    value={inviteForm.party_email}
                    onChange={(e) => setInviteForm({ ...inviteForm, party_email: e.target.value })}
                    className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="john@example.com"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Party Side</label>
                    <input
                      type="text"
                      value={inviteForm.party_side}
                      onChange={(e) => setInviteForm({ ...inviteForm, party_side: e.target.value })}
                      className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="e.g., Client"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Party Role</label>
                    <input
                      type="text"
                      value={inviteForm.party_role}
                      onChange={(e) => setInviteForm({ ...inviteForm, party_role: e.target.value })}
                      className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="e.g., Signatory"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Permissions</label>
                  <div className="space-y-2 bg-muted/40 p-3 rounded-lg border border-border">
                    {Object.entries(inviteForm.contract_permissions).map(([key, value]) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={value}
                          onChange={(e) => setInviteForm({
                            ...inviteForm,
                            contract_permissions: {
                              ...inviteForm.contract_permissions,
                              [key]: e.target.checked
                            }
                          })}
                          className="w-4 h-4 text-blue-600 border-border rounded focus:ring-blue-500 bg-background"
                        />
                        <span className="text-sm text-foreground capitalize">{key.replace('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleInviteParty}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Send Invitation
                  </button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Generate Token Modal */}
        <Dialog open={showTokenModal && !!selectedContract} onOpenChange={(open) => { if (!open) setShowTokenModal(false); }}>
          <DialogContent className="sm:max-w-lg bg-card border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="text-foreground">{selectedContract ? `Generate Access Token for ${selectedContract.contract_code}` : 'Generate Access Token'}</DialogTitle>
            </DialogHeader>
            {selectedContract && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Party Email</label>
                  <input
                    type="email"
                    value={tokenForm.email}
                    onChange={(e) => setTokenForm({ ...tokenForm, email: e.target.value })}
                    className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="party@example.com"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Email must belong to a party in this contract</p>
                  <p className="text-xs text-muted-foreground">If you want to generate a token for yourself then write your own email.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Expires In (Days)</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={tokenForm.expires_in_days}
                    onChange={(e) => setTokenForm({ ...tokenForm, expires_in_days: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowTokenModal(false)}
                    className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerateToken}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    Generate Token
                  </button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* New Access Token dialog */}
        <Dialog open={!!newAccessToken} onOpenChange={(open) => { if (!open) setNewAccessToken(null); }}>
          <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="text-foreground">Access Token Generated Successfully</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Copy this token now — it won&apos;t be shown again.
                {newAccessToken?.expiresAt && ` Expires ${new Date(newAccessToken.expiresAt).toLocaleDateString()}.`}
              </DialogDescription>
            </DialogHeader>
            {newAccessToken && (
              <div className="bg-muted/40 border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-foreground">Access Token</label>
                  <button
                    onClick={() => copyTokenToClipboard(newAccessToken.token)}
                    className="flex items-center gap-1 text-sm px-2 py-1 border border-border rounded-md hover:bg-muted transition-colors text-foreground"
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </button>
                </div>
                <code className="font-mono text-sm break-all bg-background text-foreground p-2 rounded border border-border block">
                  {newAccessToken.token}
                </code>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// Summary Card Component
function SummaryCard({ icon, title, value, color }) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
        </div>
        <div className={`${color} text-white p-3 rounded-lg`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
