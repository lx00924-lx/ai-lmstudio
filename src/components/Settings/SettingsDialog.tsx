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
import { ImagePlus, X, Camera, Image as ImageIcon, ChevronDown, Loader2 } from 'lucide-react';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { CapacitorHttp } from '@capacitor/core';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onCheckUpdate: () => Promise<{ success: boolean; data?: any; error?: string }>;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onOpenChange,
  settings,
  onSave,
  onCheckUpdate,
}) => {
  const [localSettings, setLocalSettings] = React.useState<AppSettings>(settings);
  const [updateStatus, setUpdateStatus] = React.useState<{ type: 'error' | 'success', message: string } | null>(null);
  const [isChecking, setIsChecking] = React.useState(false);
  const [isFetchingModels, setIsFetchingModels] = React.useState(false);
  const [modelFetchStatus, setModelFetchStatus] = React.useState<{ type: 'error' | 'success', message: string } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setUpdateStatus(null);
      setIsChecking(false);
      setModelFetchStatus(null);
    }
    setLocalSettings(settings);
  }, [settings, open]);

  const fetchModels = async (endpoint: string) => {
    if (!endpoint.trim()) return;
    
    let sanitized = endpoint.trim();
    if (!sanitized.startsWith('http')) {
      sanitized = `http://${sanitized}`;
    }
    if (!sanitized.endsWith('/v1') && !sanitized.endsWith('/v1/')) {
      sanitized = `${sanitized.replace(/\/$/, '')}/v1`;
    }

    setIsFetchingModels(true);
    setModelFetchStatus(null);

    try {
      const options = {
        url: `${sanitized}/models`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localSettings.apiKey || 'lm-studio'}`,
          'Content-Type': 'application/json',
        },
        connectTimeout: 10000,
        readTimeout: 10000,
      };

      const response = await CapacitorHttp.request(options);

      if (response.status >= 200 && response.status < 300) {
        const data = response.data;
        let models: string[] = [];

        if (data && Array.isArray(data.data)) {
          models = data.data.map((m: any) => m.id || m.name).filter(Boolean);
        } else if (Array.isArray(data)) {
          models = data.map((m: any) => m.id || m.name || m).filter(Boolean);
        }

        if (models.length > 0) {
          models.sort((a, b) => a.localeCompare(b));
          const defaultModel = models[0];
          setLocalSettings(prev => ({
            ...prev,
            availableModels: models,
            modelName: prev.modelName && models.includes(prev.modelName) ? prev.modelName : defaultModel,
          }));
          setModelFetchStatus({ type: 'success', message: `发现 ${models.length} 个模型` });
        } else {
          setModelFetchStatus({ type: 'error', message: '未发现可用模型' });
        }
      } else {
        setModelFetchStatus({ type: 'error', message: `请求失败: HTTP ${response.status}` });
      }
    } catch (error) {
      console.error('Fetch models error:', error);
      setModelFetchStatus({ type: 'error', message: `连接失败: ${error instanceof Error ? error.message : '请检查 API 地址及是否支持 CORS'}` });
    } finally {
      setIsFetchingModels(false);
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
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: source
      });
      
      if (image.dataUrl) {
        setLocalSettings(prev => ({ ...prev, [field]: image.dataUrl as string }));
      }
    } catch (error) {
      console.error('Image selection error:', error);
    }
  };

  const clearField = (field: keyof AppSettings) => {
    setLocalSettings(prev => ({ ...prev, [field]: '' }));
  };

  const handleSave = () => {
    onSave(localSettings);
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
        className="sm:max-w-[425px] bg-white dark:bg-card border-border text-foreground max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>应用设置</DialogTitle>
            <span className="text-[10px] font-mono text-muted-foreground mr-6">
              {localStorage.getItem('app_version') || 'v0.0.5'}
            </span>
          </div>
        </DialogHeader>
        <div className="grid gap-4 py-4">
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
            <div className="col-span-3 relative">
              {localSettings.availableModels && localSettings.availableModels.length > 0 ? (
                <div className="relative">
                  <select
                    id="modelName"
                    value={localSettings.modelName}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, modelName: e.target.value }))}
                    className="w-full h-8 text-xs rounded-md border border-input bg-background px-3 pr-8 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {localSettings.availableModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              ) : (
                <Input 
                  id="modelName" 
                  name="modelName" 
                  value={localSettings.modelName} 
                  onChange={handleChange} 
                  className="h-8 text-xs" 
                  placeholder="先填写 API 地址，自动获取模型列表" 
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="apiEndpoint" className="text-right text-xs">API 终端</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Input 
                id="apiEndpoint" 
                name="apiEndpoint" 
                value={localSettings.apiEndpoint} 
                onChange={handleChange}
                onBlur={() => fetchModels(localSettings.apiEndpoint)}
                className="h-8 text-xs flex-1" 
                placeholder="例如：http://localhost:1234" 
              />
              {isFetchingModels && <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />}
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

          <FileUploadField label="自定义背景" field="customBackground" placeholder="仅在亮色模式生效" />
          
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
                      value={localSettings.splashDuration || 2000} 
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, splashDuration: parseInt(e.target.value) || 2000 }))} 
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
        </div>
        <DialogFooter>
          <Button onClick={handleSave} className="w-full transition-all hover:bg-primary/90 active:scale-95">保存更改</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
