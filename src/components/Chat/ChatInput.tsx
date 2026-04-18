/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Mic, Camera, X, Square, Image as ImageIcon, Quote } from 'lucide-react';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);
  const { isRecording, audioUrl, startRecording, stopRecording, setAudioUrl } = useVoiceRecorder();
  const micLongPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isMicLongPress = useRef(false);

  // Auto-focus when isRecording becomes false
  useEffect(() => {
    if (!isRecording) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isRecording]);

  // Auto-send when audioUrl is set
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
      
      // Explicitly focus after a short delay to ensure DOM update
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  const takePhoto = async () => {
    try {
      const image = await CapCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera
      });
      
      if (image.dataUrl) {
        setPreviewImage(image.dataUrl);
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('Camera error:', error);
      }
    }
  };

  const pickImage = async () => {
    try {
      const image = await CapCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos
      });
      
      if (image.dataUrl) {
        setPreviewImage(image.dataUrl);
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('Gallery error:', error);
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
      // It was a click
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewImage(reader.result as string);
        e.target.value = '';
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="w-full">
      <div className="max-w-2xl mx-auto space-y-4">
        <AnimatePresence>
          {previewImage && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative flex flex-col gap-3 p-3 bg-card border border-primary/20 rounded-[32px] shadow-2xl max-w-sm w-full mx-auto"
            >
              <div className="relative rounded-[24px] overflow-hidden aspect-video bg-muted border border-border/50">
                <img src={previewImage} alt="Preview" className="w-full h-full object-cover" />
                <div className="absolute top-3 left-3 px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg text-[10px] text-white font-mono uppercase tracking-[0.2em] border border-white/10">
                  Captured
                </div>
              </div>
              
              <div className="flex gap-3">
                <Button 
                  type="button"
                  variant="outline" 
                  className="flex-1 h-12 rounded-2xl border-muted-foreground/20 text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95"
                  onClick={() => {
                    setPreviewImage(null);
                    // Small delay to allow state update before opening camera
                    setTimeout(() => takePhoto(), 100);
                  }}
                >
                  重拍
                </Button>
                <Button 
                  type="button"
                  className="flex-1 h-12 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 font-medium"
                  onClick={handleSend}
                >
                  发送
                </Button>
              </div>
              
              <button 
                type="button"
                onClick={() => setPreviewImage(null)}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-2 shadow-xl hover:scale-110 active:scale-90 transition-all border-2 border-background"
              >
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {quotedMessage && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="px-4 py-3 bg-muted/50 border border-border/50 rounded-2xl flex items-center justify-between gap-3 shadow-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-2">
                    <Quote size={12} className="text-primary" />
                    <span className="text-[10px] font-bold text-primary uppercase tracking-wider">{quotedMessage.role === 'assistant' ? 'AI' : '我'}</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground/60">{formatMessageDate(quotedMessage.timestamp)}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1 italic">
                  {quotedMessage.content || (quotedMessage.type === 'voice' ? '[语音消息]' : '[图片消息]')}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 rounded-full hover:bg-muted"
                onClick={onCancelQuote}
              >
                <X size={14} />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3 bg-white dark:bg-[rgba(255,255,255,0.03)] border border-border rounded-[24px] p-2 h-20 shadow-sm dark:shadow-none">
          <div className="flex gap-1">
            <Button 
              type="button"
              variant="ghost" 
              size="icon" 
              className="shrink-0 w-11 h-11 rounded-full bg-card border select-none active:scale-95 transition-transform"
              onPointerDown={handleCameraStart}
              onPointerUp={handleCameraEnd}
              onPointerLeave={handleCameraEnd}
              onClick={handleCameraClick}
              disabled={isRecording}
              title="点击拍照，长按选择图片"
            >
              <Camera size={20} />
            </Button>
          </div>
          
          {/* Hidden inputs for fallback if needed, but we use Capacitor now */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImageUpload} 
            accept="image/*" 
            className="hidden" 
          />

          <div className="relative flex-1 h-full flex items-center">
            <Input
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
              className="h-full border-none bg-transparent focus-visible:ring-0 text-[15px] placeholder:text-muted-foreground"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "w-11 h-11 rounded-full transition-colors bg-card border",
                isRecording ? "text-primary border-primary/50" : "text-muted-foreground"
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

          <Button 
            type="button"
            onClick={handleSend} 
            disabled={(!text.trim() && !previewImage && !audioUrl)}
            size="icon"
            className="shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_15px_rgba(0,210,255,0.4)]"
          >
            <Send size={20} />
          </Button>
        </div>
      </div>
    </div>
  );
};
