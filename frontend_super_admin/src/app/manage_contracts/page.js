"use client"
import React, { useState, useEffect } from 'react';
import { Search, Plus, Send, Key, FileText, Clock, MessageSquare, AlertTriangle, XCircle, Upload, X, File } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLocale } from '@/context/Localecontext';
import { apiFetch, uploadFile } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
const API_PATH = '/contracts';

export default function ContractManagement() {
  const { t } = useLocale();
  const { session } = useSession();
  const [contracts, setContracts] = useState([]);
  const [filteredContracts, setFilteredContracts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  // SA-01 fix: was localStorage.getItem('token'/'org_code'), always null
  // now that login no longer writes to localStorage. Session lives in the
  // httpOnly cookie; useSession() reads it via /auth/me, and apiFetch()
  // sends the cookie automatically -- no manual Authorization header
  // needed.
  const orgCode = session?.organization_code || null;

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
        console.warn('Missing orgCode; aborting fetchContracts');
        return;
      }
      const response = await apiFetch(`${API_PATH}/organization/${orgCode}`);
      const data = await response.json();
      if (response.ok) {
        setContracts(data.contracts || []);
        setFilteredContracts(data.contracts || []);
      }
    } catch (error) {
      console.error('Error fetching contracts:', error);
    } finally {
      setLoading(false);
    }
  };

  // SA-05 fix: was a bare unauthenticated fetch to the storage domain.
  // uploadFile() (imported from @/lib/api) is the shared authenticated
  // upload helper.
  const uploadFileToStorage = uploadFile;

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
      const response = await apiFetch(`${API_PATH}/create`, {
        method: 'POST',
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
      const response = await apiFetch(`${API_PATH}/${selectedContract.contract_code}/invite`, {
        method: 'POST',
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
      const response = await apiFetch(`${API_PATH}/${selectedContract.contract_code}/generate-token`, {
        method: 'POST',
        body: JSON.stringify(tokenForm)
      });
      const data = await response.json();
      if (response.ok) {
        alert(`Access token generated successfully!\n\nToken: ${data.access_token}\n\nExpires: ${new Date(data.expires_at).toLocaleDateString()}`);
        setShowTokenModal(false);
        resetTokenForm();
      } else {
        alert(data.message || 'Failed to generate token');
      }
    } catch (error) {
      console.error('Error generating token:', error);
      alert('Error generating token');
    }
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
            <h1 className="text-3xl font-bold text-gray-900">{t('contract_management')}</h1>
            <p className="text-gray-500 mt-1">{t('contract_management_desc')}</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <SummaryCard
            icon={<FileText className="w-5 h-5" />}
            title={t('total_contracts')}
            value={stats.total}
            color="bg-blue-500"
          />
          <SummaryCard
            icon={<Clock className="w-5 h-5" />}
            title={t('active')}
            value={stats.active}
            color="bg-green-500"
          />
          <SummaryCard
            icon={<MessageSquare className="w-5 h-5" />}
            title={t('in_discussion')}
            value={stats.in_discussion}
            color="bg-purple-500"
          />
          <SummaryCard
            icon={<AlertTriangle className="w-5 h-5" />}
            title={t('disputed')}
            value={stats.disputed}
            color="bg-red-500"
          />
          <SummaryCard
            icon={<XCircle className="w-5 h-5" />}
            title={t('terminated')}
            value={stats.terminated}
            color="bg-gray-500"
          />
        </div>

        {/* Search and Create */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder={t('search_contracts_by_code_or_title')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <Plus className="w-5 h-5" />
              {t('create_contract')}
            </button>
          </div>
        </div>

        {/* Contracts Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('code')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('title')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('created_at')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('status')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                      {t('loading_contracts')}
                    </td>
                  </tr>
                ) : filteredContracts.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                      {t('no_contracts_found')}
                    </td>
                  </tr>
                ) : (
                  filteredContracts.map((contract) => (
                    <tr key={contract.contract_code} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono text-sm text-gray-900">{contract.contract_code}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-gray-900">{contract.contract_title}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded transition-colors"
                          >
                            <Send className="w-4 h-4" />
                            {t('invite')}
                          </button>
                          <button
                            onClick={() => {
                              setSelectedContract(contract);
                              setShowTokenModal(true);
                            }}
                            className="flex items-center gap-1 text-purple-600 hover:text-purple-800 hover:bg-purple-50 px-3 py-1.5 rounded transition-colors"
                          >
                            <Key className="w-4 h-4" />
                            {t('token')}
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
          <DialogContent className="sm:max-w-2xl bg-white max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('create_new_contract')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('contract_title')}</label>
                <input
                  type="text"
                  value={createForm.contract_title}
                  onChange={(e) => setCreateForm({ ...createForm, contract_title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="Enter contract title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('start_date')}</label>
                  <input
                    type="date"
                    value={createForm.contract_start_date}
                    onChange={(e) => setCreateForm({ ...createForm, contract_start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('end_date')}</label>
                  <input
                    type="date"
                    value={createForm.contract_end_date}
                    onChange={(e) => setCreateForm({ ...createForm, contract_end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              {/* Contract Document Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('contract_document')} <span className="text-red-500">*</span>
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
                  <input
                    type="file"
                    id="contract-file"
                    onChange={handleContractFileChange}
                    accept=".pdf,.docx,.doc"
                    className="hidden"
                    disabled={uploadingContract}
                  />
                  <label htmlFor="contract-file" className="cursor-pointer">
                    <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">
                      {uploadingContract ? `${t('uploading')}` : `${t("upload_instructiosn")}`}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">PDF, DOCX (Max 100MB)</p>
                  </label>
                  {contractFile && (
                    <div className="mt-3 flex items-center justify-center gap-2 text-sm text-green-600">
                      <File className="w-4 h-4" />
                      <span>{contractFile.name}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Attachments Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('attachments')} (Optional)
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
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
                    <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">
                      {uploadingAttachments ? `${t('uploading')}` : `${t("upload_instructiosn")}`}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">PDF, DOCX, XLSX, CSV, Images, Videos</p>
                  </label>
                </div>

                {/* Display uploaded attachments */}
                {createForm.contract_attachments.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {createForm.contract_attachments.map((url, index) => (
                      <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                        <div className="flex items-center gap-2">
                          <File className="w-4 h-4 text-gray-500" />
                          <span className="text-sm text-gray-700">
                            {attachmentFiles[index]?.name || `Attachment ${index + 1}`}
                          </span>
                        </div>
                        <button
                          onClick={() => removeAttachment(index)}
                          className="text-red-500 hover:text-red-700"
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
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleCreateContract}
                  disabled={!createForm.contract_content_url || uploadingContract || uploadingAttachments}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('create_contract')}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Invite Party Modal */}
        <Dialog open={showInviteModal && !!selectedContract} onOpenChange={(open) => { if (!open) setShowInviteModal(false); }}>
          <DialogContent className="sm:max-w-lg bg-white">
            <DialogHeader>
              <DialogTitle>{selectedContract ? `Invite Party to ${selectedContract.contract_code}` : 'Invite Party'}</DialogTitle>
            </DialogHeader>
            {selectedContract && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('party_name')}</label>
                  <input
                    type="text"
                    value={inviteForm.party_name}
                    onChange={(e) => setInviteForm({ ...inviteForm, party_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email')}</label>
                  <input
                    type="email"
                    value={inviteForm.party_email}
                    onChange={(e) => setInviteForm({ ...inviteForm, party_email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="john@example.com"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('party_side')}</label>
                    <input
                      type="text"
                      value={inviteForm.party_side}
                      onChange={(e) => setInviteForm({ ...inviteForm, party_side: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="e.g., Client"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('party_role')}</label>
                    <input
                      type="text"
                      value={inviteForm.party_role}
                      onChange={(e) => setInviteForm({ ...inviteForm, party_role: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="e.g., Signatory"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('permissions')}</label>
                  <div className="space-y-2 bg-gray-50 p-3 rounded-lg">
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
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 capitalize">{key.replace('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={handleInviteParty}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {t('send_invitation')}
                  </button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Generate Token Modal */}
        <Dialog open={showTokenModal && !!selectedContract} onOpenChange={(open) => { if (!open) setShowTokenModal(false); }}>
          <DialogContent className="sm:max-w-lg bg-white">
            <DialogHeader>
              <DialogTitle>{selectedContract ? `Generate Access Token for ${selectedContract.contract_code}` : 'Generate Access Token'}</DialogTitle>
            </DialogHeader>
            {selectedContract && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('party_email')}</label>
                  <input
                    type="email"
                    value={tokenForm.email}
                    onChange={(e) => setTokenForm({ ...tokenForm, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="party@example.com"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('email_must_belong_to_a_party_in_this_contract')}</p>
                  <p className="text-xs text-gray-500">{t('if_you_want_to_generate_a_token_for_yourself_then_write_your_own_email')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('expires_in_days')}</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={tokenForm.expires_in_days}
                    onChange={(e) => setTokenForm({ ...tokenForm, expires_in_days: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowTokenModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={handleGenerateToken}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    {t('generate_token')}
                  </button>
                </div>
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`${color} text-white p-3 rounded-lg`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
