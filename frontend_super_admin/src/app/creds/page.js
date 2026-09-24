'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Download,
  Loader2,
  User,
  Award,
  MapPin,
  Share2,
  Linkedin,
  Search,
  FileCheck,
  FileX,
  AlertTriangle,
  Shield,
  Hash,
  Building,
  ExternalLink,
  Package,
  Building2
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLocale } from '@/context/Localecontext';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';

export default function UserCredentialManagementPage() {
  const { session } = useSession();
  const [search, setSearch] = useState('');
  const [credentials, setCredentials] = useState([]);
  const [userInfo, setUserInfo] = useState(null);
  const [organizationInfo, setOrganizationInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claimLoading, setClaimLoading] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const { t } = useLocale();

  useEffect(() => {
    // session resolves asynchronously via useSession()'s /auth/me call --
    // wait for it so fetchUserCredentials uses the real username instead of
    // the 'demo_user' placeholder fallback.
    if (!session) return;
    fetchUserCredentials();
  }, [session]);

  const fetchUserCredentials = async () => {
    // SA-01 fix: was localStorage.getItem('username'), always null now
    // that login no longer writes to localStorage. Session lives in the
    // httpOnly cookie; useSession() reads it via /auth/me.
    const username = session?.username || 'demo_user';
    setLoading(true);
    setError('');

    try {
      const response = await apiFetch(`/credentials/by-users/${username}`);
      const data = await response.json();

      // Check if no credentials found
      if (data.message === "No credentials found for this user") {
        setCredentials([]);
        setUserInfo(data.user || null);
        setOrganizationInfo(data.organization || null);
      } else {
        setUserInfo(data.user);
        setOrganizationInfo(data.organization);
        setCredentials(data.credentials || []);
      }
    } catch (err) {
      console.error('Error fetching credentials:', err);
      setError('Failed to fetch your credentials');
      setCredentials([]);
    } finally {
      setLoading(false);
    }
  };

  const claimCredential = async (credentialCode) => {
    const username = session?.username;
    setClaimLoading(prev => ({ ...prev, [credentialCode]: true }));
    setError('');
    setSuccess('');

    try {
      const response = await apiFetch(`/credentials/claim/${credentialCode}`, {
        method: 'PUT',
        body: JSON.stringify({ username })
      });

      if (!response.ok) {
        throw new Error('Failed to claim credential');
      }

      setSuccess(`Credential ${credentialCode} has been claimed successfully!`);
      fetchUserCredentials();
    } catch (err) {
      console.error('Error claiming credential:', err);
      setError('Failed to claim credential: ' + err.message);
    } finally {
      setClaimLoading(prev => ({ ...prev, [credentialCode]: false }));
    }
  };

  const downloadCredential = async (credentialUrl, credentialCode) => {
    try {
      const response = await fetch(credentialUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${credentialCode}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      setSuccess('Credential downloaded successfully!');
    } catch (err) {
      console.error('Error downloading credential:', err);
      setError('Failed to download credential');
    }
  };

  const addToLinkedInProfile = (credential) => {
    const currentDate = new Date();
    const expiryDate = new Date(currentDate.getFullYear() + 2, currentDate.getMonth(), currentDate.getDate());

    const certificationData = {
      name: credential.credential_code || 'Professional Credential',
      organization: credential.organization_detail?.name || 'Organization',
      issueYear: currentDate.getFullYear(),
      issueMonth: currentDate.getMonth() + 1,
      expirationYear: expiryDate.getFullYear(),
      expirationMonth: expiryDate.getMonth() + 1,
      credentialId: credential.credential_code || "123",
      credentialUrl: credential.credential_pic_url,
      description: `Professional credential earned from ${credential.organization_detail?.name}. 
This certification validates my expertise and commitment to professional excellence.
Credential ID: ${credential.credential_code}
Issued: ${currentDate.toLocaleDateString()}
Expires: ${expiryDate.toLocaleDateString()}`
    };

    const linkedInCertUrl = `https://www.linkedin.com/profile/add?startTask=CERTIFICATION&` +
      `name=${encodeURIComponent(certificationData.name)}&` +
      `organizationName=${encodeURIComponent(certificationData.organization)}&` +
      `issueYear=${certificationData.issueYear}&` +
      `issueMonth=${certificationData.issueMonth}&` +
      `expirationYear=${certificationData.expirationYear}&` +
      `expirationMonth=${certificationData.expirationMonth}&` +
      `certUrl=${encodeURIComponent(certificationData.credentialUrl)}&` +
      `certId=${encodeURIComponent(certificationData.credentialId)}&` +
      `description=${encodeURIComponent(certificationData.description)}`;

    window.open(linkedInCertUrl, '_blank', 'width=900,height=700');
    setSuccess('Opening LinkedIn to add your certification!');
  };

  const getStatusBadge = (status) => {
    switch (status?.toLowerCase()) {
      case 'issued':
        return (
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 border-orange-200">
            <FileCheck className="h-3 w-3 mr-1" />
            {t('available_to_claim')}
          </Badge>
        );
      case 'claimed':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
            <Shield className="h-3 w-3 mr-1" />
            {t('claimed')}
          </Badge>
        );
      case 'revoked':
        return (
          <Badge variant="destructive" className="text-xs text-white px-3 py-1">
            <FileX className="h-3 w-3 mr-1" />
            {t('revoked')}
          </Badge>
        );
      case 'expired':
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {t('expired')}
          </Badge>
        );
      default:
        return <Badge variant="outline">{t('unknown')}</Badge>;
    }
  };

  const renderActionButtons = (credential) => {
    const status = credential.credential_status?.toLowerCase();

    return (
      <div className="flex gap-2 justify-end">
        {status === 'issued' && (
          <Button
            variant="default"
            size="sm"
            onClick={() => claimCredential(credential.credential_code)}
            disabled={claimLoading[credential.credential_code]}
            className="text-xs px-3 py-1 h-8 bg-black hover:bg-zinc-900 text-white"
          >
            {claimLoading[credential.credential_code] ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                {t('claiming')}
              </>
            ) : (
              <>
                <Award className="h-3 w-3 mr-1" />
                {t('claim')}
              </>
            )}
          </Button>
        )}
        {status === 'claimed' && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCredential(credential.credential_pic_url, credential.credential_code)}
              className="text-xs px-3 py-1 h-8 border-black text-black"
            >
              <Download className="h-3 w-3 mr-1" />
              {t('download')}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => addToLinkedInProfile(credential)}
              className="text-xs px-3 py-1 h-8 bg-blue-50 hover:bg-blue-100 border-blue-200"
            >
              <Linkedin className="h-3 w-3 mr-1 text-blue-700" />
              {t('add_to_linkedin')}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs px-3 py-1 h-8 border-black text-black"
                >
                  <Share2 className="h-3 w-3 mr-1" />
                  {t('share')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => {
                  navigator.clipboard.writeText(credential.credential_pic_url);
                  setSuccess(t('link_copied_to_clipboard'));
                }}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('copy_link')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    );
  };

  const filteredCredentials = credentials.filter((c) => {
    const matchesSearch = `${c.credential_code}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.credential_status?.toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: credentials.length,
    claimed: credentials.filter(c => c.credential_status?.toLowerCase() === 'claimed').length,
    available: credentials.filter(c => c.credential_status?.toLowerCase() === 'issued').length,
    revoked: credentials.filter(c => c.credential_status?.toLowerCase() === 'revoked').length,
  };

  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  if (loading) {
    return (
      <div className="min-h-screen p-6 bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
            <span className="ml-3 text-slate-600">{t('loading_credentials')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 ">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              {t('my_credentials')}
            </h1>
            <p className="text-slate-600 mt-2">
              {t('my_credentials_description')}
            </p>
          </div>
        </div>

        {/* User Profile Card */}
        {userInfo && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200">
            <CardContent className="p-6">
              <div className="flex items-start gap-6">
                <Avatar className="h-20 w-20 border-2 border-white shadow-lg">
                  <AvatarImage src={userInfo.profile_pic} alt={userInfo.first_name} />
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-2xl font-semibold">
                    {getInitials(userInfo.first_name, userInfo.last_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900">
                      {userInfo.first_name} {userInfo.last_name}
                    </h3>
                    <p className="text-slate-600 mt-1">{userInfo.designation || 'Professional'}</p>
                    {userInfo.city && (
                      <p className="text-slate-500 flex items-center gap-1 mt-2">
                        <MapPin className="h-4 w-4" />
                        {userInfo.city}
                      </p>
                    )}
                  </div>
                  {organizationInfo && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-600 mb-1">{t('organization')}</h4>
                      <p className="text-slate-900 font-medium">{organizationInfo.name}</p>
                      <p className="text-slate-500 text-sm mt-1">
                        {organizationInfo.city}, {organizationInfo.state}, {organizationInfo.country}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('total_credentials')}</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
                </div>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Award className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('claimed')}</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.claimed}</p>
                </div>
                <div className="p-2 bg-green-100 rounded-lg">
                  <Shield className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('available')}</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.available}</p>
                </div>
                <div className="p-2 bg-orange-100 rounded-lg">
                  <FileCheck className="h-5 w-5 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('revoked')}</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.revoked}</p>
                </div>
                <div className="p-2 bg-red-100 rounded-lg">
                  <FileX className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Alerts */}
        {error && (
          <Alert variant="destructive" className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="bg-green-50 border-green-200">
            <FileCheck className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">{success}</AlertDescription>
          </Alert>
        )}

        {/* Search and Filters */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex flex-1 gap-4 items-center">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder={t('search_by_credential_code')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 bg-white/50 border-slate-200"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px] bg-white/50 border-slate-200">
                    <SelectValue placeholder={t('filter_by_status')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('all_status')}</SelectItem>
                    <SelectItem value="issued">{t('available_to_claim')}</SelectItem>
                    <SelectItem value="claimed">{t('claimed')}</SelectItem>
                    <SelectItem value="revoked">{t('revoked')}</SelectItem>
                    <SelectItem value="expired">{t('expired')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-slate-500">
                {t('showing')} {t('credentials')} : {filteredCredentials.length}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Credentials Table */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200 overflow-hidden">
          <CardHeader className="pb-3 bg-grey">
            <CardTitle className="text-xl flex items-center gap-2">
              <Award className="h-5 w-5" />
              {t('credentials')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50/80">
                  <tr className="border-b border-slate-200">
                    <th className="text-left p-4 text-slate-600 font-medium">{t('credential')}</th>
                    <th className="text-left p-4 text-slate-600 font-medium">{t('details')}</th>
                    <th className="text-left p-4 text-slate-600 font-medium">{t('organization')}</th>
                    <th className="text-left p-4 text-slate-600 font-medium">{t('status')}</th>
                    <th className="text-left p-4 text-slate-600 font-medium">{t('blockchain_hash')}</th>
                    <th className="text-right p-4 text-slate-600 font-medium">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCredentials.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="h-64">
                        <div className="text-center py-12">
                          <Package className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-slate-900 mb-2">
                            {credentials.length === 0 ? t('no_credentials_yet') : t('no_matching_credentials')}
                          </h3>
                          <p className="text-slate-500 mb-4">
                            {credentials.length === 0
                              ? t('no_credentials_issued_yet_hint')
                              : t('try_adjusting_your_search_or_filters')
                            }
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredCredentials.map((credential, index) => (
                      <tr
                        key={index}
                        className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="p-4">
                          <img
                            src={credential.credential_pic_url}
                            alt={credential.credential_code}
                            className="w-20 h-14 rounded-md object-cover border border-slate-200 shadow-sm"
                          />
                        </td>
                        <td className="p-4">
                          <div className="space-y-1">
                            <div className="text-sm text-slate-600 font-medium">
                              {credential.credential_title || t('professional_credential')}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-slate-500">
                              <Hash className="h-3 w-3" />
                              {credential.credential_code}
                            </div>
                            <div className="text-xs text-slate-500">
                              {t('issued')}: {new Date(credential.credential_issue_date).toLocaleDateString()}
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-sm text-slate-600">
                              <Building2 className="h-3 w-3" />
                              {credential.organization_detail?.name || 'N/A'}
                            </div>
                            <div className="text-xs text-slate-500">
                              {credential.organization_detail?.code}
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          {getStatusBadge(credential.credential_status)}
                        </td>
                        <td className="p-4">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1 text-sm text-slate-600 cursor-help max-w-[200px]">
                                  <Hash className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate font-mono text-xs">
                                    {credential.credential_blockchain_hashes || t('no_hash')}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-mono text-xs max-w-xs break-all">
                                  {credential.credential_blockchain_hashes || t('no_blockchain_hash_available')}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                        <td className="p-4">
                          {renderActionButtons(credential)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}