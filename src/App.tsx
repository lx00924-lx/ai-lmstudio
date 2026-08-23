/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useRef } from 'react';

import { MessageList } from './components/Chat/MessageList';
import { ChatInput } from './components/Chat/ChatInput';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { DeleteHistoryDialog } from './components/Chat/DeleteHistoryDialog';
import { UpdateDialog } from './components/Chat/UpdateDialog';
import { AuthScreen } from './components/Auth/AuthScreen';
import { CallOverlay } from './components/Chat/CallOverlay';
import { LogViewerModal, DebugFloatButton } from './components/Debug/LogViewerModal';
import { Message, ChatState, AppSettings } from './types';
import { sendMessageToGemini, transcribeAudio } from './services/gemini';
import socket from './lib/socket';
import { API_BASE_URL } from './config';
import { Sparkles, Settings, Sun, Moon, PanelLeft, Search, Trash2, X, Download, Upload, Calendar, Image, ChevronUp, ChevronDown, Filter, Eye, EyeOff, LogOut, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from './components/ui/input';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { safeSaveToLocalStorage } from './lib/utils';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { Clipboard } from '@capacitor/clipboard';
import { Toast } from '@capacitor/toast';

// Synchronous theme initialization to prevent flash
const getInitialTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    const savedTheme = localStorage.getItem('app_theme');
    if (savedTheme) {
      try {
        const parsed = JSON.parse(savedTheme);
        return (parsed === 'light' || parsed === 'dark') ? parsed : 'dark';
      } catch (e) {
        return (savedTheme === 'light' || savedTheme === 'dark') ? savedTheme : 'dark';
      }
    }
  }
  return 'dark';
};

const initialTheme = getInitialTheme();

if (typeof document !== 'undefined') {
  if (initialTheme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

const DEFAULT_SETTINGS: AppSettings = {
  userName: '用户',
  userAvatar: '',
  aiName: 'Aether-X',
  aiAvatar: '',
  apiKey: '',
  apiEndpoint: '',
  modelName: '',
  availableModels: [],
  githubOwner: 'LX00924-LX',
  githubRepo: 'ai-lmstudio',
  showSplashScreen: true,
  splashText: 'Aether-X',
  splashImage: '',
  splashSubtitle: 'Loading AI Experience',
  splashDuration: 1000,
  backgroundOpacity: 100,
  showBackgroundInDarkMode: true,
  showDebugFloatButton: true,
  chatFontSize: 'base',
};

// Storage key helpers for local-first persistence
const getMessageStorageKey = (userId?: string | null) => {
  return userId && userId !== 'guest' ? `chat_messages_${userId}` : 'guest_messages';
};

const getSettingsStorageKey = (userId?: string | null) => {
  return userId && userId !== 'guest' ? `gemini_settings_${userId}` : 'gemini_settings';
};

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDeleteHistoryOpen, setIsDeleteHistoryOpen] = useState(false);
  const [isCallOpen, setIsCallOpen] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [agentOnline, setAgentOnline] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [isImageFilter, setIsImageFilter] = useState(false);
  const [searchMatchIndex, setSearchMatchIndex] = useState(-1);
  const [hideNonMatches, setHideNonMatches] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [user, setUser] = useState<{ id: string; username: string } | null>(() => {
    try {
      const saved = localStorage.getItem('app_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.warn('Failed to parse app_user from localStorage', e);
      return null;
    }
  });

  const [state, setState] = useState<ChatState>(() => {
    try {
      let parsedUser: { id?: string; username?: string } | null = null;
      try {
        const savedUser = localStorage.getItem('app_user');
        parsedUser = savedUser ? JSON.parse(savedUser) : null;
      } catch (_) {
        parsedUser = null;
      }
      const storageKey = getMessageStorageKey(parsedUser?.id);
      
      // 优先读取当前用户的本地离线消息，若无则回退检查 guest_messages
      let rawMessages: string | null = null;
      try {
        rawMessages = localStorage.getItem(storageKey);
        if (!rawMessages && parsedUser?.id && parsedUser.id !== 'guest') {
          rawMessages = localStorage.getItem('guest_messages');
        }
      } catch (_) {
        rawMessages = null;
      }
      
      let messages: Message[] = [];
      if (rawMessages) {
        try {
          const parsed = JSON.parse(rawMessages);
          if (Array.isArray(parsed)) {
            messages = parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp || Date.now()) }));
          }
        } catch (e) {
          console.warn('Failed to parse initial messages from localStorage', e);
        }
      }
      
      // 加载当前用户或全局设置
      const settingsKey = getSettingsStorageKey(parsedUser?.id);
      let savedSettings: string | null = null;
      try {
        savedSettings = localStorage.getItem(settingsKey) || localStorage.getItem('gemini_settings');
      } catch (_) {
        savedSettings = null;
      }
      
      let settings = DEFAULT_SETTINGS;
      if (savedSettings) {
        try {
          const parsedSettings = JSON.parse(savedSettings);
          if (parsedSettings && typeof parsedSettings === 'object') {
            settings = { ...DEFAULT_SETTINGS, ...parsedSettings };
          }
        } catch (e) {
          console.warn('Failed to parse settings from localStorage', e);
        }
      }

      return {
        messages,
        isLoading: false,
        error: null,
        settings
      };
    } catch (err) {
      console.error('Error initializing state in App.tsx:', err);
      return {
        messages: [],
        isLoading: false,
        error: null,
        settings: DEFAULT_SETTINGS
      };
    }
  });

  // Handle Login
  const handleLogin = async (userData: { id: string; username: string }) => {
    setUser(userData);
    try { localStorage.setItem('app_user', JSON.stringify(userData)); } catch (_) {}
    try { socket.emit("join_user_room", userData.id); } catch (_) {}

    // 1. 读取当前用户本地已有的记录，若为空则将游客记录迁移过来
    const userKey = getMessageStorageKey(userData.id);
    let userLocalRaw = localStorage.getItem(userKey);
    const guestMessages = localStorage.getItem('guest_messages');

    if (!userLocalRaw && guestMessages && userData.id !== 'guest') {
      userLocalRaw = guestMessages;
      try {
        localStorage.setItem(userKey, guestMessages);
        localStorage.removeItem('guest_messages');
      } catch (_) {}
    }

    if (userLocalRaw) {
      try {
        const parsed = JSON.parse(userLocalRaw);
        if (Array.isArray(parsed)) {
          const messages = parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp || Date.now()) }));
          setState(prev => ({ ...prev, messages }));
        }
      } catch (e) {
        console.error('Failed to parse local user messages:', e);
      }
    }

    // 2. 若有未同步的消息，尝试异步上报给后台
    if (guestMessages && userData.id !== 'guest') {
      try {
        const messagesToSync = JSON.parse(guestMessages);
        await fetch(`${API_BASE_URL}/api/sync-messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userData.id, messages: messagesToSync })
        });
        try { localStorage.removeItem('guest_messages'); } catch (_) {}
        console.log('Guest messages synced.');
      } catch (err) {
        console.warn('Backend offline, guest messages retained in user local store:', err);
      }
    }

    // 3. 同步设置
    const guestSettings = localStorage.getItem('gemini_settings');
    if (guestSettings && userData.id !== 'guest') {
      try {
        const settingsToSync = JSON.parse(guestSettings);
        socket.emit("update_settings", { userId: userData.id, settings: settingsToSync });
      } catch (err) {
        console.warn('Failed to sync guest settings:', err);
      }
    }
  };

  const handleLogout = () => {
    setUser(null);
    try { localStorage.removeItem('app_user'); } catch (_) {}
    const guestRaw = localStorage.getItem('guest_messages');
    let guestMessages: Message[] = [];
    if (guestRaw) {
      try {
        const parsed = JSON.parse(guestRaw);
        if (Array.isArray(parsed)) {
          guestMessages = parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp || Date.now()) }));
        }
      } catch (_) {}
    }
    const guestSettingsRaw = localStorage.getItem('gemini_settings');
    let guestSettings = DEFAULT_SETTINGS;
    if (guestSettingsRaw) {
      try {
        const parsed = JSON.parse(guestSettingsRaw);
        if (parsed && typeof parsed === 'object') {
          guestSettings = { ...DEFAULT_SETTINGS, ...parsed };
        }
      } catch (_) {}
    }
    
    setState(prev => ({ ...prev, messages: guestMessages, settings: guestSettings }));
    setIsSidebarOpen(false);
  };

  // Local-First + Server Auto-Sync
  useEffect(() => {
    if (!user || user.id === 'guest') return;

    const syncWithServer = async () => {
      try {
        try { socket.emit("join_user_room", user.id); } catch (_) {}

        const [msgRes, settingsRes] = await Promise.allSettled([
          fetch(`${API_BASE_URL}/api/messages/${user.id}`).then(r => r.ok ? r.json() : Promise.reject('Failed to fetch messages')),
          fetch(`${API_BASE_URL}/api/settings/${user.id}`).then(r => r.ok ? r.json() : Promise.reject('Failed to fetch settings'))
        ]);

        if (settingsRes.status === 'fulfilled' && settingsRes.value && typeof settingsRes.value === 'object' && !settingsRes.value.error) {
          setState(prev => ({
            ...prev,
            settings: { ...DEFAULT_SETTINGS, ...(prev.settings || {}), ...settingsRes.value }
          }));
        }

        if (msgRes.status === 'fulfilled' && Array.isArray(msgRes.value)) {
          const serverMessages: any[] = msgRes.value;
          
          setState(prev => {
            const currentLocal = Array.isArray(prev.messages) ? prev.messages : [];
            const messageMap = new Map<string, Message>();
            
            // 1. 放入服务端消息
            serverMessages.forEach(m => {
              if (m && m.id) {
                messageMap.set(m.id, { ...m, timestamp: new Date(m.timestamp || Date.now()) });
              }
            });
            
            // 2. 检查本地未同步至服务端的消息（离线期间创建的）
            const unsyncedMessages: Message[] = [];
            currentLocal.forEach(m => {
              if (m && m.id && !messageMap.has(m.id)) {
                unsyncedMessages.push(m);
                messageMap.set(m.id, m);
              }
            });
            
            // 3. 若有未同步的消息，自动提交给服务端保存
            if (unsyncedMessages.length > 0) {
              fetch(`${API_BASE_URL}/api/sync-messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, messages: unsyncedMessages })
              }).then(() => {
                console.log(`[Auto-Sync] Synced ${unsyncedMessages.length} offline messages to server.`);
              }).catch(e => console.warn('[Auto-Sync] Server sync queued:', e));
            }

            const merged = Array.from(messageMap.values()).sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );

            const hasGenerating = merged.some(m => m.status === 'generating');

            return {
              ...prev,
              isLoading: hasGenerating ? true : false,
              messages: merged
            };
          });
        }
      } catch (err) {
        console.warn("Backend server not running or network error, keeping local messages intact:", err);
      }
    };

    syncWithServer();

    const handleConnect = () => {
      console.log("Socket connected/reconnected, triggering auto-sync with server...");
      syncWithServer();
    };

    socket.on("connect", handleConnect);

    socket.on("receive_message", (message: Message) => {
      if (!message || !message.id) return;
      setState(prev => {
        const msgs = Array.isArray(prev.messages) ? prev.messages : [];
        if (msgs.find(m => m.id === message.id)) return prev;
        return {
          ...prev,
          messages: [...msgs, { ...message, timestamp: new Date(message.timestamp || Date.now()) }]
        };
      });
    });

    socket.on("chat_chunk", (data: { messageId: string; chunk: string; fullContent: string }) => {
      if (!data || !data.messageId) return;
      setState(prev => {
        const msgs = Array.isArray(prev.messages) ? prev.messages : [];
        const exists = msgs.some(m => m.id === data.messageId);
        if (!exists) {
          return {
            ...prev,
            isLoading: true,
            messages: [
              ...msgs,
              {
                id: data.messageId,
                role: 'assistant',
                content: data.fullContent || '',
                timestamp: new Date(),
                type: 'text',
                status: 'generating'
              }
            ]
          };
        }
        return {
          ...prev,
          isLoading: true,
          messages: msgs.map(msg => 
            msg.id === data.messageId 
              ? { ...msg, content: data.fullContent || '', status: 'generating' } 
              : msg
          )
        };
      });
    });

    socket.on("chat_completed", (data: { messageId: string; content: string }) => {
      if (!data || !data.messageId) return;
      setState(prev => {
        const msgs = Array.isArray(prev.messages) ? prev.messages : [];
        return {
          ...prev,
          isLoading: false,
          messages: msgs.map(msg => 
            msg.id === data.messageId 
              ? { ...msg, content: data.content || '', status: 'completed' } 
              : msg
          )
        };
      });
    });

    socket.on("chat_error", (data: { messageId: string; error: string }) => {
      if (!data || !data.messageId) return;
      setState(prev => {
        const msgs = Array.isArray(prev.messages) ? prev.messages : [];
        return {
          ...prev,
          isLoading: false,
          error: data.error || "生成失败",
          messages: msgs.map(msg => 
            msg.id === data.messageId 
              ? { ...msg, status: 'error', content: msg.content || `[生成失败: ${data.error}]` } 
              : msg
          )
        };
      });
    });

    socket.on("message_deleted", (messageId: string) => {
      if (!messageId) return;
      setState(prev => {
        const msgs = Array.isArray(prev.messages) ? prev.messages : [];
        return {
          ...prev,
          messages: msgs.filter(m => m.id !== messageId)
        };
      });
    });

    socket.on("messages_updated", (newMessages: Message[]) => {
      if (!Array.isArray(newMessages)) return;
      setState(prev => ({
        ...prev,
        messages: newMessages.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp || Date.now())
        }))
      }));
    });

    socket.on("settings_updated", (newSettings: AppSettings) => {
      if (!newSettings || typeof newSettings !== 'object') return;
      setState(prev => ({ ...prev, settings: { ...DEFAULT_SETTINGS, ...(prev.settings || {}), ...newSettings } }));
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("receive_message");
      socket.off("chat_chunk");
      socket.off("chat_completed");
      socket.off("chat_error");
      socket.off("message_deleted");
      socket.off("messages_updated");
      socket.off("settings_updated");
    };
  }, [user]);

  // DeepSeek Harness Agent Status & Execution Live Tracker
  useEffect(() => {
    const token = (state.settings.agentToken || 'default_agent_token').trim();
    
    // Initial fetch
    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/agent/status?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const data = await res.json();
          setAgentOnline(!!data.online);
        } else {
          setAgentOnline(false);
        }
      } catch (_) {
        setAgentOnline(false);
      }
    };
    checkStatus();

    const handleAgentStatusChange = (data: { token: string; online: boolean }) => {
      if (data && data.token === token) {
        setAgentOnline(data.online);
      }
    };

    const handleAgentTaskStarted = (data: { taskId: string; messageId: string; prompt: string }) => {
      if (!data || !data.messageId) return;
      setState(prev => {
        const msgs = Array.isArray(prev.messages) ? prev.messages : [];
        return {
          ...prev,
          messages: msgs.map(msg => 
            msg.id === data.messageId
              ? {
                  ...msg,
                  isAgentMode: true,
                  agentExecution: {
                    taskId: data.taskId,
                    status: 'running',
                    steps: ['正在派发任务至本地 DeepSeek Agent...']
                  }
                }
              : msg
          )
        };
      });
    };

    const handleAgentTaskStep = (data: { taskId: string; messageId: string; step: string }) => {
      if (!data || !data.messageId) return;
      setState(prev => {
        const msgs = Array.isArray(prev.messages) ? prev.messages : [];
        return {
          ...prev,
          messages: msgs.map(msg => 
            msg.id === data.messageId
              ? {
                  ...msg,
                  agentExecution: {
                    ...(msg.agentExecution || { taskId: data.taskId, status: 'running', steps: [] }),
                    steps: [...(msg.agentExecution?.steps || []), data.step]
                  }
                }
              : msg
          )
        };
      });
    };

    const handleAgentTaskFinished = (data: { taskId: string; messageId: string; success: boolean; result?: string; error?: string }) => {
      if (!data || !data.messageId) return;
      setState(prev => {
        const msgs = Array.isArray(prev.messages) ? prev.messages : [];
        return {
          ...prev,
          messages: msgs.map(msg => 
            msg.id === data.messageId
              ? {
                  ...msg,
                  agentExecution: {
                    ...(msg.agentExecution || { taskId: data.taskId, steps: [] }),
                    status: data.success ? 'completed' : 'failed',
                    rawOutput: data.result || data.error,
                    steps: [
                      ...(msg.agentExecution?.steps || []),
                      data.success ? '本地 Agent 执行完毕，正在由模型总结思考回答...' : `Agent 执行失败: ${data.error || '未知错误'}`
                    ]
                  }
                }
              : msg
          )
        };
      });
    };

    socket.on("agent_status_change", handleAgentStatusChange);
    socket.on("agent_task_started", handleAgentTaskStarted);
    socket.on("agent_task_step", handleAgentTaskStep);
    socket.on("agent_task_finished", handleAgentTaskFinished);

    return () => {
      socket.off("agent_status_change", handleAgentStatusChange);
      socket.off("agent_task_started", handleAgentTaskStarted);
      socket.off("agent_task_step", handleAgentTaskStep);
      socket.off("agent_task_finished", handleAgentTaskFinished);
    };
  }, [state.settings.agentToken]);

  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    body: string;
    url: string;
    downloadUrl?: string;
    targetFileName?: string;
    platformType: 'windows' | 'android' | 'web';
  } | null>(null);

  // 监听 Electron 客户端下载进度
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.onDownloadProgress) {
      const cleanup = (window as any).electronAPI.onDownloadProgress((data: { progress: number }) => {
        setUpdateProgress(data.progress || 0);
      });
      return () => {
        if (typeof cleanup === 'function') cleanup();
      };
    }
  }, []);


  // Wake Lock implementation
  useEffect(() => {
    async function loadFallbackData() {
      if (typeof window !== 'undefined' && 'Capacitor' in window) {
        try {
          const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
          
          // Try loading chat history
          try {
            const chatResult = await Filesystem.readFile({
              path: 'data/chat_history.json',
              directory: Directory.Data,
              encoding: Encoding.UTF8,
            });
            if (chatResult.data) {
              const messages = JSON.parse(chatResult.data as string).map((m: any) => ({
                ...m,
                timestamp: new Date(m.timestamp)
              }));
              setState(prev => {
                if (prev.messages.length === 0) {
                  console.log('Loaded chat history from filesystem.');
                  return { ...prev, messages };
                }
                return prev;
              });
            }
          } catch (e) {
            console.log('No chat history found on filesystem.');
          }

          // Try loading settings
          try {
            const settingsResult = await Filesystem.readFile({
              path: 'data/gemini_settings.json',
              directory: Directory.Data,
              encoding: Encoding.UTF8,
            });
            if (settingsResult.data) {
              const settings = JSON.parse(settingsResult.data as string);
              setState(prev => {
                // Only overwrite if it looks like default settings
                if (prev.settings.apiKey === '' && prev.settings.userName === '用户') {
                  console.log('Loaded settings from filesystem.');
                  return { ...prev, settings: { ...DEFAULT_SETTINGS, ...settings } };
                }
                return prev;
              });
            }
          } catch (e) {
            console.log('No settings found on filesystem.');
          }
        } catch (fsErr) {
          console.error('Filesystem load error:', fsErr);
        }
      }
    }
    loadFallbackData();
    
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          console.log('Wake Lock active');
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'NotAllowedError') {
          console.warn('Wake Lock disallowed by policy, skipping.');
        } else {
          console.error('Wake Lock request failed:', err);
        }
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().then(() => console.log('Wake Lock released'));
      }
    };
  }, []);

  useEffect(() => {
    if (state.settings.showSplashScreen && showSplash) {
      const timer = setTimeout(() => {
        setShowSplash(false);
      }, state.settings.splashDuration || 2000);
      return () => clearTimeout(timer);
    } else {
      setShowSplash(false);
    }
  }, [state.settings.showSplashScreen, state.settings.splashDuration, showSplash]);

  // Notification implementation
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } catch (_) {}
  }, []);

  // 监听 URL 扫码快速配对参数 (?agentToken=xxx 或 ?token=xxx)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location) {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const tokenFromUrl = urlParams.get('agentToken') || urlParams.get('token');
        if (tokenFromUrl && tokenFromUrl.trim()) {
          const clean = tokenFromUrl.trim();
          setState(prev => {
            const nextSettings = { ...prev.settings, agentToken: clean, agentMode: true };
            safeSaveToLocalStorage('gemini_settings', nextSettings);
            return { ...prev, settings: nextSettings };
          });
          try { Toast.show({ text: `🎉 扫码成功！已连接本地电脑 Agent` }); } catch (_) {}
          
          // 清理浏览器地址栏上的查询参数
          try {
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
          } catch (_) {}
        }
      } catch (e) {
        console.warn('Failed to parse URL query params:', e);
      }
    }
  }, []);

  // 持续将消息写入本地存储，确保离线或重启永不丢失
  useEffect(() => {
    const key = getMessageStorageKey(user?.id);
    safeSaveToLocalStorage(key, state.messages);
  }, [state.messages, user?.id]);

  useEffect(() => {
    // Trigger notification when loading finishes and app is in background
    if (!state.isLoading && document.visibilityState === 'hidden') {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content) {
        new Notification(state.settings.aiName, {
          body: lastMessage.content.substring(0, 50) + (lastMessage.content.length > 50 ? '...' : ''),
        });
      }
    }
  }, [state.isLoading, state.messages, state.settings.aiName]);

  // 持续将设置写入本地存储
  useEffect(() => {
    const key = getSettingsStorageKey(user?.id);
    safeSaveToLocalStorage(key, state.settings);
    safeSaveToLocalStorage('gemini_settings', state.settings);
  }, [state.settings, user?.id]);

  useEffect(() => {
    safeSaveToLocalStorage('app_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Clear selection when search is disabled
  useEffect(() => {
    if (!isSearching) {
      setIsSelectionMode(false);
      setSelectedMessageIds([]);
    }
  }, [isSearching]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
    setIsSidebarOpen(false);
    setIsSearching(false);
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setState(prev => ({ ...prev, settings: newSettings }));
    if (user) {
      socket.emit("update_settings", { userId: user.id, settings: newSettings });
    }
    setIsSidebarOpen(false);
  };

  const clearChat = () => {
    setIsDeleteHistoryOpen(true);
  };

  const deleteMessagesByRange = (days: number | 'all') => {
    if (user) {
      socket.emit("delete_messages_range", { userId: user.id, range: days });
    }
    
    setState(prev => {
      // The first message is effectively the welcome message if it exists
      const firstMessage = prev.messages[0];
      
      if (days === 'all') {
        return {
          ...prev,
          messages: firstMessage?.role === 'assistant' ? [firstMessage] : []
        };
      }

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      cutoff.setHours(0, 0, 0, 0);

      const filtered = prev.messages.filter((m, index) => {
        if (index === 0 && m.role === 'assistant') return true;
        return new Date(m.timestamp) >= cutoff; // Keeps messages within the range
      });

      return {
        ...prev,
        messages: filtered
      };
    });
    setIsSidebarOpen(false);
  };

  const handleToggleMessageSelection = (id: string) => {
    setSelectedMessageIds(prev => {
      if (prev.includes(id)) {
        const next = prev.filter(mid => mid !== id);
        if (next.length === 0) setIsSelectionMode(false);
        return next;
      }
      return [...prev, id];
    });
  };

  const handleEnterSelectionMode = (id: string) => {
    setIsSelectionMode(true);
    setSelectedMessageIds([id]);
  };

  const handleDeleteSelected = () => {
    setState(prev => ({
      ...prev,
      messages: prev.messages.filter(m => !selectedMessageIds.includes(m.id))
    }));
    setSelectedMessageIds([]);
    setIsSelectionMode(false);
  };

  const handleDeleteMessage = (id: string) => {
    setState(prev => ({
      ...prev,
      messages: prev.messages.filter(m => m.id !== id)
    }));
    if (user) {
      socket.emit("delete_message", { userId: user.id, messageId: id });
    }
  };

  const handleCopySelected = async () => {
    const content = state.messages
      .filter(m => selectedMessageIds.includes(m.id))
      .map(m => `[${m.role === 'user' ? state.settings.userName : state.settings.aiName}]: ${m.content}`)
      .join('\n\n');
    
    await Clipboard.write({
      string: content
    });
    
    await Toast.show({ text: '已复制到剪贴板' });
    setSelectedMessageIds([]);
    setIsSelectionMode(false);
  };

  const handleExportChat = async () => {
    try {
      const data = JSON.stringify(state.messages, null, 2);
      const fileName = `chat_history_${new Date().toISOString().split('T')[0]}.json`;
      
      const isWeb = !window.hasOwnProperty('Capacitor') || (window as any).Capacitor?.getPlatform() === 'web';
      
      if (isWeb) {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
      } else {
        // Save to Download directory on mobile for better accessibility
        await Filesystem.writeFile({
          path: `Download/${fileName}`,
          data: data,
          directory: Directory.ExternalStorage,
          encoding: Encoding.UTF8,
          recursive: true,
        });
      }
      
      await Toast.show({ text: '已保存至下载目录' });
      setIsSidebarOpen(false);
    } catch (error) {
      console.error('Export failed', error);
      await Toast.show({ text: '保存失败' });
    }
  };

  const handleImportChat = async () => {
    const isWeb = !window.hasOwnProperty('Capacitor') || (window as any).Capacitor?.getPlatform() === 'web';

    if (isWeb) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async (event) => {
            try {
              const content = event.target?.result as string;
              const importedData = JSON.parse(content);
              
              if (Array.isArray(importedData)) {
                const formattedMessages = importedData.map((m: any) => ({
                  ...m,
                  timestamp: new Date(m.timestamp)
                }));

                setState(prev => ({ ...prev, messages: formattedMessages }));
                await Toast.show({ text: '聊天记录已覆盖恢复' });
                setIsSidebarOpen(false);
              }
            } catch (error) {
              console.error('Import failed', error);
              await Toast.show({ text: '导入失败：文件格式不合法' });
            }
          };
          reader.readAsText(file);
        }
      };
      input.click();
    } else {
      try {
        const { FilePicker } = await import('@capawesome/capacitor-file-picker');
        const result = await FilePicker.pickFiles({
          types: ['application/json'],
          limit: 1,
          readData: true
        });

        if (result.files && result.files.length > 0 && result.files[0].data) {
          try {
            const base64 = result.files[0].data;
            const binaryString = window.atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const content = new TextDecoder().decode(bytes);
            const importedData = JSON.parse(content);
            
            if (Array.isArray(importedData)) {
              const formattedMessages = importedData.map((m: any) => ({
                ...m,
                timestamp: new Date(m.timestamp)
              }));

              setState(prev => ({ ...prev, messages: formattedMessages }));
              await Toast.show({ text: '聊天记录已覆盖恢复' });
              setIsSidebarOpen(false);
            }
          } catch (error) {
            console.error('Import parse failed', error);
            await Toast.show({ text: '文件解析失败' });
          }
        }
      } catch (error) {
        console.error('Import failed', error);
        await Toast.show({ text: '导入失败' });
      }
    }
  };

  const handleQuote = (message: Message) => {
    setQuotedMessage(message);
  };

  const handleTranscribe = async (message: Message) => {
    if (message.type !== 'voice' || !message.mediaUrl || message.transcribedText) return;

    setState(prev => ({ ...prev, isLoading: true }));
    try {
      let result = "";
      if (state.settings.funasrHttpEndpoint) {
        result = await transcribeAudio(message.mediaUrl, state.settings);
      } else {
        // Use the existing sendMessageToGemini but with a specific transcription prompt
        const transcriptionPrompt: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: "请将这段语音转录为文字。只返回转录内容，不要有任何其他解释。",
          timestamp: new Date(),
          type: 'voice',
          mediaUrl: message.mediaUrl
        };
        result = await sendMessageToGemini([transcriptionPrompt], state.settings);
      }
      
      setState(prev => ({
        ...prev,
        messages: prev.messages.map(msg => 
          msg.id === message.id 
            ? { ...msg, transcribedText: result } 
            : msg
        )
      }));
      await Toast.show({ text: '转录成功' });
    } catch (error) {
      console.error('Transcription failed', error);
      await Toast.show({ text: '语音转文字失败，请检查网络或 API 配置' });
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  const queueRef = useRef<Message[]>([]);

  const runGeminiQuery = useCallback(async (allMessagesSoFar: Message[]) => {
    console.log("[Client Chat] runGeminiQuery triggered. Socket connected:", socket.connected);
    const assistantMessageId = crypto.randomUUID();
    const isAgent = !!state.settings.agentMode;
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: "",
      timestamp: new Date(),
      type: 'text',
      status: 'generating',
      isAgentMode: isAgent,
      agentExecution: isAgent ? {
        taskId: '',
        status: 'running',
        steps: ['正在派发任务至本地 DeepSeek Agent...']
      } : undefined
    };

    // 1. Add Assistant placeholder locally
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, assistantMessage],
      isLoading: true,
      error: null
    }));

    const currentUserId = user?.id || 'guest';

    // 2. Dispatch to Server-Side background worker
    try {
      if (socket.connected) {
        socket.emit("start_generation", {
          userId: currentUserId,
          assistantMessageId,
          messages: allMessagesSoFar,
          settings: state.settings
        });
      } else {
        const baseUrl = (window as any).Capacitor?.isNativePlatform?.() ? API_BASE_URL : '';
        const res = await fetch(`${baseUrl}/api/chat/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            assistantMessageId,
            messages: allMessagesSoFar,
            settings: state.settings
          })
        });
        if (!res.ok) {
          const errorText = await res.text().catch(() => "");
          console.error(`[Client Chat] Server-side dispatch failed (Status ${res.status}): ${errorText}`);
          throw new Error(`Server returned ${res.status}`);
        }
        console.log(`[Client Chat] Server-side dispatch successful.`);
      }
    } catch (serverErr) {
      console.warn("[Client Chat] Server-side dispatch failed, falling back to direct client-side generation:", serverErr);
      try {
        let assistantMessageContent = "";
        await sendMessageToGemini(allMessagesSoFar, state.settings, (chunk) => {
          assistantMessageContent += chunk;
          setState(prev => ({
            ...prev,
            messages: prev.messages.map(msg => 
              msg.id === assistantMessageId 
                ? { ...msg, content: assistantMessageContent, status: 'generating' } 
                : msg
            )
          }));
        });
        
        const finalMessage: Message = { 
          ...assistantMessage, 
          content: assistantMessageContent, 
          status: 'completed',
          timestamp: new Date() 
        };
        setState(prev => ({
          ...prev,
          isLoading: false,
          messages: prev.messages.map(msg => msg.id === assistantMessageId ? finalMessage : msg)
        }));
        if (user && user.id !== 'guest') {
          socket.emit("send_message", { userId: user.id, message: finalMessage });
        }
      } catch (clientErr: any) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: clientErr instanceof Error ? clientErr.message : "无法获取 AI 响应。请检查设置中的 API Key。",
          messages: prev.messages.map(msg => 
            msg.id === assistantMessageId 
              ? { ...msg, status: 'error', content: `[生成失败: ${clientErr?.message || '未知错误'}]` } 
              : msg
          )
        }));
      }
    }
  }, [state.settings, user]);

  useEffect(() => {
    if (!state.isLoading && queueRef.current.length > 0) {
      const nextUserMessage = queueRef.current.shift();
      if (nextUserMessage) {
        // Re-construct the context with the latest state (which now includes the completed previous AI response)
        const context = [...state.messages, nextUserMessage];
        runGeminiQuery(context);
      }
    }
  }, [state.isLoading, state.messages, runGeminiQuery]);

  const handleSendMessage = useCallback(async (content: string, type: 'text' | 'voice' | 'image', mediaUrl?: string) => {
    let finalContent = content;
    let transcribedText = undefined;

    if (type === 'voice' && mediaUrl && state.settings.funasrHttpEndpoint) {
      try {
        setState(prev => ({ ...prev, isLoading: true }));
        const resText = await transcribeAudio(mediaUrl, state.settings);
        if (resText) {
          finalContent = resText;
          transcribedText = resText;
        }
      } catch (e) {
        console.error("Auto transcribe voice message error:", e);
        await Toast.show({ text: "语音转写失败，请检查转写服务配置" });
      } finally {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: finalContent,
      timestamp: new Date(),
      type,
      mediaUrl,
      transcribedText,
      isAgentMode: !!state.settings.agentMode,
      quote: quotedMessage ? {
        id: quotedMessage.id,
        userName: quotedMessage.role === 'assistant' ? state.settings.aiName : state.settings.userName,
        content: quotedMessage.content || (quotedMessage.type === 'voice' ? '[语音消息]' : '[图片消息]'),
        timestamp: quotedMessage.timestamp
      } : undefined
    };

    setQuotedMessage(null); // Clear quote after sending

    if (!state.settings.apiKey && !process.env.GEMINI_API_KEY) {
      setState(prev => ({ ...prev, error: "请在设置中配置 API Key 以开始聊天。" }));
      return;
    }

    // Add user message to state locally (auto-persists to localStorage via effect)
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage]
    }));

    // Emit to socket to sync if online
    if (user && user.id !== 'guest') {
      socket.emit("send_message", { userId: user.id, message: userMessage });
    }

    if (state.isLoading) {
      queueRef.current.push(userMessage);
    } else {
      runGeminiQuery([...state.messages, userMessage]);
    }
  }, [state.messages, state.settings, quotedMessage, state.isLoading, runGeminiQuery, user]);

  const handleCallEnd = useCallback((newMessages: Message[]) => {
    if (newMessages.length === 0) return;

    // 批量追加到消息列表（通过 useEffect 自动持久化）
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, ...newMessages]
    }));

    // 尝试同步至服务器
    if (user && user.id !== 'guest') {
      newMessages.forEach(msg => {
        socket.emit("send_message", { userId: user.id, message: msg });
      });
    }

    Toast.show({ text: `通话结束，已自动保存对话记录` });
  }, [user]);


// 规范化提取版本号中的数字（例如 "AI-apk-v0.0.10" -> "0.0.10", "v0.0.10" -> "0.0.10"）
function extractSemVer(v: string): string {
  const match = (v || '').match(/\d+(\.\d+)+/);
  return match ? match[0] : (v || '').replace(/^v/i, '').trim();
}

// 语义化版本大小比较：v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0
function compareSemVer(v1: string, v2: string): number {
  const p1 = extractSemVer(v1).split('.').map(n => parseInt(n, 10) || 0);
  const p2 = extractSemVer(v2).split('.').map(n => parseInt(n, 10) || 0);
  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] !== undefined ? p1[i] : 0;
    const num2 = p2[i] !== undefined ? p2[i] : 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

  const handleCheckUpdate = async (): Promise<{ success: boolean; data?: any; error?: string }> => {
    const { githubOwner, githubRepo } = state.settings;
    if (!githubOwner || !githubRepo) {
      return { success: false, error: '请先在设置中配置 GitHub 仓库信息' };
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${githubOwner}/${githubRepo}/releases/latest`);
      
      if (response.status === 404) {
        throw new Error('未找到仓库或该仓库尚未发布任何 Release 版本。');
      }
      
      if (response.status === 403) {
        throw new Error('访问 GitHub API 频率受限，请稍后再试。');
      }

      if (!response.ok) {
        throw new Error(`GitHub 访问失败 (HTTP ${response.status})`);
      }
      
      const data = await response.json();
      const latestVersion = data.tag_name;
      const currentVersion = localStorage.getItem('app_version') || '0.0.10'; 

      const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
      const isCapacitorAndroid = typeof window !== 'undefined' && 'Capacitor' in window && (window as any).Capacitor?.getPlatform() === 'android';

      let platformType: 'windows' | 'android' | 'web' = 'web';
      if (isElectron) {
        platformType = 'windows';
      } else if (isCapacitorAndroid) {
        platformType = 'android';
      }

      // 智能匹配资产包：Windows 优先找 .exe/.msi，Android 优先找 .apk
      const assets: any[] = data.assets || [];
      let targetAsset = null;

      if (platformType === 'windows') {
        targetAsset = assets.find((a: any) => a.name.endsWith('.exe') || a.name.endsWith('.msi'))
          || assets.find((a: any) => a.name.endsWith('.zip'))
          || assets.find((a: any) => a.name.endsWith('.apk'));
      } else {
        targetAsset = assets.find((a: any) => a.name.endsWith('.apk'))
          || assets.find((a: any) => a.name.endsWith('.exe'));
      }

      const downloadUrl = targetAsset?.browser_download_url;
      const targetFileName = targetAsset?.name;

      // 智能语义化版本比较：仅当线上版本大于本地版本时提示更新
      const hasNewVersion = compareSemVer(latestVersion, currentVersion) > 0 || (latestVersion !== currentVersion && !currentVersion.includes(extractSemVer(latestVersion)));

      if (hasNewVersion) {
        setUpdateInfo({
          version: latestVersion,
          body: data.body,
          url: data.html_url,
          downloadUrl: downloadUrl,
          targetFileName: targetFileName,
          platformType: platformType,
        });
        return { success: true };
      } else {
        return { success: true, data: 'latest' };
      }
    } catch (error) {
      console.error('Update check failed', error);
      return { success: false, error: error instanceof Error ? error.message : '检测更新失败，请稍后重试' };
    }
  };

  const handleDownloadAndInstall = async (url: string, fileName: string) => {
    try {
      setIsUpdating(true);
      setUpdateProgress(0);
      await Toast.show({ text: '开始下载更新包...', duration: 'long' });
      
      const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
      const isCapacitor = typeof window !== 'undefined' && 'Capacitor' in window && (window as any).Capacitor?.getPlatform() !== 'web';

      // 1. Windows Electron 客户端应用内直接下载并自动运行 .exe
      if (isElectron && (window as any).electronAPI?.downloadAndInstallUpdate) {
        const result = await (window as any).electronAPI.downloadAndInstallUpdate({
          url: url,
          fileName: fileName || `AI-Assistant-Setup.exe`
        });

        if (result && !result.success) {
          throw new Error(result.error || '桌面端下载更新失败');
        }
        await Toast.show({ text: '下载完成，正在启动安装程序...' });
        return;
      }

      // 2. Android 移动端原生应用内原生安全下载（零内存溢出风险）
      if (isCapacitor) {
        let progressHandle: any = null;
        try {
          if (typeof (Filesystem as any).addListener === 'function') {
            progressHandle = await (Filesystem as any).addListener('progress', (status: { bytes: number; contentLength: number }) => {
              if (status && status.contentLength > 0) {
                const percent = Math.min(100, Math.round((status.bytes / status.contentLength) * 100));
                setUpdateProgress(percent);
              }
            });
          }
        } catch (e) {
          console.warn('Progress listener not supported, falling back', e);
        }

        // 使用原生 DownloadFile 流式直接落盘到外部存储，完全规避 JS 堆内存 OOM 崩溃
        const downloadResult = await Filesystem.downloadFile({
          url: url,
          path: `Download/${fileName}`,
          directory: Directory.ExternalStorage,
          progress: true,
          recursive: true,
        });

        if (progressHandle && typeof progressHandle.remove === 'function') {
          progressHandle.remove();
        }

        setUpdateProgress(100);

        if (downloadResult && downloadResult.path) {
          await Toast.show({ text: '下载完成，正在打开安装程序...' });
          
          await FileOpener.open({
            filePath: downloadResult.path,
            contentType: 'application/vnd.android.package-archive'
          });
          return;
        } else {
          throw new Error('下载文件路径为空');
        }
      }

      // 3. Web 网页端 fallback
      window.open(url, '_blank');
    } catch (error) {
      console.error('Update failed', error);
      await Toast.show({ text: '应用内更新失败，正在为您打开浏览器下载' });
      window.open(url, '_blank');
    } finally {
      setIsUpdating(false);
    }
  };

  const matchingMessages = state.messages.filter(msg => {
    if (!searchQuery && !selectedDate && !isImageFilter) return false;
    
    const matchesQuery = !searchQuery || msg.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDate = !selectedDate || new Date(msg.timestamp).toISOString().split('T')[0] === selectedDate;
    const matchesImage = !isImageFilter || msg.type === 'image';
    return matchesQuery && matchesDate && matchesImage;
  });

  const filteredMessages = isSearching && hideNonMatches ? matchingMessages : state.messages;

  const handleNextMatch = () => {
    if (matchingMessages.length === 0) return;
    setSearchMatchIndex(prev => (prev + 1) % matchingMessages.length);
  };

  const handlePrevMatch = () => {
    if (matchingMessages.length === 0) return;
    setSearchMatchIndex(prev => (prev - 1 + matchingMessages.length) % matchingMessages.length);
  };

  useEffect(() => {
    if (isSearching) {
      if (matchingMessages.length > 0) {
        setSearchMatchIndex(0);
      } else {
        setSearchMatchIndex(-1);
      }
    }
  }, [searchQuery, selectedDate, isImageFilter, isSearching, matchingMessages.length]);

  const SplashScreen = () => (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white dark:bg-[#0a0a0b]"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center gap-6"
      >
        {state.settings.splashImage ? (
          <img 
            src={state.settings.splashImage} 
            alt="Splash" 
            className="w-24 h-24 rounded-2xl object-cover shadow-xl border border-border/50"
          />
        ) : (
          <div className="w-24 h-24 rounded-2xl bg-primary flex items-center justify-center shadow-xl shadow-primary/20">
            <Sparkles size={48} className="text-primary-foreground" />
          </div>
        )}
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {state.settings.splashText || state.settings.aiName}
          </h1>
          <p className="text-sm text-muted-foreground font-medium uppercase tracking-[0.2em] opacity-60">
          </p>
        </div>
      </motion.div>
      <div className="absolute bottom-12 flex flex-col items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest opacity-40">
          {state.settings.splashSubtitle || 'Loading AI Experience'}
        </span>
      </div>
    </motion.div>
  );

  return (
    <div className="flex h-screen h-[100dvh] w-full bg-background text-foreground overflow-hidden relative">
      <AnimatePresence>
        {!user && <AuthScreen key="auth" onLogin={handleLogin} />}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {showSplash && state.settings.showSplashScreen && <SplashScreen key="splash" />}
      </AnimatePresence>

      {/* Sidebar Overlay Backdrop */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: -200 }}
            animate={{ x: 0 }}
            exit={{ x: -200 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 w-44 max-w-[80vw] border-r bg-sidebar dark:bg-black flex flex-col items-start py-6 sm:py-8 px-4 gap-6 shrink-0 z-50 shadow-2xl pb-safe pt-safe"
          >
            <div className="flex flex-col gap-2 w-full">
              <Button 
                variant="ghost" 
                className={cn(
                  "w-full justify-start gap-3 rounded-full bg-muted border transition-all hover:bg-primary/10 hover:text-primary active:scale-95 pl-3 text-sm",
                  isSearching ? "text-primary border-primary/50" : "text-muted-foreground"
                )}
                onClick={() => {
                  setIsSearching(!isSearching);
                  if (!isSearching) setIsSidebarOpen(false);
                }}
              >
                <Search size={18} />
                <span>搜索聊天</span>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start gap-3 rounded-full bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95 pl-3 text-sm"
                onClick={handleExportChat}
                title="导出记录"
              >
                <Upload size={18} />
                <span>导出记录</span>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start gap-3 rounded-full bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95 pl-3 text-sm"
                onClick={handleImportChat}
                title="导入记录"
              >
                <Download size={18} />
                <span>导入记录</span>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start gap-3 rounded-full bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95 pl-3 text-sm"
                onClick={clearChat}
              >
                <Trash2 size={18} />
                <span>清除记录</span>
              </Button>
            </div>

            <div className="mt-auto flex flex-col gap-2 w-full">
              <Button 
                variant="ghost" 
                className="w-full justify-start gap-3 rounded-full bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95 pl-3 text-sm"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                <span>切换主题</span>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start gap-3 rounded-full bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95 pl-3 text-sm"
                onClick={() => setIsSettingsOpen(true)}
              >
                <Settings size={18} />
                <span>设置</span>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start gap-3 rounded-full bg-destructive/10 border border-destructive/20 text-destructive transition-all hover:bg-destructive hover:text-destructive-foreground active:scale-95 pl-3 text-sm"
                onClick={handleLogout}
              >
                <LogOut size={18} />
                <span>退出登录</span>
              </Button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative w-full h-full min-h-0 overflow-hidden">
        {/* Header */}
        <header className={cn(
          "px-4 py-3 sm:px-8 sm:py-5 flex items-center justify-between border-b relative transition-all duration-300 shrink-0",
          isSearching && "py-4 sm:py-6 min-h-[90px] sm:min-h-[110px]"
        )}>
          <div className={cn("flex items-center gap-2 sm:gap-4 z-10", isSearching && "hidden")}>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-9 h-9 sm:w-11 sm:h-11 bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <PanelLeft className="size-4 sm:size-5" />
            </Button>
          </div>

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-12 sm:px-0">
            <div className="flex flex-col items-center gap-1 w-full sm:w-auto max-w-full">
              <AnimatePresence mode="wait">
                {isSearching ? (
                  <motion.div
                    key="search"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="pointer-events-auto w-full max-w-sm sm:max-w-md md:w-[480px] flex items-center gap-1.5 sm:gap-2 px-2"
                  >
                    <div className="relative flex-1 flex flex-col items-center gap-1.5 sm:gap-2 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 w-full">
                        <div className="relative flex-1 min-w-0">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                          <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="搜索聊天内容..."
                            className="pl-8 sm:pl-9 h-8 sm:h-9 rounded-full bg-muted/50 border-muted-foreground/20 focus-visible:ring-primary/20 text-xs sm:text-sm"
                            autoFocus
                          />
                          {searchQuery && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-auto">
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {matchingMessages.length > 0 ? `${searchMatchIndex + 1}/${matchingMessages.length}` : '0/0'}
                              </span>
                              <button 
                                onClick={() => setSearchQuery('')}
                                className="text-muted-foreground hover:text-primary transition-colors active:scale-90"
                              >
                                <span className="text-xs">×</span>
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted border border-muted-foreground/10 transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                            onClick={handlePrevMatch}
                            disabled={matchingMessages.length === 0}
                          >
                            <ChevronUp size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted border border-muted-foreground/10 transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                            onClick={handleNextMatch}
                            disabled={matchingMessages.length === 0}
                          >
                            <ChevronDown size={14} />
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 sm:gap-2 w-full justify-center">
                        <div className="relative group/date">
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "relative overflow-hidden rounded-full w-7 h-7 sm:w-8 sm:h-8 bg-muted border border-muted-foreground/20 text-muted-foreground shrink-0 transition-all hover:bg-primary/10 hover:text-primary active:scale-95",
                              selectedDate && "text-primary border-primary/40 bg-primary/5 hover:bg-primary/15"
                            )}
                          >
                            <Calendar size={13} />
                            <input 
                              type="date"
                              value={selectedDate}
                              onChange={(e) => setSelectedDate(e.target.value)}
                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                              style={{ colorScheme: theme }}
                            />
                          </Button>
                          {selectedDate && (
                            <button 
                              onClick={() => setSelectedDate('')}
                              className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-[10px] shadow-sm active:scale-95 transition-transform"
                            >
                              <X size={8} strokeWidth={3} />
                            </button>
                          )}
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "rounded-full w-7 h-7 sm:w-8 sm:h-8 bg-muted border border-muted-foreground/20 text-muted-foreground shrink-0 transition-all hover:bg-primary/10 hover:text-primary active:scale-95",
                            isImageFilter && "text-primary border-primary/40 bg-primary/5 hover:bg-primary/15"
                          )}
                          onClick={() => setIsImageFilter(!isImageFilter)}
                          title="只显示图片"
                        >
                          <Image size={13} />
                        </Button>

                        <Button
                          variant="ghost"
                          className={cn(
                            "h-7 sm:h-8 px-2 sm:px-3 rounded-full bg-muted border border-muted-foreground/20 text-[10px] font-medium transition-all gap-1 hover:bg-primary/10 hover:text-primary active:scale-95",
                            !hideNonMatches && "text-primary border-primary/40 bg-primary/5 hover:bg-primary/15"
                          )}
                          onClick={() => setHideNonMatches(!hideNonMatches)}
                        >
                          {hideNonMatches ? <EyeOff size={10} /> : <Eye size={10} />}
                          <span>{hideNonMatches ? "隐藏无关" : "显示全部"}</span>
                        </Button>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full w-8 h-8 sm:w-9 sm:h-9 bg-muted border text-muted-foreground shrink-0 transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                      onClick={() => {
                        setIsSearching(false);
                        setSearchQuery('');
                        setSelectedDate('');
                        setIsImageFilter(false);
                        setHideNonMatches(true);
                        setSearchMatchIndex(-1);
                      }}
                    >
                      <X size={15} />
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="title"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-center truncate max-w-[200px] sm:max-w-none"
                  >
                    <h1 className="text-base sm:text-lg font-semibold leading-tight truncate">{state.settings.aiName}</h1>
                    <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5 truncate">{state.settings.modelName}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className={cn("flex items-center gap-2 z-10", isSearching && "hidden")}>
          </div>
        </header>

        {/* Error Banner */}
        {state.error && (
          <div className="bg-destructive/10 text-destructive text-xs p-2 text-center border-b">
            {state.error}
          </div>
        )}

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col relative overflow-hidden min-h-0">
          {/* Custom Background Layer */}
          {state.settings.customBackground && (theme === 'light' || state.settings.showBackgroundInDarkMode) && (
            <div 
              className="absolute inset-0 z-0 pointer-events-none bg-cover bg-center bg-no-repeat"
              style={{ 
                backgroundImage: `url(${state.settings.customBackground})`,
                opacity: (() => {
                  let val = state.settings.backgroundOpacity ?? 100;
                  if (val <= 1 && val > 0) val = val * 100;
                  return Math.min(100, Math.max(0, val)) / 100;
                })()
              }}
            />
          )}
          
          <MessageList 
            messages={filteredMessages} 
            isLoading={state.isLoading} 
            settings={state.settings}
            isSelectionMode={isSelectionMode}
            isSearching={isSearching}
            searchQuery={searchQuery}
            activeSearchMatchId={searchMatchIndex >= 0 ? matchingMessages[searchMatchIndex]?.id : undefined}
            selectedIds={selectedMessageIds}
            onToggleSelection={handleToggleMessageSelection}
            onEnterSelectionMode={handleEnterSelectionMode}
            onQuote={handleQuote}
            onTranscribe={handleTranscribe}
            onDelete={handleDeleteMessage}
          />

          {/* Input Area */}
          <div className={cn(
            "p-3 sm:p-5 md:p-6 lg:p-8 pb-safe relative z-10 shrink-0", 
            !isSelectionMode && isSearching && "hidden"
          )}>
            <AnimatePresence mode="wait">
              {isSelectionMode ? (
                <motion.div
                  key="selection-actions"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="flex gap-2 sm:gap-4 max-w-2xl mx-auto"
                >
                  <Button
                    variant="outline"
                    className="flex-1 h-10 sm:h-12 rounded-xl sm:rounded-2xl bg-muted/50 border-muted-foreground/20 text-muted-foreground hover:text-foreground text-xs sm:text-sm"
                    onClick={() => {
                      setIsSelectionMode(false);
                      setSelectedMessageIds([]);
                    }}
                  >
                    取消 ({selectedMessageIds.length})
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-10 sm:h-12 rounded-xl sm:rounded-2xl bg-muted/50 border-muted-foreground/20 text-primary hover:bg-primary/5 text-xs sm:text-sm"
                    onClick={handleCopySelected}
                  >
                    复制内容
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1 h-10 sm:h-12 rounded-xl sm:rounded-2xl shadow-lg shadow-destructive/20 text-xs sm:text-sm"
                    onClick={handleDeleteSelected}
                  >
                    删除消息
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="chat-input"
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <ChatInput 
                    onSendMessage={handleSendMessage} 
                    quotedMessage={quotedMessage}
                    onCancelQuote={() => setQuotedMessage(null)}
                    onStartCall={() => setIsCallOpen(true)}
                    isAgentMode={state.settings.agentMode || false}
                    agentOnline={agentOnline}
                    onToggleAgentMode={() => {
                      const newMode = !state.settings.agentMode;
                      handleSaveSettings({
                        ...state.settings,
                        agentMode: newMode
                      });
                      Toast.show({ text: newMode ? '已切换至 DeepSeek Agent 模式' : '已切换至普通对话模式' });
                    }}
                    onOpenAgentSettings={() => setIsSettingsOpen(true)}
                    onScanToken={(token) => {
                      const cleanToken = token.trim();
                      if (cleanToken) {
                        handleSaveSettings({
                          ...state.settings,
                          agentToken: cleanToken,
                          agentMode: true
                        });
                        Toast.show({ text: `🎉 配对成功！已连接本地电脑 Agent` });
                      }
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <CallOverlay 
        open={isCallOpen}
        onClose={() => setIsCallOpen(false)}
        settings={state.settings}
        historyMessages={state.messages}
        onCallEnd={handleCallEnd}
      />

      <SettingsDialog 
        open={isSettingsOpen} 
        onOpenChange={setIsSettingsOpen} 
        settings={state.settings} 
        onSave={handleSaveSettings} 
        onCheckUpdate={handleCheckUpdate}
        userId={user?.id}
        username={user?.username}
        onOpenLogViewer={() => setIsLogViewerOpen(true)}
      />

      <LogViewerModal
        open={isLogViewerOpen}
        onOpenChange={setIsLogViewerOpen}
      />

      {(state.settings.showDebugFloatButton ?? true) && (
        <DebugFloatButton onClick={() => setIsLogViewerOpen(true)} />
      )}

      <DeleteHistoryDialog
        isOpen={isDeleteHistoryOpen}
        onClose={() => setIsDeleteHistoryOpen(false)}
        onDeleteToday={() => deleteMessagesByRange(0)}
        onDeleteLast7Days={() => deleteMessagesByRange(7)}
        onDeleteAll={() => deleteMessagesByRange('all')}
      />

      {updateInfo && (
        <UpdateDialog 
          isOpen={!!updateInfo}
          onClose={() => setUpdateInfo(null)}
          version={updateInfo.version}
          changelog={updateInfo.body}
          downloadUrl={updateInfo.downloadUrl || updateInfo.url}
          targetFileName={updateInfo.targetFileName}
          platformType={updateInfo.platformType}
          progress={updateProgress}
          isUpdating={isUpdating}
          onUpdate={() => {
            if (updateInfo.downloadUrl) {
              const defaultName = updateInfo.platformType === 'windows' 
                ? `AI-Assistant-Setup-${updateInfo.version}.exe` 
                : `update_${updateInfo.version}.apk`;
              handleDownloadAndInstall(updateInfo.downloadUrl, updateInfo.targetFileName || defaultName);
            } else {
              window.open(updateInfo.url, '_blank');
            }
          }}
        />
      )}
    </div>
  );
}