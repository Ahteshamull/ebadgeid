'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
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
import { 
  Plus,
  Key,
  Copy,
  Calendar,
  Zap,
  Building,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function ApiKeyManagement() {
  const { session } = useSession();
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState(null);
  const [formData, setFormData] = useState({
    valid_for: 90,
    requests_allowed_per_minute: 120,
  });
  const [newApiKey, setNewApiKey] = useState(null);

  const fetchApiKeys = async () => {
    try {
      if (!session?.organization_code) return;
      setLoading(true);
      const response = await apiClient.get(`/keys/organization/${session.organization_code}`);
      setApiKeys(response.data || []);
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
      toast.error('Failed to fetch API keys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApiKeys();
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async () => {
    try {
      const response = await apiClient.post(`/keys/${session.organization_code}`, formData);
      setApiKeys([...apiKeys, response.data]);
      setNewApiKey(response.data.api_key);
      setOpen(false);
      setFormData({
        valid_for: 90,
        requests_allowed_per_minute: 120,
      });
      toast.success('API Key generated successfully.');
    } catch (error) {
      console.error('Failed to generate API key:', error);
      toast.error('Failed to generate API key');
    }
  };

  const handleRevoke = async (tokenId) => {
    try {
      await apiClient.patch(`/keys/revoke/${tokenId}`);
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
          Revoked
        </Badge>
      );
    }

    if (isExpired(key.createdAt, key.valid_for)) {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200 flex items-center gap-1 w-fit">
          <AlertTriangle className="h-3 w-3" />
          Expired
        </Badge>
      );
    }

    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200 flex items-center gap-1 w-fit">
        <CheckCircle2 className="h-3 w-3" />
        Active
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
    <div className="space-y-6">
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Key className="h-5 w-5 text-indigo-500" />
              Developer API Keys & Integrations
            </CardTitle>
            <CardDescription className="mt-1 text-muted-foreground">
              Generate and manage API keys for LMS webhooks, external automations, or developer access.
            </CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                <Plus className="h-4 w-4" />
                Generate New Key
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-foreground">
                  <Key className="h-5 w-5 text-indigo-500" />
                  Generate New API Key
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Create a new API key with custom validity and rate limits for external integrations.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Valid For (Days)</label>
                  <Input
                    name="valid_for"
                    placeholder="90"
                    value={formData.valid_for}
                    onChange={handleInputChange}
                    type="number"
                    className="bg-background border-border text-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Requests Per Minute</label>
                  <Input
                    name="requests_allowed_per_minute"
                    placeholder="120"
                    value={formData.requests_allowed_per_minute}
                    onChange={handleInputChange}
                    type="number"
                    className="bg-background border-border text-foreground"
                  />
                </div>
                <Button 
                  onClick={handleSubmit}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Key className="mr-2 h-4 w-4" />
                  Generate API Key
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-muted/50 border border-border">
              <span className="text-xs font-medium text-muted-foreground">Total Keys</span>
              <p className="text-2xl font-bold text-foreground mt-1">{stats.total}</p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Active</span>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">{stats.active}</p>
            </div>
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Expired</span>
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1">{stats.expired}</p>
            </div>
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <span className="text-xs font-medium text-rose-600 dark:text-rose-400">Revoked</span>
              <p className="text-2xl font-bold text-rose-700 dark:text-rose-300 mt-1">{stats.revoked}</p>
            </div>
          </div>

          {/* Newly Generated Key Dialog/Alert */}
          {newApiKey && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                API Key Generated — Copy it now!
              </div>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                For security reasons, this secret key will not be shown again. Store it in a safe place.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 p-2.5 bg-background border border-emerald-500/30 rounded-lg text-xs font-mono text-foreground truncate select-all">
                  {newApiKey}
                </code>
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(newApiKey)} className="gap-1 border-emerald-500/30 text-foreground">
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="py-12 flex justify-center items-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading API keys...</span>
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-border rounded-xl">
              <Key className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-foreground">No API keys found</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Generate an API key if you plan to connect external LMS platforms (Moodle, Canvas, Blackboard) or custom services.
              </p>
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-b border-border">
                    <TableHead className="font-semibold text-xs text-muted-foreground">Key Identifier</TableHead>
                    <TableHead className="font-semibold text-xs text-muted-foreground">Status</TableHead>
                    <TableHead className="font-semibold text-xs text-muted-foreground">Rate Limit</TableHead>
                    <TableHead className="font-semibold text-xs text-muted-foreground">Created</TableHead>
                    <TableHead className="font-semibold text-xs text-muted-foreground">Expires</TableHead>
                    <TableHead className="text-right font-semibold text-xs text-muted-foreground">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key._id} className="hover:bg-muted/40 border-b border-border">
                      <TableCell className="font-mono text-xs text-foreground font-medium">
                        {key.api_key_masked || key.api_key?.slice(0, 10) + '••••••••' || key._id}
                      </TableCell>
                      <TableCell>{getStatusBadge(key)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {key.requests_allowed_per_minute || 120} req/min
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(key.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(getExpiryDate(key.createdAt, key.valid_for))}
                      </TableCell>
                      <TableCell className="text-right">
                        {key.status === 'Active' && !isExpired(key.createdAt, key.valid_for) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevokeClick(key)}
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 text-xs h-8"
                          >
                            Revoke
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Inactive</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revoke confirmation */}
      <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
              Revoke API Key
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to revoke this API key? Any LMS or external systems using this key will immediately lose access to automated credential issuance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => keyToRevoke && handleRevoke(keyToRevoke._id)}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              Confirm Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
