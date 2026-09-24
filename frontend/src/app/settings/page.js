"use client";

import { useState, useEffect } from 'react';
import { apiFetch, UPLOAD_BASE_URL, getAuthHeaders } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
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
  // Aliased: an icon called `Image` reads as next/image at every use
  // site, and the a11y linter flags it as an <img> with no alt. It is a
  // decorative placeholder glyph, not a picture of anything.
  Image as ImagePlaceholderIcon,
  Palette,
  Key,
  GraduationCap
} from 'lucide-react';
import ApiKeyManagement from '@/components/settings/api-key-management';
import LmsIntegrationManagement from '@/components/settings/lms-integration';

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
  const { session } = useSession();
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
  const [currentUsername, setCurrentUsername] = useState('');
  const [uploading, setUploading] = useState(initialUploadingState);
  const [userRole, setUserRole] = useState('');
  const [activeTab, setActiveTab] = useState('profile');

  // Open the tab named in ?tab=, so a deep link can land on the right one.
  // The design editor points here when the organization has no logo or
  // signature yet ("Add Logo" / "Add Signature"); without this the admin
  // arrived on Profile and had to find the correct tab themselves, which
  // makes a call-to-action feel broken.
  //
  // Read on mount from window.location rather than useSearchParams(): the
  // latter forces this whole client page under a Suspense boundary in the
  // app router, which is a lot of restructuring for one query parameter.
  // Only known tab names are honoured, so an arbitrary ?tab= value cannot
  // put the page into a state that does not exist.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested) {
      if (['developer', 'api', 'integrations'].includes(requested)) {
        setActiveTab('developer');
      } else if (['lms', 'moodle', 'canvas', 'blackboard'].includes(requested)) {
        setActiveTab('lms');
      } else if (['profile', 'organization', 'signature', 'brand-kit'].includes(requested)) {
        setActiveTab(requested);
      }
    }
  }, []);

  // The platform administrator manages the eBadgeID platform company and
  // certificate signer just like an organization administrator manages its
  // own organization. The API remains tenant-scoped to the session.
  const isAdmin = ['admin', 'platform_admin'].includes(userRole);

  // Session identity comes from the server-validated httpOnly cookie.
  useEffect(() => {
    if (!session) return;
    setCurrentUsername(session.username || '');
    setUserRole(session.role || 'user');
  }, [session]);

  // Fetch data when username changes
  useEffect(() => {
    const loadData = async () => {
      if (!currentUsername) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const user = await fetchUserData();
        
        if (isAdmin && user.organization_code) {
          await fetchOrganizationData();
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

  const fetchOrganizationData = async () => {
    try {
      const response = await apiFetch('/organizations/me');
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

  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('visibility', 'private');
    
    const response = await fetch(`${UPLOAD_BASE_URL}/api/uploads`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders({}, true),
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error('Failed to upload file');
    }
    
    const result = await response.json();
    return result.url;
  };

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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedData)
    });
    
    if (!response.ok) throw new Error('Failed to update user');
    return response.json();
  };

  const updateOrganization = async (updatedData) => {
    const response = await apiFetch(`/organizations/${organizationData._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
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
          <p className="text-slate-600">Loading settings...</p>
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
            <h1 className="text-3xl font-bold text-foreground">
              Settings
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Manage your profile and organization settings
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="flex items-center gap-1">
              <Shield className="h-3 w-3" />
              {userRole === 'admin' ? 'Administrator' : 'User'}
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
              Settings updated successfully!
            </AlertDescription>
          </Alert>
        )}

        {/* Tabs Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 h-auto p-1.5 gap-1.5 bg-muted/80 border border-border rounded-xl">
            <TabsTrigger value="profile" className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground transition-all">
              <User className="h-4 w-4" />
              <span>Profile</span>
            </TabsTrigger>
            {isAdmin && (
              <>
                <TabsTrigger value="organization" className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground transition-all">
                  <Building className="h-4 w-4" />
                  <span>Company</span>
                </TabsTrigger>
                <TabsTrigger value="signature" className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground transition-all">
                  <Signature className="h-4 w-4" />
                  <span>Signature</span>
                </TabsTrigger>
                <TabsTrigger value="brand-kit" className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground transition-all">
                  <Palette className="h-4 w-4" />
                  <span>Brand Kit</span>
                </TabsTrigger>
                <TabsTrigger value="lms" className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground transition-all">
                  <GraduationCap className="h-4 w-4" />
                  <span>LMS Connect</span>
                </TabsTrigger>
                <TabsTrigger value="developer" className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground transition-all">
                  <Key className="h-4 w-4" />
                  <span>API & Keys</span>
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
              />
            </TabsContent>
          )}

          {/* Brand Kit Tab */}
          {isAdmin && (
            <TabsContent value="brand-kit" className="space-y-6">
              <BrandKitSettings />
            </TabsContent>
          )}

          {/* LMS Integrations Tab */}
          {isAdmin && (
            <TabsContent value="lms" className="space-y-6">
              <LmsIntegrationManagement />
            </TabsContent>
          )}

          {/* Integrations & API Tab */}
          {isAdmin && (
            <TabsContent value="developer" className="space-y-6">
              <ApiKeyManagement />
            </TabsContent>
          )}
        </Tabs>

        {/* Save Button */}
        {activeTab !== 'brand-kit' && activeTab !== 'developer' && activeTab !== 'lms' && (
        <div className="flex justify-end pt-6 border-t border-border">
          <Button 
            onClick={handleSubmit} 
            disabled={saving}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-8 font-semibold shadow-sm"
            size="lg"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? 'Saving Changes...' : 'Save Changes'}
          </Button>
        </div>
        )}
      </div>
    </div>
  );
}

// Component for Profile Settings
const ProfileSettings = ({ userData, uploading, handleUserChange, handleFileUpload }) => (
  <Card className="bg-card border-border shadow-sm">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-foreground">
        <User className="h-5 w-5 text-primary" />
        Profile Settings
      </CardTitle>
      <CardDescription className="text-muted-foreground">
        Manage your personal information and profile picture
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Profile Picture Section */}
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <Avatar className="w-32 h-32 border-4 border-border shadow-lg">
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
            <Label htmlFor="profile-image" className="text-sm font-medium text-foreground">
              Update Profile Picture
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
              className="gap-2 border-border text-foreground hover:bg-muted"
            >
              <Upload className="h-4 w-4" />
              {uploading.profile ? 'Uploading...' : 'Choose Image'}
            </Button>
            <p className="text-xs text-muted-foreground text-center max-w-[200px]">
              JPG, PNG or GIF. Max size 5MB.
            </p>
          </div>
        </div>
        
        {/* Form Fields */}
        <div className="flex-1 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="first_name" className="flex items-center gap-2 text-foreground">
                <User className="h-4 w-4" />
                First Name
              </Label>
              <Input
                id="first_name"
                name="first_name"
                value={userData.first_name}
                onChange={handleUserChange}
                className="bg-background border-input text-foreground"
                placeholder="Enter your first name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="last_name" className="flex items-center gap-2 text-foreground">
                <User className="h-4 w-4" />
                Last Name
              </Label>
              <Input
                id="last_name"
                name="last_name"
                value={userData.last_name}
                onChange={handleUserChange}
                className="bg-background border-input text-foreground"
                placeholder="Enter your last name"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2 text-foreground">
                <Mail className="h-4 w-4" />
                Email Address
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={userData.email}
                onChange={handleUserChange}
                className="bg-background border-input text-foreground"
                placeholder="your.email@example.com"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2 text-foreground">
                <Phone className="h-4 w-4" />
                Phone Number
              </Label>
              <Input
                id="phone"
                name="phone"
                value={userData.phone}
                onChange={handleUserChange}
                className="bg-background border-input text-foreground"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="designation" className="flex items-center gap-2 text-foreground">
              <Briefcase className="h-4 w-4" />
              Designation
            </Label>
            <Input
              id="designation"
              name="designation"
              value={userData.designation}
              onChange={handleUserChange}
              className="bg-background border-input text-foreground"
              placeholder="Your job title or role"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="city" className="flex items-center gap-2 text-foreground">
                <MapPin className="h-4 w-4" />
                City
              </Label>
              <Input
                id="city"
                name="city"
                value={userData.city}
                onChange={handleUserChange}
                className="bg-background border-input text-foreground"
                placeholder="City"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="state" className="flex items-center gap-2 text-foreground">
                <MapPin className="h-4 w-4" />
                State
              </Label>
              <Input
                id="state"
                name="state"
                value={userData.state}
                onChange={handleUserChange}
                className="bg-background border-input text-foreground"
                placeholder="State"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="country" className="flex items-center gap-2 text-foreground">
                <MapPin className="h-4 w-4" />
                Country
              </Label>
              <Input
                id="country"
                name="country"
                value={userData.country}
                onChange={handleUserChange}
                className="bg-background border-input text-foreground"
                placeholder="Country"
              />
            </div>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);

// Component for Signature Settings
const SignatureSettings = ({ organizationData, uploading, handleFileUpload }) => (
  <Card className="bg-card border-border shadow-sm">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-foreground">
        <Signature className="h-5 w-5 text-primary" />
        Digital Signature
      </CardTitle>
      <CardDescription className="text-muted-foreground">
        Upload your digital signature for certificate generation
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex flex-col items-center gap-8 max-w-2xl mx-auto">
        {/* Signature Preview */}
        <div className="w-full max-w-md">
          <Label className="text-sm font-medium text-foreground mb-3 block">
            Signature Preview
          </Label>
          <div className="w-full h-32 bg-muted/40 border-2 border-dashed border-border rounded-lg flex items-center justify-center p-4">
            {organizationData.signature ? (
              <img 
                src={organizationData.signature} 
                alt="Digital Signature" 
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="text-center text-muted-foreground">
                <Signature className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No signature uploaded</p>
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
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 w-full font-semibold shadow-sm"
          >
            {uploading.signature ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploading.signature ? 'Uploading Signature...' : 'Upload Signature'}
          </Button>
          <div className="text-center space-y-1">
            <p className="text-sm text-foreground">
              Recommended: Transparent PNG with clear signature
            </p>
            <p className="text-xs text-muted-foreground">
              Max file size: 5MB • Optimal dimensions: 400x150px
            </p>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);

// Component for Organization Settings
const OrganizationSettings = ({ organizationData, uploading, handleOrganizationChange, handleFileUpload }) => (
  <Card className="bg-card border-border shadow-sm">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-foreground">
        <Building className="h-5 w-5 text-primary" />
        Company Settings
      </CardTitle>
      <CardDescription className="text-muted-foreground">
        Manage your company information and certificate branding
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Logo Section */}
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-32 h-32 rounded-xl border-2 border-border bg-muted/40 flex items-center justify-center shadow-sm">
              {organizationData.logo ? (
                <img 
                  src={organizationData.logo} 
                  alt="Organization Logo" 
                  className="w-full h-full object-contain p-2"
                />
              ) : (
                <div className="text-center text-muted-foreground">
                  <ImagePlaceholderIcon aria-hidden="true" className="h-8 w-8 mx-auto mb-1 opacity-50" />
                  <p className="text-xs">No Logo</p>
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
            <Label htmlFor="organization-logo" className="text-sm font-medium text-foreground">
              Company Logo
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
              className="gap-2 border-border text-foreground hover:bg-muted"
            >
              <Upload className="h-4 w-4" />
              {uploading.logo ? 'Uploading...' : 'Upload Logo'}
            </Button>
            <p className="text-xs text-muted-foreground text-center max-w-[200px]">
              JPG, PNG or SVG. Max size 5MB.
            </p>
          </div>

          {/* Organization Stats */}
          <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3 w-full">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Plan</span>
              <Badge variant="outline">{organizationData.plan || 'Basic'}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                {organizationData.status || 'Active'}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Users</span>
              <span className="text-sm font-medium text-foreground">
                {organizationData.users || 0}
              </span>
            </div>
          </div>
        </div>
        
        {/* Organization Form Fields */}
        <div className="flex-1 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="org-name" className="flex items-center gap-2 text-foreground">
              <Building className="h-4 w-4" />
              Company Name
            </Label>
            <Input
              id="org-name"
              name="name"
              value={organizationData.name}
              onChange={handleOrganizationChange}
              className="bg-background border-input text-foreground"
              placeholder="Enter organization name"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="org-email" className="flex items-center gap-2 text-foreground">
                <Mail className="h-4 w-4" />
              Company Email
              </Label>
              <Input
                id="org-email"
                name="email"
                type="email"
                value={organizationData.email}
                onChange={handleOrganizationChange}
                className="bg-background border-input text-foreground"
                placeholder="org@example.com"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="org-phone" className="flex items-center gap-2 text-foreground">
                <Phone className="h-4 w-4" />
              Company Phone
              </Label>
              <Input
                id="org-phone"
                name="phone"
                value={organizationData.phone}
                onChange={handleOrganizationChange}
                className="bg-background border-input text-foreground"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="org-city" className="flex items-center gap-2 text-foreground">
                <MapPin className="h-4 w-4" />
                City
              </Label>
              <Input
                id="org-city"
                name="city"
                value={organizationData.city}
                onChange={handleOrganizationChange}
                className="bg-background border-input text-foreground"
                placeholder="City"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="org-state" className="flex items-center gap-2 text-foreground">
                <MapPin className="h-4 w-4" />
                State
              </Label>
              <Input
                id="org-state"
                name="state"
                value={organizationData.state}
                onChange={handleOrganizationChange}
                className="bg-background border-input text-foreground"
                placeholder="State"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="org-country" className="flex items-center gap-2 text-foreground">
                <MapPin className="h-4 w-4" />
                Country
              </Label>
              <Input
                id="org-country"
                name="country"
                value={organizationData.country}
                onChange={handleOrganizationChange}
                className="bg-background border-input text-foreground"
                placeholder="Country"
              />
            </div>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);

// Component for Brand Kit Settings -- an org's default primary/secondary
// color and logo, purely a starting point the design editor reads from
// (see design-editor/page.js's "Brand Kit" quick-pick); it never mutates a
// design that already exists, and nothing here is enforced when saving one.
// Self-contained (own fetch/save) rather than folded into the parent's
// userData/organizationData state, because it lives behind its own
// endpoint (/api/brand-kit, see controllers/brandKitController.js) with no
// overlap with either of those.
const BrandKitSettings = () => {
  const [brandKit, setBrandKit] = useState({ primary_color: '#4f46e5', secondary_color: '#1f2937', logo_url: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/brand-kit');
        const json = await res.json();
        if (res.ok && json.success) setBrandKit(json.data);
      } catch (err) {
        console.error('Failed to load brand kit:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('visibility', 'private');
      const response = await fetch(`${UPLOAD_BASE_URL}/api/uploads`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders({}, true),
        body: formData,
      });
      if (!response.ok) throw new Error('Failed to upload logo');
      const result = await response.json();
      setBrandKit((prev) => ({ ...prev, logo_url: result.url }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await apiFetch('/brand-kit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_color: brandKit.primary_color,
          secondary_color: brandKit.secondary_color,
          logo_url: brandKit.logo_url,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.message || 'Failed to save brand kit');
      setBrandKit(json.data);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="bg-card border-border shadow-sm">
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Palette className="h-5 w-5 text-primary" />
          Brand Kit
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Your organization&apos;s default colors and logo — a starting point for new certificate designs, not something already-created templates are forced to match.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 max-w-xl">
        {error && (
          <Alert className="bg-red-500/10 border-red-500/20 text-red-600">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="bg-emerald-500/10 border-emerald-500/20 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>Brand kit saved.</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="brand-primary-color" className="text-foreground">Primary color</Label>
            <div className="flex items-center gap-2">
              <input
                id="brand-primary-color"
                type="color"
                value={brandKit.primary_color}
                onChange={(e) => setBrandKit((prev) => ({ ...prev, primary_color: e.target.value }))}
                className="h-10 w-14 border border-input rounded cursor-pointer bg-background"
              />
              <Input
                value={brandKit.primary_color}
                onChange={(e) => setBrandKit((prev) => ({ ...prev, primary_color: e.target.value }))}
                className="bg-background border-input text-foreground font-mono"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-secondary-color" className="text-foreground">Secondary color</Label>
            <div className="flex items-center gap-2">
              <input
                id="brand-secondary-color"
                type="color"
                value={brandKit.secondary_color}
                onChange={(e) => setBrandKit((prev) => ({ ...prev, secondary_color: e.target.value }))}
                className="h-10 w-14 border border-input rounded cursor-pointer bg-background"
              />
              <Input
                value={brandKit.secondary_color}
                onChange={(e) => setBrandKit((prev) => ({ ...prev, secondary_color: e.target.value }))}
                className="bg-background border-input text-foreground font-mono"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-foreground">Logo</Label>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg border-2 border-dashed border-border bg-muted/40 flex items-center justify-center">
              {brandKit.logo_url ? (
                <img src={brandKit.logo_url} alt="Brand logo" className="max-w-full max-h-full object-contain p-1" />
              ) : (
                <ImagePlaceholderIcon aria-hidden="true" className="h-6 w-6 text-muted-foreground opacity-50" />
              )}
            </div>
            <div>
              <Input id="brand-logo" type="file" accept="image/*" className="hidden" disabled={uploadingLogo} onChange={handleLogoUpload} />
              <Button variant="outline" size="sm" onClick={() => document.getElementById('brand-logo').click()} disabled={uploadingLogo} className="gap-2 border-border text-foreground hover:bg-muted">
                <Upload className="h-4 w-4" />
                {uploadingLogo ? 'Uploading...' : 'Upload logo'}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving...' : 'Save Brand Kit'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
