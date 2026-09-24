"use client"
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Send, MoreVertical, Smile, Paperclip, Menu, X, MessageSquareX, UserX, BellOff, Star, Phone, User, Clock, CheckCircle, AlertCircle, Users, MessageSquare } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ORGANIZATION_CODE } from '@/lib/config';

const AgentMessengerApp = () => {
  const [selectedChat, setSelectedChat] = useState(0);
  const [message, setMessage] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const [agentInfo, setAgentInfo] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ emailOrUsername: '', password: '', organization_code: ORGANIZATION_CODE });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [agentStatus, setAgentStatus] = useState('available');
  const [activeChats, setActiveChats] = useState(0);
  const [pendingChats, setPendingChats] = useState([]);
  
  // Enhanced typing states
  const [typingStates, setTypingStates] = useState({}); // Track typing for each chat
  const [userTypingStates, setUserTypingStates] = useState({}); // Track when agent is typing
  const [typingTimers, setTypingTimers] = useState({}); // Debounce timers
  
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedChat, typingStates]);

  useEffect(() => {
    authenticateAgent();
  }, []);

  // Debounced typing indicator for agent
  const debouncedTyping = useCallback((sessionId, isTyping) => {
    // Clear existing timer for this session
    if (typingTimers[sessionId]) {
      clearTimeout(typingTimers[sessionId]);
    }

    if (isTyping) {
      // Update typing state immediately
      setUserTypingStates(prev => ({ ...prev, [sessionId]: true }));
      
      // Send typing indicator to customer
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'agent_typing',
          sessionId: sessionId,
          isTyping: true
        }));
      }

      // Set timer to stop typing after 1.5 seconds of inactivity
      const timer = setTimeout(() => {
        setUserTypingStates(prev => ({ ...prev, [sessionId]: false }));
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'agent_typing',
            sessionId: sessionId,
            isTyping: false
          }));
        }
      }, 1500);

      setTypingTimers(prev => ({ ...prev, [sessionId]: timer }));
    } else {
      // Immediate stop
      setUserTypingStates(prev => ({ ...prev, [sessionId]: false }));
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'agent_typing',
          sessionId: sessionId,
          isTyping: false
        }));
      }
    }
  }, [typingTimers]);

  const authenticateAgent = async () => {
    try {
      setIsLoading(true);
      const response = await apiFetch('/auth/profile', { redirectOnUnauthorized: false });

      if (response.ok) {
        const userData = await response.json();
        
        // Check if user is an agent
        if (userData.user_type !== 'agent') {
          throw new Error('Access denied. Agent privileges required.');
        }

        setAgentInfo(userData);
        setIsAuthenticated(true);
        setError('');
        
        // Initialize WebSocket connection for agent
        initializeAgentWebSocket();
        
        // Load agent's chat data
        await loadAgentChats();
        
      } else {
        throw new Error('Authentication failed');
      }
    } catch (error) {
      setError(error.message);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      setError('');

      const response = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm)
      });

      const data = await response.json();

      if (response.ok) {
        // Check if user is an agent
        if (data.user.user_type !== 'agent') {
          throw new Error('Access denied. This interface is for support agents only.');
        }

        setAgentInfo(data.user);
        setIsAuthenticated(true);
        
        // Initialize WebSocket connection for agent
        initializeAgentWebSocket();
        
        // Load agent's chat data
        await loadAgentChats();
        
      } else {
        throw new Error(data.message || 'Login failed');
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAgentChats = async () => {
    try {
      // Load active and pending chats for this agent
      const initialChats = [
        {
          id: 'pending-001',
          customerName: 'Waiting for Agent',
          lastMessage: 'Customer requesting live support...',
          time: 'Now',
          status: 'pending',
          priority: 'medium',
          sessionId: 'sess_001',
          isNew: true,
          customerInfo: {
            email: 'customer@email.com',
            previousMessages: 3
          }
        }
      ];
      
      setChats(initialChats);
      setPendingChats(initialChats.filter(chat => chat.status === 'pending'));
    } catch (error) {
      console.error('Error loading agent chats:', error);
    }
  };

  const initializeAgentWebSocket = () => {
    const wsUrl = process.env.NEXT_PUBLIC_HELPDESK_WS_URL || 'wss://hapi.ebadgeid.com';
    const ws = new WebSocket(`${wsUrl}?agent=true`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Agent WebSocket connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('Agent received:', data);
      
      switch (data.type) {
        case 'agent_connected':
          console.log('Agent connection confirmed');
          break;

        case 'customer_chat_request':
          handleNewChatRequest(data);
          break;
          
        case 'customer_message':
          handleCustomerMessage(data);
          break;

        case 'customer_typing':
          handleCustomerTyping(data.sessionId, data.isTyping, data.customerName);
          break;
          
        case 'customer_disconnected':
          handleCustomerDisconnect(data);
          break;
          
        case 'chat_accepted':
          console.log('Chat acceptance confirmed:', data);
          break;
          
        default:
          console.log('Unknown agent message type:', data.type);
      }
    };

    ws.onclose = () => {
      console.log('Agent WebSocket disconnected');
      setIsConnected(false);
      // Clear all typing states
      setTypingStates({});
      setUserTypingStates({});
    };

    ws.onerror = (error) => {
      console.error('Agent WebSocket error:', error);
      setIsConnected(false);
    };
  };

  const handleNewChatRequest = (data) => {
    const newChat = {
      id: data.sessionId,
      customerName: data.customerName || `Customer ${data.sessionId.slice(-4)}`,
      lastMessage: data.initialMessage || 'Customer requesting support',
      time: 'Now',
      status: 'pending',
      priority: data.priority || 'medium',
      sessionId: data.sessionId,
      isNew: true,
      customerInfo: data.customerInfo || {}
    };

    setChats(prev => [newChat, ...prev]);
    setPendingChats(prev => [newChat, ...prev]);
    
    // Initialize messages for this chat
    setMessages(prev => ({
      ...prev,
      [data.sessionId]: data.messageHistory || []
    }));
  };

  const handleCustomerMessage = (data) => {
    const newMessage = {
      id: Date.now(),
      sender: data.customerName || 'Customer',
      content: data.message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isOwn: false,
      type: 'customer'
    };
    
    setMessages(prev => ({
      ...prev,
      [data.sessionId]: [...(prev[data.sessionId] || []), newMessage]
    }));

    // Update chat list with latest message
    setChats(prev => prev.map(chat => 
      chat.sessionId === data.sessionId 
        ? { ...chat, lastMessage: data.message, time: 'Now', isNew: true }
        : chat
    ));

    // Clear customer typing indicator
    setTypingStates(prev => ({
      ...prev,
      [data.sessionId]: false
    }));
  };

  const handleCustomerTyping = (sessionId, isTyping, customerName) => {
    setTypingStates(prev => ({
      ...prev,
      [sessionId]: isTyping ? customerName : false
    }));
  };

  const handleCustomerDisconnect = (data) => {
    // Update chat status
    setChats(prev => prev.map(chat => 
      chat.sessionId === data.sessionId 
        ? { ...chat, status: 'ended', lastMessage: 'Customer disconnected' }
        : chat
    ));

    // Clear typing states
    setTypingStates(prev => ({ ...prev, [data.sessionId]: false }));
    setUserTypingStates(prev => ({ ...prev, [data.sessionId]: false }));
  };

  const acceptChatRequest = (chatId) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    // Send acceptance to WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'accept_chat',
        sessionId: chat.sessionId,
        agentId: agentInfo.id || agentInfo._id
      }));
    }

    // Update chat status
    setChats(prev => prev.map(c => 
      c.id === chatId 
        ? { ...c, status: 'active', isNew: false }
        : c
    ));

    // Remove from pending
    setPendingChats(prev => prev.filter(c => c.id !== chatId));
    
    // Update active chats count
    setActiveChats(prev => prev + 1);
    
    // Select this chat
    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex >= 0) setSelectedChat(chatIndex);
  };

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setMessage(newValue);
    
    const currentChat = chats[selectedChat];
    if (!currentChat) return;

    // Trigger typing indicator when agent starts typing
    if (newValue.length > 0 && !userTypingStates[currentChat.sessionId]) {
      debouncedTyping(currentChat.sessionId, true);
    } else if (newValue.length === 0 && userTypingStates[currentChat.sessionId]) {
      debouncedTyping(currentChat.sessionId, false);
    }
  };

  const sendMessage = () => {
    if (!message.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    const currentChat = chats[selectedChat];
    if (!currentChat) return;

    // Stop typing indicator immediately
    debouncedTyping(currentChat.sessionId, false);

    const newMessage = {
      id: Date.now(),
      sender: agentInfo.name,
      content: message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isOwn: true,
      type: 'agent'
    };
    
    setMessages(prev => ({
      ...prev,
      [currentChat.sessionId]: [...(prev[currentChat.sessionId] || []), newMessage]
    }));

    // Send to customer via WebSocket
    wsRef.current.send(JSON.stringify({
      type: 'agent_message',
      sessionId: currentChat.sessionId,
      message: message,
      agentName: agentInfo.name
    }));
    
    setMessage('');
    
    // Update chat list
    setChats(prev => prev.map(chat => 
      chat.sessionId === currentChat.sessionId
        ? { ...chat, lastMessage: `You: ${message}`, time: 'Now' }
        : chat
    ));
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const logout = async () => {
    // Clear all timers
    Object.values(typingTimers).forEach(clearTimeout);
    
    await apiFetch('/auth/logout', { method: 'POST', redirectOnUnauthorized: false });
    if (wsRef.current) {
      wsRef.current.close();
    }
    setIsAuthenticated(false);
    setAgentInfo(null);
    setChats([]);
    setMessages({});
    setTypingStates({});
    setUserTypingStates({});
    setTypingTimers({});
  };

  const updateAgentStatus = (newStatus) => {
    setAgentStatus(newStatus);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'agent_status_update',
        status: newStatus
      }));
    }
  };

  // Typing indicator component
  const TypingIndicator = ({ customerName }) => (
    <div className="flex justify-start">
      <div className="bg-gray-100 text-gray-800 px-4 py-2 rounded-2xl">
        <div className="flex items-center space-x-2">
          <div className="text-xs font-medium opacity-75">
            {customerName} is typing
          </div>
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
          </div>
        </div>
      </div>
    </div>
  );

  // Login Form Component
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              Agent Portal Login
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              Sign in to access the support dashboard
            </p>
          </div>
          <form className="mt-8 space-y-6" onSubmit={handleLogin}>
            <div className="space-y-4">
              <div>
                <label htmlFor="emailOrUsername" className="block text-sm font-medium text-gray-700">
                  Email or Username
                </label>
                <input
                  id="emailOrUsername"
                  name="emailOrUsername"
                  type="text"
                  required
                  value={loginForm.emailOrUsername}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, emailOrUsername: e.target.value }))}
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter email or username"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter password"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">
                      Authentication Error
                    </h3>
                    <div className="mt-2 text-sm text-red-700">
                      {error}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400"
              >
                {isLoading ? 'Signing in...' : 'Sign in as Agent'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const currentChat = chats[selectedChat];
  const currentMessages = currentChat ? messages[currentChat.sessionId] || [] : [];
  const isCustomerTyping = currentChat ? typingStates[currentChat.sessionId] : false;
  const isAgentTyping = currentChat ? userTypingStates[currentChat.sessionId] : false;

  return (
    <div className="flex h-screen bg-background relative">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed lg:relative lg:translate-x-0 z-50 lg:z-auto
        w-80 sm:w-96 lg:w-80 xl:w-96
        h-full border-r border-border flex flex-col bg-background
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Agent Header */}
        <div className="p-3 sm:p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-semibold">Support Dashboard</h1>
              <p className="text-sm text-gray-600">Agent: {agentInfo?.name}</p>
            </div>
            <button
              className="lg:hidden p-1 hover:bg-gray-100 rounded"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          
          {/* Agent Status */}
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-2 h-2 rounded-full ${
              isConnected 
                ? agentStatus === 'available' ? 'bg-green-500' : 'bg-yellow-500'
                : 'bg-red-500'
            }`}></div>
            <select
              value={agentStatus}
              onChange={(e) => updateAgentStatus(e.target.value)}
              className="text-sm border rounded px-2 py-1"
            >
              <option value="available">Available</option>
              <option value="busy">Busy</option>
              <option value="away">Away</option>
            </select>
            <button
              onClick={logout}
              className="ml-auto text-sm text-red-600 hover:text-red-800"
            >
              Logout
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-blue-50 p-2 rounded text-center">
              <div className="text-lg font-semibold">{activeChats}</div>
              <div className="text-xs text-gray-600">Active</div>
            </div>
            <div className="bg-orange-50 p-2 rounded text-center">
              <div className="text-lg font-semibold">{pendingChats.length}</div>
              <div className="text-xs text-gray-600">Pending</div>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <input
              placeholder="Search conversations..."
              className="w-full pl-10 pr-3 py-2 border border-gray-200 rounded-md text-sm"
            />
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-1 sm:p-2">
            {chats.map((chat, index) => (
              <div
                key={chat.id}
                className={`flex items-center p-2 sm:p-3 rounded-lg cursor-pointer hover:bg-accent transition-colors relative ${
                  selectedChat === index ? 'bg-accent' : ''
                }`}
              >
                {/* Priority Indicator */}
                <div className={`w-1 h-12 rounded mr-2 ${
                  chat.priority === 'high' ? 'bg-red-400' :
                  chat.priority === 'medium' ? 'bg-yellow-400' : 'bg-green-400'
                }`}></div>

                <div 
                  className="flex-1 flex items-center"
                  onClick={() => {
                    setSelectedChat(index);
                    setSidebarOpen(false);
                  }}
                >
                  <div className="relative flex-shrink-0">
                    <div className="h-10 w-10 sm:h-12 sm:w-12 bg-blue-100 rounded-full flex items-center justify-center">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                      chat.status === 'active' ? 'bg-green-500' :
                      chat.status === 'pending' ? 'bg-orange-500' : 'bg-gray-400'
                    }`}></div>
                  </div>
                  <div className="ml-3 flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium truncate pr-2 flex items-center gap-1">
                        {chat.customerName}
                        {chat.isNew && <div className="w-2 h-2 bg-red-500 rounded-full"></div>}
                        {typingStates[chat.sessionId] && (
                          <div className="flex items-center gap-1 text-xs text-blue-600">
                            <div className="w-1 h-1 bg-blue-600 rounded-full animate-pulse"></div>
                            typing
                          </div>
                        )}
                      </p>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{chat.time}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground truncate pr-2">{chat.lastMessage}</p>
                      <div className="flex items-center gap-1">
                        {chat.status === 'pending' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              acceptChatRequest(chat.id);
                            }}
                            className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                          >
                            Accept
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {chats.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No active conversations</p>
                <p className="text-sm">Waiting for customer requests...</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col lg:ml-0">
        {/* Chat Header */}
        {currentChat ? (
          <div className="p-3 sm:p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center">
              <button
                className="lg:hidden mr-2 p-1 hover:bg-gray-100 rounded"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="relative flex-shrink-0">
                <div className="h-10 w-10 sm:h-12 sm:w-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-blue-600" />
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                  currentChat.status === 'active' ? 'bg-green-500' :
                  currentChat.status === 'pending' ? 'bg-orange-500' : 'bg-gray-400'
                }`}></div>
              </div>
              <div className="ml-3 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-sm sm:text-base truncate">{currentChat.customerName}</h2>
                  {isCustomerTyping && (
                    <div className="flex items-center gap-1 text-xs text-blue-600">
                      <div className="w-1 h-1 bg-blue-600 rounded-full animate-pulse"></div>
                      typing...
                    </div>
                  )}
                  {isAgentTyping && (
                    <div className="flex items-center gap-1 text-xs text-green-600">
                      <div className="w-1 h-1 bg-green-600 rounded-full animate-pulse"></div>
                      you're typing...
                    </div>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {currentChat.status === 'pending' ? 'Awaiting response' :
                   currentChat.status === 'active' ? 'Active conversation' : 'Ended'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-500">
                Priority: {currentChat.priority}
              </div>
              <button className="p-1 hover:bg-gray-100 rounded">
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3 sm:p-4 border-b border-border flex items-center">
            <button
              className="lg:hidden mr-2 p-1 hover:bg-gray-100 rounded"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </button>
            <h2 className="font-medium">Select a conversation</h2>
          </div>
        )}

        {/* Messages */}
        {currentChat ? (
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            <div className="space-y-3 sm:space-y-4">
              {currentMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.isOwn ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] sm:max-w-xs lg:max-w-md px-3 sm:px-4 py-2 rounded-2xl ${
                      msg.isOwn
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {!msg.isOwn && (
                      <p className="text-xs font-medium mb-1 opacity-75">{msg.sender}</p>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-xs mt-1 opacity-70">
                      {msg.time}
                    </p>
                  </div>
                </div>
              ))}
              
              {/* Customer Typing Indicator */}
              {isCustomerTyping && (
                <TypingIndicator customerName={isCustomerTyping} />
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Users className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">Welcome to Support Dashboard</h3>
              <p>Select a conversation to start helping customers</p>
            </div>
          </div>
        )}

        {/* Message Input */}
        {currentChat && currentChat.status === 'active' && (
          <div className="p-3 sm:p-4 border-t border-border">
            <div className="flex items-center space-x-2">
              <button className="hidden sm:flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center hover:bg-gray-100 rounded-md">
                <Paperclip className="h-4 w-4" />
              </button>
              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  placeholder="Type your response..."
                  value={message}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  className="w-full pr-10 sm:pr-12 py-2 px-3 border border-gray-200 rounded-md text-sm"
                />
                <button className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 flex items-center justify-center hover:bg-gray-100 rounded">
                  <Smile className="h-4 w-4" />
                </button>
              </div>
              <button 
                onClick={sendMessage} 
                disabled={!message.trim() || !isConnected}
                className="h-8 w-8 sm:h-10 sm:w-10 bg-blue-500 text-white rounded-md flex items-center justify-center disabled:bg-gray-300"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            
            {/* Typing Status */}
            <div className="mt-1 text-xs text-gray-500 flex items-center justify-between">
              <span>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
              {isCustomerTyping && (
                <span className="text-blue-600 flex items-center gap-1">
                  <div className="w-1 h-1 bg-blue-600 rounded-full animate-pulse"></div>
                  {isCustomerTyping} is typing...
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentMessengerApp;
