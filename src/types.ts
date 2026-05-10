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
  reasoningContent?: string;
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
  enableWebSearch?: boolean;
  searxngUrl?: string;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  settings: AppSettings;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export type ReasoningType = 'thinking' | 'normal';
