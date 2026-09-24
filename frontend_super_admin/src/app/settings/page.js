"use client";

import { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  User,
  Building,
  Upload,
  Save,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Signature,
  Image
} from 'lucide-react';
import { useLocale } from '@/context/Localecontext';
import { apiFetch, uploadFile } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
// Initial state objects
const initialUserData = {
  _id: '',
  username: '',
  organization_code: '',
  first_name: '',
  last_name: '',
  designation: '',
  city: '',
  state: '',
  country: '',
  email: '',
  phone: '',
  status: '',
  profile_picture_url: ''
};

const initialOrganizationData = {
  _id: '',
  organization_code: '',
  name: '',
  city: '',
  state: '',
  country: '',
  email: '',
  phone: '',
  status: '',
  plan: '',
  users: 0,
  logo: '',
  signature: ''
};

const initialUploadingState = {
  profile: false,
  logo: false,
  signature: false
};

export default function SettingsPage() {
  // State management
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [userData, setUserData] = useState(initialUserData);
  const [organizationData, setOrganizationData] = useState(initialOrganizationData);
  const [profileImage, setProfileImage] = useState(null);
  const [organizationLogo, setOrganizationLogo] = useState(null);
  const [signatureImage, setSignatureImage] = useState(null);
  const [uploading, setUploading] = useState(initialUploadingState);
  const [activeTab, setActiveTab] = useState('profile');
  const { t } = useLocale();
  // SA-01 fix: was localStorage.getItem('username'/'role'), which is
  // always null now that login no longer writes to localStorage. Session
  // lives in the httpOnly cookie; useSession() reads it via /auth/me.
  const { session } = useSession();
  const currentUsername = session?.username || '';
  const userRole = session?.role || '';
  const isAdmin = userRole === 'admin';

  // Fetch data when username changes
  useEffect(() => {
    const loadData = async () => {
      if (!currentUsername) return;

      setLoading(true);
      setError(null);

      try {
        const user = await fetchUserData();

        if (isAdmin && user.organization_code) {
          await fetchOrganizationData(user.organization_code);
        }
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [currentUsername, isAdmin]);

  // API functions
  const fetchUserData = async () => {
    try {
      const response = await apiFetch(`/users/username/${currentUsername}`);
      if (!response.ok) throw new Error('Failed to fetch user data');
      const data = await response.json();
      setUserData(data);
      return data;
    } catch (err) {
      setError('Failed to load user data');
      throw err;
    }
  };

  const fetchOrganizationData = async (orgCode) => {
    try {
      const response = await apiFetch(`/organizations/code/${orgCode}`);
      if (!response.ok) throw new Error('Failed to fetch organization data');
      const data = await response.json();
      setOrganizationData(data);
      return data;
    } catch (err) {
      setError('Failed to load organization data');
      throw err;
    }
  };

  // Handlers
  const handleUserChange = (e) => {
    const { name, value } = e.target;
    setUserData(prev => ({ ...prev, [name]: value }));
  };

  const handleOrganizationChange = (e) => {
    const { name, value, type, checked } = e.target;
    setOrganizationData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // SA-05 fix: was a bare unauthenticated fetch to the storage domain.
  // uploadFile() (imported from @/lib/api) is the shared authenticated
  // upload helper.
  const handleFileUpload = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(prev => ({ ...prev, [type]: true }));

    try {
      const uploadedUrl = await uploadFile(file);

      switch (type) {
        case 'profile':
          setProfileImage(uploadedUrl);
          setUserData(prev => ({ ...prev, profile_picture_url: uploadedUrl }));
          break;
        case 'logo':
          setOrganizationLogo(uploadedUrl);
          setOrganizationData(prev => ({ ...prev, logo: uploadedUrl }));
          break;
        case 'signature':
          setSignatureImage(uploadedUrl);
          setOrganizationData(prev => ({ ...prev, signature: uploadedUrl }));
          break;
        default:
          break;
      }
    } catch (err) {
      setError(`Failed to upload ${type}: ${err.message}`);
    } finally {
      setUploading(prev => ({ ...prev, [type]: false }));
    }
  };

  // Update functions
  const updateUser = async (updatedData) => {
    const response = await apiFetch(`/users/${userData._id}`, {
      method: 'PUT',
      body: JSON.stringify(updatedData)
    });

    if (!response.ok) throw new Error('Failed to update user');
    return response.json();
  };

  const updateOrganization = async (updatedData) => {
    const response = await apiFetch(`/organizations/${organizationData._id}`, {
      method: 'PUT',
      body: JSON.stringify(updatedData)
    });

    if (!response.ok) throw new Error('Failed to update organization');
    return response.json();
  };

  // Form submission
  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Prepare user update data
      const userUpdateData = {
        first_name: userData.first_name,
        last_name: userData.last_name,
        designation: userData.designation,
        city: userData.city,
        state: userData.state,
        country: userData.country,
        email: userData.email,
        phone: userData.phone,
        profile_picture_url: userData.profile_picture_url
      };

      await updateUser(userUpdateData);

      // Update organization data if admin
      if (isAdmin) {
        const orgUpdateData = {
          name: organizationData.name,
          city: organizationData.city,
          state: organizationData.state,
          country: organizationData.country,
          email: organizationData.email,
          phone: organizationData.phone,
          logo: organizationData.logo,
          signature: organizationData.signature
        };

        await updateOrganization(orgUpdateData);
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex justify-center items-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="text-slate-600">{t('loading_settings')}</p>
        </div>
      </div>
    );
  }

  // Main render
  return (
    <div className="min-h-screen  p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              {t('settings')}
            </h1>
            <p className="text-slate-600 mt-2">
              {t('settings_description')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="flex items-center gap-1">
              <Shield className="h-3 w-3" />
              {userRole === 'admin' ? t('administrator') : t('user')}
            </Badge>
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              {t('settings_updated_successfully')}
            </AlertDescription>
          </Alert>
        )}

        {/* Tabs Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 lg:grid-cols-3">
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              {t('profile')}
            </TabsTrigger>
            {isAdmin && (
              <>
                <TabsTrigger value="organization" className="flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  {t('organization')}
                </TabsTrigger>
                <TabsTrigger value="signature" className="flex items-center gap-2">
                  <Signature className="h-4 w-4" />
                  {t('signature')}
                </TabsTrigger>
              </>
            )}
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6">
            <ProfileSettings
              userData={userData}
              uploading={uploading}
              handleUserChange={handleUserChange}
              handleFileUpload={handleFileUpload}
              t={t}
            />
          </TabsContent>

          {/* Organization Tab */}
          {isAdmin && (
            <TabsContent value="organization" className="space-y-6">
              <OrganizationSettings
                organizationData={organizationData}
                uploading={uploading}
                handleOrganizationChange={handleOrganizationChange}
                handleFileUpload={handleFileUpload}
                t={t}
              />
            </TabsContent>
          )}

          {/* Signature Tab */}
          {isAdmin && (
            <TabsContent value="signature" className="space-y-6">
              <SignatureSettings
                organizationData={organizationData}
                uploading={uploading}
                handleFileUpload={handleFileUpload}
                t={t}
              />
            </TabsContent>
          )}
        </Tabs>

        {/* Save Button */}
        <div className="flex justify-end pt-6 border-t border-slate-200">
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="gap-2 bg-black hover:bg-blue-700 px-8"
            size="lg"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? t('saving_changes') : t('save_changes')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Component for Profile Settings
const ProfileSettings = ({ userData, uploading, handleUserChange, handleFileUpload, t }) => (
  <Card className="bg-white/80 backdrop-blur-sm border-slate-200">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <User className="h-5 w-5" />
        {t('profile_settings')}
      </CardTitle>
      <CardDescription>
        {t('profile_settings_description')}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Profile Picture Section */}
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <Avatar className="w-32 h-32 border-4 border-white shadow-lg">
              <AvatarImage src={userData.profile_picture_url} />
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-2xl font-semibold">
                {userData.first_name?.[0]}{userData.last_name?.[0]}
              </AvatarFallback>
            </Avatar>
            {uploading.profile && (
              <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-3">
            <Label htmlFor="profile-image" className="text-sm font-medium text-slate-700">
              {t('update_profile_picture')}
            </Label>
            <Input
              id="profile-image"
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading.profile}
              onChange={(e) => handleFileUpload(e, 'profile')}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('profile-image').click()}
              disabled={uploading.profile}
              className="gap-2 border-slate-200"
            >
              <Upload className="h-4 w-4" />
              {uploading.profile ? t('uploading') : t('choose_image')}
            </Button>
            <p className="text-xs text-slate-500 text-center max-w-[200px]">
              {t('profile_picture_hint')}
            </p>
          </div>
        </div>

        {/* Form Fields */}
        <div className="flex-1 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="first_name" className="flex items-center gap-2 text-slate-700">
                <User className="h-4 w-4" />
                {t('first_name')}
              </Label>
              <Input
                id="first_name"
                name="first_name"
                value={userData.first_name}
                onChange={handleUserChange}
                className="bg-white border-slate-200"
                placeholder={t('enter_first_name')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="last_name" className="flex items-center gap-2 text-slate-700">
                <User className="h-4 w-4" />
                {t('last_name')}
              </Label>
              <Input
                id="last_name"
                name="last_name"
                value={userData.last_name}
                onChange={handleUserChange}
                className="bg-white border-slate-200"
                placeholder={t('enter_last_name')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2 text-slate-700">
                <Mail className="h-4 w-4" />
                {t('email_address')}
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={userData.email}
                onChange={handleUserChange}
                className="bg-white border-slate-200"
                placeholder={t('email_placeholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2 text-slate-700">
                <Phone className="h-4 w-4" />
                {t('phone_number')}
              </Label>
              <Input
                id="phone"
                name="phone"
                value={userData.phone}
                onChange={handleUserChange}
                className="bg-white border-slate-200"
                placeholder={t('phone_placeholder')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="designation" className="flex items-center gap-2 text-slate-700">
              <Briefcase className="h-4 w-4" />
              {t('designation')}
            </Label>
            <Input
              id="designation"
              name="designation"
              value={userData.designation}
              onChange={handleUserChange}
              className="bg-white border-slate-200"
              placeholder={t('designation_placeholder')}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="city" className="flex items-center gap-2 text-slate-700">
                <MapPin className="h-4 w-4" />
                {t('city')}
              </Label>
              <Input
                id="city"
                name="city"
                value={userData.city}
                onChange={handleUserChange}
                className="bg-white border-slate-200"
                placeholder={t('city_placeholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="state" className="flex items-center gap-2 text-slate-700">
                <MapPin className="h-4 w-4" />
                {t('state')}
              </Label>
              <Input
                id="state"
                name="state"
                value={userData.state}
                onChange={handleUserChange}
                className="bg-white border-slate-200"
                placeholder={t('state_placeholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="country" className="flex items-center gap-2 text-slate-700">
                <MapPin className="h-4 w-4" />
                {t('country')}
              </Label>
              <Input
                id="country"
                name="country"
                value={userData.country}
                onChange={handleUserChange}
                className="bg-white border-slate-200"
                placeholder={t('country_placeholder')}
              />
            </div>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);

// Component for Signature Settings
const SignatureSettings = ({ organizationData, uploading, handleFileUpload, t }) => (
  <Card className="bg-white/80 backdrop-blur-sm border-slate-200">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Signature className="h-5 w-5" />
        {t('digital_signature')}
      </CardTitle>
      <CardDescription>
        {t('digital_signature_description')}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex flex-col items-center gap-8 max-w-2xl mx-auto">
        {/* Signature Preview */}
        <div className="w-full max-w-md">
          <Label className="text-sm font-medium text-slate-700 mb-3 block">
            {t('signature_preview')}
          </Label>
          <div className="w-full h-32 bg-white border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center p-4">
            {organizationData.signature ? (
              <img
                src={organizationData.signature}
                alt={t('digital_signature')}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="text-center text-slate-400">
                <Signature className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">{t('no_signature_uploaded')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Upload Section */}
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <Input
            id="signature"
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading.signature}
            onChange={(e) => handleFileUpload(e, 'signature')}
          />
          <Button
            onClick={() => document.getElementById('signature').click()}
            disabled={uploading.signature}
            className="gap-2 bg-black hover:bg-blue-700 w-full"
          >
            {uploading.signature ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploading.signature ? t('uploading_signature') : t('upload_signature')}
          </Button>
          <div className="text-center space-y-1">
            <p className="text-sm text-slate-600">
              {t('signature_hint')}
            </p>
            <p className="text-xs text-slate-500">
              {t('signature_dimensions_hint')}
            </p>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);

// Component for Organization Settings
const OrganizationSettings = ({ organizationData, uploading, handleOrganizationChange, handleFileUpload, t }) => (
  <Card className="bg-white/80 backdrop-blur-sm border-slate-200">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Building className="h-5 w-5" />
        {t('organization_settings')}
      </CardTitle>
      <CardDescription>
        {t('organization_settings_description')}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Logo Section */}
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-32 h-32 rounded-xl border-2 border-slate-200 bg-white flex items-center justify-center shadow-sm">
              {organizationData.logo ? (
                <img
                  src={organizationData.logo}
                  alt={t('organization_logo')}
                  className="w-full h-full object-contain p-2"
                />
              ) : (
                <div className="text-center text-slate-400">
                  <Image className="h-8 w-8 mx-auto mb-1" />
                  <p className="text-xs">{t('no_logo')}</p>
                </div>
              )}
            </div>
            {uploading.logo && (
              <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-3">
            <Label htmlFor="organization-logo" className="text-sm font-medium text-slate-700">
              {t('organization_logo')}
            </Label>
            <Input
              id="organization-logo"
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading.logo}
              onChange={(e) => handleFileUpload(e, 'logo')}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('organization-logo').click()}
              disabled={uploading.logo}
              className="gap-2 border-slate-200"
            >
              <Upload className="h-4 w-4" />
              {uploading.logo ? t('uploading') : t('upload_logo')}
            </Button>
            <p className="text-xs text-slate-500 text-center max-w-[200px]">
              {t('logo_hint')}
            </p>
          </div>

          {/* Organization Stats */}
          <div className="bg-slate-50 rounded-lg p-4 space-y-3 w-full">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('plan')}</span>
              <Badge variant="outline">{organizationData.plan || t('basic')}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('status')}</span>
              <Badge className="bg-green-100 text-green-800 border-green-200">
                {organizationData.status || t('active')}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('users')}</span>
              <span className="text-sm font-medium text-slate-900">
                {organizationData.users || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Organization Form Fields */}
        <div className="flex-1 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="org-name" className="flex items-center gap-2 text-slate-700">
              <Building className="h-4 w-4" />
              {t('organization_name')}
            </Label>
            <Input
              id="org-name"
              name="name"
              value={organizationData.name}
              onChange={handleOrganizationChange}
              className="bg-white border-slate-200"
              placeholder={t('enter_organization_name')}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="org-email" className="flex items-center gap-2 text-slate-700">
                <Mail className="h-4 w-4" />
                {t('organization_email')}
              </Label>
              <Input
                id="org-email"
                name="email"
                type="email"
                value={organizationData.email}
                onChange={handleOrganizationChange}
                className="bg-white border-slate-200"
                placeholder={t('org_email_placeholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-phone" className="flex items-center gap-2 text-slate-700">
                <Phone className="h-4 w-4" />
                {t('organization_phone')}
              </Label>
              <Input
                id="org-phone"
                name="phone"
                value={organizationData.phone}
                onChange={handleOrganizationChange}
                className="bg-white border-slate-200"
                placeholder={t('phone_placeholder')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="org-city" className="flex items-center gap-2 text-slate-700">
                <MapPin className="h-4 w-4" />
                {t('city')}
              </Label>
              <Input
                id="org-city"
                name="city"
                value={organizationData.city}
                onChange={handleOrganizationChange}
                className="bg-white border-slate-200"
                placeholder={t('city_placeholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-state" className="flex items-center gap-2 text-slate-700">
                <MapPin className="h-4 w-4" />
                {t('state')}
              </Label>
              <Input
                id="org-state"
                name="state"
                value={organizationData.state}
                onChange={handleOrganizationChange}
                className="bg-white border-slate-200"
                placeholder={t('state_placeholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-country" className="flex items-center gap-2 text-slate-700">
                <MapPin className="h-4 w-4" />
                {t('country')}
              </Label>
              <Input
                id="org-country"
                name="country"
                value={organizationData.country}
                onChange={handleOrganizationChange}
                className="bg-white border-slate-200"
                placeholder={t('country_placeholder')}
              />
            </div>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);