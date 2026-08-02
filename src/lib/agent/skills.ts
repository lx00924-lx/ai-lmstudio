import { AgentSkill } from './types';

export const DEFAULT_SKILLS: AgentSkill[] = [
  // Computer Use 技能
  {
    id: 'computer_screenshot',
    name: '桌面屏幕截图 (Take Screenshot)',
    description: '获取当前电脑桌面的全屏截图，用于识别应用界面、按钮位置与报错信息。',
    category: 'computer_use',
    enabled: true,
    iconName: 'Monitor',
    handlerName: 'takeScreenshot',
    parameters: {
      type: 'object',
      properties: {
        monitorIndex: { type: 'number', description: '显示器序号 (默认 0)' }
      }
    }
  },
  {
    id: 'computer_mouse_click',
    name: '鼠标点击控制 (Click Coordinate)',
    description: '在当前电脑桌面的指定坐标 (x, y) 位置执行鼠标左键/右键/双击操作。',
    category: 'computer_use',
    enabled: true,
    iconName: 'MousePointer',
    handlerName: 'clickCoordinate',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X轴坐标像素点' },
        y: { type: 'number', description: 'Y轴坐标像素点' },
        clickType: { type: 'string', enum: ['left', 'right', 'double'], description: '点击类型: left(左键), right(右键), double(双击)' }
      },
      required: ['x', 'y']
    }
  },
  {
    id: 'computer_type_input',
    name: '键盘文本输入 (Type Text)',
    description: '在当前焦点输入框中模拟键盘直接输入文本或按下快捷组合键 (如 Ctrl+C, Enter)。',
    category: 'computer_use',
    enabled: true,
    iconName: 'Keyboard',
    handlerName: 'typeText',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要输入的文字内容' },
        pressKey: { type: 'string', description: '需要按下的特殊按键 (例如 Enter, Backspace, Tab, Escape)' },
        modifiers: { type: 'string', description: '组合修饰键 (例如 ctrl, alt, shift)' }
      }
    }
  },
  {
    id: 'computer_run_terminal',
    name: '终端命令执行 (Run Terminal Command)',
    description: '在本地电脑系统 Shell (Bash/PowerShell/CMD) 中安全运行系统命令并返回输出结果。',
    category: 'computer_use',
    enabled: true,
    iconName: 'Terminal',
    handlerName: 'runTerminalCommand',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 Bash / PowerShell 命令行脚本' },
        cwd: { type: 'string', description: '工作目录路径' }
      },
      required: ['command']
    }
  },
  {
    id: 'computer_open_app',
    name: '启动/切换应用 (Launch Application)',
    description: '在电脑上打开指定应用软件或网页 (例如 Chrome, VSCode, Terminal)。',
    category: 'computer_use',
    enabled: true,
    iconName: 'AppWindow',
    handlerName: 'launchApp',
    parameters: {
      type: 'object',
      properties: {
        appNameOrUrl: { type: 'string', description: '应用名称或网页 URL 地址' }
      },
      required: ['appNameOrUrl']
    }
  },

  // 知识库技能
  {
    id: 'knowledge_search',
    name: '知识库 RAG 检索 (Knowledge Base Query)',
    description: '在本地知识库文档中搜索匹配的技术文档、参考资料、规则或企业私有信息。',
    category: 'knowledge',
    enabled: true,
    iconName: 'BookOpen',
    handlerName: 'searchKnowledgeBase',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字或自然语言查询' },
        topK: { type: 'number', description: '返回结果数量限制，默认 3' }
      },
      required: ['query']
    }
  },

  // 长期记忆技能
  {
    id: 'memory_search',
    name: '检索记忆 (Retrieve Memory)',
    description: '检索关于用户的长期偏好、常用习惯、项目背景及历史记录。',
    category: 'memory',
    enabled: true,
    iconName: 'Brain',
    handlerName: 'searchMemory',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '查找记忆的主题词' }
      },
      required: ['keyword']
    }
  },
  {
    id: 'memory_update',
    name: '保存重要记忆 (Store Fact / Memory)',
    description: '记录并长期记住关于用户的重要事实、指令偏好、系统密钥或规则。',
    category: 'memory',
    enabled: true,
    iconName: 'BookmarkPlus',
    handlerName: 'saveMemory',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: '需要记住的核心事实或规则' },
        category: { type: 'string', description: '记忆类别', enum: ['user_preference', 'personal_fact', 'work_context', 'instruction'] }
      },
      required: ['fact']
    }
  },

  // 效率与代码执行
  {
    id: 'system_eval_python',
    name: 'Python/JS 代码沙盒 (Code Executor)',
    description: '在沙盒中运行 Python 或 JavaScript 代码段，进行数值计算、数据分析或文本处理。',
    category: 'productivity',
    enabled: true,
    iconName: 'Code',
    handlerName: 'executeCode',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', description: '编程语言类别', enum: ['javascript', 'python'] },
        code: { type: 'string', description: '需要执行的代码' }
      },
      required: ['code']
    }
  }
];

const SKILL_STORAGE_KEY = 'agent_skills_config';

export function getSkills(): AgentSkill[] {
  try {
    const saved = localStorage.getItem(SKILL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as AgentSkill[];
      // Merge with default skills if new ones added
      const existingIds = new Set(parsed.map(s => s.id));
      const missingDefaults = DEFAULT_SKILLS.filter(d => !existingIds.has(d.id));
      return [...parsed, ...missingDefaults];
    }
  } catch (e) {
    console.error('Failed to load skills:', e);
  }
  return DEFAULT_SKILLS;
}

export function saveSkills(skills: AgentSkill[]): void {
  try {
    localStorage.setItem(SKILL_STORAGE_KEY, JSON.stringify(skills));
  } catch (e) {
    console.error('Failed to save skills:', e);
  }
}

export function toggleSkillEnabled(skillId: string, enabled: boolean): AgentSkill[] {
  const current = getSkills();
  const updated = current.map(s => s.id === skillId ? { ...s, enabled } : s);
  saveSkills(updated);
  return updated;
}
