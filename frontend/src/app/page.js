"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { apiFetch } from '@/lib/api';

export default function AuthCheck() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      // Check if we're on the client side
      if (typeof window !== 'undefined') {
          try {
            const response = await apiFetch('/auth/me', { redirectOnUnauthorized: false });

            if (response.ok) {
              const data = await response.json();
              
              if (data.authenticated) {
                // User is authenticated, check role
                if (data.role === 'admin') {
                  router.push('/reports/organizations');
                } else {
                  router.push('/user_dash');
                }
              } else {
                // Token is invalid or not authenticated
                handleLogout();
              }
            } else {
              // Server responded with error
              handleLogout();
            }
          } catch (error) {
            console.error('Authentication error:', error);
            handleLogout();
          }
      }
    };

    const handleLogout = () => {
      router.push('/auth/login');
    };

    checkAuth();
  }, [router]);

  // No need to render anything as we're just doing redirects
  return null;
}
