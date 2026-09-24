"use client"
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Upload, User, Building2, MapPin, Phone, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { AvatarSelectionDialog } from '@/components/auth/AvatarSelectionDialog';
import { API_BASE_URL, STORAGE_BASE_URL } from '@/lib/api';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { useLocale } from '@/context/Localecontext';
import { AuthLanguageSwitcher } from '@/components/auth/AuthLanguageSwitcher';

export default function StepOnboarding() {
  const router = useRouter();
  const params = useParams();
  const { t } = useLocale();
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
  const [showAvatarDialog, setShowAvatarDialog] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Updated default avatar URL as per your request
  const DEFAULT_AVATAR_URL = 'https://img.freepik.com/free-psd/3d-illustration-human-avatar-profile_23-2150671132.jpg?semt=ais_hybrid&w=740&q=80';

  // Fallback placeholder while loading (you can keep your old one or use null)
  const PLACEHOLDER_AVATAR = 'https://i.sstatic.net/l60Hf.png';

  const countries = [
    { code: 'AF', name: 'Afghanistan' },
    { code: 'AL', name: 'Albania' },
    { code: 'DZ', name: 'Algeria' },
    { code: 'AS', name: 'American Samoa' },
    { code: 'AD', name: 'Andorra' },
    { code: 'AO', name: 'Angola' },
    { code: 'AI', name: 'Anguilla' },
    { code: 'AQ', name: 'Antarctica' },
    { code: 'AG', name: 'Antigua and Barbuda' },
    { code: 'AR', name: 'Argentina' },
    { code: 'AM', name: 'Armenia' },
    { code: 'AW', name: 'Aruba' },
    { code: 'AU', name: 'Australia' },
    { code: 'AT', name: 'Austria' },
    { code: 'AZ', name: 'Azerbaijan' },
    { code: 'BS', name: 'Bahamas' },
    { code: 'BH', name: 'Bahrain' },
    { code: 'BD', name: 'Bangladesh' },
    { code: 'BB', name: 'Barbados' },
    { code: 'BY', name: 'Belarus' },
    { code: 'BE', name: 'Belgium' },
    { code: 'BZ', name: 'Belize' },
    { code: 'BJ', name: 'Benin' },
    { code: 'BM', name: 'Bermuda' },
    { code: 'BT', name: 'Bhutan' },
    { code: 'BO', name: 'Bolivia' },
    { code: 'BA', name: 'Bosnia and Herzegovina' },
    { code: 'BW', name: 'Botswana' },
    { code: 'BR', name: 'Brazil' },
    { code: 'BN', name: 'Brunei' },
    { code: 'BG', name: 'Bulgaria' },
    { code: 'BF', name: 'Burkina Faso' },
    { code: 'BI', name: 'Burundi' },
    { code: 'KH', name: 'Cambodia' },
    { code: 'CM', name: 'Cameroon' },
    { code: 'CA', name: 'Canada' },
    { code: 'CV', name: 'Cape Verde' },
    { code: 'KY', name: 'Cayman Islands' },
    { code: 'CF', name: 'Central African Republic' },
    { code: 'TD', name: 'Chad' },
    { code: 'CL', name: 'Chile' },
    { code: 'CN', name: 'China' },
    { code: 'CO', name: 'Colombia' },
    { code: 'KM', name: 'Comoros' },
    { code: 'CG', name: 'Congo' },
    { code: 'CR', name: 'Costa Rica' },
    { code: 'HR', name: 'Croatia' },
    { code: 'CU', name: 'Cuba' },
    { code: 'CY', name: 'Cyprus' },
    { code: 'CZ', name: 'Czech Republic' },
    { code: 'DK', name: 'Denmark' },
    { code: 'DJ', name: 'Djibouti' },
    { code: 'DM', name: 'Dominica' },
    { code: 'DO', name: 'Dominican Republic' },
    { code: 'EC', name: 'Ecuador' },
    { code: 'EG', name: 'Egypt' },
    { code: 'SV', name: 'El Salvador' },
    { code: 'EE', name: 'Estonia' },
    { code: 'ET', name: 'Ethiopia' },
    { code: 'FI', name: 'Finland' },
    { code: 'FR', name: 'France' },
    { code: 'GA', name: 'Gabon' },
    { code: 'GM', name: 'Gambia' },
    { code: 'GE', name: 'Georgia' },
    { code: 'DE', name: 'Germany' },
    { code: 'GH', name: 'Ghana' },
    { code: 'GR', name: 'Greece' },
    { code: 'GL', name: 'Greenland' },
    { code: 'GD', name: 'Grenada' },
    { code: 'GT', name: 'Guatemala' },
    { code: 'GN', name: 'Guinea' },
    { code: 'GY', name: 'Guyana' },
    { code: 'HT', name: 'Haiti' },
    { code: 'HN', name: 'Honduras' },
    { code: 'HK', name: 'Hong Kong' },
    { code: 'HU', name: 'Hungary' },
    { code: 'IS', name: 'Iceland' },
    { code: 'IN', name: 'India' },
    { code: 'ID', name: 'Indonesia' },
    { code: 'IR', name: 'Iran' },
    { code: 'IQ', name: 'Iraq' },
    { code: 'IE', name: 'Ireland' },
    { code: 'IL', name: 'Israel' },
    { code: 'IT', name: 'Italy' },
    { code: 'JM', name: 'Jamaica' },
    { code: 'JP', name: 'Japan' },
    { code: 'JO', name: 'Jordan' },
    { code: 'KZ', name: 'Kazakhstan' },
    { code: 'KE', name: 'Kenya' },
    { code: 'KW', name: 'Kuwait' },
    { code: 'KG', name: 'Kyrgyzstan' },
    { code: 'LA', name: 'Laos' },
    { code: 'LV', name: 'Latvia' },
    { code: 'LB', name: 'Lebanon' },
    { code: 'LS', name: 'Lesotho' },
    { code: 'LR', name: 'Liberia' },
    { code: 'LY', name: 'Libya' },
    { code: 'LT', name: 'Lithuania' },
    { code: 'LU', name: 'Luxembourg' },
    { code: 'MY', name: 'Malaysia' },
    { code: 'MV', name: 'Maldives' },
    { code: 'MX', name: 'Mexico' },
    { code: 'MA', name: 'Morocco' },
    { code: 'NP', name: 'Nepal' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'NG', name: 'Nigeria' },
    { code: 'NO', name: 'Norway' },
    { code: 'OM', name: 'Oman' },
    { code: 'PK', name: 'Pakistan' },
    { code: 'PH', name: 'Philippines' },
    { code: 'PL', name: 'Poland' },
    { code: 'PT', name: 'Portugal' },
    { code: 'QA', name: 'Qatar' },
    { code: 'RO', name: 'Romania' },
    { code: 'RU', name: 'Russia' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'SG', name: 'Singapore' },
    { code: 'ZA', name: 'South Africa' },
    { code: 'KR', name: 'South Korea' },
    { code: 'ES', name: 'Spain' },
    { code: 'LK', name: 'Sri Lanka' },
    { code: 'SE', name: 'Sweden' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'TH', name: 'Thailand' },
    { code: 'TR', name: 'Turkey' },
    { code: 'UA', name: 'Ukraine' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'US', name: 'United States' },
    { code: 'UY', name: 'Uruguay' },
    { code: 'UZ', name: 'Uzbekistan' },
    { code: 'VE', name: 'Venezuela' },
    { code: 'VN', name: 'Vietnam' },
    { code: 'YE', name: 'Yemen' },
    { code: 'ZM', name: 'Zambia' },
    { code: 'ZW', name: 'Zimbabwe' }
  ];


  const steps = [
    { id: 0, title: t('welcome_step'), icon: Building2 },
    { id: 1, title: t('profile_picture_step'), icon: User },
    { id: 2, title: t('account_step'), icon: Lock },
    { id: 3, title: t('personal_info_step'), icon: User },
    { id: 4, title: t('location_step'), icon: MapPin }
  ];

  useEffect(() => {
    if (!inviteCode) {
      setError(t('no_invitation_code'));
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
          organization: data.data.organization_name,
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

  // Generate username when entering step 2
  useEffect(() => {
    if (currentStep === 2 && !formData.username) {
      // Generate a temporary username for step 2
      const tempUsername = generateUsername('User', Date.now().toString().slice(-4));
      setFormData(prev => ({ ...prev, username: tempUsername }));
    }
  }, [currentStep]);

  const generateUsername = (firstName, lastName) => {
    if (!firstName || !lastName) return '';
    const timestamp = Date.now().toString().slice(-4);
    const username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${timestamp}`;
    return username;
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Auto-generate username when first or last name is changed
    if (field === 'first_name' || field === 'last_name') {
      const firstName = field === 'first_name' ? value : formData.first_name;
      const lastName = field === 'last_name' ? value : formData.last_name;
      const newUsername = generateUsername(firstName, lastName);
      if (newUsername) {
        setFormData(prev => ({ ...prev, username: newUsername }));
      }
    }

    if (field === 'password' || field === 'confirmPassword') {
      setPasswordError('');
    }
  };

  const validatePassword = () => {
    if (formData.password.length < 8) {
      setPasswordError(t('password_must_be_at_least_8_characters_long'));
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setPasswordError(t('passwords_do_not_match'));
      return false;
    }

    return true;
  };

  // Pre-existing functional gap, not introduced here: this runs before the
  // account exists (no session cookie yet), but the real /api/uploads
  // requires an authenticated session (storage.js's requireUploadAuth) --
  // this call has always 401'd. Left as a real, separate, flagged issue
  // rather than inventing a new unauthenticated upload endpoint or
  // silently reworking the signup flow's ordering.
  const uploadProfilePicture = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(STORAGE_BASE_URL, {
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
  // New handler for using the default avatar with upload to your storage
  const handleSelectAvatar = async (avatarUrl) => {
    setShowAvatarDialog(false);
    // Don't set global loading here to avoid blocking UI if we just want to show spinner on valid field
    // But since we are uploading, maybe a toast loading is better
    const toastId = toast.loading(t('setting_up_avatar'));

    try {
      const response = await fetch(avatarUrl);
      const blob = await response.blob();
      const file = new File([blob], 'avatar.svg', { type: 'image/svg+xml' });

      // Upload to your storage
      const uploadedUrl = await uploadProfilePicture(file);

      setProfileImage(avatarUrl);
      setProfileImageFile(file);
      setFormData(prev => ({ ...prev, profile_picture_url: uploadedUrl }));

      toast.dismiss(toastId);
      toast.success(t('avatar_updated'));
    } catch (error) {
      console.error('Avatar selection failed:', error);
      toast.dismiss(toastId);
      toast.error(t('failed_to_set_avatar'));
    }
  };
  const handleSkipAvatar = () => {
    setProfileImage(DEFAULT_AVATAR_URL);
    setProfileImageFile(null);
    setFormData(prev => ({ ...prev, profile_picture_url: DEFAULT_AVATAR_URL }));
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
      let profilePictureUrl = formData.profile_picture_url || DEFAULT_AVATAR_URL;

      if (profileImageFile) {
        try {
          profilePictureUrl = await uploadProfilePicture(profileImageFile);
          toast.success(t('profile_picture_uploaded_successfully'));
        } catch (error) {
          toast.error(t('failed_to_upload_profile_picture'), {
            description: t('using_default_avatar')
          });
          profilePictureUrl = DEFAULT_AVATAR_URL;
        }
      }

      const userData = {
        ...formData,
        profile_picture_url: profilePictureUrl
      };



      toast.loading(t('setting_up_user_profile'));
      await registerUser(userData);
      toast.dismiss();

      toast.success(t('account_created_successfully_toast'), {
        description: t('you_can_now_login_with_your_credentials')
      });
      setShowSuccessModal(true);
      // router.push('/auth/login');
    } catch (err) {
      toast.dismiss();
      toast.error(t('failed_to_create_account'), {
        description: err.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const validateStep = () => {
    switch (currentStep) {
      case 2: // Account Setup
        return validatePassword();

      case 3: // Personal Info
        if (!formData.first_name.trim()) {
          toast.error(t('please_enter_your_first_name'));
          return false;
        }
        if (!formData.last_name.trim()) {
          toast.error(t('please_enter_your_last_name'));
          return false;
        }
        if (!formData.phone.trim()) {
          toast.error(t('please_enter_your_phone_number'));
          return false;
        }
        return true;

      case 4: // Location
        if (!formData.country) {
          toast.error(t('please_select_your_country'));
          return false;
        }
        if (!formData.state.trim()) {
          toast.error(t('please_enter_your_state_province'));
          return false;
        }
        if (!formData.city.trim()) {
          toast.error(t('please_enter_your_city'));
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
          <p className="text-muted-foreground">{t('verifying_invitation')}</p>
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
            <CardTitle>{t('invitation_error')}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/')} className="w-full">
              {t('return_home')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-4">
      {/* Language Switcher Overlay */}
      <div className="w-full max-w-2xl flex justify-end mb-4">
        <AuthLanguageSwitcher />
      </div>

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
                      className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${index === currentStep
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
                    <span className={`text-xs mt-2 font-medium absolute top-12 whitespace-nowrap ${index === currentStep ? 'text-foreground' : 'text-muted-foreground'
                      }`}>
                      {step.title}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div className="flex-1 h-0.5 mx-2 mb-6">
                      <div
                        className={`h-full transition-all ${index < currentStep ? 'bg-primary' : 'bg-muted'
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
              {currentStep === 0 && `${t('welcome_to_org')} ${inviteInfo.organization}`}
              {currentStep === 1 && t('add_profile_picture_desc')}
              {currentStep === 2 && t('create_account_credentials_desc')}
              {currentStep === 3 && t('tell_us_about_yourself_desc')}
              {currentStep === 4 && t('where_are_you_located_desc')}
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
                      <p className="text-sm font-medium">{t('organization_label')}</p>
                      <p className="text-sm text-muted-foreground">{inviteInfo.organization}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{t('role')}</p>
                      <p className="text-sm text-muted-foreground">{inviteInfo.designation}</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('complete_setup_message')}
                  </p>
                </div>
              )}

              {/* Step 1: Profile Picture */}
              {currentStep === 1 && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      <Avatar className="h-32 w-32 border">
                        <AvatarImage src={profileImage || PLACEHOLDER_AVATAR} />
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
                        {t('click_upload_button')}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAvatarDialog(true)}
                        disabled={isLoading}
                      >
                        {t('select_avatar')}
                      </Button>
                      <AvatarSelectionDialog
                        open={showAvatarDialog}
                        onOpenChange={setShowAvatarDialog}
                        onSelect={handleSelectAvatar}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Account Setup */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">{t('username')}</Label>
                    <div className="relative">
                      <Input
                        id="username"
                        value={formData.username}
                        onChange={(e) => handleInputChange('username', e.target.value)}
                        placeholder="Your username will appear here"
                        required
                        readOnly
                        className="bg-muted cursor-not-allowed pr-10"
                      />
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground">{t('auto_generated_username_hint')}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">{t('password')}</Label>
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
                    <p className="text-xs text-muted-foreground">{t('must_be_8_chars')}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">{t('confirm_password')}</Label>
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
                      <Label htmlFor="first_name">{t('first_name')}</Label>
                      <Input
                        id="first_name"
                        value={formData.first_name}
                        onChange={(e) => handleInputChange('first_name', e.target.value)}
                        placeholder="First name"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="last_name">{t('last_name')}</Label>
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
                    <Label htmlFor="phone">{t('phone_number')}</Label>
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
                      {t('email_label')}: <span className="font-medium text-foreground">{inviteInfo.email}</span>
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
                        <SelectValue placeholder={t('select_your_country')} />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
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
                      <Label htmlFor="state">{t('state_province')}</Label>
                      <Input
                        id="state"
                        value={formData.state}
                        onChange={(e) => handleInputChange('state', e.target.value)}
                        placeholder={t('state')}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="city">{t('city')}</Label>
                      <Input
                        id="city"
                        value={formData.city}
                        onChange={(e) => handleInputChange('city', e.target.value)}
                        placeholder={t('city')}
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
                  {t('back')}
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
                    {t('creating_account')}
                  </>
                ) : currentStep === steps.length - 1 ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {t('complete_registration')}
                  </>
                ) : (
                  <>
                    {t('continue_btn')}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center mt-6 text-sm text-muted-foreground">
          {t('terms_agreement')}
        </p>
      </div>

      <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-6 w-6" />
              {t('signup_successful')}
            </DialogTitle>
            <DialogDescription>
              {t('account_created_description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button
              className="w-full sm:w-auto"
              onClick={() => router.push('/auth/login')}
            >
              {t('login_btn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}