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
import { Message, ChatState, AppSettings } from './types';
import { sendMessageToGemini } from './services/gemini';
import { Sparkles, Settings, Sun, Moon, PanelLeft, Search, Trash2, X, Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from './components/ui/input';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
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
  modelName: 'gemini-3-flash-preview',
};

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDeleteHistoryOpen, setIsDeleteHistoryOpen] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
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

  // Notification implementation
  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  const [state, setState] = useState<ChatState>(() => {
    let settings = DEFAULT_SETTINGS;
    try {
      const savedSettings = localStorage.getItem('gemini_settings');
      if (savedSettings) {
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
      }
    } catch (error) {
      console.error('Failed to parse settings', error);
    }

    return {
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: settings.welcomeMessage || `你好！我是 ${settings.aiName}。今天有什么我可以帮你的吗？你可以给我发送文字、图片，甚至是语音消息！`,
          timestamp: new Date(),
          type: 'text'
        }
      ],
      isLoading: false,
      error: null,
      settings
    };
  });

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
      const welcomeMessage = prev.messages.find(m => m.id === '1' || m.id === 'welcome');

      if (days === 'all') {
        return {
          ...prev,
          messages: welcomeMessage ? [welcomeMessage] : []
        };
      }

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      cutoff.setHours(0, 0, 0, 0);

      const filtered = prev.messages.filter(m => {
        if (m.id === '1' || m.id === 'welcome') return true;
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
      const fileName = `chat_history_${new Date().getTime()}.json`;

      const result = await Filesystem.writeFile({
        path: fileName,
        data: data,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });

      await Share.share({
        title: '导出聊天记录',
        text: '这是我的聊天记录备份',
        url: result.uri,
        dialogTitle: '分享聊天记录',
      });

      await Toast.show({ text: '导出成功' });
    } catch (error) {
      console.error('Export failed', error);
      await Toast.show({ text: '导出失败' });
    }
  };

  const handleImportChat = async () => {
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
            const messages = JSON.parse(content);
            if (Array.isArray(messages)) {
              setState(prev => ({ ...prev, messages }));
              await Toast.show({ text: '导入成功' });
            }
          } catch (error) {
            console.error('Import failed', error);
            await Toast.show({ text: '导入失败：文件格式不正确' });
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleSendMessage = useCallback(async (content: string, type: 'text' | 'voice' | 'image', mediaUrl?: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
      type,
      mediaUrl
    };

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
  }, [state.messages, state.settings]);

  const filteredMessages = state.messages.filter(msg =>
    msg.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden relative">
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
                  "w-11 h-11 rounded-xl bg-muted border transition-colors",
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
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                onClick={handleExportChat}
                title="导出记录"
              >
                <Download size={20} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                onClick={handleImportChat}
                title="导入记录"
              >
                <Upload size={20} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                onClick={clearChat}
              >
                <Trash2 size={20} />
              </Button>
            </div>

            <div className="mt-auto flex flex-col gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-11 h-11 rounded-xl bg-muted border text-muted-foreground"
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
        <header className="px-8 py-6 flex items-center justify-between border-b relative">
          <div className={cn("flex items-center gap-4 z-10", isSearching && "hidden")}>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-11 h-11 bg-muted border text-muted-foreground transition-colors"
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
                    className="pointer-events-auto w-64 sm:w-80 flex items-center gap-2"
                  >
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索聊天记录..."
                        className="pl-9 h-9 rounded-full bg-muted/50 border-muted-foreground/20 focus-visible:ring-primary/20"
                        autoFocus
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground pointer-events-auto"
                        >
                          <span className="text-xs">×</span>
                        </button>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full w-9 h-9 bg-muted border text-muted-foreground shrink-0"
                      onClick={() => {
                        setIsSearching(false);
                        setSearchQuery('');
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
            selectedIds={selectedMessageIds}
            onToggleSelection={handleToggleMessageSelection}
            onEnterSelectionMode={handleEnterSelectionMode}
          />

          {/* Input Area */}
          <div className="p-8 relative z-10">
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
                  <ChatInput onSendMessage={handleSendMessage} />
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
      />

      <DeleteHistoryDialog
        isOpen={isDeleteHistoryOpen}
        onClose={() => setIsDeleteHistoryOpen(false)}
        onDeleteToday={() => deleteMessagesByRange(0)}
        onDeleteLast7Days={() => deleteMessagesByRange(7)}
        onDeleteAll={() => deleteMessagesByRange('all')}
      />
    </div>
  );
}

