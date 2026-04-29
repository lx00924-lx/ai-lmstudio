/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { MessageList } from './components/Chat/MessageList';
import { ChatInput } from './components/Chat/ChatInput';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { DeleteHistoryDialog } from './components/Chat/DeleteHistoryDialog';
import { UpdateDialog } from './components/Chat/UpdateDialog';
import { Message, ChatState, AppSettings } from './types';
import { sendMessageToGemini } from './services/gemini';
import { Sparkles, Settings, Sun, Moon, PanelLeft, Search, Trash2, X, Download, Upload, Calendar, Image, ChevronUp, ChevronDown, Filter, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from './components/ui/input';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { Clipboard } from '@capacitor/clipboard';
import { Toast } from '@capacitor/toast';

const DEFAULT_SETTINGS: AppSettings = {
  userName: '用户',
  userAvatar: '',
  aiName: 'Aether-X',
  aiSubtitle: '专业版',
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
  splashDuration: 2000,
};

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDeleteHistoryOpen, setIsDeleteHistoryOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; body: string; url: string; apkUrl?: string } | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [isImageFilter, setIsImageFilter] = useState(false);
  const [searchMatchIndex, setSearchMatchIndex] = useState(-1);
  const [hideNonMatches, setHideNonMatches] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  const [state, setState] = useState<ChatState>(() => {
    let settings = DEFAULT_SETTINGS;
    let messages: Message[] = [];
    
    try {
      const savedSettings = localStorage.getItem('gemini_settings');
      if (savedSettings) {
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
      }
      
      const savedMessages = localStorage.getItem('chat_history');
      if (savedMessages) {
        messages = JSON.parse(savedMessages).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
      }
    } catch (error) {
      console.error('Failed to parse saved data', error);
    }
    
    return {
      messages,
      isLoading: false,
      error: null,
      settings
    };
  });

  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = localStorage.getItem('app_theme');
    return (savedTheme as 'light' | 'dark') || 'dark';
  });


  // Wake Lock implementation
  useEffect(() => {
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
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);


  useEffect(() => {
    try {
        localStorage.setItem('chat_history', JSON.stringify(state.messages));
    } catch (error) {
        if (error instanceof Error && (error.name === 'QuotaExceededError' || error.message.includes('QuotaExceededError'))) {
            console.warn('LocalStorage quota exceeded, please clear some history.');
        } else {
            console.error('Failed to save chat history', error);
        }
    }
  }, [state.messages]);

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

  useEffect(() => {
    localStorage.setItem('gemini_settings', JSON.stringify(state.settings));
  }, [state.settings]);

  useEffect(() => {
    localStorage.setItem('app_theme', theme);
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
    setIsSidebarOpen(false);
  };

  const clearChat = () => {
    setIsDeleteHistoryOpen(true);
  };

  const deleteMessagesByRange = (days: number | 'all') => {
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
        return new Date(m.timestamp) < cutoff;
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
      // Use the existing sendMessageToGemini but with a specific transcription prompt
      const transcriptionPrompt: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: "请将这段语音转录为文字。只返回转录内容，不要有任何其他解释。",
        timestamp: new Date(),
        type: 'voice',
        mediaUrl: message.mediaUrl
      };

      const result = await sendMessageToGemini([transcriptionPrompt], state.settings);
      
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

  const handleSendMessage = useCallback(async (content: string, type: 'text' | 'voice' | 'image', mediaUrl?: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
      type,
      mediaUrl,
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

    const assistantMessageId = crypto.randomUUID();
    const currentMessages = [...state.messages, userMessage];

    setState(prev => ({
      ...prev,
      messages: [
        ...currentMessages,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: "",
          timestamp: new Date(),
          type: 'text'
        }
      ],
      isLoading: true,
      error: null
    }));

    try {
      let assistantMessageContent = "";
      await sendMessageToGemini(currentMessages, state.settings, (chunk) => {
        assistantMessageContent += chunk;
        setState(prev => ({
          ...prev,
          messages: prev.messages.map(msg => 
            msg.id === assistantMessageId 
              ? { ...msg, content: assistantMessageContent } 
              : msg
          )
        }));
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : "无法获取 Gemini 的响应。请检查设置中的 API Key。"
      }));
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [state.messages, state.settings, quotedMessage]);

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
      const currentVersion = localStorage.getItem('app_version') || 'v0.0.2'; 

      // Find APK in assets
      const apkAsset = data.assets?.find((asset: any) => asset.name.endsWith('.apk'));
      const apkUrl = apkAsset?.browser_download_url;

      if (latestVersion !== currentVersion) {
        setUpdateInfo({
          version: latestVersion,
          body: data.body,
          url: data.html_url,
          apkUrl: apkUrl
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
      await Toast.show({ text: '开始下载更新包...', duration: 'long' });
      
      const isWeb = !window.hasOwnProperty('Capacitor') || (window as any).Capacitor?.getPlatform() === 'web';
      
      if (isWeb) {
        window.open(url, '_blank');
        return;
      }

      // Capacitor logic for mobile
      // 1. Download the file
      const downloadResult = await Filesystem.downloadFile({
        url: url,
        path: `Download/${fileName}`,
        directory: Directory.ExternalStorage,
      });

      if (downloadResult.path) {
        await Toast.show({ text: '下载完成，正在打开安装程序...' });
        
        // 2. Open the file
        await FileOpener.open({
          filePath: downloadResult.path,
          contentType: 'application/vnd.android.package-archive'
        });
      }
    } catch (error) {
      console.error('Update failed', error);
      await Toast.show({ text: '更新失败，请前往浏览器手动下载' });
      window.open(url, '_blank');
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
            {state.settings.aiSubtitle}
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
    <div className="flex h-screen bg-background text-foreground overflow-hidden relative">
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
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: -80 }}
            animate={{ x: 0 }}
            exit={{ x: -80 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 w-20 border-r bg-sidebar flex flex-col items-center py-8 gap-6 shrink-0 z-50 shadow-2xl"
          >
            <div className="flex flex-col gap-4">
              <Button 
                variant="ghost" 
                size="icon" 
                className={cn(
                  "w-11 h-11 rounded-xl bg-muted border transition-all hover:bg-primary/10 hover:text-primary active:scale-95",
                  isSearching ? "text-primary border-primary/50" : "text-muted-foreground"
                )}
                onClick={() => {
                  setIsSearching(!isSearching);
                  if (!isSearching) setIsSidebarOpen(false);
                }}
              >
                <Search size={20} />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                onClick={handleExportChat}
                title="导出记录"
              >
                <Upload size={20} />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                onClick={handleImportChat}
                title="导入记录"
              >
                <Download size={20} />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                onClick={clearChat}
              >
                <Trash2 size={20} />
              </Button>
            </div>

            <div className="mt-auto flex flex-col gap-4">
              <Button 
                variant="ghost" 
                size="icon" 
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                onClick={() => setIsSettingsOpen(true)}
              >
                <Settings size={20} />
              </Button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative w-full">
        {/* Header */}
        <header className={cn(
          "px-8 py-6 flex items-center justify-between border-b relative transition-all duration-300",
          isSearching && "py-8 min-h-[110px]"
        )}>
          <div className={cn("flex items-center gap-4 z-10", isSearching && "hidden")}>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-11 h-11 bg-muted border text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <PanelLeft size={20} />
            </Button>
          </div>

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-1">
              <AnimatePresence mode="wait">
                {isSearching ? (
                  <motion.div
                    key="search"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="pointer-events-auto w-72 sm:w-[480px] flex items-center gap-2"
                  >
                    <div className="relative flex-1 flex flex-col items-center gap-2">
                      <div className="flex items-center gap-2 w-full">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                          <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="搜索聊天内容..."
                            className="pl-9 h-9 rounded-full bg-muted/50 border-muted-foreground/20 focus-visible:ring-primary/20"
                            autoFocus
                          />
                          {searchQuery && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-auto">
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

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-8 h-8 rounded-full bg-muted border border-muted-foreground/10 transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                            onClick={handlePrevMatch}
                            disabled={matchingMessages.length === 0}
                          >
                            <ChevronUp size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-8 h-8 rounded-full bg-muted border border-muted-foreground/10 transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                            onClick={handleNextMatch}
                            disabled={matchingMessages.length === 0}
                          >
                            <ChevronDown size={14} />
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full justify-center">
                        <div className="relative group/date">
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "relative overflow-hidden rounded-full w-8 h-8 bg-muted border border-muted-foreground/20 text-muted-foreground shrink-0 transition-all hover:bg-primary/10 hover:text-primary active:scale-95",
                              selectedDate && "text-primary border-primary/40 bg-primary/5 hover:bg-primary/15"
                            )}
                          >
                            <Calendar size={14} />
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
                            "rounded-full w-8 h-8 bg-muted border border-muted-foreground/20 text-muted-foreground shrink-0 transition-all hover:bg-primary/10 hover:text-primary active:scale-95",
                            isImageFilter && "text-primary border-primary/40 bg-primary/5 hover:bg-primary/15"
                          )}
                          onClick={() => setIsImageFilter(!isImageFilter)}
                          title="只显示图片"
                        >
                          <Image size={14} />
                        </Button>

                        <Button
                          variant="ghost"
                          className={cn(
                            "h-8 px-3 rounded-full bg-muted border border-muted-foreground/20 text-[10px] font-medium transition-all gap-1.5 hover:bg-primary/10 hover:text-primary active:scale-95",
                            !hideNonMatches && "text-primary border-primary/40 bg-primary/5 hover:bg-primary/15"
                          )}
                          onClick={() => setHideNonMatches(!hideNonMatches)}
                        >
                          {hideNonMatches ? <EyeOff size={10} /> : <Eye size={10} />}
                          {hideNonMatches ? "隐藏无关" : "显示全部"}
                        </Button>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full w-9 h-9 bg-muted border text-muted-foreground shrink-0 transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                      onClick={() => {
                        setIsSearching(false);
                        setSearchQuery('');
                        setSelectedDate('');
                        setIsImageFilter(false);
                        setHideNonMatches(true);
                        setSearchMatchIndex(-1);
                      }}
                    >
                      <X size={16} />
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="title"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-center"
                  >
                    <h1 className="text-lg font-semibold leading-none">{state.settings.aiName} {state.settings.aiSubtitle}</h1>
                    <p className="text-[10px] text-muted-foreground mt-1">{state.settings.modelName}</p>
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
        <div className="flex-1 flex flex-col relative overflow-hidden">
          {/* Custom Background Layer */}
          {theme === 'light' && state.settings.customBackground && (
            <div 
              className="absolute inset-0 z-0 opacity-40 pointer-events-none bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${state.settings.customBackground})` }}
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
          <div className={cn("p-8 relative z-10", !isSelectionMode && isSearching && "hidden")}>
            <AnimatePresence mode="wait">
              {isSelectionMode ? (
                <motion.div
                  key="selection-actions"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="flex gap-4"
                >
                  <Button
                    variant="outline"
                    className="flex-1 h-12 rounded-2xl bg-muted/50 border-muted-foreground/20 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setIsSelectionMode(false);
                      setSelectedMessageIds([]);
                    }}
                  >
                    取消 ({selectedMessageIds.length})
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-12 rounded-2xl bg-muted/50 border-muted-foreground/20 text-primary hover:bg-primary/5"
                    onClick={handleCopySelected}
                  >
                    复制内容
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1 h-12 rounded-2xl shadow-lg shadow-destructive/20"
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
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <SettingsDialog 
        open={isSettingsOpen} 
        onOpenChange={setIsSettingsOpen} 
        settings={state.settings} 
        onSave={handleSaveSettings} 
        onCheckUpdate={handleCheckUpdate}
      />

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
          downloadUrl={updateInfo.apkUrl || updateInfo.url}
          onUpdate={() => {
            if (updateInfo.apkUrl) {
              handleDownloadAndInstall(updateInfo.apkUrl, `update_${updateInfo.version}.apk`);
            } else {
              window.open(updateInfo.url, '_blank');
            }
          }}
        />
      )}
    </div>
  );
}

