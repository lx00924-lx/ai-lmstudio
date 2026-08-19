/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppSettings } from '../../types';
import { API_BASE_URL } from '../../config';
import { ImagePlus, X, Camera, Image as ImageIcon, ChevronDown, Loader2, Bug, Terminal, Copy, Trash2, HardDrive, FolderOpen, RotateCcw, RefreshCw, Check, Type } from 'lucide-react';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { CapacitorHttp } from '@capacitor/core';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { ImageCropDialog } from './ImageCropDialog';
import { ModelSelector } from '../Chat/ModelSelector';
import { copyLogsToClipboard, clearLogs } from '../../lib/logger';
import { normalizeApiBaseUrl, getModelsUrl, normalizeHttpAsrUrl, normalizeWsAsrUrl } from '../../services/gemini';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onCheckUpdate: () => Promise<{ success: boolean; data?: any; error?: string }>;
  userId?: string;
  username?: string;
  onOpenLogViewer?: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onOpenChange,
  settings,
  onSave,
  onCheckUpdate,
  userId,
  username,
  onOpenLogViewer,
}) => {
  const [localSettings, setLocalSettings] = React.useState<AppSettings>(settings);
  const [updateStatus, setUpdateStatus] = React.useState<{ type: 'error' | 'success', message: string } | null>(null);
  const [isChecking, setIsChecking] = React.useState(false);
  const [isFetchingModels, setIsFetchingModels] = React.useState(false);
  const [modelFetchStatus, setModelFetchStatus] = React.useState<{ type: 'error' | 'success', message: string } | null>(null);
  const [httpTestStatus, setHttpTestStatus] = React.useState<{ type: 'error' | 'success', message: string } | null>(null);
  const [isTestingHttp, setIsTestingHttp] = React.useState(false);
  const [wsTestStatus, setWsTestStatus] = React.useState<{ type: 'error' | 'success', message: string } | null>(null);
  const [isTestingWs, setIsTestingWs] = React.useState(false);
  const [cropImage, setCropImage] = React.useState<{ src: string, field: keyof AppSettings } | null>(null);
  const [passwordStatus, setPasswordStatus] = React.useState<{ type: 'error' | 'success', message: string } | null>(null);
  const [oldPassword, setOldPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [storageInfo, setStorageInfo] = React.useState<{ currentPath: string; defaultPath: string; isCustom: boolean; configuredPath: string } | null>(null);
  const [storageStatus, setStorageStatus] = React.useState<{ type: 'error' | 'success' | 'info'; message: string; needRestart?: boolean } | null>(null);
  const [isChangingStorage, setIsChangingStorage] = React.useState(false);

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

  const loadStorageInfo = React.useCallback(async () => {
    if (window.electronAPI?.getStorageInfo) {
      try {
        const info = await window.electronAPI.getStorageInfo();
        setStorageInfo(info);
      } catch (err) {
        console.error('获取存储目录信息失败:', err);
      }
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      loadStorageInfo();
    }
  }, [open, loadStorageInfo]);

  const handleSelectStoragePath = async () => {
    if (!window.electronAPI?.selectStoragePath) return;
    setIsChangingStorage(true);
    setStorageStatus(null);
    try {
      const res = await window.electronAPI.selectStoragePath();
      if (!res.canceled && res.selectedPath) {
        const setRes = await window.electronAPI.setStoragePath(res.selectedPath);
        if (setRes.success) {
          setStorageStatus({
            type: 'success',
            message: `已设置新目录：${res.selectedPath}（需重启软件生效）`,
            needRestart: true,
          });
          await loadStorageInfo();
        } else {
          setStorageStatus({ type: 'error', message: setRes.error || '保存路径配置失败' });
        }
      }
    } catch (err: any) {
      setStorageStatus({ type: 'error', message: err.message || '选择目录失败' });
    } finally {
      setIsChangingStorage(false);
    }
  };

  const handleResetStoragePath = async () => {
    if (!window.electronAPI?.setStoragePath) return;
    try {
      const res = await window.electronAPI.setStoragePath(null);
      if (res.success) {
        setStorageStatus({
          type: 'info',
          message: '已恢复系统默认存储目录（需重启软件生效）',
          needRestart: true,
        });
        await loadStorageInfo();
      }
    } catch (err: any) {
      setStorageStatus({ type: 'error', message: err.message || '恢复默认失败' });
    }
  };

  const handleOpenStorageFolder = async () => {
    if (!window.electronAPI?.openStorageFolder) return;
    try {
      await window.electronAPI.openStorageFolder(storageInfo?.currentPath);
    } catch (err: any) {
      setStorageStatus({ type: 'error', message: err.message || '打开目录失败' });
    }
  };

  const handleRelaunch = async () => {
    if (window.electronAPI?.relaunchApp) {
      await window.electronAPI.relaunchApp();
    }
  };

  React.useEffect(() => {
    if (!open) {
      setUpdateStatus(null);
      setIsChecking(false);
      setModelFetchStatus(null);
      setPasswordStatus(null);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    let initialOpacity = settings.backgroundOpacity;
    if (initialOpacity != null && initialOpacity <= 1 && initialOpacity > 0) {
      initialOpacity = Math.round(initialOpacity * 100);
    } else if (initialOpacity == null) {
      initialOpacity = 100;
    }
    setLocalSettings({ ...settings, backgroundOpacity: initialOpacity });
  }, [settings, open]);

  const fetchModels = async (endpoint: string) => {
    if (!endpoint || !endpoint.trim()) return;
    
    setIsFetchingModels(true);
    setModelFetchStatus(null);

    const isVolces = endpoint.includes('volces.com') || endpoint.includes('volcengine.com');
    const isAliyun = endpoint.includes('dashscope.aliyuncs.com');
    const isZhipu = endpoint.includes('open.bigmodel.cn');
    const isBaidu = endpoint.includes('qianfan.baidubce.com');
    const isMiniMax = endpoint.includes('api.minimax.chat');
    const isOllama = endpoint.includes('11434') || endpoint.includes('ollama');

    const base = normalizeApiBaseUrl(endpoint);
    const candidateUrls = [
      `${base}/models`,
      ...(isVolces ? [`${base}/endpoints`, `${base}/bots`] : []),
      ...(isOllama ? [`${base.replace(/\/v1$/, '')}/api/tags`] : []),
    ];

    let foundModels: string[] = [];
    let lastError: string = '';

    for (const url of candidateUrls) {
      try {
        const options = {
          url: url,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${localSettings.apiKey || 'lm-studio'}`,
            'Content-Type': 'application/json',
          },
          connectTimeout: 8000,
          readTimeout: 8000,
        };

        const response = await CapacitorHttp.request(options);

        if (response.status >= 200 && response.status < 300) {
          const data = response.data;
          let list: any[] = [];

          if (data && Array.isArray(data.data)) list = data.data;
          else if (data && Array.isArray(data.items)) list = data.items;
          else if (data && Array.isArray(data.endpoints)) list = data.endpoints;
          else if (data && Array.isArray(data.bots)) list = data.bots;
          else if (data && Array.isArray(data.models)) list = data.models; // Ollama /api/tags
          else if (Array.isArray(data)) list = data;

          const extracted = list
            .map((m: any) => m.id || m.name || m.endpoint_id || m.model || m.model_name)
            .filter(Boolean);

          if (extracted.length > 0) {
            foundModels = Array.from(new Set([...foundModels, ...extracted]));
          }
        } else {
          const serverMsg = response.data?.error?.message || response.data?.message || response.data?.msg || `HTTP ${response.status}`;
          lastError = serverMsg;
        }
      } catch (e: any) {
        lastError = e?.message || '网络连接超时';
      }
    }

    if (foundModels.length > 0) {
      foundModels.sort((a, b) => a.localeCompare(b));
      const defaultModel = foundModels[0];
      setLocalSettings(prev => ({
        ...prev,
        availableModels: foundModels,
        modelName: prev.modelName && foundModels.includes(prev.modelName) ? prev.modelName : defaultModel,
      }));
      setModelFetchStatus({ type: 'success', message: `发现 ${foundModels.length} 个可用模型/接入点` });
    } else {
      if (isVolces) {
        setModelFetchStatus({ 
          type: 'error', 
          message: '火山方舟已限制 API 遍历权限。请直接在上方“模型名称”手动填写接入点 ID，即可正常发起对话' 
        });
      } else if (isAliyun) {
        setModelFetchStatus({ 
          type: 'error', 
          message: '阿里百炼/通义千问已限制模型遍历。请直接在上方“模型名称”填写模型名（例如 qwen-plus、qwen-max、qwen-turbo、qwen2.5-72b-instruct）即可正常使用' 
        });
      } else if (isZhipu) {
        setModelFetchStatus({ 
          type: 'error', 
          message: '智谱 AI (GLM) 未开放模型列表遍历权限。请在上方“模型名称”手动填写（例如 glm-4-plus、glm-4-flash、glm-4-air、glm-4v）即可正常使用' 
        });
      } else if (isBaidu) {
        setModelFetchStatus({ 
          type: 'error', 
          message: '百度千帆已限制 API 遍历权限。请在上方“模型名称”手动填写模型名（例如 ernie-4.0-8k、ernie-3.5-8k）即可正常使用' 
        });
      } else if (isMiniMax) {
        setModelFetchStatus({ 
          type: 'error', 
          message: 'MiniMax 已限制模型遍历。请在上方“模型名称”手动填写（例如 abab6.5s-chat、MiniMax-Text-01）即可正常使用' 
        });
      } else {
        setModelFetchStatus({ 
          type: 'error', 
          message: lastError ? `获取失败: ${lastError}（若 API 限制了遍历，可直接在上方手动输入模型名称）` : '未发现可用模型，请手动输入模型名称' 
        });
      }
    }

    setIsFetchingModels(false);
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ type: 'error', message: '两次新密码不一致' });
      return;
    }
    if (!oldPassword || !newPassword) {
      setPasswordStatus({ type: 'error', message: '请填写所有密码字段' });
      return;
    }
    
    try {
      const baseUrl = API_BASE_URL;
      const response = await fetch(`${baseUrl}/api/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, oldPassword, newPassword })
      });
      const data = await response.json();
      if (response.ok) {
        setPasswordStatus({ type: 'success', message: '密码修改成功' });
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordStatus({ type: 'error', message: data.error || '修改失败' });
      }
    } catch (e) {
      setPasswordStatus({ type: 'error', message: '连接错误' });
    }
  };

  const handleInnerCheckUpdate = async () => {
    setIsChecking(true);
    setUpdateStatus(null);
    const result = await onCheckUpdate();
    setIsChecking(false);
    
    if (!result.success) {
      setUpdateStatus({ type: 'error', message: result.error || '检测失败' });
    } else if (result.data === 'latest') {
      setUpdateStatus({ type: 'success', message: '当前已是最新版本' });
    }
    // If it's a new version, App.tsx handles the UpdateDialog
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLocalSettings((prev) => ({ ...prev, [name]: value }));
  };

  const handleImageSelect = async (field: keyof AppSettings, source: CameraSource) => {
    try {
      const image = await CapCamera.getPhoto({
        quality: 90,
        width: 800,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: source
      });
      
      if (image.dataUrl) {
        setCropImage({ src: image.dataUrl, field });
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('Image selection error:', error);
      }
    }
  };

  const clearField = (field: keyof AppSettings) => {
    setLocalSettings(prev => ({ ...prev, [field]: '' }));
  };

  const handleTestHttp = async () => {
    if (!localSettings.funasrHttpEndpoint?.trim()) {
      setHttpTestStatus({ type: 'error', message: '请先输入转写 HTTP 地址' });
      return;
    }
    const targetUrl = normalizeHttpAsrUrl(localSettings.funasrHttpEndpoint);
    setIsTestingHttp(true);
    setHttpTestStatus(null);

    try {
      const dummyWavHeader = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
        0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
        0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00
      ]);
      const blob = new Blob([dummyWavHeader], { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('file', blob, 'test.wav');
      formData.append('audio_in', blob, 'test.wav');

      const baseUrl = (window as any).Capacitor?.isNativePlatform?.() ? API_BASE_URL : '';
      let proxyUrl = `${baseUrl}/api/funasr-transcribe?endpoint=${encodeURIComponent(targetUrl)}`;
      if (localSettings.asrModel) {
        proxyUrl += `&model=${encodeURIComponent(localSettings.asrModel)}`;
      }
      
      const headers: Record<string, string> = {};
      const testApiKey = localSettings.asrApiKey || localSettings.apiKey;
      if (testApiKey) {
        headers['x-asr-api-key'] = testApiKey;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        setHttpTestStatus({ type: 'success', message: '连接成功：语音转写接口响应正常' });
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 400 || res.status === 405 || res.status === 200) {
          setHttpTestStatus({ type: 'success', message: '连接成功：转写服务在线' });
        } else {
          setHttpTestStatus({ type: 'error', message: `服务返回状态码 ${res.status}${data.error ? `: ${data.error}` : ''}` });
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setHttpTestStatus({ type: 'error', message: '连接超时，请检查服务地址与网络' });
      } else {
        setHttpTestStatus({ type: 'error', message: err.message || '连接失败，请检查网络与端口' });
      }
    } finally {
      setIsTestingHttp(false);
    }
  };

  const handleTestWs = () => {
    if (!localSettings.funasrWsEndpoint?.trim()) {
      setWsTestStatus({ type: 'error', message: '请先输入实时流 WS 地址' });
      return;
    }
    const targetWsUrl = normalizeWsAsrUrl(localSettings.funasrWsEndpoint);
    setIsTestingWs(true);
    setWsTestStatus(null);

    const isNativeApp = typeof window !== 'undefined' && (
      window.location.protocol === 'file:' || 
      window.location.protocol === 'capacitor:' || 
      !!(window as any).Capacitor?.isNativePlatform?.() ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );

    let finalWsUrl = targetWsUrl;
    if (!isNativeApp && !targetWsUrl.includes('/api/funasr-ws')) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      if (host && window.location.protocol.startsWith('http')) {
        finalWsUrl = `${protocol}//${host}/api/funasr-ws?endpoint=${encodeURIComponent(targetWsUrl)}`;
      }
    }

    try {
      const ws = new WebSocket(finalWsUrl, 'binary');
      let isDone = false;
      const timeoutId = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          try { ws.close(); } catch (_) {}
          setWsTestStatus({ type: 'error', message: '连接超时，请检查 WS 地址与端口' });
          setIsTestingWs(false);
        }
      }, 5000);

      ws.onopen = () => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timeoutId);
          setWsTestStatus({ type: 'success', message: '连接成功：WebSocket 实时流服务就绪' });
          setIsTestingWs(false);
          try { ws.close(); } catch (_) {}
        }
      };

      ws.onerror = (e) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timeoutId);
          setWsTestStatus({ type: 'error', message: 'WebSocket 连接失败，请检查端口是否开放' });
          setIsTestingWs(false);
        }
      };
    } catch (e: any) {
      setWsTestStatus({ type: 'error', message: e.message || '创建 WebSocket 失败' });
      setIsTestingWs(false);
    }
  };

  const handleSave = () => {
    let validOpacity = localSettings.backgroundOpacity;
    if (validOpacity == null || isNaN(validOpacity)) {
      validOpacity = 100;
    } else {
      validOpacity = Math.min(100, Math.max(0, Math.round(validOpacity)));
    }

    const updatedSettings = {
      ...localSettings,
      apiEndpoint: localSettings.apiEndpoint?.trim() || '',
      funasrHttpEndpoint: localSettings.funasrHttpEndpoint?.trim() || '',
      funasrWsEndpoint: localSettings.funasrWsEndpoint?.trim() || '',
      asrModel: localSettings.asrModel?.trim() || '',
      asrApiKey: localSettings.asrApiKey?.trim() || '',
      backgroundOpacity: validOpacity
    };
    onSave(updatedSettings);
    onOpenChange(false);
  };

  const FileUploadField = ({ label, field, placeholder }: { label: string, field: keyof AppSettings, placeholder?: string }) => (
    <div className="grid grid-cols-4 items-center gap-4">
      <Label className="text-right text-xs">{label}</Label>
      <div className="col-span-3 flex items-center gap-2">
        {localSettings[field] ? (
          <div className="relative group">
            <img 
              src={localSettings[field] as string} 
              alt={label} 
              className="w-10 h-10 rounded-lg object-cover border border-border" 
            />
            <button 
              onClick={() => clearField(field)}
              className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              className="w-10 h-10 rounded-lg border-dashed transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
              onClick={() => handleImageSelect(field, CameraSource.Camera)}
              title="拍照"
            >
              <Camera size={16} className="text-muted-foreground" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-10 h-10 rounded-lg border-dashed transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
              onClick={() => handleImageSelect(field, CameraSource.Photos)}
              title="相册"
            >
              <ImageIcon size={16} className="text-muted-foreground" />
            </Button>
          </div>
        )}
        <span className="text-[10px] text-muted-foreground truncate flex-1">
          {localSettings[field] ? '已选择图片' : (placeholder || '选择图片')}
        </span>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="w-[94vw] max-w-[440px] sm:max-w-[480px] bg-white dark:bg-black border-border text-foreground max-h-[85vh] max-h-[85dvh] overflow-y-auto rounded-2xl sm:rounded-3xl p-4 sm:p-6"
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>应用设置</DialogTitle>
            <span className="text-[10px] font-mono text-muted-foreground mr-6">
              {localStorage.getItem('app_version') || 'v0.0.10'}
            </span>
          </div>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-xs">登录账号</Label>
            <span className="col-span-3 text-xs text-muted-foreground">
              {username ? username : '游客'}
            </span>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="userName" className="text-right text-xs">用户名</Label>
            <Input id="userName" name="userName" value={localSettings.userName} onChange={handleChange} className="col-span-3 h-8 text-xs" />
          </div>
          
          <FileUploadField label="用户头像" field="userAvatar" />

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="aiName" className="text-right text-xs">AI 名称</Label>
            <Input id="aiName" name="aiName" value={localSettings.aiName} onChange={handleChange} className="col-span-3 h-8 text-xs" />
          </div>

          <FileUploadField label="AI 头像" field="aiAvatar" />

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="apiKey" className="text-right text-xs">API Key</Label>
            <Input id="apiKey" name="apiKey" type="password" value={localSettings.apiKey} onChange={handleChange} className="col-span-3 h-8 text-xs" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="modelName" className="text-right text-xs">模型名称</Label>
            <div className="col-span-3">
              <ModelSelector 
                 settings={localSettings} 
                 onUpdateSettings={setLocalSettings} 
                 modelsOverride={localSettings.availableModels}
              />
            </div>
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="apiEndpoint" className="text-right text-xs mt-2.5">API 终端</Label>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Input 
                id="apiEndpoint" 
                name="apiEndpoint" 
                value={localSettings.apiEndpoint} 
                onChange={handleChange}
                className="h-8 text-xs flex-1" 
              />
              <span className="text-[10px] text-muted-foreground">
                支持智能识别各类模型服务（如火山方舟 /api/v3、DeepSeek、OpenAI 等），自动防止重复拼接
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs transition-all hover:bg-primary/10 hover:text-primary active:scale-95 mt-0.5"
                onClick={() => fetchModels(localSettings.apiEndpoint)}
                disabled={isFetchingModels}
              >
                {isFetchingModels ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
                获取模型列表
              </Button>
            </div>
          </div>

          {modelFetchStatus && (
            <div className="grid grid-cols-4 items-center gap-4">
              <div></div>
              <div className="col-span-3">
                <div className={cn(
                  "text-[10px] p-1.5 rounded-md border",
                  modelFetchStatus.type === 'success' ? "bg-primary/10 border-primary/20 text-primary" : "bg-destructive/10 border-destructive/20 text-destructive"
                )}>
                  {modelFetchStatus.message}
                </div>
              </div>
            </div>
          )}

          <FileUploadField label="自定义背景" field="customBackground" placeholder="应用自定义壁纸" />
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-xs flex items-center justify-end gap-1">
              <Type className="w-3 h-3 text-muted-foreground" />
              字体大小
            </Label>
            <div className="col-span-3 flex flex-col gap-1.5">
              <div className="grid grid-cols-4 gap-1.5 p-1 bg-muted/40 rounded-lg border border-border/50">
                {[
                  { value: 'sm', label: '小号', size: '13px' },
                  { value: 'base', label: '标准', size: '15px' },
                  { value: 'lg', label: '大号', size: '16px' },
                  { value: 'xl', label: '特大', size: '18px' },
                ].map((item) => {
                  const isSelected = (localSettings.chatFontSize || 'base') === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setLocalSettings(prev => ({ ...prev, chatFontSize: item.value as any }))}
                      className={cn(
                        "flex flex-col items-center justify-center py-1.5 px-1 rounded-md text-xs font-medium transition-all",
                        isSelected 
                          ? "bg-primary text-primary-foreground shadow-sm scale-[1.02]" 
                          : "hover:bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className="text-[11px] leading-none">{item.label}</span>
                      <span className="text-[9px] opacity-70 leading-none mt-0.5 font-mono">{item.size}</span>
                    </button>
                  );
                })}
              </div>
              <div className={cn(
                "p-2 rounded bg-muted/20 border border-border/40 text-muted-foreground transition-all flex items-center justify-between",
                (localSettings.chatFontSize === 'sm') && "text-xs",
                (localSettings.chatFontSize === 'base' || !localSettings.chatFontSize) && "text-[14px]",
                (localSettings.chatFontSize === 'lg') && "text-[16px]",
                (localSettings.chatFontSize === 'xl') && "text-[18px]",
              )}>
                <span className="truncate">预览：这是一条示例聊天消息文本效果</span>
                <span className="text-[10px] font-mono opacity-60 ml-2 shrink-0">
                  {localSettings.chatFontSize === 'sm' ? '13px' : localSettings.chatFontSize === 'lg' ? '16px' : localSettings.chatFontSize === 'xl' ? '18px' : '15px (默认)'}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="backgroundOpacity" className="text-right text-xs">透明度</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Input 
                id="backgroundOpacity" 
                name="backgroundOpacity" 
                type="number"
                step="1"
                min="0"
                max="100"
                value={localSettings.backgroundOpacity == null ? '' : localSettings.backgroundOpacity} 
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setLocalSettings(prev => ({ ...prev, backgroundOpacity: undefined }));
                  } else {
                    const num = parseInt(val, 10);
                    if (!isNaN(num)) {
                      const clamped = Math.min(100, Math.max(0, num));
                      setLocalSettings(prev => ({ ...prev, backgroundOpacity: clamped }));
                    }
                  }
                }}
                onBlur={() => {
                  const val = localSettings.backgroundOpacity;
                  if (val == null || isNaN(val)) {
                    setLocalSettings(prev => ({ ...prev, backgroundOpacity: 100 }));
                  } else {
                    setLocalSettings(prev => ({ ...prev, backgroundOpacity: Math.min(100, Math.max(0, val)) }));
                  }
                }}
                className="h-8 text-xs flex-1" 
                placeholder="0 - 100"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="showBackgroundInDarkMode" className="text-right text-xs">暗夜模式显示</Label>
            <div className="col-span-3 flex items-center h-8">
              <input
                id="showBackgroundInDarkMode"
                type="checkbox"
                checked={localSettings.showBackgroundInDarkMode}
                onChange={(e) => setLocalSettings(prev => ({ ...prev, showBackgroundInDarkMode: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
            </div>
          </div>
          
          <div className="border-t pt-4 mt-2">
            <h4 className="text-xs font-semibold mb-3">启动页设置</h4>
            <div className="space-y-3">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="showSplashScreen" className="text-right text-xs">启用启动页</Label>
                <div className="col-span-3 flex items-center h-8">
                  <input
                    id="showSplashScreen"
                    type="checkbox"
                    checked={localSettings.showSplashScreen}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, showSplashScreen: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </div>
              </div>
              
              {localSettings.showSplashScreen && (
                <>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="splashText" className="text-right text-xs">启动文本</Label>
                    <Input 
                      id="splashText" 
                      name="splashText" 
                      value={localSettings.splashText || ''} 
                      onChange={handleChange} 
                      className="col-span-3 h-8 text-xs" 
                      placeholder="例如：Aether-X" 
                    />
                  </div>
                  <FileUploadField label="启动图片" field="splashImage" />
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="splashSubtitle" className="text-right text-xs">启动子文本</Label>
                    <Input 
                      id="splashSubtitle" 
                      name="splashSubtitle" 
                      value={localSettings.splashSubtitle || ''} 
                      onChange={handleChange} 
                      className="col-span-3 h-8 text-xs" 
                      placeholder="例如：Loading AI Experience" 
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="splashDuration" className="text-right text-xs">持续时间(ms)</Label>
                    <Input 
                      id="splashDuration" 
                      name="splashDuration" 
                      type="number"
                      value={localSettings.splashDuration === 0 ? '' : (localSettings.splashDuration || 1000)} 
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, splashDuration: e.target.value === '' ? 0 : parseInt(e.target.value) }))} 
                      onBlur={(e) => {
                        const val = parseInt(e.target.value);
                        if (isNaN(val) || val < 1000) {
                          setLocalSettings(prev => ({ ...prev, splashDuration: 1000 }));
                        }
                      }}
                      className="col-span-3 h-8 text-xs" 
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="systemInstruction" className="text-right text-xs">回复逻辑</Label>
            <Input id="systemInstruction" name="systemInstruction" value={localSettings.systemInstruction || ''} onChange={handleChange} className="col-span-3 h-8 text-xs" placeholder="例如：你是一个专业的程序员" />
          </div>

          <div className="border-t pt-4 mt-2">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold">语音转写设置 (商用云转写 / FunASR)</h4>
            </div>

            {/* Quick Provider Presets */}
            <div className="mb-3">
              <div className="text-[11px] text-muted-foreground mb-1.5 font-medium">常用商用服务商快捷预设：</div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-2 py-0"
                  onClick={() => {
                    setLocalSettings(prev => ({
                      ...prev,
                      funasrHttpEndpoint: 'api.siliconflow.cn',
                      asrModel: 'FunAudioLLM/SenseVoiceSmall',
                    }));
                  }}
                >
                  ⚡ 硅基流动 SenseVoice
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-2 py-0"
                  onClick={() => {
                    setLocalSettings(prev => ({
                      ...prev,
                      funasrHttpEndpoint: 'api.groq.com',
                      asrModel: 'whisper-large-v3-turbo',
                    }));
                  }}
                >
                  🚀 Groq Whisper
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-2 py-0"
                  onClick={() => {
                    setLocalSettings(prev => ({
                      ...prev,
                      funasrHttpEndpoint: 'api.openai.com',
                      asrModel: 'whisper-1',
                    }));
                  }}
                >
                  🌐 OpenAI Whisper
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-2 py-0"
                  onClick={() => {
                    setLocalSettings(prev => ({
                      ...prev,
                      funasrHttpEndpoint: 'dashscope.aliyuncs.com',
                      asrModel: 'sensevoice-v1',
                    }));
                  }}
                >
                  ☁️ 阿里百炼
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-2 py-0"
                  onClick={() => {
                    setLocalSettings(prev => ({
                      ...prev,
                      funasrHttpEndpoint: '192.168.1.100:10095',
                      funasrWsEndpoint: '192.168.1.100:10096',
                      asrModel: '',
                    }));
                  }}
                >
                  🤖 自建 FunASR
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="funasrHttpEndpoint" className="text-right text-xs">转写 HTTP</Label>
                <div className="col-span-3 flex items-center gap-2">
                  <Input 
                    id="funasrHttpEndpoint" 
                    name="funasrHttpEndpoint" 
                    value={localSettings.funasrHttpEndpoint || ''} 
                    onChange={handleChange} 
                    className="h-8 text-xs flex-1" 
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={handleTestHttp} 
                    disabled={isTestingHttp || !localSettings.funasrHttpEndpoint}
                    className="h-8 px-2 text-xs flex items-center gap-1 shrink-0"
                  >
                    {isTestingHttp ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    测试
                  </Button>
                </div>
              </div>

              {httpTestStatus && (
                <div className="grid grid-cols-4 gap-4">
                  <div className="col-start-2 col-span-3">
                    <div className={cn(
                      "text-[11px] p-2 rounded-md",
                      httpTestStatus.type === 'error' ? "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400" : "bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400"
                    )}>
                      {httpTestStatus.message}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="asrModel" className="text-right text-xs">转写模型</Label>
                <Input 
                  id="asrModel" 
                  name="asrModel" 
                  value={localSettings.asrModel || ''} 
                  onChange={handleChange} 
                  placeholder="例如：whisper-1 / FunAudioLLM/SenseVoiceSmall"
                  className="col-span-3 h-8 text-xs" 
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="asrApiKey" className="text-right text-xs">转写 Key</Label>
                <Input 
                  id="asrApiKey" 
                  name="asrApiKey" 
                  type="password"
                  value={localSettings.asrApiKey || ''} 
                  onChange={handleChange} 
                  placeholder="留空则自动复用上方全局 API Key"
                  className="col-span-3 h-8 text-xs" 
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="funasrWsEndpoint" className="text-right text-xs">实时流 WS</Label>
                <div className="col-span-3 flex items-center gap-2">
                  <Input 
                    id="funasrWsEndpoint" 
                    name="funasrWsEndpoint" 
                    value={localSettings.funasrWsEndpoint || ''} 
                    onChange={handleChange} 
                    className="h-8 text-xs flex-1" 
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={handleTestWs} 
                    disabled={isTestingWs || !localSettings.funasrWsEndpoint}
                    className="h-8 px-2 text-xs flex items-center gap-1 shrink-0"
                  >
                    {isTestingWs ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    测试
                  </Button>
                </div>
              </div>
              {wsTestStatus && (
                <div className="grid grid-cols-4 gap-4">
                  <div className="col-start-2 col-span-3">
                    <div className={cn(
                      "text-[11px] p-2 rounded-md",
                      wsTestStatus.type === 'error' ? "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400" : "bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400"
                    )}>
                      {wsTestStatus.message}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="contextLength" className="text-right text-xs">上下文长度</Label>
            <Input 
              id="contextLength" 
              name="contextLength" 
              type="number"
              value={localSettings.contextLength == null ? '' : localSettings.contextLength}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setLocalSettings(prev => ({ ...prev, contextLength: undefined }));
                } else {
                  const num = parseInt(val);
                  if (!isNaN(num)) {
                    setLocalSettings(prev => ({ ...prev, contextLength: Math.max(1, num) }));
                  }
                }
              }}
              onBlur={() => {
                if (localSettings.contextLength == null || localSettings.contextLength <= 0) {
                  setLocalSettings(prev => ({ ...prev, contextLength: 30000 }));
                }
              }}
              className="col-span-3 h-8 text-xs" 
              placeholder="默认为30000tonken"
            />
          </div>

          <div className="border-t pt-4 mt-2">
            <h4 className="text-xs font-semibold mb-3">修改密码</h4>
            <div className="space-y-3">
              <Input type="password" placeholder="原密码" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} className="h-8 text-xs" />
              <Input type="password" placeholder="新密码" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-8 text-xs" />
              <Input type="password" placeholder="确认新密码" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="h-8 text-xs" />
              
              <AnimatePresence>
                {passwordStatus && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={cn(
                      "text-[10px] p-2 rounded-lg border",
                      passwordStatus.type === 'error' ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-primary/10 border-primary/20 text-primary"
                    )}
                  >
                    {passwordStatus.message}
                  </motion.div>
                )}
              </AnimatePresence>
              
              <div className="flex justify-end pr-0.5">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 text-xs px-3 transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                  onClick={handlePasswordChange}
                >
                  确认修改
                </Button>
              </div>
            </div>
          </div>

          <div className="border-t pt-4 mt-2">
            <h4 className="text-xs font-semibold mb-3">GitHub 更新设置</h4>
            <div className="space-y-3">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="githubOwner" className="text-right text-xs">用户名</Label>
                <Input id="githubOwner" name="githubOwner" value={localSettings.githubOwner || ''} onChange={handleChange} className="col-span-3 h-8 text-xs" placeholder="例如：lx00924" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="githubRepo" className="text-right text-xs">仓库名</Label>
                <Input id="githubRepo" name="githubRepo" value={localSettings.githubRepo || ''} onChange={handleChange} className="col-span-3 h-8 text-xs" placeholder="例如：aether-x" />
              </div>
              
              <AnimatePresence>
                {updateStatus && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={cn(
                      "text-[10px] p-2 rounded-lg border",
                      updateStatus.type === 'error' ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-primary/10 border-primary/20 text-primary"
                    )}
                  >
                    {updateStatus.message}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex justify-end pr-0.5">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 text-xs px-3 transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                  onClick={handleInnerCheckUpdate}
                  disabled={isChecking}
                >
                  {isChecking ? '检测中...' : '检测新版本'}
                </Button>
              </div>
            </div>
          </div>

          <div className="border-t pt-4 mt-2">
            <h4 className="text-xs font-semibold mb-3 flex items-center justify-between text-blue-500">
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" />
                桌面端数据与缓存目录
              </span>
              {isElectron && storageInfo?.isCustom && (
                <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20 font-normal">
                  自定义路径
                </span>
              )}
            </h4>
            
            <div className="space-y-3">
              <div className="p-2.5 rounded-lg border bg-muted/20 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">当前存储路径：</span>
                </div>
                <div 
                  className="text-[11px] font-mono bg-background/80 p-2 rounded border break-all select-all text-foreground/90 max-h-20 overflow-y-auto"
                  title={storageInfo?.currentPath || '默认 Windows 用户目录 (%APPDATA%)'}
                >
                  {storageInfo?.currentPath || (isElectron ? '正在读取中...' : '桌面端运行模式下可自定义路径 (默认 %APPDATA%)')}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1 hover:bg-blue-500/10 hover:text-blue-500 transition-all active:scale-95"
                  onClick={handleSelectStoragePath}
                  disabled={isChangingStorage || !isElectron}
                  title={!isElectron ? '仅在 Windows 桌面端运行环境有效' : '自定义选择新的缓存与数据盘符目录'}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  {isChangingStorage ? '选择中...' : '更改目录'}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1 hover:bg-blue-500/10 hover:text-blue-500 transition-all active:scale-95"
                  onClick={handleOpenStorageFolder}
                  disabled={!isElectron}
                  title={!isElectron ? '仅在 Windows 桌面端运行环境有效' : '在 Windows 资源管理器中打开该目录'}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  打开目录
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1 hover:bg-destructive/10 hover:text-destructive transition-all active:scale-95"
                  onClick={handleResetStoragePath}
                  disabled={!isElectron || !storageInfo?.isCustom}
                  title="恢复为系统默认目录"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  恢复默认
                </Button>
              </div>

              <AnimatePresence>
                {storageStatus && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={cn(
                      "text-[10px] p-2.5 rounded-lg border flex flex-col gap-2",
                      storageStatus.type === 'error' ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-blue-500/10 border-blue-500/20 text-blue-500"
                    )}
                  >
                    <div>{storageStatus.message}</div>
                    {storageStatus.needRestart && (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          className="h-7 text-[11px] px-2.5 bg-blue-600 hover:bg-blue-700 text-white gap-1 shadow-sm active:scale-95"
                          onClick={handleRelaunch}
                        >
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          立即重启生效
                        </Button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="border-t pt-4 mt-2">
            <h4 className="text-xs font-semibold mb-3 flex items-center gap-1.5 text-emerald-500">
              <Terminal className="w-3.5 h-3.5" />
              APP 检修与调试日志
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium">显示悬浮调试球</div>
                  <div className="text-[10px] text-muted-foreground">在右下角提供轻量 🐞 调试按钮，方便随时排查 APP 报错</div>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.showDebugFloatButton ?? true}
                  onChange={(e) => setLocalSettings(prev => ({ ...prev, showDebugFloatButton: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-500"
                  onClick={() => {
                    if (onOpenLogViewer) onOpenLogViewer();
                  }}
                >
                  <Bug className="w-3.5 h-3.5 text-emerald-500" />
                  打开控制台
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => copyLogsToClipboard()}
                >
                  <Copy className="w-3.5 h-3.5" />
                  复制日志
                </Button>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSave} className="w-full transition-all hover:bg-primary/90 active:scale-95">保存更改</Button>
        </DialogFooter>
      </DialogContent>
      {cropImage && (
        <ImageCropDialog
          imageSrc={cropImage.src}
          open={!!cropImage}
          onClose={() => setCropImage(null)}
          onCropComplete={(croppedImage) => {
            setLocalSettings(prev => ({ ...prev, [cropImage.field]: croppedImage }));
            setCropImage(null);
          }}
        />
      )}
    </Dialog>
  );
};
