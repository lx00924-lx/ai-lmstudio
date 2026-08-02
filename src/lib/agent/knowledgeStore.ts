import { KnowledgeDocument, KnowledgeChunk } from './types';

const KNOWLEDGE_STORAGE_KEY = 'agent_knowledge_documents';

export const DEFAULT_KNOWLEDGE_DOCS: KnowledgeDocument[] = [
  {
    id: 'doc-1',
    title: 'OpenClaw / Computer Use Agent 架构指南',
    category: '技术文档',
    tags: ['Agent', 'Electron', 'ComputerUse', '架构'],
    content: `OpenClaw 桌面智能体基于分布式 Actor 模型与 Electron 本地通信。
1. 本地驱动服务：基于 Node.js / Python 部署在 127.0.0.1:9090，暴露 WebSocket 和 REST API。
2. 模拟屏幕控制：通过 RobotJS 或 Nut.js 捕获屏幕坐标点，执行鼠标左键/右键点击与按键操作。
3. 视觉闭环：每次 Tool Call 后自动触发一次 500ms 延迟的高清截屏，传回 Vision LLM (如 Gemini 1.5/2.0 Pro) 进行界面位置再校验。
4. 安全隔离：系统 Shell 命令需要通过用户二次确认弹窗或白名单配置才可以自动运行。`,
    chunkCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'doc-2',
    title: 'FunASR 语音识别与 WebSocket 代理规范',
    category: '语音处理',
    tags: ['FunASR', 'WebSocket', 'PCM', '音频'],
    content: `FunASR 2pass 实时语音识别流传输协议：
1. 建立 WebSocket 连接后，客户端必须第一时间发送 JSON 配置消息：{"mode":"2pass","chunk_size":[5,10,5],"wav_name":"mic","is_speaking":true}。
2. 需确保服务端解析配置完毕后再发送 PCM 16kHz 音频流，否则服务端会抛出 [WARN] chunk_size not set yet, skip audio frame。
3. 每隔 30 秒发送心跳包 {"is_speaking": false} 保证连接不中断。`,
    chunkCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export function getKnowledgeDocuments(): KnowledgeDocument[] {
  try {
    const saved = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load knowledge base:', e);
  }
  saveKnowledgeDocuments(DEFAULT_KNOWLEDGE_DOCS);
  return DEFAULT_KNOWLEDGE_DOCS;
}

export function saveKnowledgeDocuments(docs: KnowledgeDocument[]): void {
  try {
    localStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(docs));
  } catch (e) {
    console.error('Failed to save knowledge base:', e);
  }
}

export function addKnowledgeDocument(title: string, content: string, category: string = '通用', tags: string[] = []): KnowledgeDocument {
  const docs = getKnowledgeDocuments();
  const chunks = chunkText(content, 300);
  const newDoc: KnowledgeDocument = {
    id: 'doc-' + Date.now(),
    title,
    content,
    category,
    tags,
    chunkCount: chunks.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const updated = [newDoc, ...docs];
  saveKnowledgeDocuments(updated);
  return newDoc;
}

export function deleteKnowledgeDocument(id: string): KnowledgeDocument[] {
  const docs = getKnowledgeDocuments();
  const updated = docs.filter(d => d.id !== id);
  saveKnowledgeDocuments(updated);
  return updated;
}

function chunkText(text: string, chunkSize: number = 300): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let currentChunk = '';

  for (const line of lines) {
    if ((currentChunk + line).length > chunkSize) {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  return chunks.length > 0 ? chunks : [text];
}

export function queryKnowledgeBase(query: string, topK: number = 3): { docTitle: string; content: string; score: number }[] {
  const docs = getKnowledgeDocuments();
  if (!query.trim()) return [];

  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: { docTitle: string; content: string; score: number }[] = [];

  for (const doc of docs) {
    const chunks = chunkText(doc.content, 400);
    for (const chunk of chunks) {
      let score = 0;
      const lowerChunk = chunk.toLowerCase();
      const lowerTitle = doc.title.toLowerCase();

      // Title match high weight
      for (const term of queryTerms) {
        if (lowerTitle.includes(term)) score += 5;
        if (lowerChunk.includes(term)) score += 2;
        // Exact substring
        if (query.length > 3 && lowerChunk.includes(query.toLowerCase())) score += 10;
      }

      if (score > 0) {
        results.push({
          docTitle: doc.title,
          content: chunk,
          score
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
