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
import { ImagePlus, X, Camera, Image as ImageIcon } from 'lucide-react';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
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

  React.useEffect(() => {
    if (!open) {
      setUpdateStatus(null);
      setIsChecking(false);
    }
    setLocalSettings(settings);
  }, [settings, open]);

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
              className="w-10 h-10 rounded-lg border-dashed"
              onClick={() => handleImageSelect(field, CameraSource.Camera)}
              title="拍照"
            >
              <Camera size={16} className="text-muted-foreground" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-10 h-10 rounded-lg border-dashed"
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
              {localStorage.getItem('app_version') || 'v0.0.2'}
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
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="aiSubtitle" className="text-right text-xs">AI 副标题</Label>
            <Input id="aiSubtitle" name="aiSubtitle" value={localSettings.aiSubtitle} onChange={handleChange} className="col-span-3 h-8 text-xs" />
          </div>

          <FileUploadField label="AI 头像" field="aiAvatar" />

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="apiKey" className="text-right text-xs">API Key</Label>
            <Input id="apiKey" name="apiKey" type="password" value={localSettings.apiKey} onChange={handleChange} className="col-span-3 h-8 text-xs" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="modelName" className="text-right text-xs">模型名称</Label>
            <Input id="modelName" name="modelName" value={localSettings.modelName} onChange={handleChange} className="col-span-3 h-8 text-xs" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="apiEndpoint" className="text-right text-xs">API 终端</Label>
            <Input id="apiEndpoint" name="apiEndpoint" value={localSettings.apiEndpoint} onChange={handleChange} className="col-span-3 h-8 text-xs" />
          </div>

          <FileUploadField label="自定义背景" field="customBackground" placeholder="仅在亮色模式生效" />
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="welcomeMessage" className="text-right text-xs">欢迎标语</Label>
            <Input id="welcomeMessage" name="welcomeMessage" value={localSettings.welcomeMessage || ''} onChange={handleChange} className="col-span-3 h-8 text-xs" />
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
                  className="h-8 text-xs px-3"
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
          <Button onClick={handleSave} className="w-full">保存更改</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
