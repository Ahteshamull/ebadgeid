"use client"
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Upload, User, Building2, MapPin, Phone, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/lib/api';

export default function StepOnboarding() {
  const router = useRouter();
  const params = useParams();
  const inviteCode = params?.invite_code;

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    username: '',
    first_name: '',
    last_name: '',
    city: '',
    state: '',
    country: '',
    phone: '',
    password: '',
    confirmPassword: '',
    status: 'active',
    profile_picture_url: ''
  });

  const [inviteInfo, setInviteInfo] = useState({
    email: '',
    organization: '',
    status: '',
    designation: ''
  });

  const [profileImage, setProfileImage] = useState(null);
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const DEFAULT_AVATAR = '/avatars/default.svg'; // was 'https://i.sstatic.net/l60Hf.png' — a third-party CDN (Stack Overflow's) that eBadge ID doesn't control, saved directly into new users' profile_picture_url. If that URL ever breaks, every user who signed up with the default avatar breaks with it. Served from our own /public now.

  const countries = [
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'CA', name: 'Canada' },
    { code: 'AU', name: 'Australia' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'JP', name: 'Japan' },
    { code: 'IN', name: 'India' },
    { code: 'BR', name: 'Brazil' },
    { code: 'CN', name: 'China' }
  ];

  const steps = [
    { id: 0, title: 'Welcome', icon: Building2 },
    { id: 1, title: 'Profile Picture', icon: User },
    { id: 2, title: 'Account', icon: Lock },
    { id: 3, title: 'Personal Info', icon: User },
    { id: 4, title: 'Location', icon: MapPin }
  ];

  useEffect(() => {
    if (!inviteCode) {
      setError('No invitation code provided');
      setVerifying(false);
      return;
    }

    const verifyInvitation = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/invitation/verify/${inviteCode}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-invite-code': inviteCode
          }
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Failed to verify invitation');
        }

        if (!data.success) {
          throw new Error(data.message || 'Invalid invitation');
        }

        setInviteInfo({
          email: data.data.email,
          organization: data.data.organization_code,
          status: data.data.status,
          designation: data.data.designation
        });

      } catch (err) {
        setError(err.message);
      } finally {
        setVerifying(false);
      }
    };

    verifyInvitation();
  }, [inviteCode]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    if (field === 'password' || field === 'confirmPassword') {
      setPasswordError('');
    }
  };

  const validatePassword = () => {
    if (formData.password.length < 12) {
      setPasswordError('Password must be at least 12 characters long');
      return false;
    }
    
    if (formData.password !== formData.confirmPassword) {
      setPasswordError('Passwords do not match');
      return false;
    }
    
    return true;
  };

  const uploadProfilePicture = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE_URL}/invitation/profile-upload/${encodeURIComponent(inviteCode)}`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to upload profile picture');
      }

      const data = await response.json();
      return data.url;
    } catch (error) {
      console.error('Profile picture upload failed:', error);
      throw error;
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setProfileImageFile(file);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        setProfileImage(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSkipAvatar = () => {
    setProfileImage(DEFAULT_AVATAR);
    setProfileImageFile(null);
    setFormData(prev => ({ ...prev, profile_picture_url: DEFAULT_AVATAR }));
  };

  const registerUser = async (userData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/users/self-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-invite-code': inviteCode
        },
        body: JSON.stringify({
          ...userData,
          email: inviteInfo.email,
          organization_code: inviteInfo.organization,
          designation: inviteInfo.designation
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to create user account');
      }

      return data;
    } catch (error) {
      console.error('User registration failed:', error);
      throw error;
    }
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    
    try {
      let profilePictureUrl = formData.profile_picture_url || DEFAULT_AVATAR;

      if (profileImageFile) {
        try {
          profilePictureUrl = await uploadProfilePicture(profileImageFile);
          toast.success('Profile picture uploaded successfully');
        } catch (error) {
          toast.error('Failed to upload profile picture', {
            description: 'Using default avatar'
          });
          profilePictureUrl = DEFAULT_AVATAR;
        }
      }

      const userData = {
        ...formData,
        profile_picture_url: profilePictureUrl
      };

      toast.loading('Creating your account...');
      await registerUser(userData);
      toast.dismiss();

      toast.success('Account created successfully!', {
        description: 'You can now login with your credentials'
      });
      
      router.push('/auth/login');
    } catch (err) {
      toast.dismiss();
      toast.error('Failed to create account', {
        description: err.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const validateStep = () => {
    switch(currentStep) {
      case 2:
        if (!formData.username) {
          toast.error('Please enter a username');
          return false;
        }
        if (!validatePassword()) {
          return false;
        }
        return true;
      case 3:
        if (!formData.first_name || !formData.last_name || !formData.phone) {
          toast.error('Please fill in all required fields');
          return false;
        }
        return true;
      case 4:
        if (!formData.city || !formData.state || !formData.country) {
          toast.error('Please fill in all location fields');
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const nextStep = () => {
    if (validateStep()) {
      if (currentStep < steps.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        handleSubmit();
      }
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const getInitials = () => {
    return `${formData.first_name.charAt(0)}${formData.last_name.charAt(0)}`.toUpperCase();
  };

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verifying your invitation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
            </div>
            <CardTitle>Invitation Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/')} className="w-full">
              Return Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const StepIcon = step.icon;
              return (
                <div key={step.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center relative">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                        index === currentStep
                          ? 'border-primary bg-primary text-primary-foreground'
                          : index < currentStep
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted bg-background text-muted-foreground'
                      }`}
                    >
                      {index < currentStep ? (
                        <CheckCircle className="w-5 h-5" />
                      ) : (
                        <StepIcon className="w-5 h-5" />
                      )}
                    </div>
                    <span className={`text-xs mt-2 font-medium absolute top-12 whitespace-nowrap ${
                      index === currentStep ? 'text-foreground' : 'text-muted-foreground'
                    }`}>
                      {step.title}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div className="flex-1 h-0.5 mx-2 mb-6">
                      <div
                        className={`h-full transition-all ${
                          index < currentStep ? 'bg-primary' : 'bg-muted'
                        }`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Card */}
        <Card>
          <CardHeader>
            <CardTitle>{steps[currentStep].title}</CardTitle>
            <CardDescription>
              {currentStep === 0 && `Welcome to ${inviteInfo.organization}`}
              {currentStep === 1 && 'Add a profile picture or use the default'}
              {currentStep === 2 && 'Create your account credentials'}
              {currentStep === 3 && 'Tell us about yourself'}
              {currentStep === 4 && 'Where are you located?'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="min-h-[320px]">
              {/* Step 0: Welcome */}
              {currentStep === 0 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Organization</p>
                      <p className="text-sm text-muted-foreground">{inviteInfo.organization}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Role</p>
                      <p className="text-sm text-muted-foreground">{inviteInfo.designation}</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Complete the following steps to set up your account. This should only take a few minutes.
                  </p>
                </div>
              )}

              {/* Step 1: Profile Picture */}
              {currentStep === 1 && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      <Avatar className="h-32 w-32 border">
                        <AvatarImage src={profileImage || DEFAULT_AVATAR} />
                        <AvatarFallback className="bg-muted text-muted-foreground text-2xl">
                          {getInitials() || <User className="h-12 w-12" />}
                        </AvatarFallback>
                      </Avatar>
                      <label className="absolute bottom-0 right-0 h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer hover:bg-primary/90 transition-colors">
                        <Upload className="h-5 w-5" />
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Click the upload button to add a profile picture
                      </p>
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="sm"
                        onClick={handleSkipAvatar}
                      >
                        Use Default Avatar
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Account Setup */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      value={formData.username}
                      onChange={(e) => handleInputChange('username', e.target.value)}
                      placeholder="Choose a username"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={formData.password}
                        onChange={(e) => handleInputChange('password', e.target.value)}
                        placeholder="Create a password"
                        className="pr-10"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">Must be at least 12 characters</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <div className="relative">
                      <Input
                        id="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        value={formData.confirmPassword}
                        onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                        placeholder="Confirm your password"
                        className="pr-10"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {passwordError && (
                    <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                      <AlertCircle className="h-4 w-4" />
                      <p>{passwordError}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Personal Info */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="first_name">First Name</Label>
                      <Input
                        id="first_name"
                        value={formData.first_name}
                        onChange={(e) => handleInputChange('first_name', e.target.value)}
                        placeholder="First name"
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="last_name">Last Name</Label>
                      <Input
                        id="last_name"
                        value={formData.last_name}
                        onChange={(e) => handleInputChange('last_name', e.target.value)}
                        placeholder="Last name"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => handleInputChange('phone', e.target.value)}
                      placeholder="+1 (555) 123-4567"
                      required
                    />
                  </div>

                  <div className="p-3 bg-muted rounded-md">
                    <p className="text-sm text-muted-foreground">
                      Email: <span className="font-medium text-foreground">{inviteInfo.email}</span>
                    </p>
                  </div>
                </div>
              )}

              {/* Step 4: Location */}
              {currentStep === 4 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="country">Country</Label>
                    <Select 
                      value={formData.country} 
                      onValueChange={(value) => handleInputChange('country', value)}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select your country" />
                      </SelectTrigger>
                      <SelectContent>
                        {countries.map((country) => (
                          <SelectItem key={country.code} value={country.code}>
                            <div className="flex items-center gap-2">
                              <img 
                                src={`https://flagcdn.com/w20/${country.code.toLowerCase()}.png`} 
                                alt={country.name} 
                                className="w-5 h-3 object-cover" 
                              />
                              <span>{country.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="state">State/Province</Label>
                      <Input
                        id="state"
                        value={formData.state}
                        onChange={(e) => handleInputChange('state', e.target.value)}
                        placeholder="State"
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={formData.city}
                        onChange={(e) => handleInputChange('city', e.target.value)}
                        placeholder="City"
                        required
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation Buttons */}
            <div className="flex gap-4 mt-8 pt-6 border-t">
              {currentStep > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={prevStep}
                  disabled={isLoading}
                  className="w-full"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              )}
              <Button
                type="button"
                onClick={nextStep}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating Account...
                  </>
                ) : currentStep === steps.length - 1 ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Complete Registration
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center mt-6 text-sm text-muted-foreground">
          By creating an account, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}
