'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
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
  Eye,
  EyeOff
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

  useEffect(() => {
    if (session?.username) fetchUserCredentials();
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchUserCredentials = async () => {
    const username = session?.username;
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
        headers: {
          'Content-Type': 'application/json',
        },
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

  // Explicit opt-in/opt-out for the public portal (ebadge.id/portal/:username)
  // — separate from claiming. A credential is visible there by default once
  // Claimed (see backend (updated)/models/credentialSchema.js), but the
  // recipient can turn that off (or back on) here at any time.
  const togglePortalVisibility = async (credential) => {
    const nextVisible = !credential.portal_visible;
    setError('');
    setSuccess('');
    try {
      const response = await apiFetch(`/credentials/portal-visibility/${credential.credential_code}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: nextVisible }),
      });
      if (!response.ok) throw new Error('Failed to update portal visibility');
      setSuccess(nextVisible ? 'Now visible on your public portal.' : 'Hidden from your public portal.');
      fetchUserCredentials();
    } catch (err) {
      console.error('Error updating portal visibility:', err);
      setError('Failed to update portal visibility: ' + err.message);
    }
  };

  const downloadCredential = async (credentialUrl, credentialCode) => {
    try {
      const response = await fetch(credentialUrl);
      const blob = await response.blob();
      // The certificate service always generates PNG (see
      // certificateController.js — PNG_SIGNATURE check on the response
      // bytes), but this used to force a `.jpg` extension regardless.
      // Image viewers read actual file bytes, not the extension, so this
      // rarely broke anything visibly — but it's a real mismatch, and a
      // strict validator or a "type must match extension" upload elsewhere
      // could reject the downloaded file. Derive the extension from the
      // blob's real MIME type instead of hardcoding one.
      const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'png';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${credentialCode}.${extension}`;
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
    // Was: today's date for "issued" and "today + 2 years" for "expires",
    // regardless of the credential's actual dates — same bug already fixed
    // in the public verification page (see AUDIT_FIXES.md); this call site
    // was missed. Now uses the real credential_issue_date /
    // credential_expiry_date fields, same as verifications/credentials/[code].
    const issueDate = new Date(credential.credential_issue_date);
    const expiryDate = new Date(credential.credential_expiry_date);

    const certificationData = {
      name: credential.credential_title || 'Professional Credential',
      organization: credential.organization_detail?.name || 'Organization',
      issueYear: issueDate.getFullYear(),
      issueMonth: issueDate.getMonth() + 1,
      expirationYear: expiryDate.getFullYear(),
      expirationMonth: expiryDate.getMonth() + 1,
      credentialId: credential.credential_code || "123",
      credentialUrl: credential.credential_pic_url,
      description: `Professional credential earned from ${credential.organization_detail?.name}.
This certification validates my expertise and commitment to professional excellence.
Credential ID: ${credential.credential_code}
Issued: ${issueDate.toLocaleDateString()}
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
            Available to Claim
          </Badge>
        );
      case 'claimed':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
            <Shield className="h-3 w-3 mr-1" />
            Claimed
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
      default:
        return <Badge variant="outline">Unknown</Badge>;
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
                Claiming...
              </>
            ) : (
              <>
                <Award className="h-3 w-3 mr-1" />
                Claim
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
              Download
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => addToLinkedInProfile(credential)}
              className="text-xs px-3 py-1 h-8 bg-blue-50 hover:bg-blue-100 border-blue-200"
            >
              <Linkedin className="h-3 w-3 mr-1 text-blue-700" />
              Add to LinkedIn
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs px-3 py-1 h-8 border-black text-black"
                >
                  <Share2 className="h-3 w-3 mr-1" />
                  Share
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => {
                  navigator.clipboard.writeText(credential.credential_pic_url);
                  setSuccess('Link copied to clipboard!');
                }}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Copy Link
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => togglePortalVisibility(credential)}>
                  {credential.portal_visible !== false ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-2" />
                      Hide from public portal
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Show on public portal
                    </>
                  )}
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
            <span className="ml-3 text-slate-600">Loading your credentials...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              My Credentials
            </h1>
            <p className="text-muted-foreground mt-2">
              View and manage your digital credentials and certificates
            </p>
          </div>
        </div>

        {/* User Profile Card */}
        {userInfo && (
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start gap-6">
                <Avatar className="h-20 w-20 border-2 border-border shadow-lg">
                  <AvatarImage src={userInfo.profile_pic} alt={userInfo.first_name} />
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-2xl font-semibold">
                    {getInitials(userInfo.first_name, userInfo.last_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">
                      {userInfo.first_name} {userInfo.last_name}
                    </h3>
                    <p className="text-muted-foreground mt-1">{userInfo.designation || 'Professional'}</p>
                    {userInfo.city && (
                      <p className="text-muted-foreground flex items-center gap-1 mt-2">
                        <MapPin className="h-4 w-4" />
                        {userInfo.city}
                      </p>
                    )}
                  </div>
                  {organizationInfo && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Organization</h4>
                      <p className="text-foreground font-medium">{organizationInfo.name}</p>
                      <p className="text-muted-foreground text-sm mt-1">
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
                  <p className="text-sm font-medium text-muted-foreground">Claimed</p>
                  <p className="text-2xl font-bold text-foreground">{stats.claimed}</p>
                </div>
                <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg">
                  <Shield className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Available</p>
                  <p className="text-2xl font-bold text-foreground">{stats.available}</p>
                </div>
                <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg">
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
                    placeholder="Search by credential code..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 bg-background border-border text-foreground"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px] bg-background border-border text-foreground">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="issued">Available to Claim</SelectItem>
                    <SelectItem value="claimed">Claimed</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-muted-foreground">
                Showing {filteredCredentials.length} of {credentials.length} credentials
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
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr className="border-b border-border">
                    <th className="text-left p-4 text-muted-foreground font-medium">Credential</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Details</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Organization</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Status</th>
                    <th className="text-left p-4 text-muted-foreground font-medium">Blockchain Hash</th>
                    <th className="text-right p-4 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCredentials.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="h-64">
                        <div className="text-center py-12">
                          <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-foreground mb-2">
                            {credentials.length === 0 ? 'No credentials yet' : 'No matching credentials'}
                          </h3>
                          <p className="text-muted-foreground mb-4">
                            {credentials.length === 0 
                              ? 'You don\'t have any credentials issued yet. Check back later!' 
                              : 'Try adjusting your search or filters'
                            }
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredCredentials.map((credential, index) => (
                      <tr 
                        key={index} 
                        className="border-b border-border hover:bg-muted/40 transition-colors"
                      >
                        <td className="p-4">
                          <img
                            src={credential.credential_pic_url}
                            alt={credential.credential_code}
                            className="w-20 h-14 rounded-md object-cover border border-border shadow-sm"
                          />
                        </td>
                        <td className="p-4">
                          <div className="space-y-1">
                            <div className="text-sm text-foreground font-medium">
                              {credential.credential_title || 'Professional Credential'}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Hash className="h-3 w-3" />
                              {credential.credential_code}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Issued: {new Date(credential.credential_issue_date).toLocaleDateString()}
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-sm text-foreground">
                              <Building className="h-3 w-3" />
                              {credential.organization_detail?.name || 'N/A'}
                            </div>
                            <div className="text-xs text-muted-foreground">
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
