"use client"
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Award, Loader2, AlertCircle, ExternalLink, Linkedin } from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';

// Public recipient portal (ebadge.id/portal/:username) — every credential
// a person has actively Claimed, in one page. See
// getPublicPortalByUsername in backend (updated)/controllers/
// credentialController.js for exactly why this only shows Claimed
// credentials, not everything ever issued to this username.
//
// "Add to Profile" uses LinkedIn's own documented deep link
// (ADD_TO_PROFILE) — a plain URL with query params, no LinkedIn API key
// or app registration needed on this side.
const linkedInAddToProfileUrl = (credential) => {
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: credential.title || 'Credential',
    organizationName: credential.organization_name || '',
    issueYear: credential.issue_date ? String(new Date(credential.issue_date).getFullYear()) : '',
    issueMonth: credential.issue_date ? String(new Date(credential.issue_date).getMonth() + 1) : '',
    certUrl: `${typeof window !== 'undefined' ? window.location.origin : ''}/verifications/credentials/${credential.credential_code}`,
    certId: credential.credential_code,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
};

export default function RecipientPortalPage() {
  const params = useParams();
  const username = params?.username;

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/credentials/portal/${encodeURIComponent(username)}`);
        if (res.status === 404) {
          if (!cancelled) { setNotFound(true); setLoading(false); }
          return;
        }
        if (!res.ok) throw new Error(`Unexpected response: ${res.status}`);
        const data = await res.json();
        if (!cancelled) { setProfile(data); setLoading(false); }
      } catch {
        if (!cancelled) { setNotFound(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground mb-3" />
        <h1 className="text-lg font-semibold text-foreground">No public credentials found</h1>
        <p className="text-sm text-muted-foreground mt-1">This profile doesn&apos;t have any claimed credentials to show yet.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center mb-3">
            <Award className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{profile.display_name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{profile.credentials.length} verified credential{profile.credentials.length === 1 ? '' : 's'}</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {profile.credentials.map((credential) => (
            <div key={credential.credential_code} className="bg-card rounded-lg border border-border shadow-sm overflow-hidden flex flex-col">
              {credential.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={credential.image_url} alt={credential.title || 'Credential'} className="w-full h-40 object-cover bg-muted" />
              )}
              <div className="p-4 flex flex-col flex-1">
                <h2 className="font-semibold text-foreground">{credential.title || 'Credential'}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{credential.organization_name}</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Issued {credential.issue_date}</p>
                <div className="mt-3 flex gap-2 pt-2 border-t border-border">
                  <a
                    href={`/verifications/credentials/${credential.credential_code}`}
                    className="flex-1 text-xs font-medium text-foreground border border-border rounded-md px-2 py-1.5 text-center hover:bg-muted flex items-center justify-center gap-1 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" /> Verify
                  </a>
                  <a
                    href={linkedInAddToProfileUrl(credential)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-xs font-medium text-white bg-[#0A66C2] rounded-md px-2 py-1.5 text-center hover:opacity-90 flex items-center justify-center gap-1 transition-opacity"
                  >
                    <Linkedin className="h-3 w-3" /> Add to LinkedIn
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
