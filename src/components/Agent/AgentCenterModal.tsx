import React, { useState, useEffect } from 'react';
import {
  Brain,
  BookOpen,
  Terminal,
  Monitor,
  MousePointer,
  Keyboard,
  Code,
  Sparkles,
  Plus,
  Trash2,
  Check,
  X,
  Search,
  Settings,
  Power,
  Laptop,
  ChevronRight,
  RefreshCw,
  Cpu,
  Shield,
  Layers
} from 'lucide-react';
import { AgentSkill, MemoryItem, KnowledgeDocument } from '../../lib/agent/types';
import { getSkills, toggleSkillEnabled } from '../../lib/agent/skills';
import { getMemories, addMemory, deleteMemory } from '../../lib/agent/memoryStore';
import {
  getKnowledgeDocuments,
  addKnowledgeDocument,
  deleteKnowledgeDocument,
  queryKnowledgeBase
} from '../../lib/agent/knowledgeStore';
import {
  captureScreen,
  clickScreenCoordinate,
  typeTextInSystem,
  executeTerminalCommand,
  launchAppOrUrl
} from '../../lib/agent/computerDriver';

interface AgentCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AgentCenterModal: React.FC<AgentCenterModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'skills' | 'knowledge' | 'memory' | 'computer'>('computer');

  // Skills State
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [selectedSkillCategory, setSelectedSkillCategory] = useState<string>('all');

  // Memory State
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryCategory, setNewMemoryCategory] = useState<MemoryItem['category']>('personal_fact');
  const [memorySearch, setMemorySearch] = useState('');

  // Knowledge State
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocContent, setNewDocContent] = useState('');
  const [newDocCategory, setNewDocCategory] = useState('技术文档');
  const [ragTestQuery, setRagTestQuery] = useState('');
  const [ragTestResults, setRagTestResults] = useState<{ docTitle: string; content: string; score: number }[]>([]);

  // Computer Use Sandbox State
  const [screenshotUrl, setScreenshotUrl] = useState<string>('');
  const [activeWindow, setActiveWindow] = useState<string>('Desktop');
  const [cursorPos, setCursorPos] = useState({ x: 450, y: 320 });
  const [testCmd, setTestCmd] = useState('git status');
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['OpenClaw Local Agent System initialized on 127.0.0.1:9090']);
  const [localEndpoint, setLocalEndpoint] = useState('http://127.0.0.1:9090');
  const [clickCoord, setClickCoord] = useState({ x: 500, y: 300 });

  useEffect(() => {
    if (isOpen) {
      refreshAll();
    }
  }, [isOpen]);

  const refreshAll = async () => {
    setSkills(getSkills());
    setMemories(getMemories());
    setKnowledgeDocs(getKnowledgeDocuments());
    handleRefreshScreen();
  };

  const handleRefreshScreen = async () => {
    const screen = await captureScreen();
    setScreenshotUrl(screen.screenshotUrl);
    setActiveWindow(screen.activeWindow);
    setCursorPos(screen.cursor);
  };

  const handleToggleSkill = (skillId: string, enabled: boolean) => {
    const updated = toggleSkillEnabled(skillId, !enabled);
    setSkills(updated);
  };

  const handleAddMemory = () => {
    if (!newMemoryText.trim()) return;
    addMemory(newMemoryText.trim(), newMemoryCategory, 'high');
    setNewMemoryText('');
    setMemories(getMemories());
  };

  const handleDeleteMemory = (id: string) => {
    deleteMemory(id);
    setMemories(getMemories());
  };

  const handleAddKnowledgeDoc = () => {
    if (!newDocTitle.trim() || !newDocContent.trim()) return;
    addKnowledgeDocument(newDocTitle.trim(), newDocContent.trim(), newDocCategory);
    setNewDocTitle('');
    setNewDocContent('');
    setKnowledgeDocs(getKnowledgeDocuments());
  };

  const handleDeleteDoc = (id: string) => {
    deleteKnowledgeDocument(id);
    setKnowledgeDocs(getKnowledgeDocuments());
  };

  const handleTestRag = () => {
    if (!ragTestQuery.trim()) return;
    const results = queryKnowledgeBase(ragTestQuery);
    setRagTestResults(results);
  };

  const handleRunTerminalTest = async () => {
    if (!testCmd.trim()) return;
    setTerminalLogs(prev => [...prev, `$ ${testCmd}`]);
    const out = await executeTerminalCommand(testCmd);
    setTerminalLogs(prev => [...prev, out]);
  };

  const handleTestClick = async () => {
    const msg = await clickScreenCoordinate(clickCoord.x, clickCoord.y);
    setTerminalLogs(prev => [...prev, `[Action] ${msg}`]);
    await handleRefreshScreen();
  };

  if (!isOpen) return null;

  const filteredSkills = skills.filter(s => selectedSkillCategory === 'all' || s.category === selectedSkillCategory);
  const filteredMemories = memories.filter(m => !memorySearch.trim() || m.content.toLowerCase().includes(memorySearch.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-lg">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                OpenClaw Agent 智能体中心
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  v2.5 Autonomous
                </span>
              </h2>
              <p className="text-xs text-slate-400">具备电脑桌面控制 (Computer Use)、RAG 知识库与长期记忆系统</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-slate-800 flex items-center gap-2 bg-slate-950/50">
          <button
            onClick={() => setActiveTab('computer')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'computer'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Laptop className="w-4 h-4" />
            桌面控制 (Computer Use)
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'skills'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            技能库 (Skills Center)
          </button>
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'knowledge'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            知识库 (Knowledge RAG)
          </button>
          <button
            onClick={() => setActiveTab('memory')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'memory'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Brain className="w-4 h-4" />
            长期记忆 (Memory Store)
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">

          {/* TAB 1: Computer Use Desktop Console */}
          {activeTab === 'computer' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Screen Preview */}
              <div className="lg:col-span-7 flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-indigo-400" />
                    屏幕截图与活动窗口: <span className="text-indigo-300 font-normal">{activeWindow}</span>
                  </span>
                  <button
                    onClick={handleRefreshScreen}
                    className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-slate-200 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> 刷新画幅
                  </button>
                </div>

                <div className="relative rounded-xl border border-slate-700 bg-black overflow-hidden aspect-video flex items-center justify-center shadow-inner">
                  {screenshotUrl ? (
                    <img src={screenshotUrl} alt="Desktop Capture" className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-slate-500 text-sm flex flex-col items-center gap-2">
                      <Cpu className="w-8 h-8 animate-pulse text-indigo-400" />
                      正在加载桌面画面...
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur px-2.5 py-1 rounded text-[11px] font-mono text-emerald-400 border border-emerald-500/30">
                    Cursor: ({cursorPos.x}, {cursorPos.y})
                  </div>
                </div>

                {/* Local Agent Driver Bridge Config */}
                <div className="bg-slate-800/50 p-3.5 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-emerald-400" /> 本地 Agent 驱动通信服务 (Local Driver Endpoint)
                    </span>
                    <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[11px]">Active/Ready</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={localEndpoint}
                      onChange={(e) => setLocalEndpoint(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                      placeholder="http://127.0.0.1:9090"
                    />
                    <button className="bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition">
                      重连代理
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    💡 未检测到本地 Electron 时，系统会自动切换至虚拟计算机桌面与 Terminal 命令行沙盒。
                  </p>
                </div>
              </div>

              {/* Controls & Logs */}
              <div className="lg:col-span-5 flex flex-col space-y-4">
                {/* Manual Control Tester */}
                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <MousePointer className="w-4 h-4 text-indigo-400" /> 交互指令驱动测试
                  </h3>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-slate-400 block mb-1">X 坐标</label>
                      <input
                        type="number"
                        value={clickCoord.x}
                        onChange={e => setClickCoord(prev => ({ ...prev, x: Number(e.target.value) }))}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Y 坐标</label>
                      <input
                        type="number"
                        value={clickCoord.y}
                        onChange={e => setClickCoord(prev => ({ ...prev, y: Number(e.target.value) }))}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-slate-200"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleTestClick}
                    className="w-full bg-slate-700 hover:bg-slate-600 py-1.5 rounded text-xs font-medium text-slate-100 flex items-center justify-center gap-1.5 transition"
                  >
                    <MousePointer className="w-3.5 h-3.5" /> 模拟左键点击此坐标
                  </button>

                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <label className="text-slate-400 text-xs block">Terminal Shell 快捷测试</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={testCmd}
                        onChange={e => setTestCmd(e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200"
                        placeholder="e.g. ls -la"
                      />
                      <button
                        onClick={handleRunTerminalTest}
                        className="bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-xs font-medium text-white transition"
                      >
                        执行
                      </button>
                    </div>
                  </div>
                </div>

                {/* System Execution Terminal Log */}
                <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col font-mono text-xs">
                  <div className="text-slate-400 pb-2 border-b border-slate-800 mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <Terminal className="w-3.5 h-3.5" /> Agent Action Logs
                    </span>
                    <button onClick={() => setTerminalLogs([])} className="hover:text-slate-200">清空</button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1 max-h-48 text-slate-300">
                    {terminalLogs.map((log, idx) => (
                      <div key={idx} className="whitespace-pre-wrap break-all">
                        {log.startsWith('$') ? (
                          <span className="text-indigo-400">{log}</span>
                        ) : log.startsWith('[Action]') ? (
                          <span className="text-amber-400">{log}</span>
                        ) : (
                          <span>{log}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Skills Center */}
          {activeTab === 'skills' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  已启用技能列表会在 Agent 思考任务时自动作为 Tools 注入，供智能体自主识别并调用。
                </p>
                <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                  {['all', 'computer_use', 'knowledge', 'memory', 'productivity'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedSkillCategory(cat)}
                      className={`px-2.5 py-1 rounded capitalize transition ${
                        selectedSkillCategory === cat ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {cat.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredSkills.map(skill => (
                  <div
                    key={skill.id}
                    className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                      skill.enabled
                        ? 'bg-slate-800/60 border-slate-700'
                        : 'bg-slate-900/40 border-slate-800/80 opacity-60'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`p-2 rounded-lg ${skill.enabled ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
                            {skill.category === 'computer_use' ? <Monitor className="w-4 h-4" /> :
                             skill.category === 'knowledge' ? <BookOpen className="w-4 h-4" /> :
                             skill.category === 'memory' ? <Brain className="w-4 h-4" /> :
                             <Code className="w-4 h-4" />}
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-slate-100">{skill.name}</h4>
                            <span className="text-[10px] text-slate-400 font-mono">ID: {skill.id}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleToggleSkill(skill.id, skill.enabled)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                            skill.enabled
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {skill.enabled ? '已启用' : '已禁用'}
                        </button>
                      </div>
                      <p className="text-xs text-slate-300 mb-3">{skill.description}</p>
                    </div>

                    <div className="pt-2 border-t border-slate-800 text-[11px] font-mono text-slate-400 flex items-center justify-between">
                      <span>Handler: {skill.handlerName}()</span>
                      <span className="capitalize text-indigo-400/80">{skill.category.replace('_', ' ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Knowledge Base (RAG) */}
          {activeTab === 'knowledge' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Add & RAG Test */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-indigo-400" /> 导入知识库文档
                  </h3>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">文档标题</label>
                    <input
                      type="text"
                      value={newDocTitle}
                      onChange={e => setNewDocTitle(e.target.value)}
                      placeholder="如：项目接口说明书"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">知识分类</label>
                    <input
                      type="text"
                      value={newDocCategory}
                      onChange={e => setNewDocCategory(e.target.value)}
                      placeholder="技术文档 / 规章流程"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">文档正文</label>
                    <textarea
                      rows={5}
                      value={newDocContent}
                      onChange={e => setNewDocContent(e.target.value)}
                      placeholder="粘贴 Markdown、规则文本或技术指南..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200"
                    />
                  </div>
                  <button
                    onClick={handleAddKnowledgeDoc}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 py-2 rounded-lg text-xs font-medium text-white transition flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" /> 添加到知识库
                  </button>
                </div>

                {/* RAG Tester */}
                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Search className="w-4 h-4 text-indigo-400" /> RAG 语义与关键词检索测试
                  </h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={ragTestQuery}
                      onChange={e => setRagTestQuery(e.target.value)}
                      placeholder="输入测试查询语句..."
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                    />
                    <button
                      onClick={handleTestRag}
                      className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg text-xs text-slate-200"
                    >
                      搜索
                    </button>
                  </div>

                  {ragTestResults.length > 0 && (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {ragTestResults.map((r, idx) => (
                        <div key={idx} className="p-2.5 bg-slate-950 rounded border border-slate-800 text-xs">
                          <span className="font-semibold text-indigo-300 block mb-1">
                            [{r.docTitle}] Score: {r.score}
                          </span>
                          <p className="text-slate-300 text-[11px] line-clamp-3">{r.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Document List */}
              <div className="lg:col-span-7 space-y-3">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-400" /> 已导入知识库文档 ({knowledgeDocs.length})
                </h3>
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {knowledgeDocs.map(doc => (
                    <div key={doc.id} className="p-4 bg-slate-800/50 border border-slate-800 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-100">{doc.title}</h4>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
                            {doc.category}
                          </span>
                          <button
                            onClick={() => handleDeleteDoc(doc.id)}
                            className="text-slate-500 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-3 bg-slate-950 p-2.5 rounded font-mono">
                        {doc.content}
                      </p>
                      <div className="text-[11px] text-slate-500 flex justify-between">
                        <span>Chunks: {doc.chunkCount}</span>
                        <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Long-Term Memory */}
          {activeTab === 'memory' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={newMemoryText}
                    onChange={e => setNewMemoryText(e.target.value)}
                    placeholder="例如：用户习惯用 Python 编写算法脚本..."
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                  />
                  <select
                    value={newMemoryCategory}
                    onChange={e => setNewMemoryCategory(e.target.value as any)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-300"
                  >
                    <option value="user_preference">用户偏好</option>
                    <option value="personal_fact">事实记录</option>
                    <option value="work_context">工作上下文</option>
                    <option value="instruction">重要指令</option>
                  </select>
                </div>
                <button
                  onClick={handleAddMemory}
                  className="bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 rounded-lg text-xs font-medium text-white transition flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> 记住此信息
                </button>
              </div>

              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={memorySearch}
                  onChange={e => setMemorySearch(e.target.value)}
                  placeholder="筛选搜索记忆..."
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 w-64"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredMemories.map(mem => (
                  <div key={mem.id} className="p-3.5 bg-slate-800/50 border border-slate-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                        {mem.category.replace('_', ' ')}
                      </span>
                      <button
                        onClick={() => handleDeleteMemory(mem.id)}
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-200">{mem.content}</p>
                    <div className="text-[10px] text-slate-500 text-right">
                      {new Date(mem.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex justify-between items-center text-xs text-slate-400">
          <span>Agent Loop State: <strong className="text-emerald-400 font-normal">Ready & Listening</strong></span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
          >
            关闭
          </button>
        </div>

      </div>
    </div>
  );
};
