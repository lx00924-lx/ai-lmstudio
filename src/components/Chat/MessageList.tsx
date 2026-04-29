/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message, AppSettings } from '../../types';
import { cn, formatMessageDate } from '../../lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { motion, AnimatePresence } from 'motion/react';
import { Bot, User, Mic, CheckCircle2, Circle, Play, Pause, Copy, Quote, Languages, RefreshCcw, Target, Trash2 } from 'lucide-react';
import { Clipboard } from '@capacitor/clipboard';
import { Toast } from '@capacitor/toast';

interface VoiceMessagePlayerProps {
  url: string;
  onReplay?: (play: () => void) => void;
}

const VoiceMessagePlayer: React.FC<VoiceMessagePlayerProps> = ({ url, onReplay }) => {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [duration, setDuration] = React.useState<number | null>(null);
  const [currentTime, setCurrentTime] = React.useState(0);

  React.useEffect(() => {
    if (onReplay && audioRef.current) {
      onReplay(() => {
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.play();
        }
      });
    }
  }, [onReplay]);

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  React.useEffect(() => {
    let interval: number;
    if (isPlaying) {
      interval = window.setInterval(() => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
      }, 1000 / 240); // 240 FPS Target (approx 4.16ms)
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    }
  };

  const onLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const onEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div 
      className="flex items-center gap-3 py-1 cursor-pointer group/voice"
      onClick={togglePlay}
    >
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center group-active/voice:scale-90 transition-transform">
        {isPlaying ? (
          <Pause size={16} className="text-primary fill-primary/20" />
        ) : (
          <Play size={16} className="text-primary translate-x-0.5 fill-primary/20" />
        )}
      </div>
      <div className="flex flex-col gap-1 min-w-32">
        <div className="relative flex items-center h-4 w-full">
          <div className="absolute inset-0 flex items-center justify-between pointer-events-none overflow-hidden">
            {[...Array(18)].map((_, i) => (
              <div 
                key={i} 
                className={cn(
                  "w-0.5 rounded-full transition-colors",
                  progress >= (i / 17) * 100 ? "bg-primary" : "bg-primary/20"
                )}
                style={{ 
                  height: `${4 + (Math.sin(i * 0.8) + 1) * 5}px`,
                }} 
              />
            ))}
          </div>
          
          {/* Moving progress bar */}
          <div 
            className="absolute top-0 bottom-0 w-[1.5px] bg-primary shadow-[0_0_8px_#00D2FF] z-10"
            style={{ 
              left: `${progress}%`,
              transform: 'translateX(-50%)',
              transition: 'none'
            }}
          />
        </div>
        <div className="flex justify-end items-center px-0.5">
          <span className="text-[10px] font-medium text-muted-foreground/60">
            {duration ? formatTime(duration) : '--:--'}
          </span>
        </div>
      </div>
      <audio 
        ref={audioRef}
        src={url} 
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={onEnded}
        onLoadedMetadata={onLoadedMetadata}
        className="hidden" 
      />
    </div>
  );
};

const QuoteDisplay: React.FC<{ quote: Message['quote']; onLocate?: (id: string) => void }> = ({ quote, onLocate }) => {
  if (!quote) return null;
  return (
    <div className="mb-2 p-2 rounded-lg bg-black/5 dark:bg-white/5 border-l-2 border-primary/50 text-xs text-muted-foreground italic relative group/quote">
      <div className="flex items-center justify-between mb-0.5">
        <span className="font-semibold not-italic text-primary/70">{quote.userName}</span>
        <div className="flex items-center gap-2">
           <span className="text-[10px] opacity-60 not-italic font-normal">{formatMessageDate(quote.timestamp)}</span>
           <button 
             onClick={(e) => {
               e.stopPropagation();
               onLocate?.(quote.id);
             }}
             className="p-1 rounded-md hover:bg-primary/20 text-primary opacity-0 group-hover/quote:opacity-100 transition-opacity"
             title="点击定位到引用消息"
           >
             <Target size={12} />
           </button>
        </div>
      </div>
      <div className="line-clamp-2">
        {quote.content}
      </div>
    </div>
  );
};

const HighlightedText: React.FC<{ text: string; query: string; isActive?: boolean }> = ({ text, query, isActive }) => {
  if (!query.trim()) return <>{text}</>;
  
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  
  return (
    <>
      {parts.map((part, i) => 
        part.toLowerCase() === query.toLowerCase() 
          ? <span 
              key={i} 
              className={cn(
                "rounded-sm px-0.5 leading-none inline-block transition-colors duration-200",
                isActive 
                  ? "bg-orange-500/30 text-orange-600 font-black border-b border-orange-500/60 ring-1 ring-orange-500/20" 
                  : "bg-primary/20 text-primary font-bold border-b border-primary/40"
              )}
            >
              {part}
            </span> 
          : part
      )}
    </>
  );
};

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  settings: AppSettings;
  isSelectionMode: boolean;
  isSearching: boolean;
  searchQuery?: string;
  activeSearchMatchId?: string;
  selectedIds: string[];
  onToggleSelection: (id: string) => void;
  onEnterSelectionMode: (id: string) => void;
  onQuote?: (message: Message) => void;
  onTranscribe?: (message: Message) => void;
  onDelete?: (id: string) => void;
}

const MessageItem: React.FC<{
  message: Message;
  isSelected: boolean;
  isSelectionMode: boolean;
  isSearching: boolean;
  searchQuery: string;
  activeSearchMatchId?: string;
  highlightMessageId: string | null;
  contextMenuId?: string;
  settings: AppSettings;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onMouseUp: () => void;
  onMouseEnter: (id: string) => void;
  onTouchStart: (e: React.TouchEvent, id: string) => void;
  onTouchEnd: () => void;
  onClick: (id: string) => void;
  scrollToMessage: (id: string) => void;
  messageRef?: (el: HTMLDivElement | null) => void;
  onRegisterReplay?: (id: string, play: () => void) => void;
}> = ({
  message,
  isSelected,
  isSelectionMode,
  isSearching,
  searchQuery,
  activeSearchMatchId,
  highlightMessageId,
  contextMenuId,
  settings,
  onMouseDown,
  onMouseUp,
  onMouseEnter,
  onTouchStart,
  onTouchEnd,
  onClick,
  scrollToMessage,
  messageRef,
  onRegisterReplay
}) => {
  return (
    <motion.div
      key={message.id}
      ref={messageRef}
      data-message-id={message.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onMouseDown={(e) => onMouseDown(e, message.id)}
      onMouseUp={onMouseUp}
      onMouseEnter={() => onMouseEnter(message.id)}
      onTouchStart={(e) => onTouchStart(e, message.id)}
      onTouchEnd={onTouchEnd}
      onClick={() => onClick(message.id)}
      className={cn(
        "flex w-full gap-3 transition-all duration-300 rounded-xl p-1 relative",
        message.role === 'user' ? "flex-row-reverse" : "flex-row",
        isSelectionMode && "cursor-pointer active:scale-[0.98]",
        isSelected && "opacity-100 scale-[1.02]",
        highlightMessageId === message.id && "animate-pulse-highlight",
        contextMenuId === message.id && "z-[65]"
      )}
    >
      {isSelectionMode && (
        <div className="flex items-center justify-center px-2">
          {isSelected ? (
            <CheckCircle2 className="text-primary size-5 fill-primary/10" />
          ) : (
            <Circle className="text-muted-foreground/30 size-5" />
          )}
        </div>
      )}

      {message.role === 'assistant' && (
        <Avatar className="w-8 h-8 border border-border shrink-0 mt-1">
          {settings.aiAvatar && <AvatarImage src={settings.aiAvatar} />}
          <AvatarFallback><Bot size={16} /></AvatarFallback>
        </Avatar>
      )}

      {message.role === 'user' && (
        <Avatar className="w-8 h-8 border border-border shrink-0 mt-1">
          {settings.userAvatar && <AvatarImage src={settings.userAvatar} />}
          <AvatarFallback><User size={16} /></AvatarFallback>
        </Avatar>
      )}

      <div className={cn(
        "flex flex-col max-w-[85%] transition-opacity",
        message.role === 'user' ? "items-end" : "items-start",
        isSelectionMode && !isSelected && "opacity-50"
      )}>
        <div className="flex items-center gap-2 mb-1 px-1">
          <span className="text-[10px] font-medium text-muted-foreground tracking-wider">
            {message.role === 'assistant' ? settings.aiName : settings.userName}
          </span>
        </div>
        <div className={cn(
          "px-5 py-4 rounded-[20px] text-[15px] leading-relaxed transition-all relative overflow-hidden",
          message.role === 'user' 
            ? "bg-white dark:bg-card border border-border text-black dark:text-foreground" 
            : "bg-white dark:bg-card border border-border text-black dark:text-foreground",
          isSelected && "ring-2 ring-primary/50 border-primary/50 shadow-lg shadow-primary/10",
          contextMenuId === message.id && "ring-2 ring-primary/30 scale-[0.99]"
        )}>
          <QuoteDisplay quote={message.quote} onLocate={scrollToMessage} />

          {message.type === 'image' && message.mediaUrl && (
            <img 
              src={message.mediaUrl} 
              alt="Uploaded" 
              className="rounded-lg mb-2 max-w-full h-auto"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                console.error("Image render error");
              }}
            />
          )}
          
          {message.type === 'voice' && message.mediaUrl && (
            <>
              <VoiceMessagePlayer 
                url={message.mediaUrl} 
                onReplay={(play) => onRegisterReplay?.(message.id, play)}
              />
              {message.transcribedText && (
                <div className="mt-3 pt-3 border-t border-border/30 text-xs italic text-muted-foreground/80 leading-relaxed font-mono">
                   <Languages size={10} className="inline mr-1 opacity-50" />
                   {message.transcribedText}
                </div>
              )}
            </>
          )}

              {message.content && (
                <div className={cn(
                  "prose prose-sm dark:prose-invert max-w-none",
                  (message.type === 'image' || message.type === 'voice') && "mt-2 pt-2 border-t border-border/50"
                )}>
                  {isSearching ? (
                    <div className="whitespace-pre-wrap">
                      <HighlightedText 
                        text={message.content} 
                        query={searchQuery} 
                        isActive={message.id === activeSearchMatchId}
                      />
                    </div>
                  ) : (
                    <ReactMarkdown
                      components={{
                        code({ node, inline, className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || '');
                          return !inline && match ? (
                            <SyntaxHighlighter
                              style={oneDark}
                              language={match[1]}
                              PreTag="div"
                              {...props}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}
                </div>
              )}
        </div>
        <span className="text-[10px] text-muted-foreground mt-1 px-1">
          {formatMessageDate(message.timestamp)}
        </span>
      </div>
    </motion.div>
  );
};

export const MessageList: React.FC<MessageListProps> = ({ 
  messages, 
  isLoading, 
  settings,
  isSelectionMode,
  isSearching,
  searchQuery = '',
  activeSearchMatchId,
  selectedIds,
  onToggleSelection,
  onEnterSelectionMode,
  onQuote,
  onTranscribe,
  onDelete
}) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<{ id: string; x: number; y: number } | null>(null);
  const [highlightMessageId, setHighlightMessageId] = React.useState<string | null>(null);
  const messageRefs = React.useRef<{ [key: string]: HTMLDivElement | null }>({});
  const replayRefs = React.useRef<{ [key: string]: () => void }>({});
  const lastSelectedId = React.useRef<string | null>(null);
  const touchStartPos = React.useRef<{ x: number; y: number } | null>(null);

  const scrollToMessage = (id: string) => {
    const element = messageRefs.current[id];
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightMessageId(id);
      setTimeout(() => setHighlightMessageId(null), 2000);
    } else {
      Toast.show({ text: '找不到原消息' });
    }
  };

  const handleCopy = async (text: string) => {
    await Clipboard.write({ string: text });
    await Toast.show({ text: '已复制到剪贴板' });
    setContextMenu(null);
  };

  const handleQuoteClick = (message: Message) => {
    onQuote?.(message);
    setContextMenu(null);
  };

  const handleTranscribeClick = (message: Message) => {
    onTranscribe?.(message);
    setContextMenu(null);
  };

  const handleReplayClick = (id: string) => {
    replayRefs.current[id]?.();
    setContextMenu(null);
  };

  const handleDeleteClick = (id: string) => {
    onDelete?.(id);
    setContextMenu(null);
  };

  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    if (isSelectionMode) {
      if (isSearching) {
        setIsDragging(true);
      }
      lastSelectedId.current = id;
      onToggleSelection(id);
      return;
    }
    
    const x = e.clientX;
    const y = e.clientY;
    touchStartPos.current = { x, y };

    longPressTimer.current = setTimeout(() => {
      if (isSearching) {
        onEnterSelectionMode(id);
        setIsDragging(true);
        lastSelectedId.current = id;
      } else {
        setContextMenu({ id, x, y });
      }
      touchStartPos.current = null;
    }, 600);
  };

  const handleTouchStart = (e: React.TouchEvent, id: string) => {
    if (isSelectionMode) return;
    
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    touchStartPos.current = { x, y };

    longPressTimer.current = setTimeout(() => {
      if (isSearching) {
        onEnterSelectionMode(id);
        setIsDragging(true);
        lastSelectedId.current = id;
      } else {
        setContextMenu({ id, x, y });
      }
      touchStartPos.current = null;
    }, 600);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
    setIsDragging(false);
    lastSelectedId.current = null;
  };

  const handleClick = (id: string) => {
    if (isSelectionMode) {
      onToggleSelection(id);
    }
  };

  const handleMouseEnter = (id: string) => {
    if (isDragging && isSelectionMode && lastSelectedId.current !== id) {
      onToggleSelection(id);
      lastSelectedId.current = id;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (longPressTimer.current && touchStartPos.current) {
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartPos.current.x);
      const dy = Math.abs(touch.clientY - touchStartPos.current.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        touchStartPos.current = null;
      }
    }

    if (!isDragging || !isSelectionMode) return;
    
    const touch = e.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    const messageElement = element?.closest('[data-message-id]');
    
    if (messageElement) {
      const id = messageElement.getAttribute('data-message-id');
      if (id && lastSelectedId.current !== id) {
        onToggleSelection(id);
        lastSelectedId.current = id;
      }
    }
  };

  React.useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      lastSelectedId.current = null;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const isFirstScroll = React.useRef(true);
  const isNavigatingSearchMatch = React.useRef(false);
  const prevIsSearching = React.useRef(isSearching);

  React.useEffect(() => {
    const searchStatusChanged = prevIsSearching.current !== isSearching;
    const searchCancelled = prevIsSearching.current && !isSearching;
    const isFirst = isFirstScroll.current;
    
    // Update the ref for next render
    prevIsSearching.current = isSearching;

    const scrollToBottom = () => {
      if (scrollRef.current && !isSelectionMode && !isNavigatingSearchMatch.current) {
        // Use instant scroll if it's the first scroll OR if search status just changed (on/off)
        const shouldBeInstant = isFirst || searchStatusChanged;
        
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: shouldBeInstant ? 'auto' : 'smooth'
        });
        
        if (isFirst) isFirstScroll.current = false;
      }
    };
    
    // Use a slightly longer delay if search cancelled to ensure DOM is fully updated
    const timeoutId = setTimeout(scrollToBottom, (isFirst || searchStatusChanged) ? 0 : 100);
    return () => clearTimeout(timeoutId);
  }, [messages, isLoading, isSelectionMode, isSearching]);

  // Scroll to search match
  React.useEffect(() => {
    if (isSearching && activeSearchMatchId) {
      isNavigatingSearchMatch.current = true;
      const element = messageRefs.current[activeSearchMatchId];
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightMessageId(activeSearchMatchId);
        
        // Allow auto-scroll again after a delay
        const timer = setTimeout(() => {
          isNavigatingSearchMatch.current = false;
          setHighlightMessageId(null);
        }, 1500);
        return () => clearTimeout(timer);
      } else {
        isNavigatingSearchMatch.current = false;
      }
    } else {
      isNavigatingSearchMatch.current = false;
    }
  }, [activeSearchMatchId, isSearching]);

  return (
    <div 
      ref={scrollRef} 
        className="flex-1 overflow-y-auto p-4 space-y-6 pb-24 select-none"
        onTouchMove={handleTouchMove}
      >
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            isSelected={selectedIds.includes(message.id)}
            isSelectionMode={isSelectionMode}
            isSearching={isSearching}
            searchQuery={searchQuery}
            activeSearchMatchId={activeSearchMatchId}
            highlightMessageId={highlightMessageId}
            contextMenuId={contextMenu?.id}
            settings={settings}
            onMouseDown={handleMouseDown}
            onMouseUp={handleTouchEnd}
            onMouseEnter={handleMouseEnter}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={handleClick}
            scrollToMessage={scrollToMessage}
            messageRef={(el) => { messageRefs.current[message.id] = el; }}
            onRegisterReplay={(id, play) => { replayRefs.current[id] = play; }}
          />
        ))}
        
        {isLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex gap-3"
        >
          <Avatar className="w-8 h-8 border animate-pulse">
            {settings.aiAvatar && <AvatarImage src={settings.aiAvatar} />}
            <AvatarFallback><Bot size={16} /></AvatarFallback>
          </Avatar>
          <div className="bg-white dark:bg-muted border border-border dark:border-none px-4 py-3 rounded-2xl shadow-sm dark:shadow-none">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </motion.div>
      )}

      {/* Context Menu Overlay */}
      <AnimatePresence>
        {contextMenu && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-transparent"
              onClick={() => setContextMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu(null);
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              className="fixed z-[70] bg-popover border border-border rounded-2xl shadow-2xl overflow-hidden min-w-[140px] p-1.5 backdrop-blur-md"
              style={{ 
                left: Math.min(window.innerWidth - 160, Math.max(20, contextMenu.x - 70)),
                top: contextMenu.y > window.innerHeight - 200 
                  ? contextMenu.y - 210 // Pop up if near bottom
                  : contextMenu.y + 10  // Pop down normally
              }}
            >
              <div className="flex flex-col gap-0.5">
                {(() => {
                  const message = messages.find(m => m.id === contextMenu.id);
                  if (!message) return null;

                  return (
                    <>
                      {message.type !== 'voice' && (
                        <button 
                          className="flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-muted rounded-xl transition-colors active:bg-muted/80"
                          onClick={() => handleCopy(message.content)}
                        >
                          <Copy size={16} className="text-muted-foreground" />
                          <span>复制文本</span>
                        </button>
                      )}
                      <button 
                        className="flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-muted rounded-xl transition-colors active:bg-muted/80"
                        onClick={() => handleQuoteClick(message)}
                      >
                        <Quote size={16} className="text-muted-foreground" />
                        <span>引用消息</span>
                      </button>
                      {message.type === 'voice' && (
                        <>
                          <button 
                            className="flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-muted rounded-xl transition-colors active:bg-muted/80"
                            onClick={() => handleTranscribeClick(message)}
                          >
                            <Languages size={16} className="text-muted-foreground" />
                            <span>转为文本</span>
                          </button>
                          <button 
                            className="flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-muted rounded-xl transition-colors active:bg-muted/80"
                            onClick={() => handleReplayClick(message.id)}
                          >
                            <RefreshCcw size={16} className="text-muted-foreground" />
                            <span>重新播放</span>
                          </button>
                        </>
                      )}

                      <div className="h-px bg-border/50 my-1 mx-1" />
                      
                      <button 
                        className="flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-destructive/10 text-destructive rounded-xl transition-colors active:bg-destructive/20"
                        onClick={() => handleDeleteClick(message.id)}
                      >
                        <Trash2 size={16} />
                        <span>删除消息</span>
                      </button>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
