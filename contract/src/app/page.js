"use client"
import Image from "next/image";
import { Button } from "@/components/ui/button"; // shadcn button

export default function NotAllowedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-red-100 via-red-200 to-red-300 dark:from-red-900 dark:via-red-800 dark:to-red-700 font-sans px-6 text-center">
      
      <h1 className="text-5xl font-extrabold text-red-800 dark:text-red-200 mb-4">
        🚫 You Are Not Allowed
      </h1>
      <p className="text-lg text-red-700 dark:text-red-300 mb-8 max-w-md">
        Sorry, you do not have permission to access this page. If you have any contract try accessing it with your token or from your email due to security issues direct access is not allowed to anyone
      </p>
      
      <p className="mt-6 text-sm text-red-700 dark:text-red-300">
        Error code: 403 - Forbidden
      </p>
    </div>
  );
}
