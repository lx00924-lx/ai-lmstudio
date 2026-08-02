export type SkillCategory = 'computer_use' | 'system' | 'knowledge' | 'memory' | 'productivity' | 'custom';

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  enabled: boolean;
  iconName?: string;
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      default?: any;
    }>;
    required?: string[];
  };
  // 本地/桌面执行函数名
  handlerName: string;
}

export interface MemoryItem {
  id: string;
  category: 'user_preference' | 'personal_fact' | 'work_context' | 'instruction';
  content: string;
  importance: 'high' | 'medium' | 'low';
  createdAt: string;
  updatedAt: string;
  sourceMessageId?: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  docId: string;
  docTitle: string;
  content: string;
}

export interface ComputerScreenState {
  screenshotUrl: string;
  activeWindow: string;
  cursorPosition: { x: number; y: number };
  systemStatus: {
    cpu: string;
    memory: string;
    os: string;
  };
}

export interface AgentExecutionStep {
  id: string;
  stepNumber: number;
  toolName: string;
  args: Record<string, any>;
  result?: any;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'requires_confirmation';
  thought?: string;
  timestamp: string;
  screenshotBefore?: string;
  screenshotAfter?: string;
}

export interface AgentTaskSession {
  id: string;
  userPrompt: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  steps: AgentExecutionStep[];
  startTime: string;
  endTime?: string;
}
