"use client";

// Plan + consumption panel, shared by the Admin dashboard (own
// organization) and the Super Admin dashboard (any organization it drills
// into). One component, one API shape, so the two views can never render
// the same organization differently -- which is the point of the
// requirement that Admin and Super Admin agree.
//
// It renders ONLY what the backend reports and never computes a quota of
// its own. Three states are distinguished on purpose, because collapsing
// them is how dashboards end up lying:
//   - metered with a cap  -> show used / limit / remaining + a bar
//   - unlimited (-1)      -> show usage, and "Unlimited" instead of a
//                            fake remaining figure
//   - not metered (null)  -> show usage and say plainly that this
//                            product places no quota on it
import { useEffect, useState } from "react";
import { Gauge, CalendarClock, BadgeCheck, Users2, FileSignature, Activity, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";

const fmtDate = (value) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
};

const barColor = (percent) => {
  if (percent >= 90) return "bg-red-500";
  if (percent >= 70) return "bg-amber-500";
  return "bg-emerald-500";
};

function Metric({ icon, label, metric }) {
  if (!metric) return null;

  // Not metered by any plan tier: report the real number and say so,
  // rather than inventing a ceiling to fill the bar with.
  if (!metric.metered) {
    return (
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-gray-600 text-sm font-medium">{icon}{label}</div>
        <p className="mt-2 text-2xl font-bold text-gray-900">{metric.used}</p>
        <p className="text-xs text-gray-500 mt-1">No plan limit applies</p>
      </div>
    );
  }

  if (metric.unlimited) {
    return (
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-gray-600 text-sm font-medium">{icon}{label}</div>
        <p className="mt-2 text-2xl font-bold text-gray-900">{metric.used}</p>
        <p className="text-xs text-emerald-600 font-medium mt-1">Unlimited</p>
      </div>
    );
  }

  const percent = metric.percent_used ?? 0;
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 text-gray-600 text-sm font-medium">{icon}{label}</div>
      <p className="mt-2 text-2xl font-bold text-gray-900">
        {metric.used}
        <span className="text-base font-medium text-gray-400"> / {metric.limit}</span>
      </p>
      <div className="mt-2 h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${barColor(percent)}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-gray-500 mt-1">{metric.remaining} remaining</p>
    </div>
  );
}

export default function PlanUsageCard({ organizationCode = null, title = "Plan & Usage" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const path = organizationCode
      ? `/organizations/plan-usage/${encodeURIComponent(organizationCode)}`
      : "/organizations/plan-usage";

    apiFetch(path, { redirectOnUnauthorized: false })
      .then(async (response) => {
        if (cancelled) return;
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Unable to load plan usage");
        setData(payload);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [organizationCode]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-md border p-6">
        <div className="h-5 w-40 bg-gray-100 rounded animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-md border p-6">
        <div className="flex items-center gap-3 text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm"><strong>Plan &amp; usage unavailable:</strong> {error}</span>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { plan, usage, organization } = data;

  return (
    <div className="bg-white rounded-2xl shadow-md border p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Gauge className="h-5 w-5 text-indigo-600" />
            {title}
          </h2>
          <p className="text-sm text-gray-600 mt-1">{organization.name} · {organization.organization_code}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-3 py-1 rounded-full text-sm font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            {plan.name} plan
          </span>
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${
            plan.status === "ACTIVE" ? "bg-green-50 text-green-700 border-green-200"
            : plan.status === "TRIAL" ? "bg-amber-50 text-amber-700 border-amber-200"
            : "bg-gray-100 text-gray-700 border-gray-200"}`}>
            {plan.status}
          </span>
        </div>
      </div>

      {/* Real data drift: the organization names a plan that has no
          matching definition. Enforcement fails closed on exactly this
          condition, so the customer would otherwise be blocked with no
          visible reason. */}
      {!plan.configured && (
        <div className="mt-4 flex items-center gap-3 text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm">
            This organization is on the <strong>{plan.name}</strong> plan, but no plan definition with that name exists,
            so no limits can be applied. Usage below is real; the limits are unknown until the plan is configured.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5 text-sm">
        <div className="flex items-center gap-2 text-gray-700">
          <CalendarClock className="h-4 w-4 text-gray-400" />
          <span className="text-gray-500">Started:</span> <strong>{fmtDate(plan.started_at)}</strong>
        </div>
        <div className="flex items-center gap-2 text-gray-700">
          <CalendarClock className="h-4 w-4 text-gray-400" />
          {/* Quotas are monthly, so this is the real renewal date for
              everything metered here. */}
          <span className="text-gray-500">Quotas reset:</span> <strong>{fmtDate(plan.quota_resets_at)}</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
        <Metric icon={<Users2 className="h-4 w-4" />} label="Users" metric={usage.users} />
        <Metric icon={<BadgeCheck className="h-4 w-4" />} label="Badges / credentials this month" metric={usage.credentials_this_month} />
        <Metric icon={<Activity className="h-4 w-4" />} label="API calls this month" metric={usage.api_calls_this_month} />
        <Metric icon={<FileSignature className="h-4 w-4" />} label="Contracts" metric={usage.contracts} />
      </div>

      <p className="text-xs text-gray-500 mt-4">
        A badge and a credential are the same record in eBadge ID, so both names report one figure.
        Credentials issued all time: <strong>{usage.credentials_all_time}</strong>.
      </p>
    </div>
  );
}
