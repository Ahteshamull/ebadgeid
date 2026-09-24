"use client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const dynamic = 'force-dynamic';

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeOffIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiFetch } from '@/lib/api';
import { ORGANIZATION_CODE } from '@/lib/config';

// Zod schema
const loginSchema = z.object({
  username: z.string().min(3, { message: "Username must be at least 3 characters" }),
  password: z.string().min(4, { message: "Password must be at least 4 characters" }),
});

// Helper function to determine redirect URL based on role
const getRedirectUrl = (role) => {
  switch (role.toLowerCase()) {
    case 'agent':
      return "/reports/organizations";
    case 'admin':
      return "/reports/organizations";
    case 'user':
      return "/tracking";
    default:
      return "/";
  }
};

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loginError, setLoginError] = useState("");

  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  async function onSubmit(values) {
    setIsLoading(true);
    setLoginError("");
    
    try {
      const response = await apiFetch('/auth/login', {
        method: "POST",
        redirectOnUnauthorized: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailOrUsername: values.username,
          password: values.password,
          organization_code: ORGANIZATION_CODE,
        }),
      });

      const data = await response.json();

      if (response.ok) {
          setLoginSuccess(true);
          
          // Get redirect URL based on role
          const redirectUrl = getRedirectUrl(data.user.user_type);
          
          // Redirect after showing success message
          setTimeout(() => {
            window.location.href = redirectUrl;
          }, 1500);
      } else {
        setLoginError(data.message || "Invalid credentials. Please try again.");
      }
    } catch (error) {
      console.error("Error during login:", error);
      setLoginError("Connection error. Please check your internet connection.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2"> eBadgeId HELP LOGIN</h1>
          <p className="text-gray-600 text-sm">NEXTGEN HELPDESK</p>
        </div>

        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl font-medium text-gray-900">Sign In</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loginSuccess && (
              <Alert className="bg-green-50 border-green-200">
                <AlertDescription className="text-green-800 text-sm">
                  Login successful! Redirecting...
                </AlertDescription>
              </Alert>
            )}
            
            {loginError && (
              <Alert className="bg-red-50 border-red-200">
                <AlertDescription className="text-red-800 text-sm">
                  {loginError}
                </AlertDescription>
              </Alert>
            )}
            
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="username" className="text-sm font-medium text-gray-700">
                  Username
                </Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter username"
                  {...form.register("username")}
                  className="mt-1 h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  disabled={isLoading}
                />
                {form.formState.errors.username && (
                  <p className="text-xs text-red-600 mt-1">{form.formState.errors.username.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                  Password
                </Label>
                <div className="relative mt-1">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password"
                    {...form.register("password")}
                    className="h-10 pr-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? (
                      <EyeOffIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {form.formState.errors.password && (
                  <p className="text-xs text-red-600 mt-1">{form.formState.errors.password.message}</p>
                )}
              </div>

              <Button 
                type="submit" 
                className="w-full h-10 bg-green-600 hover:bg-blue-700 text-white text-sm font-medium"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
            
            <div className="text-center pt-4">
              <p className="text-xs text-gray-500">
                © {new Date().getFullYear()} eBadge ID | All Rights Reserved
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
