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
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Rocket, Download, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
  changelog: string;
  downloadUrl: string;
}

export const UpdateDialog: React.FC<UpdateDialogProps> = ({
  isOpen,
  onClose,
  version,
  changelog,
  downloadUrl,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        className="sm:max-w-[450px] bg-white dark:bg-card border-border text-foreground z-[9999]"
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Rocket size={20} />
            </div>
            <DialogTitle className="text-xl">发现新版本！</DialogTitle>
          </div>
          <DialogDescription className="text-sm font-medium text-primary">
            最新版本: {version}
          </DialogDescription>
        </DialogHeader>
        
        <div className="my-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">更新日志</div>
          <div className="markdown-body prose prose-sm dark:prose-invert max-w-none text-xs bg-muted/30 p-4 rounded-2xl border border-muted-foreground/10">
            <ReactMarkdown>{changelog || '该版本暂无详细描述。'}</ReactMarkdown>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-xl h-11">
            以后再说
          </Button>
          <Button 
            className="flex-1 rounded-xl h-11 bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90"
            onClick={() => {
              // Store current version in storage to suppress next check if needed
              localStorage.setItem('app_version', version);
              // Force reload from server to get new assets
              window.location.reload();
            }}
          >
            <Rocket size={16} className="mr-2" />
            立即重启更新
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
