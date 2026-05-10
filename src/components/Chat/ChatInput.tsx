/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Mic, Camera, X, Square, Image as ImageIcon, Quote, Plus } from 'lucide-react';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatMessageDate } from '../../lib/utils';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Toast } from '@capacitor/toast';

interface ChatInputProps {
  onSendMessage: (text: string, type: 'text' | 'voice' | 'image', mediaUrl?: string) => void;
  disabled?: boolean;
  quotedMessage?: any;
  onCancelQuote?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, quotedMessage, onCancelQuote }) => {
  const [text, setText] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);
  const { isRecording, audioUrl, startRecording, stopRecording, setAudioUrl } = useVoiceRecorder();
  const micLongPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isMicLongPress = useRef(false);

  useEffect(() => {
    if (!isRecording) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isRecording]);

  useEffect(() => {
    if (audioUrl) {
      onSendMessage('', 'voice', audioUrl);
      setAudioUrl(null);
    }
  }, [audioUrl, onSendMessage, setAudioUrl]);

  const handleSend = () => {
    if (text.trim() || previewImage) {
      if (previewImage) {
        onSendMessage(text, 'image', previewImage);
        setPreviewImage(null);
      } else {
        onSendMessage(text, 'text');
      }
      setText('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  const takePhoto = async () => {
    try {
      setIsMenuOpen(false);
      const image = await CapCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera
      });
      
      if (image?.dataUrl) {
        setPreviewImage(image.dataUrl);
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('Camera error:', error);
        await Toast.show({ text: '相机访问失败，请检查权限。' });
      }
    }
  };

  const pickImage = async () => {
    try {
      setIsMenuOpen(false);
      const image = await CapCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos
      });
      
      if (image?.dataUrl) {
        setPreviewImage(image.dataUrl);
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('Gallery error:', error);
        await Toast.show({ text: '相册访问失败，请检查权限。' });
      }
    }
  };

  const handleCameraStart = () => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      pickImage();
    }, 600);
  };

  const handleCameraEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleCameraClick = () => {
    if (!isLongPress.current) {
      takePhoto();
    }
  };

  const handleMicDown = () => {
    isMicLongPress.current = false;
    micLongPressTimer.current = setTimeout(() => {
      isMicLongPress.current = true;
      if (!isRecording) {
        startRecording();
      }
    }, 400);
  };

  const handleMicUp = () => {
    if (micLongPressTimer.current) {
      clearTimeout(micLongPressTimer.current);
    }
    
    if (isMicLongPress.current) {
      if (isRecording) {
        stopRecording();
      }
      isMicLongPress.current = false;
    } else {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    }
  };



  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const hasContent = text.trim() || previewImage;

  return (
    <div className="w-full" ref={containerRef}>
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Image Preview */}
        <AnimatePresence>
          {previewImage && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="relative rounded-2xl overflow-hidden bg-muted border border-border/50"
            >
              <img src={previewImage} alt="Preview" className="w-full h-auto max-h-72 object-cover" />
              <button 
                type="button"
                onClick={() => setPreviewImage(null)}
                className="absolute top-3 right-3 w-8 h-8 bg-black/60 backdrop-blur-sm text-white rounded-full flex items-center justify-center hover:bg-black/80 active:scale-90 transition-all"
              >
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quote Display */}
        <AnimatePresence>
          {quotedMessage && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="px-4 py-3 bg-muted/40 border-l-2 border-primary rounded-xl"
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Quote size={11} className="text-primary shrink-0" />
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                  {quotedMessage.role === 'assistant' ? 'AI' : '我'}
                </span>
                <span className="text-[9px] text-muted-foreground/60 ml-auto">{formatMessageDate(quotedMessage.timestamp)}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1 italic">
                {quotedMessage.content || (quotedMessage.type === 'voice' ? '[语音消息]' : '[图片消息]')}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Bar */}
        <div className="flex items-end gap-2">
          {/* Left: Plus Button */}
          <div className="relative shrink-0">
            <Button 
              type="button"
              onClick={() => {
                if (hasContent) return;
                setIsMenuOpen(!isMenuOpen);
              }} 
              size="icon"
              variant="ghost"
              className={cn(
                "w-12 h-12 rounded-full transition-all duration-300 active:scale-95",
                isMenuOpen ? "bg-primary/10 text-primary rotate-45" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Plus size={22} />
            </Button>

            {/* Plus Menu */}
            <AnimatePresence>
              {isMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  className="absolute bottom-full left-0 mb-2 p-4 bg-popover border border-border rounded-2xl shadow-xl min-w-[180px]"
                >

                  <button 
                    type="button"
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted rounded-xl transition-colors active:scale-[0.98]"
                    onClick={takePhoto}
                  >
                    <Camera size={18} className="text-primary" />
                    <span>拍照</span>
                  </button>
                  <button 
                    type="button"
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted rounded-xl transition-colors active:scale-[0.98]"
                    onClick={pickImage}
                  >
                    <ImageIcon size={16} className="text-primary" />
                    <span>相册</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>


          {/* Center: Text Input */}
          <div className="flex-1 relative">
            <Input
              id="chat-text-input"
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isRecording ? "正在录音..." : "输入消息..."}
              className="h-12 px-5 rounded-full bg-muted/50 border-border/30 focus-visible:ring-primary/20 text-[16px] pr-14"
            />
            
            {/* Mic Button - inside input on right */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full transition-all",
                isRecording ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              onPointerDown={handleMicDown}
              onPointerUp={handleMicUp}
              onPointerLeave={() => {
                if (isMicLongPress.current && isRecording) {
                  stopRecording();
                  isMicLongPress.current = false;
                }
                if (micLongPressTimer.current) {
                  clearTimeout(micLongPressTimer.current);
                }
              }}
            >
              {isRecording ? <Square size={18} fill="currentColor" /> : <Mic size={18} />}
            </Button>
          </div>

          {/* Right: Send Button */}
          <AnimatePresence mode="wait">
            {hasContent ? (
              <motion.button
                key="send"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                type="button"
                onClick={handleSend}
                className="shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30 hover:bg-primary/90 active:scale-90 transition-all"
              >
                <Send size={22} />
              </motion.button>
            ) : (
              <div className="w-12 shrink-0" />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
