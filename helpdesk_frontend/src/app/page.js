"use client"
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Plus, MessageCircle, BarChart3, ArrowRight, ChevronDown, ChevronUp, Clock, Users, Zap, Loader2, AlertCircle, X, Send, User, Minimize2, Globe } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from '../hooks/useTranslation';
import { useLocalization } from '../context/LocalizationContext';
import { helpdeskTranslations, languages as availableLanguages } from '../locales';
import { API_BASE_URL, HELPDESK_WS_URL, ORGANIZATION_CODE } from '@/lib/config';

// Redesigned LanguageSelector component with enhanced aesthetics
const LanguageSelector = ({ currentLanguage, onLanguageChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedLang = availableLanguages.find(l => l.code === currentLanguage) || availableLanguages[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-gray-200 hover:border-emerald-300 hover:shadow-sm transition-all duration-200"
      >
        <Globe className="w-4 h-4 text-gray-600" />
        <span className="text-sm font-semibold text-gray-800">{selectedLang.flag} {selectedLang.name}</span>
        <ChevronDown className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50 animate-fadeIn">
          {availableLanguages.map((lang, index) => (
            <button
              key={lang.code}
              onClick={() => {
                onLanguageChange(lang.code);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors duration-150 ${
                currentLanguage === lang.code ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-gray-50'
              } ${index !== availableLanguages.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <span className="text-2xl">{lang.flag}</span>
              <span className="text-sm font-medium">{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// CustomerChatWidget Component
const CustomerChatWidget = ({ initialOpen = false, translations }) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [showAgentConnect, setShowAgentConnect] = useState(false);
  const [showHandoffOptions, setShowHandoffOptions] = useState(false);
  const [agentInfo, setAgentInfo] = useState(null);
  const [isConnectingToAgent, setIsConnectingToAgent] = useState(false);
  const [chatStatus, setChatStatus] = useState('bot');
  const [botTyping, setBotTyping] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [userTyping, setUserTyping] = useState(false);
  const [typingTimer, setTypingTimer] = useState(null);

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (initialOpen) {
      setIsOpen(true);
    }
  }, [initialOpen]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, botTyping, agentTyping]);

  useEffect(() => {
    if (isOpen && !isConnected) {
      initializeChat();
    }
  }, [isOpen]);

  const debouncedTyping = useCallback((isTyping) => {
    if (typingTimer) clearTimeout(typingTimer);

    if (isTyping) {
      if (!userTyping) {
        setUserTyping(true);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'typing', isTyping: true }));
        }
      }
      const timer = setTimeout(() => {
        setUserTyping(false);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'typing', isTyping: false }));
        }
      }, 1000);
      setTypingTimer(timer);
    } else {
      setUserTyping(false);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'typing', isTyping: false }));
      }
    }
  }, [userTyping, typingTimer]);

  const initializeChat = () => {
    // The backend rejects the connection outright if org is missing/invalid
    // (see help_backend/websocket/chatSocket.js handleCustomerConnection) —
    // this deployment's organization identifier must be configured via
    // NEXT_PUBLIC_ORGANIZATION_CODE.
    const ws = new WebSocket(`${HELPDESK_WS_URL}?org=${encodeURIComponent(ORGANIZATION_CODE)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'welcome':
          setSessionId(data.sessionId);
          addMessage('bot', data.response);
          break;
        case 'response':
          setBotTyping(false);
          addMessage('bot', data.response);
          if (data.showHandoffOptions) setShowHandoffOptions(true);
          break;
        case 'bot_typing':
          setBotTyping(data.isTyping);
          break;
        case 'agent_typing':
          setAgentTyping(data.isTyping);
          break;
        case 'agent_connecting':
          if (data.success) {
            setIsConnectingToAgent(true);
            setAgentInfo(data.agent);
            setChatStatus('connecting');
            addMessage('system', `${data.message} (${data.estimatedWait})`);
          }
          break;
        case 'agent_connected':
          setIsConnectingToAgent(false);
          setChatStatus('agent');
          setAgentInfo(data.agent);
          addMessage('agent', data.message, data.agent.name);
          setBotTyping(false);
          break;
        case 'agent_unavailable':
          addMessage('system', data.message);
          setIsConnectingToAgent(false);
          break;
        case 'agent_response':
          setAgentTyping(false);
          addMessage('agent', data.message, data.agent);
          break;
        case 'agent_disconnected':
          addMessage('system', data.message);
          setChatStatus('bot');
          setAgentInfo(null);
          setAgentTyping(false);
          break;
        case 'chat_ending':
          setShowHandoffOptions(true);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setBotTyping(false);
      setAgentTyping(false);
    };

    ws.onerror = () => {
      setIsConnected(false);
      setBotTyping(false);
      setAgentTyping(false);
    };
  };

  const addMessage = (sender, content, agentName = null) => {
    const newMessage = {
      id: Date.now(),
      sender:
        sender === 'user'
          ? 'You'
          : sender === 'bot'
          ? translations.chat.supportBot
          : sender === 'agent'
          ? agentName || translations.chat.supportAgent
          : translations.chat.system,
      content,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isOwn: sender === 'user',
      type: sender,
    };

    setMessages((prev) => [...prev, newMessage]);
  };

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setMessage(newValue);

    if (newValue.length > 0 && !userTyping) {
      debouncedTyping(true);
    } else if (newValue.length === 0 && userTyping) {
      debouncedTyping(false);
    }
  };

  const sendMessage = () => {
    if (!message.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    debouncedTyping(false);
    addMessage('user', message);

    wsRef.current.send(JSON.stringify({ type: 'message', content: message }));
    setMessage('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleConnectToAgent = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'request_agent',
          userInfo: { sessionId: sessionId, timestamp: new Date().toISOString() },
        })
      );
    }
    setShowAgentConnect(false);
  };

  const closeChat = () => {
    if (typingTimer) clearTimeout(typingTimer);
    if (wsRef.current) wsRef.current.close();

    setIsOpen(false);
    setIsConnected(false);
    setMessages([]);
    setSessionId(null);
    setChatStatus('bot');
    setAgentInfo(null);
    setShowHandoffOptions(false);
    setBotTyping(false);
    setAgentTyping(false);
    setUserTyping(false);
  };

  const TypingIndicator = ({ sender, name }) => (
    <div className="flex justify-start mb-3 animate-fadeIn">
      <div
        className={`relative px-6 py-4 rounded-3xl backdrop-blur-sm border transition-all duration-300 ${
          sender === 'bot'
            ? 'bg-gradient-to-r from-gray-50 to-white border-gray-200/60 text-gray-800'
            : 'bg-gradient-to-r from-gray-900 to-black border-gray-700/60 text-white'
        }`}
      >
        <div className="flex items-center space-x-3">
          <div className="text-sm font-medium opacity-70">
            {sender === 'bot' ? translations.chat.supportBot : name || translations.chat.supportAgent}
          </div>
          <div className="flex space-x-1">
            <div className={`w-2 h-2 rounded-full animate-bounce ${sender === 'bot' ? 'bg-gray-400' : 'bg-gray-300'}`}></div>
            <div className={`w-2 h-2 rounded-full animate-bounce ${sender === 'bot' ? 'bg-gray-400' : 'bg-gray-300'}`} style={{ animationDelay: '0.1s' }}></div>
            <div className={`w-2 h-2 rounded-full animate-bounce ${sender === 'bot' ? 'bg-gray-400' : 'bg-gray-300'}`} style={{ animationDelay: '0.2s' }}></div>
          </div>
        </div>
      </div>
    </div>
  );

  const AgentConnectModal = () => (
    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 p-8 rounded-3xl max-w-sm w-full mx-4 shadow-2xl transform scale-95 animate-scaleIn">
        <div className="text-center mb-6">
          <div className="bg-black rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">{translations.chat.connectExpert}</h3>
          <p className="text-gray-600">{translations.chat.connectDescription}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleConnectToAgent}
            className="flex-1 bg-black text-white py-3 px-6 rounded-2xl font-medium transition-all duration-200 hover:bg-gray-800 hover:scale-105 active:scale-95"
          >
            {translations.chat.connectNow}
          </button>
          <button
            onClick={() => setShowAgentConnect(false)}
            className="flex-1 bg-gray-100 text-gray-800 py-3 px-6 rounded-2xl font-medium transition-all duration-200 hover:bg-gray-200 hover:scale-105 active:scale-95"
          >
            {translations.chat.maybeLater}
          </button>
        </div>
      </div>
    </div>
  );

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-black text-white p-5 rounded-full shadow-2xl hover:bg-gray-800 transition-all duration-300 z-50 hover:scale-110 active:scale-95 group"
        aria-label="Open chat"
      >
        <MessageCircle className="w-7 h-7 group-hover:animate-pulse" />
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-6 right-6 w-96 bg-white rounded-3xl shadow-2xl border border-gray-200/60 z-50 transition-all duration-500 overflow-hidden ${
        isMinimized ? 'h-16' : 'h-[32rem]'
      }`}
    >
      <div className="flex items-center justify-between p-5 bg-gradient-to-r from-gray-900 via-black to-gray-900 text-white relative overflow-hidden">
        <div className="flex items-center gap-3 relative z-10">
          <div className={`w-3 h-3 rounded-full transition-all duration-300 ${isConnected ? 'bg-green-400 shadow-green-400/50 shadow-lg animate-pulse' : 'bg-red-400 shadow-red-400/50 shadow-lg'}`}></div>
          <div>
            <span className="font-semibold text-base">
              {chatStatus === 'agent' && agentInfo
                ? agentInfo.name
                : chatStatus === 'connecting'
                ? translations.chat.connecting
                : translations.chat.title}
            </span>
            {userTyping && (
              <div className="text-xs opacity-75 flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                {translations.chat.youTyping}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 relative z-10">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-2 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          <button
            onClick={closeChat}
            className="p-2 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          <div className="h-80 overflow-y-auto p-5 space-y-4 bg-gradient-to-b from-gray-50/50 to-white custom-scrollbar">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.isOwn ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
                <div className={`max-w-[85%] px-6 py-4 rounded-3xl text-sm relative transition-all duration-300 hover:scale-102 ${
                    msg.isOwn
                      ? 'bg-gradient-to-r from-black to-gray-800 text-white shadow-lg'
                      : msg.type === 'system'
                      ? 'bg-gradient-to-r from-gray-100 to-gray-50 text-gray-700 border border-gray-200/60'
                      : msg.type === 'agent'
                      ? 'bg-gradient-to-r from-gray-900 to-black text-white shadow-lg'
                      : 'bg-gradient-to-r from-gray-50 to-white text-gray-800 border border-gray-200/60 shadow-sm'
                  }`}>
                  {!msg.isOwn && msg.type !== 'system' && (
                    <p className="text-xs font-semibold mb-2 opacity-70 tracking-wide uppercase">{msg.sender}</p>
                  )}
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  <p className="text-xs mt-2 opacity-60 font-medium">{msg.time}</p>
                </div>
              </div>
            ))}

            {botTyping && <TypingIndicator sender="bot" />}
            {agentTyping && <TypingIndicator sender="agent" name={agentInfo?.name} />}

            {isConnectingToAgent && (
              <div className="bg-gradient-to-r from-black to-gray-900 p-5 rounded-3xl border border-gray-700/60 shadow-lg animate-fadeIn">
                <div className="flex items-center gap-3 text-sm text-white">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span className="font-medium">{translations.chat.connectingToAgent} {agentInfo?.name || ''}...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="p-5 bg-white border-t border-gray-200/60">
            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                type="text"
                placeholder={translations.chat.placeholder}
                value={message}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                className="flex-1 px-5 py-3.5 bg-gray-50 border border-gray-200/60 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:bg-white transition-all duration-200 placeholder-gray-500"
                disabled={!isConnected}
              />
              <button
                onClick={sendMessage}
                disabled={!message.trim() || !isConnected}
                className="bg-black text-white p-3.5 rounded-2xl hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 active:scale-95 group"
              >
                <Send className="w-5 h-5 group-hover:animate-pulse" />
              </button>
            </div>

            <div className="mt-3 text-xs text-gray-500 flex items-center justify-between">
              <span className="font-medium">
                {isConnected ? (
                  chatStatus === 'agent' ? (
                    <span className="text-black">{translations.chat.connectedTo} {agentInfo?.name || 'agent'}</span>
                  ) : chatStatus === 'connecting' ? (
                    <span className="text-gray-600">{translations.chat.connectingToAgent}</span>
                  ) : (
                    <span className="text-gray-600">{translations.chat.aiAssistant}</span>
                  )
                ) : (
                  <span className="text-gray-400">{translations.chat.connecting}</span>
                )}
              </span>
              {(botTyping || agentTyping) && (
                <span className="text-xs text-black flex items-center gap-2 font-medium">
                  <div className="w-1.5 h-1.5 bg-black rounded-full animate-pulse"></div>
                  {botTyping ? translations.chat.supportBot : agentInfo?.name || translations.chat.supportAgent} {translations.chat.typing}
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {showAgentConnect && <AgentConnectModal />}

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.3s ease-out; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d1d5db; }
      `}</style>
    </div>
  );
};

export default function HelpdeskPage() {
  const { language, changeLanguage } = useLocalization();
  const [expandedFaq, setExpandedFaq] = useState(null);
  const [faqItems, setFaqItems] = useState([]);
  const [faqLoading, setFaqLoading] = useState(true);
  const [faqError, setFaqError] = useState(null);
  const [articles, setArticles] = useState([]);
  const [articlesLoading, setArticlesLoading] = useState(true);
  const [articlesError, setArticlesError] = useState(null);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [showChatWidget, setShowChatWidget] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [triggerChatOpen, setTriggerChatOpen] = useState(false);
  const [ticketFormData, setTicketFormData] = useState({
    ticket_title: '',
    department: '',
    ticket_description: '',
    priority: 'medium',
    usernameOrEmail: ''
  });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const t = helpdeskTranslations[language] || helpdeskTranslations.en;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setTicketFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleTicketSubmit = async (e) => {
    e.preventDefault();
    setSubmitLoading(true);
    setSubmitError(null);

    try {
      const ticketData = {
        ticket_title: ticketFormData.ticket_title,
        department: ticketFormData.department,
        ticket_description: ticketFormData.ticket_description,
        usernameOrEmail: ticketFormData.usernameOrEmail,
        priority: ticketFormData.priority,
      };

      const response = await fetch(`${API_BASE_URL}/tickets/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ticketData)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      setSubmitSuccess(true);
      setTicketFormData({
        ticket_title: '',
        department: '',
        ticket_description: '',
        priority: 'medium',
        usernameOrEmail: ''
      });

      setTimeout(() => {
        setShowTicketModal(false);
        setSubmitSuccess(false);
      }, 2000);

    } catch (error) {
      console.error('Error submitting ticket:', error);
      setSubmitError('Failed to submit ticket. Please try again.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const closeModal = () => {
    setShowTicketModal(false);
    setSubmitError(null);
    setSubmitSuccess(false);
    setTicketFormData({
      ticket_title: '',
      department: '',
      ticket_description: '',
      priority: 'medium',
      usernameOrEmail: ''
    });
  };

  const handleStartChat = () => {
    setTriggerChatOpen(true);
    setChatKey(prev => prev + 1);
  };

  useEffect(() => {
    const fetchFaqs = async () => {
      try {
        setFaqLoading(true);
        const response = await fetch(`${API_BASE_URL}/faqs/?lang=${language}&organization_code=${encodeURIComponent(ORGANIZATION_CODE)}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        const visibleFaqs = data.data
          .filter(faq => faq.faq_status === 'visible')
          .map(faq => ({
            id: faq._id,
            question: faq.faq_title,
            answer: faq.faq_body,
            createdAt: faq.createdAt
          }));
        
        setFaqItems(visibleFaqs);
        setFaqError(null);
      } catch (error) {
        console.error('Error fetching FAQs:', error);
        setFaqError(t.faq.error);
        setFaqItems([]);
      } finally {
        setFaqLoading(false);
      }
    };

    const fetchArticles = async () => {
      try {
        setArticlesLoading(true);
        const response = await fetch(`${API_BASE_URL}/articles/?organization_code=${encodeURIComponent(ORGANIZATION_CODE)}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        const transformedArticles = data.map(article => ({
          id: article._id,
          code: article.article_code,
          title: article.article_title,
          category: article.article_category,
          author: article.author,
          contentUrl: article.article_content,
          createdAt: article.createdAt,
          updatedAt: article.updatedAt,
          readTime: 'Open article'
        }));
        
        setArticles(transformedArticles);
        setArticlesError(null);
      } catch (error) {
        console.error('Error fetching articles:', error);
        setArticlesError('Failed to load articles. Please try again later.');
        setArticles([]);
      } finally {
        setArticlesLoading(false);
      }
    };

    fetchFaqs();
    fetchArticles();
  }, [language, t]);

  const handleArticleClick = (articleCode) => {
    window.location.href = `/articles/${articleCode}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-emerald-50">
      <CustomerChatWidget key={chatKey} initialOpen={triggerChatOpen} translations={t} />

      <header className="bg-white shadow-sm border-b border-gray-200">
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div className="flex items-center justify-between h-20 sm:h-24 relative">

      {/* Back Button */}
      <button
        onClick={() => window.history.back()}
        className="p-2 sm:p-3 rounded-full bg-gray-100 hover:bg-gray-200 shadow transition-all duration-200"
        title={t.header.backButton}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 sm:h-6 sm:w-6 text-gray-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Centered Logo */}
      <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center justify-center">
        <img
          src="/helpdesk_logo.webp"
          alt="eBadgeId Logo"
          className="w-15 h-15 sm:w-15 sm:h-28 object-contain"
        />
      </div>

      {/* Language Selector */}
      <div className="flex-shrink-0">
        <LanguageSelector currentLanguage={language} onLanguageChange={changeLanguage} />
      </div>
    </div>
  </div>
</header>

      {showTicketModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">{t.ticketModal.title}</h2>
                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6">
              {submitSuccess ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{t.ticketModal.successTitle}</h3>
                  <p className="text-gray-600">{t.ticketModal.successMessage}</p>
                </div>
              ) : (
                <form onSubmit={handleTicketSubmit} className="space-y-6">
                  <div>
                    <label htmlFor="usernameOrEmail" className="block text-sm font-medium text-gray-700 mb-2">
                      {t.ticketModal.emailLabel} *
                    </label>
                    <input
                      type="email"
                      id="usernameOrEmail"
                      name="usernameOrEmail"
                      value={ticketFormData.usernameOrEmail}
                      onChange={handleInputChange}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      placeholder={t.ticketModal.emailPlaceholder}
                    />
                  </div>

                  <div>
                    <label htmlFor="ticket_title" className="block text-sm font-medium text-gray-700 mb-2">
                      {t.ticketModal.subjectLabel} *
                    </label>
                    <input
                      type="text"
                      id="ticket_title"
                      name="ticket_title"
                      value={ticketFormData.ticket_title}
                      onChange={handleInputChange}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      placeholder={t.ticketModal.subjectPlaceholder}
                    />
                  </div>

                  <div>
                    <label htmlFor="department" className="block text-sm font-medium text-gray-700 mb-2">
                      {t.ticketModal.departmentLabel}
                    </label>
                    <select
                      id="department"
                      name="department"
                      value={ticketFormData.department}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    >
                      <option value="">{t.ticketModal.departmentOptions.select}</option>
                      <option value="technical">{t.ticketModal.departmentOptions.technical}</option>
                      <option value="billing">{t.ticketModal.departmentOptions.billing}</option>
                      <option value="general">{t.ticketModal.departmentOptions.general}</option>
                      <option value="sales">{t.ticketModal.departmentOptions.sales}</option>
                      <option value="account">{t.ticketModal.departmentOptions.account}</option>
                     
                    </select>
                  </div>

                  <div>
                    <label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-2">
                      {t.ticketModal.priorityLabel} *
                    </label>
                    <select
                      id="priority"
                      name="priority"
                      value={ticketFormData.priority}
                      onChange={handleInputChange}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    >
                      <option value="low">{t.ticketModal.priorityOptions.low}</option>
                      <option value="medium">{t.ticketModal.priorityOptions.medium}</option>
                      <option value="high">{t.ticketModal.priorityOptions.high}</option>
                      <option value="urgent">{t.ticketModal.priorityOptions.urgent}</option>
                      <option value="critical">{t.ticketModal.priorityOptions.critical}</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="ticket_description" className="block text-sm font-medium text-gray-700 mb-2">
                      {t.ticketModal.descriptionLabel} *
                    </label>
                    <textarea
                      id="ticket_description"
                      name="ticket_description"
                      value={ticketFormData.ticket_description}
                      onChange={handleInputChange}
                      required
                      rows={6}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                      placeholder={t.ticketModal.descriptionPlaceholder}
                    />
                  </div>

                  {submitError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center">
                        <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                        <p className="text-red-700">{submitError}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4 pt-4">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="flex-1 px-6 py-3 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                    >
                      {t.ticketModal.cancelButton}
                    </button>
                    <button
                      type="submit"
                      disabled={submitLoading}
                      className="flex-1 px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                      {submitLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t.ticketModal.submittingButton}
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          {t.ticketModal.submitButton}
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="relative py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <div className="relative">
            <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
              {t.hero.title}
              <span className="block bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                {t.hero.titleHighlight}
              </span>
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
              {t.hero.subtitle}
            </p>
            
            <div className="max-w-2xl mx-auto mb-12">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder={t.hero.searchPlaceholder}
                  className="w-full pl-12 pr-4 py-4 text-lg border border-gray-300 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent shadow-lg"
                />
                <button className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-emerald-600 text-white px-6 py-2 rounded-xl hover:bg-emerald-700 transition-colors">
                  {t.hero.searchButton}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl transition-shadow border border-gray-100">
                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mb-4 mx-auto">
                  <MessageCircle className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t.hero.submitTicket.title}</h3>
                <p className="text-gray-600 mb-4">{t.hero.submitTicket.description}</p>
                <button 
                  onClick={() => setShowTicketModal(true)}
                  className="text-emerald-600 font-medium hover:text-emerald-700 transition-colors"
                >
                  {t.hero.submitTicket.action} →
                </button>
              </div>
              
              <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl transition-shadow border border-gray-100">
                <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center mb-4 mx-auto">
                  <Clock className="w-6 h-6 text-teal-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t.hero.trackProgress.title}</h3>
                <p className="text-gray-600 mb-4">{t.hero.trackProgress.description}</p>
                <Link href="/tracking">
                  <button className="text-teal-600 font-medium hover:text-teal-700 transition-colors">
                    {t.hero.trackProgress.action} →
                  </button>
                </Link>
              </div>
              
              <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl transition-shadow border border-gray-100">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4 mx-auto">
                  <Users className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{t.hero.liveChat.title}</h3>
                <p className="text-gray-600 mb-4">{t.hero.liveChat.description}</p>
                <button 
                  onClick={handleStartChat}
                  className="text-green-600 font-medium hover:text-green-700 transition-colors"
                >
                  {t.hero.liveChat.action} →
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">{t.faq.title}</h2>
            <p className="text-lg text-gray-600">{t.faq.subtitle}</p>
          </div>
          
          {faqLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
              <span className="ml-2 text-gray-600">{t.faq.loading}</span>
            </div>
          ) : faqError ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <p className="text-red-600 mb-4">{faqError}</p>
                <button 
                  onClick={() => window.location.reload()} 
                  className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  {t.faq.retry}
                </button>
              </div>
            </div>
          ) : faqItems.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-600">{t.faq.noFaqs}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {faqItems.map((item, index) => (
                <div key={item.id || index} className="border border-gray-200 rounded-xl overflow-hidden">
                  <button
                    className="w-full px-6 py-4 text-left flex justify-between items-center hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                  >
                    <span className="font-medium text-gray-900">{item.question}</span>
                    {expandedFaq === index ? (
                      <ChevronUp className="w-5 h-5 text-gray-500 flex-shrink-0 ml-4" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0 ml-4" />
                    )}
                  </button>
                  {expandedFaq === index && (
                    <div className="px-6 pb-4 text-gray-600 border-t border-gray-100 bg-gray-50">
                      <p className="pt-4">{item.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <footer className="bg-black text-gray-400 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent"></div>
        
        <div className="max-w-7xl mx-auto px-6">
          <div className="py-16">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
              
              <div className="md:col-span-5">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-20 h-20 flex items-center justify-center">
                    <img src="/helpdesk_logo.webp" alt="eBadgeId Logo" className="w-full h-full object-contain" />
                  </div>
                  <h3 className="text-2xl font-light tracking-wide text-white">
                    eBadge ID <span className="font-normal">Helpdesk</span>
                  </h3>
                </div>
                <p className="text-gray-500 leading-7 text-sm max-w-md">
                  {t.footer.description}
                </p>
              </div>

              <div className="md:col-span-3">
                <h4 className="text-white text-sm font-semibold uppercase tracking-wider mb-6 relative inline-block">
                  {t.footer.company}
                  <span className="absolute bottom-0 left-0 w-8 h-px bg-white"></span>
                </h4>
                <ul className="space-y-3">
                  <li>
                    <a href="/hiring" className="text-sm hover:text-white transition-colors duration-300 hover:translate-x-1 inline-block">
                      {t.footer.careers}
                    </a>
                  </li>
                  <li>
                    <a href="/status" className="text-sm hover:text-white transition-colors duration-300 hover:translate-x-1 inline-block">
                      {t.footer.systemStatus}
                    </a>
                  </li>
                </ul>
              </div>

{/* The "Connect" social block used to also have LinkedIn/Instagram/TikTok
    links pointing at the Soraroam company's real accounts (removed in an
    earlier audit round, see AUDIT_FIXES.md) — this Facebook link was the
    last one left, confirmed to be the same kind of foreign-brand residue,
    not an eBadge ID account. Removing it leaves nothing else in this
    section, so the whole block goes rather than an empty heading. */}

            </div>
          </div>

          <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent"></div>

          <div className="py-8">
            <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
              <p className="text-xs text-gray-600 tracking-wide">
                {t.footer.copyright}
              </p>
              <div className="flex items-center space-x-8">
                <a 
                  href="#" 
                  className="text-xs text-gray-600 hover:text-white transition-colors duration-300 tracking-wide"
                >
                  {t.footer.privacy}
                </a>
                <span className="text-gray-800">|</span>
                <a 
                  href="#" 
                  className="text-xs text-gray-600 hover:text-white transition-colors duration-300 tracking-wide"
                >
                  {t.footer.terms}
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
