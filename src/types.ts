/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  type: 'text' | 'voice' | 'image';
  mediaUrl?: string;
  transcribedText?: string;
  status?: 'generating' | 'completed' | 'error';
  quote?: {
    id: string;
    userName: string;
    content: string;
    timestamp: Date;
  };
}

export interface AppSettings {
  userName: string;
  userAvatar: string;
  aiName: string;
  aiAvatar: string;
  apiKey: string;
  apiEndpoint: string;
  modelName: string;
  availableModels?: string[];
  customBackground?: string;
  backgroundOpacity?: number;
  showBackgroundInDarkMode?: boolean;
  systemInstruction?: string;
  githubOwner?: string;
  githubRepo?: string;
  showSplashScreen?: boolean;
  splashText?: string;
  splashImage?: string;
  splashSubtitle?: string;
  splashDuration?: number;
  contextLength?: number;
  funasrHttpEndpoint?: string;
  funasrWsEndpoint?: string;
  asrProvider?: 'funasr' | 'siliconflow' | 'groq' | 'openai' | 'dashscope' | 'custom';
  asrApiKey?: string;
  asrModel?: string;
  showDebugFloatButton?: boolean;
  chatFontSize?: 'sm' | 'base' | 'lg' | 'xl';
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  settings: AppSettings;
}

export interface ElectronStorageInfo {
  currentPath: string;
  defaultPath: string;
  isCustom: boolean;
  configuredPath: string;
}

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      isElectron?: boolean;
      getStorageInfo: () => Promise<ElectronStorageInfo>;
      selectStoragePath: () => Promise<{ canceled: boolean; selectedPath?: string }>;
      setStoragePath: (newPath: string | null) => Promise<{ success: boolean; error?: string }>;
      openStorageFolder: (targetPath?: string) => Promise<{ success: boolean; error?: string }>;
      relaunchApp: () => Promise<void>;
    };
  }
}
