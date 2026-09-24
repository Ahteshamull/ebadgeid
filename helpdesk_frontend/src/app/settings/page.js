"use client";

import { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSession } from '@/hooks/use-session';
import { FTP_BASE_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api';

export default function SettingsPage() {
  const { user: sessionUser, loading: sessionLoading } = useSession();
  const userRole = sessionUser?.role || sessionUser?.user_type || 'user';
  
  // State management
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  
  const [userData, setUserData] = useState({
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
  });

  const [organizationData, setOrganizationData] = useState({
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
  });

  const [profileImage, setProfileImage] = useState(null);
  const [organizationLogo, setOrganizationLogo] = useState(null);
  const [signatureImage, setSignatureImage] = useState(null);
   const [currentUsername, setCurrentUsername] = useState('');
  const [uploading, setUploading] = useState({
    profile: false,
    logo: false,
    signature: false
  });

  const isAdmin = userRole === 'admin';

   // Load initial data
  useEffect(() => {
    setCurrentUsername(sessionUser?.username || '');
  }, [sessionUser?.username]);

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
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [currentUsername, isAdmin]);

  // Fetch user data
  const fetchUserData = async () => {
    try {
      const response = await apiFetch('/auth/profile');
      if (!response.ok) throw new Error('Failed to fetch user data');
      const data = await response.json();
      const names = String(data.name || '').trim().split(/\s+/);
      const normalized = {
        ...data,
        organization_code: data.org_code,
        first_name: names.shift() || '',
        last_name: names.join(' '),
        profile_picture_url: data.profile_picture || '',
      };
      setUserData(normalized);
      return normalized;
    } catch (err) {
      setError('Failed to load user data');
      throw err;
    }
  };

  // Fetch organization data
  const fetchOrganizationData = async (orgCode) => {
    try {
      const response = await apiFetch(`/organizations/code/${encodeURIComponent(orgCode)}`);
      if (!response.ok) throw new Error('Failed to fetch organization data');
      const data = await response.json();
      const normalized = {
        ...data,
        email: data.support_email || '',
        logo: data.organization_logo || '',
      };
      setOrganizationData(normalized);
      return normalized;
    } catch (err) {
      setError('Failed to load organization data');
      throw err;
    }
  };

  // Handle user data changes
  const handleUserChange = (e) => {
    const { name, value } = e.target;
    setUserData(prev => ({ ...prev, [name]: value }));
  };

  // Handle organization data changes
  const handleOrganizationChange = (e) => {
    const { name, value, type, checked } = e.target;
    setOrganizationData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // Upload file to storage server
  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    // Profile pictures, org logo and signature are only ever read back from
    // this same authenticated settings page (no public/anonymous consumer
    // exists in this app) -- mirrors the equivalent fix already applied to
    // the main app's settings/design-editor upload calls.
    formData.append('visibility', 'private');

    const response = await fetch(`${FTP_BASE_URL}/api/uploads`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error('Failed to upload file');
    }
    
    const result = await response.json();
    return result.url; // Assuming your server returns { url: "https://..." }
  };

  // Handle file uploads with server upload
  const handleFileUpload = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    // Set uploading state
    setUploading(prev => ({ ...prev, [type]: true }));
    
    try {
      const uploadedUrl = await uploadFile(file);
      
      // Update the appropriate state with the server URL
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

  // Update user data
  const updateUser = async (updatedData) => {
    const response = await apiFetch('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(updatedData)
    });
    
    if (!response.ok) throw new Error('Failed to update user');
    return response.json();
  };

  // Update organization data
  const updateOrganization = async (updatedData) => {
    const response = await apiFetch(`/organizations/${organizationData._id}`, {
      method: 'PUT',
      body: JSON.stringify(updatedData)
    });
    
    if (!response.ok) throw new Error('Failed to update organization');
    return response.json();
  };

  // Handle form submission
  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Prepare user update data
      const userUpdateData = {
        name: `${userData.first_name} ${userData.last_name}`.trim(),
        username: userData.username,
        address: userData.address,
        profile_picture: userData.profile_picture_url,
      };

      // Update user data
      await updateUser(userUpdateData);

      // Update organization data if admin
      if (isAdmin) {
        const orgUpdateData = {
          name: organizationData.name,
          support_email: organizationData.email,
          organization_logo: organizationData.logo,
          address: organizationData.address,
          city: organizationData.city,
          country: organizationData.country,
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

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading settings...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        {/* Demo role switcher - remove in production */}
       
      </div>

      {/* Status Messages */}
      {error && (
        <Alert className="mb-6 border-red-200 bg-red-50">
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mb-6 border-green-200 bg-green-50">
          <AlertDescription className="text-green-800">Settings updated successfully!</AlertDescription>
        </Alert>
      )}
      
      <div>
        {/* Profile Settings - Always visible */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Profile Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-8">
              <div className="flex flex-col items-center gap-4">
                <Avatar className="w-24 h-24">
                  <AvatarImage src={userData.profile_picture_url} />
                  <AvatarFallback>
                    {userData.first_name?.[0]}{userData.last_name?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-center gap-2">
                  <Label htmlFor="profile-image">Profile Picture</Label>
                  <Input
                    id="profile-image"
                    type="file"
                    accept="image/*"
                    className="w-auto"
                    disabled={uploading.profile}
                    onChange={(e) => handleFileUpload(e, 'profile')}
                  />
                  {uploading.profile && (
                    <div className="text-sm text-blue-600">Uploading...</div>
                  )}
                </div>
              </div>
              
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="first_name">First Name</Label>
                    <Input
                      id="first_name"
                      name="first_name"
                      value={userData.first_name}
                      onChange={handleUserChange}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="last_name">Last Name</Label>
                    <Input
                      id="last_name"
                      name="last_name"
                      value={userData.last_name}
                      onChange={handleUserChange}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={userData.email}
                    onChange={handleUserChange}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    name="phone"
                    value={userData.phone}
                    onChange={handleUserChange}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="designation">Designation</Label>
                  <Input
                    id="designation"
                    name="designation"
                    value={userData.designation}
                    onChange={handleUserChange}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      name="city"
                      value={userData.city}
                      onChange={handleUserChange}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input
                      id="state"
                      name="state"
                      value={userData.state}
                      onChange={handleUserChange}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      name="country"
                      value={userData.country}
                      onChange={handleUserChange}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Admin-only sections */}
        {isAdmin && (
          <>
            <Separator className="my-8" />
            
            {/* Signature Upload - Only for admins */}
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Signature</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-4">
                  <div className="w-64 h-32 bg-white border flex items-center justify-center">
                    {organizationData.signature ? (
                      <img 
                        src={organizationData.signature} 
                        alt="Signature" 
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-gray-400">Signature Preview</span>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <Label htmlFor="signature">Upload Signature</Label>
                    <Input
                      id="signature"
                      type="file"
                      accept="image/*"
                      className="w-auto"
                      disabled={uploading.signature}
                      onChange={(e) => handleFileUpload(e, 'signature')}
                    />
                    {uploading.signature && (
                      <div className="text-sm text-blue-600">Uploading...</div>
                    )}
                    <p className="text-sm text-gray-500">Upload a transparent PNG of your signature</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Organization Settings */}
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Organization Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row gap-8">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-24 h-24 rounded-md border flex items-center justify-center">
                      {organizationData.logo ? (
                        <img 
                          src={organizationData.logo} 
                          alt="Organization Logo" 
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="text-gray-400">Logo</span>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <Label htmlFor="organization-logo">Organization Logo</Label>
                      <Input
                        id="organization-logo"
                        type="file"
                        accept="image/*"
                        className="w-auto"
                        disabled={uploading.logo}
                        onChange={(e) => handleFileUpload(e, 'logo')}
                      />
                      {uploading.logo && (
                        <div className="text-sm text-blue-600">Uploading...</div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="org-name">Organization Name</Label>
                      <Input
                        id="org-name"
                        name="name"
                        value={organizationData.name}
                        onChange={handleOrganizationChange}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="org-email">Organization Email</Label>
                      <Input
                        id="org-email"
                        name="email"
                        type="email"
                        value={organizationData.email}
                        onChange={handleOrganizationChange}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="org-phone">Organization Phone</Label>
                      <Input
                        id="org-phone"
                        name="phone"
                        value={organizationData.phone}
                        onChange={handleOrganizationChange}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="org-city">City</Label>
                        <Input
                          id="org-city"
                          name="city"
                          value={organizationData.city}
                          onChange={handleOrganizationChange}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="org-state">State</Label>
                        <Input
                          id="org-state"
                          name="state"
                          value={organizationData.state}
                          onChange={handleOrganizationChange}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="org-country">Country</Label>
                        <Input
                          id="org-country"
                          name="country"
                          value={organizationData.country}
                          onChange={handleOrganizationChange}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Organization Info</Label>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>Plan: <span className="font-medium">{organizationData.plan}</span></p>
                        <p>Status: <span className="font-medium">{organizationData.status}</span></p>
                        <p>Users: <span className="font-medium">{organizationData.users}</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
        
        <div className="flex justify-end">
          <Button 
            onClick={handleSubmit} 
            disabled={saving}
            className="px-8"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
