import { MemoryItem } from './types';

const MEMORY_STORAGE_KEY = 'agent_long_term_memory';

export const INITIAL_MEMORIES: MemoryItem[] = [
  {
    id: 'mem-1',
    category: 'user_preference',
    content: '用户偏好使用简洁直截了当的中文回答，代码风格优先使用 TypeScript 与 Tailwind CSS。',
    importance: 'high',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'mem-2',
    category: 'instruction',
    content: '任何代码修改前，先提供修改方案，获得用户“确认”后再执行实际代码变更。',
    importance: 'high',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'mem-3',
    category: 'work_context',
    content: '当前项目为语音AI/Agent融合助手，支持语音对话、FunASR实时识别、Gemini与Computer Use桌面控制。',
    importance: 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export function getMemories(): MemoryItem[] {
  try {
    const saved = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load memories:', e);
  }
  // 初次使用设置默认记忆
  saveMemories(INITIAL_MEMORIES);
  return INITIAL_MEMORIES;
}

export function saveMemories(memories: MemoryItem[]): void {
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memories));
  } catch (e) {
    console.error('Failed to save memories:', e);
  }
}

export function addMemory(content: string, category: MemoryItem['category'] = 'personal_fact', importance: MemoryItem['importance'] = 'medium'): MemoryItem {
  const current = getMemories();
  const newItem: MemoryItem = {
    id: 'mem-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    category,
    content,
    importance,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const updated = [newItem, ...current];
  saveMemories(updated);
  return newItem;
}

export function deleteMemory(id: string): MemoryItem[] {
  const current = getMemories();
  const updated = current.filter(m => m.id !== id);
  saveMemories(updated);
  return updated;
}

export function searchMemories(keyword: string): MemoryItem[] {
  const all = getMemories();
  if (!keyword.trim()) return all;
  const kw = keyword.toLowerCase();
  return all.filter(m => m.content.toLowerCase().includes(kw) || m.category.toLowerCase().includes(kw));
}

export function getMemoryContextPrompt(): string {
  const memories = getMemories();
  if (memories.length === 0) return '';
  
  const formatted = memories
    .map(m => `- [${m.category.toUpperCase()} | 重要程度: ${m.importance}] ${m.content}`)
    .join('\n');

  return `\n=== 智能体长期记忆 (Long-Term Memories) ===\n${formatted}\n=== 记忆结束 ===\n`;
}
