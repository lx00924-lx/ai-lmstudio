/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PhoneOff, Mic, MicOff, Volume2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppSettings, Message } from '../../types';
import { sendMessageToGemini } from '../../services/gemini';
import { Toast } from '@capacitor/toast';
import { cn } from '../../lib/utils';

interface CallOverlayProps {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  historyMessages: Message[];
  onCallEnd: (newMessages: Message[]) => void;
}

type CallStatus = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

export const CallOverlay: React.FC<CallOverlayProps> = ({
  open,
  onClose,
  settings,
  historyMessages,
  onCallEnd,
}) => {
  const [status, setStatus] = useState<CallStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState('');
  const [userText, setUserText] = useState(''); // 用户当前实时识别结果
  const [aiText, setAiText] = useState(''); // AI 当前正在说的话/回答
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0); // 音频音量用于涟漪动画
  
  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  const statusRef = useRef<CallStatus>('connecting');
  const userTextRef = useRef('');
  const aiGeneratingDoneRef = useRef(false);
  const silenceTimeRef = useRef(0);
  const hasSpokenRef = useRef(false);
  
  const localMessagesRef = useRef<Message[]>([...historyMessages]);
  const newMessagesRef = useRef<Message[]>([]); // 记录当前通话中产生的所有新消息
  
  // TTS Queue Refs
  const speechQueueRef = useRef<string[]>([]);
  const isSpeakingTtsRef = useRef(false);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pendingTtsTextRef = useRef('');
  const ttsCleanTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync status ref
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Clean TTS Synthesis and socket connections on mount/unmount
  useEffect(() => {
    if (open) {
      if (!settings.funasrWsEndpoint) {
        setStatus('error');
        setErrorMessage('请先在“应用设置”中配置 FunASR 实时流式语音 WS 地址。');
        return;
      }
      
      initCall();
    }

    return () => {
      cleanupCall();
    };
  }, [open, settings.funasrWsEndpoint]);

  const initCall = async () => {
    setStatus('connecting');
    setErrorMessage('');
    setUserText('');
    setAiText('');
    setVolume(0);
    newMessagesRef.current = [];
    localMessagesRef.current = [...historyMessages];
    
    // 初始化 TTS
    window.speechSynthesis.cancel();
    speechQueueRef.current = [];
    isSpeakingTtsRef.current = false;
    currentUtteranceRef.current = null;
    pendingTtsTextRef.current = '';

    try {
      // 1. 初始化 FunASR WS
      let targetWsUrl = settings.funasrWsEndpoint!.trim();
      if (!targetWsUrl.startsWith('ws://') && !targetWsUrl.startsWith('wss://')) {
        targetWsUrl = `ws://${targetWsUrl}`;
      }

      // 如果未包含代理路径，则通过服务器的 /api/funasr-ws 端点代理转发，以消除跨域和 HTTPS 混合内容限制
      let finalWsUrl = targetWsUrl;
      if (!targetWsUrl.includes('/api/funasr-ws')) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        if (host) {
          finalWsUrl = `${protocol}//${host}/api/funasr-ws?endpoint=${encodeURIComponent(targetWsUrl)}`;
        }
      }
      
      console.log('Connecting to FunASR WS (via proxy):', finalWsUrl);
      const ws = new WebSocket(finalWsUrl);
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('FunASR WS connection established');
        // 发送初始化配置 JSON
        const config = {
          mode: "2pass",
          chunk_size: [5, 10, 5],
          chunk_interval: 10,
          wav_name: "micro",
          wav_format: "pcm",
          is_speaking: true
        };
        ws.send(JSON.stringify(config));
        
        // 2. 启动音频捕获
        startAudioCapture();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // FunASR 2pass 的通常回包结构包含 text 字段
          if (data && typeof data.text === 'string') {
            const transcript = data.text.trim();
            if (transcript) {
              setUserText(transcript);
              userTextRef.current = transcript;
              silenceTimeRef.current = 0; // 有新 ASR 说明在说话，重置静音检测
              hasSpokenRef.current = true;
            }
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('FunASR WS Error:', err);
        setStatus('error');
        setErrorMessage('FunASR 实时语音连接失败，请确认服务端已启动并且地址正确。');
      };

      ws.onclose = () => {
        console.log('FunASR WS closed');
        if (statusRef.current !== 'error' && statusRef.current !== 'connecting') {
          // 非主动挂断或错误时被动断开
          setStatus('error');
          setErrorMessage('流式语音服务连接已断开。');
        }
      };

    } catch (e: any) {
      console.error('Call initialization failed', e);
      setStatus('error');
      setErrorMessage(`初始化通话失败: ${e.message || '未知错误'}`);
    }
  };

  const startAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;
      source.connect(analyser);

      // 创建 ScriptProcessorNode 进行 2048 采样（单声道）
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(audioCtx.destination);

      silenceTimeRef.current = 0;
      hasSpokenRef.current = false;
      setStatus('listening');

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (statusRef.current !== 'listening') return; // 只有在“倾听”状态才将麦克风数据送去识别

        const inputData = e.inputBuffer.getChannelData(0);

        // 计算 RMS 能量（音量大小）
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        
        // 实时音量波动动画
        setVolume(rms * 100);

        // VAD 静音判断
        if (rms < 0.015) {
          silenceTimeRef.current += e.inputBuffer.duration * 1000;
        } else {
          silenceTimeRef.current = 0;
          hasSpokenRef.current = true;
        }

        // 说话静音超过 1.5 秒且曾经说话过
        if (silenceTimeRef.current > 1500 && hasSpokenRef.current && userTextRef.current.trim()) {
          silenceTimeRef.current = 0;
          hasSpokenRef.current = false;
          triggerAISpeak();
        }

        // 转为 16位有符号 PCM 并发送
        if (!isMuted) {
          const buffer = floatTo16BitPCM(inputData);
          wsRef.current.send(buffer);
        }
      };

    } catch (err: any) {
      console.error('Audio capture permission error:', err);
      setStatus('error');
      setErrorMessage('无法捕获麦克风。请检查应用或浏览器的麦克风权限设置。');
    }
  };

  const floatTo16BitPCM = (input: Float32Array): ArrayBuffer => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output.buffer;
  };

  const sendWsSpeakingStatus = (isSpeaking: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ is_speaking: isSpeaking }));
      } catch (e) {
        console.error('Error sending WS status:', e);
      }
    }
  };

  const triggerAISpeak = async () => {
    const speechText = userTextRef.current.trim();
    if (!speechText) return;

    console.log('User spoke complete sentence:', speechText);
    
    // 1. 切换到思考状态
    setStatus('thinking');
    setVolume(0);
    sendWsSpeakingStatus(false); // 停止倾听，避免干扰 ASR

    // 2. 构造 User 消息并保存到 local 历史
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: speechText,
      timestamp: new Date(),
      type: 'text'
    };
    
    localMessagesRef.current.push(userMessage);
    newMessagesRef.current.push(userMessage);

    // 3. 准备接收 AI 回复
    setAiText('');
    aiGeneratingDoneRef.current = false;
    pendingTtsTextRef.current = '';
    
    // 初始化播放队列
    speechQueueRef.current = [];
    isSpeakingTtsRef.current = false;

    let aiFullContent = '';
    
    try {
      await sendMessageToGemini(localMessagesRef.current, settings, (chunk) => {
        aiFullContent += chunk;
        setAiText(aiFullContent);
        
        // 实时对 Chunk 进行流式句号拆分并放入 TTS 播放队列
        handleTtsChunk(chunk);
      });

      // AI 回复大模型生成完成
      aiGeneratingDoneRef.current = true;
      
      // 把最后的 pending TTS 扔进队列播放
      if (pendingTtsTextRef.current.trim()) {
        queueSpeech(pendingTtsTextRef.current.trim());
        pendingTtsTextRef.current = '';
      }

      // 4. 将 AI 完整消息也记录下来
      const aiMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: aiFullContent,
        timestamp: new Date(),
        type: 'text'
      };
      localMessagesRef.current.push(aiMessage);
      newMessagesRef.current.push(aiMessage);

      // 清空 ASR 以便进行下一轮
      setUserText('');
      userTextRef.current = '';

    } catch (e: any) {
      console.error('Gemini call failed in call mode', e);
      setStatus('error');
      setErrorMessage(`AI 服务调用失败: ${e.message || '请检查 API 终端或 API Key'}`);
    }
  };

  // TTS 流式断句分段处理
  const handleTtsChunk = (chunk: string) => {
    pendingTtsTextRef.current += chunk;
    
    // 按逗号、句号、换行等常见断句符切分
    const sentences = pendingTtsTextRef.current.split(/[，。？！\n；,;.!?]/);
    
    if (sentences.length > 1) {
      for (let i = 0; i < sentences.length - 1; i++) {
        const sentence = sentences[i].trim();
        if (sentence) {
          queueSpeech(sentence);
        }
      }
      // 保留最后一个可能还没结束的子句
      pendingTtsTextRef.current = sentences[sentences.length - 1];
    }
  };

  const queueSpeech = (text: string) => {
    speechQueueRef.current.push(text);
    if (!isSpeakingTtsRef.current) {
      speakNextInQueue();
    }
  };

  const speakNextInQueue = () => {
    if (speechQueueRef.current.length === 0) {
      isSpeakingTtsRef.current = false;
      // 全部播放完毕后，如果大模型已经生成结束，重置为 listening 状态
      if (aiGeneratingDoneRef.current) {
        // 短暂延迟后切换为 listening，给用户一个完美的过渡体验
        if (ttsCleanTimerRef.current) clearTimeout(ttsCleanTimerRef.current);
        ttsCleanTimerRef.current = setTimeout(() => {
          setStatus('listening');
          setVolume(0);
          sendWsSpeakingStatus(true); // 重新启用流式 ASR 倾听
        }, 800);
      }
      return;
    }

    isSpeakingTtsRef.current = true;
    const textToSpeak = speechQueueRef.current.shift()!;
    
    // 过滤 Markdown 和无效字符
    const cleanText = textToSpeak.replace(/[#*`_~[\]()]/g, '').trim();
    if (!cleanText) {
      speakNextInQueue();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.15; // 稍快语速提高灵动感
    
    // 设置发音人
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.includes('zh') || v.lang.includes('ZH'));
    if (zhVoice) {
      utterance.voice = zhVoice;
    }

    currentUtteranceRef.current = utterance;

    utterance.onstart = () => {
      setStatus('speaking');
    };

    utterance.onend = () => {
      currentUtteranceRef.current = null;
      speakNextInQueue();
    };

    utterance.onerror = (e) => {
      console.error('SpeechSynthesis error:', e);
      currentUtteranceRef.current = null;
      speakNextInQueue();
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleHangup = () => {
    // 结束通话，输出新产生的对话消息
    onCallEnd(newMessagesRef.current);
    cleanupCall();
    onClose();
  };

  const cleanupCall = () => {
    window.speechSynthesis.cancel();
    if (ttsCleanTimerRef.current) clearTimeout(ttsCleanTimerRef.current);
    
    // 停止 WS
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ is_speaking: false }));
        }
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }

    // 停止麦克风采集
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // 停止 AudioContext
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }
    
    analyserRef.current = null;
  };

  if (!open) return null;

  // 根据当前状态显示对应涟漪和呼吸发光效果
  const getPulseScale = () => {
    if (status === 'listening') {
      return 1 + (volume / 100) * 0.4; // 根据说话音量实时波动
    }
    return 1;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-black/75 backdrop-blur-xl p-6 text-white"
      >
        {/* Top bar info */}
        <div className="w-full flex items-center justify-between max-w-lg mt-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                status === 'listening' ? "bg-emerald-400" : status === 'thinking' ? "bg-amber-400" : status === 'speaking' ? "bg-sky-400" : "bg-destructive"
              )}></span>
              <span className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                status === 'listening' ? "bg-emerald-500" : status === 'thinking' ? "bg-amber-500" : status === 'speaking' ? "bg-sky-500" : "bg-destructive"
              )}></span>
            </span>
            <span className="text-xs font-mono text-white/60 uppercase tracking-widest">
              {status === 'connecting' && '正在连接转写服务...'}
              {status === 'listening' && '正在倾听中...'}
              {status === 'thinking' && '正在理解思考...'}
              {status === 'speaking' && '正在播放语音...'}
              {status === 'error' && '语音连接错误'}
            </span>
          </div>
          
          {status !== 'error' && status !== 'connecting' && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "w-10 h-10 rounded-full border border-white/10 text-white/80 hover:text-white hover:bg-white/10 transition-all",
                isMuted && "bg-destructive/20 border-destructive/40 text-destructive hover:bg-destructive/30 hover:text-destructive"
              )}
              onClick={() => setIsMuted(!isMuted)}
              title={isMuted ? "取消静音" : "静音麦克风"}
            >
              {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </Button>
          )}
        </div>

        {/* Center avatar & high-end wave ripples */}
        <div className="relative flex-1 flex items-center justify-center w-full max-w-lg">
          {/* Pulsing ripples */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {status === 'listening' && (
              <>
                <motion.div
                  animate={{ scale: getPulseScale(), opacity: [0.1, 0.4, 0.1] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: 'easeOut' }}
                  className="absolute w-48 h-48 rounded-full bg-emerald-500/20 border border-emerald-500/30"
                />
                <motion.div
                  animate={{ scale: getPulseScale() * 1.3, opacity: [0.05, 0.2, 0.05] }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeOut', delay: 0.3 }}
                  className="absolute w-64 h-64 rounded-full bg-emerald-500/10 border border-emerald-500/20"
                />
              </>
            )}

            {status === 'thinking' && (
              <>
                <motion.div
                  animate={{ scale: [1, 1.15, 1], opacity: [0.2, 0.5, 0.2] }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                  className="absolute w-48 h-48 rounded-full bg-amber-500/20 border border-amber-500/30"
                />
                <motion.div
                  animate={{ scale: [1.15, 1.3, 1.15], opacity: [0.1, 0.3, 0.1] }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut', delay: 0.5 }}
                  className="absolute w-64 h-64 rounded-full bg-amber-500/10 border border-amber-500/20"
                />
              </>
            )}

            {status === 'speaking' && (
              <>
                <motion.div
                  animate={{ scale: [1, 1.25, 1], opacity: [0.15, 0.4, 0.15] }}
                  transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                  className="absolute w-48 h-48 rounded-full bg-sky-500/20 border border-sky-500/30"
                />
                <motion.div
                  animate={{ scale: [1.15, 1.45, 1.15], opacity: [0.05, 0.2, 0.05] }}
                  transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut', delay: 0.2 }}
                  className="absolute w-64 h-64 rounded-full bg-sky-500/10 border border-sky-500/20"
                />
              </>
            )}
          </div>

          {/* AI Avatar */}
          <div className="relative z-10 w-28 h-28 rounded-full overflow-hidden border-2 border-white/20 shadow-2xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center">
            {settings.aiAvatar ? (
              <img src={settings.aiAvatar} alt="AI Avatar" className="w-full h-full object-cover" />
            ) : (
              <Volume2 size={40} className="text-white animate-pulse" />
            )}
          </div>
        </div>

        {/* Dynamic subtitles and transcript screen */}
        <div className="w-full max-w-lg bg-white/5 border border-white/10 rounded-[28px] p-5 backdrop-blur-md space-y-4 mb-6">
          {status === 'error' ? (
            <div className="space-y-3 py-2 text-center">
              <p className="text-sm text-destructive font-medium leading-relaxed">{errorMessage}</p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-white/10 bg-white/5 text-white/90 hover:bg-white/10 active:scale-95"
                onClick={initCall}
              >
                <RefreshCw size={12} className="mr-1.5" />
                重新尝试连接
              </Button>
            </div>
          ) : (
            <>
              {/* User transcript (Real-time ASR) */}
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest font-semibold">你</span>
                <p className="text-sm font-medium text-white/90 line-clamp-2 min-h-[2.5rem]">
                  {userText || (status === 'listening' ? (isMuted ? '麦克风已静音' : '我在听，请开始说话...') : ' ')}
                </p>
              </div>

              {/* Divider */}
              <div className="border-t border-white/5" />

              {/* AI text (Real-time LLM) */}
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-sky-400 uppercase tracking-widest font-semibold">{settings.aiName || 'AI'}</span>
                <p className="text-sm text-white/70 leading-relaxed line-clamp-3 min-h-[3.75rem]">
                  {aiText || (status === 'thinking' ? '正在思考中...' : ' ')}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Control bar */}
        <div className="w-full max-w-md flex justify-center pb-6">
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="w-16 h-16 rounded-full bg-red-500 text-white shadow-xl shadow-red-500/20 hover:bg-red-600 transition-all active:scale-90 flex items-center justify-center border-4 border-black/20"
            onClick={handleHangup}
            title="挂断"
          >
            <PhoneOff size={24} />
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
