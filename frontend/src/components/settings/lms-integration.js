"use client";

import React, { useState, useEffect } from 'react';
import { apiFetch, API_BASE_URL } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  GraduationCap,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Send,
  Loader2,
  ExternalLink,
  RefreshCw,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  KeyRound,
  FileCode2,
  HelpCircle
} from 'lucide-react';

const LMS_PLATFORMS = [
  {
    id: 'moodle',
    name: 'Moodle LMS',
    tagline: 'World’s most popular open-source LMS',
    badge: 'Popular',
    iconBg: 'bg-amber-500/10 text-amber-600 border-amber-200',
    docUrl: 'https://docs.moodle.org/en/Webhooks',
    samplePayload: {
      external_event_id: 'moodle-evt-98214',
      achiever_username: 'student.id.442',
      guest_recipient: {
        first_name: 'Sarah',
        last_name: 'Jenkins',
        email: 'sarah.j@university.edu'
      },
      credential_title: 'Moodle Python Mastery 2026',
      design_code: 'DESIGN-CERT-01'
    }
  },
  {
    id: 'canvas',
    name: 'Canvas LMS',
    tagline: 'Instructure modern cloud learning platform',
    badge: 'Enterprise',
    iconBg: 'bg-rose-500/10 text-rose-600 border-rose-200',
    docUrl: 'https://canvas.instructure.com/doc/api/',
    samplePayload: {
      external_event_id: 'canvas-submission-8711',
      achiever_username: 'student_canvas_102',
      guest_recipient: {
        first_name: 'Marcus',
        last_name: 'Vance',
        email: 'mvance@institution.org'
      },
      credential_title: 'Canvas Advanced Data Science',
      design_code: 'DESIGN-CERT-01'
    }
  },
  {
    id: 'blackboard',
    name: 'Blackboard Learn',
    tagline: 'Anthology comprehensive educational suite',
    badge: 'Higher Ed',
    iconBg: 'bg-slate-800/10 text-slate-800 border-slate-300',
    docUrl: 'https://developer.anthology.com/',
    samplePayload: {
      external_event_id: 'bb-completion-3301',
      achiever_username: 'bb_user_772',
      guest_recipient: {
        first_name: 'Elena',
        last_name: 'Rostova',
        email: 'e.rostova@academy.edu'
      },
      credential_title: 'Healthcare Compliance Certification',
      design_code: 'DESIGN-CERT-01'
    }
  }
];

export default function LmsIntegrationManagement() {
  const [selectedPlatform, setSelectedPlatform] = useState('moodle');
  const [copiedField, setCopiedField] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSuccess, setConfigSuccess] = useState('');
  const [configError, setConfigError] = useState('');

  // Sync config state
  const [syncApiUrl, setSyncApiUrl] = useState('');
  const [syncApiToken, setSyncApiToken] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  // Simulator state
  const [simStudentName, setSimStudentName] = useState('Alex Morgan');
  const [simStudentEmail, setSimStudentEmail] = useState('alex.morgan@example.com');
  const [simCourseName, setSimCourseName] = useState('Certified Cloud Architect 2026');
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState(null);
  const [simulationError, setSimulationError] = useState('');

  const webhookEndpointUrl = `${API_BASE_URL.replace(/\/$/, '')}/lms/webhook/course-completed`;

  // Fetch current LMS config on load
  useEffect(() => {
    fetchLmsConfig();
  }, []);

  const fetchLmsConfig = async () => {
    setLoadingConfig(true);
    try {
      const res = await apiFetch('/lms/config');
      if (res.ok) {
        const data = await res.json();
        if (data.sync_api_url) setSyncApiUrl(data.sync_api_url);
        if (data.enabled !== undefined) setSyncEnabled(data.enabled);
        if (data.last_synced_at) setLastSyncedAt(data.last_synced_at);
      }
    } catch (err) {
      console.warn('LMS config fetch notice:', err.message);
    } finally {
      setLoadingConfig(false);
    }
  };

  const handleCopy = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 2500);
  };

  const handleSaveLmsConfig = async (e) => {
    e.preventDefault();
    setConfigSuccess('');
    setConfigError('');
    setSavingConfig(true);

    if (!syncApiUrl.trim()) {
      setConfigError('Please provide your LMS Base API URL');
      setSavingConfig(false);
      return;
    }

    if (!syncApiToken.trim()) {
      setConfigError('Please provide your LMS Sync API Token');
      setSavingConfig(false);
      return;
    }

    try {
      const res = await apiFetch('/lms/config', {
        method: 'PUT',
        body: JSON.stringify({
          sync_api_url: syncApiUrl.trim(),
          sync_api_token: syncApiToken.trim(),
          enabled: syncEnabled
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to update LMS integration configuration');
      }

      setConfigSuccess('LMS integration configuration saved securely! API token encrypted at rest.');
      setTimeout(() => setConfigSuccess(''), 5000);
    } catch (err) {
      setConfigError(err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRunSimulation = async () => {
    setSimulating(true);
    setSimulationResult(null);
    setSimulationError('');

    try {
      const res = await apiFetch('/lms/simulate-webhook', {
        method: 'POST',
        body: JSON.stringify({
          platform: selectedPlatform,
          student_name: simStudentName,
          student_email: simStudentEmail,
          course_name: simCourseName
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Simulation request failed');
      }

      const result = await res.json();
      setSimulationResult(result);
    } catch (err) {
      setSimulationError(err.message || 'Failed to simulate webhook ping');
    } finally {
      setSimulating(false);
    }
  };

  const activePlatform = LMS_PLATFORMS.find(p => p.id === selectedPlatform) || LMS_PLATFORMS[0];

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Intro Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <GraduationCap className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">LMS Automated Issuance</h2>
            <p className="text-sm text-muted-foreground">
              Connect Moodle, Canvas, or Blackboard so learners instantly receive certificates & badges upon course completion.
            </p>
          </div>
        </div>
      </div>

      {/* Platform Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {LMS_PLATFORMS.map((platform) => {
          const isSelected = selectedPlatform === platform.id;
          return (
            <div
              key={platform.id}
              onClick={() => setSelectedPlatform(platform.id)}
              className={`cursor-pointer relative p-5 rounded-2xl border-2 transition-all duration-200 ${
                isSelected
                  ? 'border-primary bg-primary/10 shadow-md shadow-primary/10 scale-[1.02]'
                  : 'border-border bg-card hover:border-primary/40 hover:shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2 rounded-xl border ${platform.iconBg}`}>
                  <BookOpen className="h-5 w-5" />
                </div>
                <Badge variant={isSelected ? 'default' : 'secondary'} className="text-xs">
                  {platform.badge}
                </Badge>
              </div>
              <h3 className="font-bold text-foreground text-base mb-1">{platform.name}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{platform.tagline}</p>

              {isSelected && (
                <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Selected Platform</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Guided 3-Step Setup Wizard */}
      <Card className="border-border shadow-sm overflow-hidden bg-card">
        <CardHeader className="bg-muted/40 border-b border-border pb-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <span>{activePlatform.name} Setup Guide & Webhook Target</span>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                Configure your LMS to trigger automatic credential delivery when a learner finishes an assessment or course.
              </CardDescription>
            </div>
            <a
              href={activePlatform.docUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium self-start sm:self-auto bg-card px-3 py-1.5 rounded-lg border border-border shadow-xs hover:border-primary/40"
            >
              <span>{activePlatform.name} Docs</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Step 1: Webhook URL */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
                <h4 className="font-semibold text-sm text-foreground">Webhook Notification URL</h4>
              </div>
              <Badge variant="outline" className="text-xs bg-background text-muted-foreground font-mono">
                POST
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste this URL into your {activePlatform.name} webhook / event triggers (e.g. Course Completion Event).
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={webhookEndpointUrl}
                className="bg-background border-input font-mono text-xs text-foreground select-all"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopy(webhookEndpointUrl, 'url')}
                className="shrink-0 gap-1.5 text-xs font-medium border-border"
              >
                {copiedField === 'url' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                <span>{copiedField === 'url' ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </div>

          {/* Step 2: Authentication & Header */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
              <h4 className="font-semibold text-sm text-foreground">Header Authentication (API Key)</h4>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Every request from your LMS must include an <code className="bg-background px-1.5 py-0.5 rounded border border-border text-foreground font-mono font-semibold">X-API-Key</code> header to verify your organization&apos;s permission.
            </p>
            <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border text-xs">
              <div className="flex items-center gap-2 font-mono text-foreground">
                <KeyRound className="h-4 w-4 text-amber-500" />
                <span>Header: <strong>X-API-Key: YOUR_API_TOKEN</strong></span>
              </div>
              <span className="text-[11px] text-muted-foreground">Generate keys in &quot;API &amp; Keys&quot; tab</span>
            </div>
          </div>

          {/* Step 3: Interactive Webhook Simulator */}
          <div className="p-5 rounded-xl border border-primary/20 bg-primary/5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
                <h4 className="font-semibold text-sm text-foreground">Interactive Webhook Simulator</h4>
              </div>
              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border text-xs">
                Zero Risk Test Ping
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Test how eBadgeID handles a course completion payload from {activePlatform.name} without needing live students.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-foreground">Sample Student Name</Label>
                <Input
                  value={simStudentName}
                  onChange={(e) => setSimStudentName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  className="bg-background border-input text-xs h-9 text-foreground"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-foreground">Sample Student Email</Label>
                <Input
                  value={simStudentEmail}
                  onChange={(e) => setSimStudentEmail(e.target.value)}
                  placeholder="e.g. alex@example.com"
                  className="bg-background border-input text-xs h-9 text-foreground"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-foreground">Course / Assessment Title</Label>
                <Input
                  value={simCourseName}
                  onChange={(e) => setSimCourseName(e.target.value)}
                  placeholder="e.g. Certified Cloud Architect"
                  className="bg-background border-input text-xs h-9 text-foreground"
                />
              </div>
            </div>

            <Button
              type="button"
              onClick={handleRunSimulation}
              disabled={simulating}
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold gap-2 h-9 px-4 rounded-lg shadow-sm"
            >
              {simulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span>{simulating ? 'Simulating Event...' : `Send Test Ping (${activePlatform.name})`}</span>
            </Button>

            {simulationError && (
              <Alert className="bg-red-500/10 border-red-500/20 text-xs text-red-600 py-2.5">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription>{simulationError}</AlertDescription>
              </Alert>
            )}

            {simulationResult && (
              <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-semibold text-emerald-600">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>{simulationResult.message}</span>
                </div>
                <div className="bg-card p-3 rounded border border-border font-mono text-[11px] text-foreground overflow-x-auto">
                  <pre>{JSON.stringify(simulationResult.simulated_event, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Direct LMS API Reconciliation (Background Sync) */}
      <Card className="border-border shadow-sm bg-card">
        <CardHeader className="border-b border-border pb-5">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" />
                <span>Automated Periodic Reconciliation (LMS Sync)</span>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                Enable background scheduled sync to automatically catch any completion events even if webhooks temporarily drop.
              </CardDescription>
            </div>
            {lastSyncedAt && (
              <Badge variant="outline" className="text-[11px] text-muted-foreground">
                Last Synced: {new Date(lastSyncedAt).toLocaleString()}
              </Badge>
            )}
          </div>
        </CardHeader>

        <form onSubmit={handleSaveLmsConfig}>
          <CardContent className="p-6 space-y-5">
            {configSuccess && (
              <Alert className="bg-emerald-500/10 border-emerald-500/20 text-xs text-emerald-600">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertDescription>{configSuccess}</AlertDescription>
              </Alert>
            )}

            {configError && (
              <Alert className="bg-red-500/10 border-red-500/20 text-xs text-red-600">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription>{configError}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <Label htmlFor="syncApiUrl" className="text-xs font-semibold text-foreground">
                  LMS API Endpoint / Base URL
                </Label>
                <Input
                  id="syncApiUrl"
                  type="url"
                  placeholder="https://moodle.yourdomain.edu/webservice/rest/server.php"
                  value={syncApiUrl}
                  onChange={(e) => setSyncApiUrl(e.target.value)}
                  className="text-xs font-mono bg-background border-input text-foreground"
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  The REST API endpoint for your institution&apos;s Moodle, Canvas, or Blackboard instance.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="syncApiToken" className="text-xs font-semibold text-foreground">
                  LMS API Token (Encrypted at rest)
                </Label>
                <Input
                  id="syncApiToken"
                  type="password"
                  placeholder="••••••••••••••••••••••••••••••••"
                  value={syncApiToken}
                  onChange={(e) => setSyncApiToken(e.target.value)}
                  className="text-xs font-mono bg-background border-input text-foreground"
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Encrypted using AES-256 before storage. Never shared or returned in plain text.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border">
              <div className="space-y-0.5">
                <Label htmlFor="syncToggle" className="text-xs font-semibold text-foreground">
                  Enable Scheduled Periodic Sync
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Automatically pull completions every hour to reconcile missing webhooks.
                </p>
              </div>
              <Switch
                id="syncToggle"
                checked={syncEnabled}
                onCheckedChange={setSyncEnabled}
              />
            </div>
          </CardContent>

          <CardFooter className="bg-muted/30 px-6 py-4 border-t border-border flex justify-end">
            <Button
              type="submit"
              disabled={savingConfig || loadingConfig}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold h-9 px-5 rounded-lg shadow-sm"
            >
              {savingConfig ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              <span>{savingConfig ? 'Saving...' : 'Save LMS Integration'}</span>
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
