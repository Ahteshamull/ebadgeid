'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
import { checkAuth } from '../../lib/authChecker.js';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import {
  Plus,
  Key,
  Copy,
  Eye,
  EyeOff,
  Calendar,
  Zap,
  Building,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Building2
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocale } from '@/context/Localecontext.js';
export default function ApiKeyManagementPage() {
  const { t } = useLocale();
  const { session } = useSession();
  const [apiKeys, setApiKeys] = useState([]);
  const [open, setOpen] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState(null);
  const [formData, setFormData] = useState({
    valid_for: 90,
    requests_allowed_per_minute: 120,
  });
  const [newApiKey, setNewApiKey] = useState(null);
  const [showFullKey, setShowFullKey] = useState(false);
  const [showFullKeys, setShowFullKeys] = useState({});



  useEffect(() => {
    checkAuth('admin');
  }, []);

  const fetchApiKeys = async () => {
    try {
      const orgCode = session?.organization_code;
      const response = await apiFetch(`/keys/organization/${orgCode}`);
      if (!response.ok) throw new Error('Failed to fetch API keys');
      const data = await response.json();
      setApiKeys(data);
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
      toast.error('Failed to fetch API keys');
    }
  };

  useEffect(() => {
    if (!session) return;
    fetchApiKeys();
  }, [session]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async () => {
    try {
      const orgCode = session?.organization_code;
      const response = await apiFetch(`/keys/${orgCode}`, {
        method: 'POST',
        body: JSON.stringify(formData),
      });
      if (!response.ok) throw new Error('Failed to generate API key');
      const data = await response.json();

      setApiKeys([...apiKeys, data]);
      setNewApiKey(data.api_key);
      setOpen(false);
      setFormData({
        valid_for: 90,
        requests_allowed_per_minute: 120,
      });
      toast.success('API Key generated successfully. Please go through the API Docs for usage example.');
    } catch (error) {
      console.error('Failed to generate API key:', error);
      toast.error('Failed to generate API key');
    }
  };

  const handleRevoke = async (tokenId) => {
    try {
      const response = await apiFetch(`/keys/revoke/${tokenId}`, { method: 'PATCH' });
      if (!response.ok) throw new Error('Failed to revoke API key');
      fetchApiKeys();
      setShowRevokeDialog(false);
      setKeyToRevoke(null);
      toast.success('API Key revoked successfully');
    } catch (error) {
      console.error('Failed to revoke API key:', error);
      toast.error('Failed to revoke API key');
    }
  };

  const handleRevokeClick = (key) => {
    setKeyToRevoke(key);
    setShowRevokeDialog(true);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('API key copied to clipboard');
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getExpiryDate = (createdAt, validForDays) => {
    const date = new Date(createdAt);
    date.setDate(date.getDate() + validForDays);
    return date;
  };

  const isExpired = (createdAt, validForDays) => {
    const expiryDate = getExpiryDate(createdAt, validForDays);
    return new Date() > expiryDate;
  };

  const getStatusBadge = (key) => {
    if (key.status === 'Revoked') {
      return (
        <Badge variant="destructive" className="flex items-center gap-1 w-fit text-white">
          <XCircle className="h-3 w-3" />
          {t('revoked')}
        </Badge>
      );
    }

    if (isExpired(key.createdAt, key.valid_for)) {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200 flex items-center gap-1 w-fit">
          <AlertTriangle className="h-3 w-3" />
          {t('expired')}
        </Badge>
      );
    }

    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200 flex items-center gap-1 w-fit">
        <CheckCircle2 className="h-3 w-3" />
        {t('active')}
      </Badge>
    );
  };

  const stats = {
    total: apiKeys.length,
    active: apiKeys.filter(key => key.status === 'Active' && !isExpired(key.createdAt, key.valid_for)).length,
    revoked: apiKeys.filter(key => key.status === 'Revoked').length,
    expired: apiKeys.filter(key => isExpired(key.createdAt, key.valid_for) && key.status !== 'Revoked').length,
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              {t('api_key_heading')}
            </h1>
            <p className="text-slate-600 mt-2">
              {t('api_key_description')}
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4" />
                {t('generate_api_key')}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md bg-white">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  {t('generate_new_api_key')}
                </DialogTitle>
                <DialogDescription>
                  {t('generate_new_api_key_description')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">{t('valid_for')}</label>
                  <Input
                    name="valid_for"
                    placeholder="90"
                    value={formData.valid_for}
                    onChange={handleInputChange}
                    type="number"
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">{t('requests_allowed_per_minute')}</label>
                  <Input
                    name="requests_allowed_per_minute"
                    placeholder="120"
                    value={formData.requests_allowed_per_minute}
                    onChange={handleInputChange}
                    type="number"
                    className="bg-white border-slate-200"
                  />
                </div>
                <Button
                  onClick={handleSubmit}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  <Key className="mr-2 h-4 w-4" />
                  {t('generate_api_key')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('total_keys')}</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
                </div>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Key className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('active')}</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.active}</p>
                </div>
                <div className="p-2 bg-green-100 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
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
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/50 backdrop-blur-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">{t('expired')}</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.expired}</p>
                </div>
                <div className="p-2 bg-yellow-100 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* API Keys Table */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2">
              <Key className="h-5 w-5" />
              {t('api_keys')}
            </CardTitle>
            <CardDescription>
              {t('api_keys_description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow className="border-b border-slate-200">
                    <TableHead className="text-slate-600 font-medium">{t('api_key')}</TableHead>
                    <TableHead className="text-slate-600 font-medium">{t('status')}</TableHead>
                    <TableHead className="text-slate-600 font-medium">{t('created')}</TableHead>
                    <TableHead className="text-slate-600 font-medium">{t('expires')}</TableHead>
                    <TableHead className="text-slate-600 font-medium">{t('rate_limit')}</TableHead>
                    <TableHead className="text-slate-600 font-medium">{t('organization')}</TableHead>
                    <TableHead className="text-slate-600 font-medium text-right">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key._id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-2">
                                <code className="font-mono text-sm bg-slate-100 px-2 py-1 rounded border">
                                  {showFullKey ? key.api_key : `${key.api_key.substring(0, 12)}...${key.api_key.substring(key.api_key.length - 8)}`}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setShowFullKey(!showFullKey)}
                                >
                                  {showFullKey ? (
                                    <EyeOff className="h-4 w-4" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => copyToClipboard(key.api_key)}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{showFullKey ? t('click_to_hide_full_key') : t('click_to_reveal_full_key')}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(key)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-slate-600">
                          <Calendar className="h-3 w-3" />
                          {formatDate(key.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-slate-600">
                          <Calendar className="h-3 w-3" />
                          {formatDate(getExpiryDate(key.createdAt, key.valid_for))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-slate-600">
                          <Zap className="h-3 w-3" />
                          {key.requests_allowed_per_minute}/min
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-slate-600">
                          <Building2 className="h-3 w-3" />
                          {key.organization_code}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {key.status === 'Active' && !isExpired(key.createdAt, key.valid_for) && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRevokeClick(key)}
                              className="text-xs h-8 text-white"
                            >
                              <Shield className="h-3 w-3 mr-1 text-white" />
                              {t('revoke')}
                            </Button>
                          )}
                          {(key.status === 'Revoked' || isExpired(key.createdAt, key.valid_for)) && (
                            <span className="text-xs text-slate-500 px-3 py-1 flex items-center h-8">
                              <XCircle className="h-3 w-3 mr-1" />
                              {key.status === 'Revoked' ? 'Revoked' : 'Expired'}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {apiKeys.length === 0 && (
              <div className="text-center py-12">
                <Key className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">{t('no_api_keys_found')}</h3>
                <p className="text-slate-500 mb-4">
                  {t('get_started_by_generating_your_first_api_key')}
                </p>
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      {t('generate_api_key')}
                    </Button>
                  </DialogTrigger>
                </Dialog>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* New API Key Success Dialog */}
      <Dialog open={!!newApiKey} onOpenChange={() => setNewApiKey(null)}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              {t('api_key_generated_successfully')}
            </DialogTitle>
            <DialogDescription>
              {t('api_key_generated_successfully_description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-slate-700">{t('your_api_key')}</label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(newApiKey)}
                  className="gap-1"
                >
                  <Copy className="h-3 w-3" />
                  {t('copy')}
                </Button>
              </div>
              <code className="font-mono text-sm break-all bg-white p-2 rounded border block">
                {newApiKey}
              </code>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-yellow-800">
                  <p className="font-medium">{t('important_security_notice')}</p>
                  <p className="mt-1">{t('store_this_key_securely')}</p>
                </div>
              </div>
            </div>
            <Button
              onClick={() => setNewApiKey(null)}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {t('i_have_saved_my_key')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              {t('revoke_api_key')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-700">
              {t('are_you_sure_you_want_to_revoke_the_api_key_starting_with')}
              <strong> {keyToRevoke?.api_key?.substring(0, 8)}...</strong>?
              <br /><br />
              {t('undone_description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setKeyToRevoke(null)}
              className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleRevoke(keyToRevoke?._id)}
              className="bg-red-600 hover:bg-red-700"
            >
              <Shield className="mr-2 h-4 w-4" />
              {t('revoke_api_key')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}