"use client"
import React, { useState, useEffect } from 'react';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Server, 
  MessageCircle, 
  Activity,
  RefreshCw,
  Calendar
} from 'lucide-react';
import { CORE_API_ORIGIN, HELPDESK_API_ORIGIN } from '@/lib/config';

export default function SystemStatusPage() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Checks a service's real /health endpoint. This used to be a "Mock
  // function" (the comment's own words) that waited a random delay and
  // then rolled weighted dice (80% operational / 15% degraded / 5% down)
  // with a fake uptime percentage — a visitor to this page saw a
  // confident-looking "All Systems Operational" or "Degraded" status that
  // had nothing to do with whether anything was actually working.
  const checkServiceStatus = async (service) => {
    const start = Date.now();
    try {
      const response = await fetch(service.endpoint, { signal: AbortSignal.timeout(5000) });
      const responseTime = Date.now() - start;
      const body = await response.json().catch(() => null);
      return {
        ...service,
        status: response.ok ? 'operational' : 'down',
        responseTime,
        lastChecked: new Date(),
        detail: body?.status || null,
      };
    } catch (error) {
      return {
        ...service,
        status: 'down',
        responseTime: Date.now() - start,
        lastChecked: new Date(),
        detail: 'Unreachable',
      };
    }
  };

  // Only the two services that actually exist in eBadge ID's
  // infrastructure — this used to list ten, nine of which pointed at
  // "deskarro.com" (a generic off-the-shelf helpdesk product's domain,
  // not eBadge ID's — the template this app was built from), including a
  // raw `mongodb://localhost:27017` string sitting in client-side code as
  // a "service endpoint" a browser could never actually check anyway.
  // Neither a CDN, a separate SMS/push/email service, nor a standalone
  // WebSocket host exist as separate infrastructure today; the chat
  // WebSocket lives inside the Helpdesk API service itself.
  const initialServices = [
    {
      id: 'main-api',
      name: 'eBadge ID API',
      description: 'Credentials, organizations, and core platform API',
      category: 'api',
      endpoint: `${CORE_API_ORIGIN}/health`,
      icon: Server
    },
    {
      id: 'helpdesk-api',
      name: 'Helpdesk API',
      description: 'Ticket management, FAQs, articles, and live chat',
      category: 'api',
      endpoint: `${HELPDESK_API_ORIGIN}/health`,
      icon: MessageCircle
    },
  ];
    
  useEffect(() => {
    const fetchServiceStatuses = async () => {
      setLoading(true);
      const servicePromises = initialServices.map(service => checkServiceStatus(service));
      const updatedServices = await Promise.all(servicePromises);
      setServices(updatedServices);
      setLastUpdated(new Date());
      setLoading(false);
    };

    fetchServiceStatuses();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchServiceStatuses, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    const servicePromises = services.map(service => checkServiceStatus(service));
    const updatedServices = await Promise.all(servicePromises);
    setServices(updatedServices);
    setLastUpdated(new Date());
    setLoading(false);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'operational': return 'text-green-600 bg-green-100';
      case 'degraded': return 'text-yellow-600 bg-yellow-100';
      case 'down': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'operational': return CheckCircle;
      case 'degraded': return AlertTriangle;
      case 'down': return XCircle;
      default: return Clock;
    }
  };

  const getCategoryTitle = (category) => {
    switch (category) {
      case 'api': return 'API Services';
      case 'server': return 'Server Infrastructure';
      case 'live_chat': return 'Live Chat System';
      case 'notification_servers': return 'Notification Services';
      default: return 'Other Services';
    }
  };

  const getOverallStatus = () => {
    if (services.length === 0) return 'unknown';
    
    const downServices = services.filter(s => s.status === 'down').length;
    const degradedServices = services.filter(s => s.status === 'degraded').length;
    
    if (downServices > 0) return 'down';
    if (degradedServices > 0) return 'degraded';
    return 'operational';
  };

  const groupedServices = services.reduce((acc, service) => {
    if (!acc[service.category]) {
      acc[service.category] = [];
    }
    acc[service.category].push(service);
    return acc;
  }, {});

  const overallStatus = getOverallStatus();
  const operationalCount = services.filter(s => s.status === 'operational').length;
  const totalServices = services.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                eBadge ID
              </h1>
              <span className="ml-4 text-gray-500">/</span>
              <span className="ml-2 text-gray-700 font-medium">System Status</span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overall Status */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 mb-8">
          <div className="text-center">
            <div className="flex justify-center mb-4">
              {React.createElement(getStatusIcon(overallStatus), {
                className: `w-16 h-16 ${getStatusColor(overallStatus).split(' ')[0]}`
              })}
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {overallStatus === 'operational' && 'All Systems Operational'}
              {overallStatus === 'degraded' && 'Some Systems Degraded'}
              {overallStatus === 'down' && 'System Issues Detected'}
            </h1>
            <p className="text-lg text-gray-600 mb-4">
              {operationalCount} of {totalServices} services are operational
            </p>
            <div className="flex justify-center items-center space-x-6 text-sm text-gray-500">
              <div className="flex items-center">
                <Clock className="w-4 h-4 mr-1" />
                Last updated: {lastUpdated.toLocaleTimeString()}
              </div>
              <div className="flex items-center">
                <Calendar className="w-4 h-4 mr-1" />
                {lastUpdated.toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>

        {/* Service Status Grid */}
        {Object.entries(groupedServices).map(([category, categoryServices]) => (
          <div key={category} className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
              <div className="w-1 h-8 bg-blue-600 rounded-full mr-4"></div>
              {getCategoryTitle(category)}
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {categoryServices.map((service) => {
                const StatusIcon = getStatusIcon(service.status);
                const IconComponent = service.icon;
                
                return (
                  <div
                    key={service.id}
                    className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 hover:shadow-xl transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                          <IconComponent className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{service.name}</h3>
                          <p className="text-sm text-gray-500">{service.description}</p>
                        </div>
                      </div>
                      <StatusIcon className={`w-6 h-6 ${getStatusColor(service.status).split(' ')[0]}`} />
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Status</span>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(service.status)}`}>
                          {service.status.charAt(0).toUpperCase() + service.status.slice(1)}
                        </span>
                      </div>
                      
                      {service.responseTime && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Response Time</span>
                          <span className="text-sm font-medium text-gray-900">{service.responseTime}ms</span>
                        </div>
                      )}
                      
                      {service.uptime && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Uptime</span>
                          <span className="text-sm font-medium text-gray-900">{service.uptime}%</span>
                        </div>
                      )}
                      
                      <div className="pt-2 border-t border-gray-100">
                        <p className="text-xs text-gray-500 truncate" title={service.endpoint}>
                          {service.endpoint}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Incident History */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
            <div className="w-1 h-8 bg-purple-600 rounded-full mr-4"></div>
            Recent Incidents
          </h2>
          
          <div className="space-y-4">
            <div className="flex items-start space-x-4 p-4 bg-green-50 rounded-lg border border-green-200">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-green-900">All systems operational</h4>
                <p className="text-sm text-green-700">No recent incidents to report. All services are running smoothly.</p>
                <p className="text-xs text-green-600 mt-1">Last 30 days</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center text-gray-500">
          <div className="flex items-center justify-center space-x-2 mb-2">
            <Activity className="w-4 h-4" />
            <span>System powered by eBadge ID</span>
          </div>
          <p className="text-sm">
            Status page automatically updates every 30 seconds
          </p>
        </footer>
      </div>
    </div>
  );
}
