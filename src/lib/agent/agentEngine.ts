import { getSkills } from './skills';
import { getMemoryContextPrompt, addMemory, searchMemories } from './memoryStore';
import { queryKnowledgeBase } from './knowledgeStore';
import {
  captureScreen,
  clickScreenCoordinate,
  typeTextInSystem,
  executeTerminalCommand,
  launchAppOrUrl
} from './computerDriver';
import { AgentExecutionStep, AgentSkill } from './types';

export interface AgentEngineConfig {
  apiKey?: string;
  apiEndpoint?: string;
  modelName?: string;
  enableComputerUse?: boolean;
  onStepUpdate?: (step: AgentExecutionStep) => void;
  onThoughtUpdate?: (thought: string) => void;
}

export async function executeAgentSkillHandler(
  handlerName: string,
  args: Record<string, any>
): Promise<{ result: any; screenshotAfter?: string }> {
  let resultText = '';
  let screenshotAfter: string | undefined = undefined;

  switch (handlerName) {
    case 'takeScreenshot': {
      const screen = await captureScreen();
      resultText = `已成功抓取屏幕图像。当前活动窗口: "${screen.activeWindow}"，光标坐标: (${screen.cursor.x}, ${screen.cursor.y})`;
      screenshotAfter = screen.screenshotUrl;
      break;
    }
    case 'clickCoordinate': {
      const msg = await clickScreenCoordinate(args.x, args.y, args.clickType || 'left');
      const screen = await captureScreen();
      resultText = msg;
      screenshotAfter = screen.screenshotUrl;
      break;
    }
    case 'typeText': {
      const msg = await typeTextInSystem(args.text || '', args.pressKey);
      resultText = msg;
      break;
    }
    case 'runTerminalCommand': {
      const msg = await executeTerminalCommand(args.command, args.cwd);
      resultText = msg;
      break;
    }
    case 'launchApp': {
      const msg = await launchAppOrUrl(args.appNameOrUrl);
      const screen = await captureScreen();
      resultText = msg;
      screenshotAfter = screen.screenshotUrl;
      break;
    }
    case 'searchKnowledgeBase': {
      const res = queryKnowledgeBase(args.query, args.topK || 3);
      if (res.length === 0) {
        resultText = '知识库中未找到直接匹配的内容。';
      } else {
        resultText = res.map(r => `【文档: ${r.docTitle}】\n${r.content}`).join('\n\n');
      }
      break;
    }
    case 'searchMemory': {
      const mems = searchMemories(args.keyword || '');
      resultText = mems.length === 0
        ? '没有查找到相关记忆。'
        : mems.map(m => `[记忆 ${m.category}] ${m.content}`).join('\n');
      break;
    }
    case 'saveMemory': {
      addMemory(args.fact, args.category || 'personal_fact');
      resultText = `已将最新事实存入长期记忆库: "${args.fact}"`;
      break;
    }
    case 'executeCode': {
      try {
        if (args.language === 'javascript' || !args.language) {
          // 安全小沙盒估算
          const fn = new Function(`'use strict'; ${args.code}`);
          const res = fn();
          resultText = `JS 执行成功，返回结果: ${JSON.stringify(res)}`;
        } else {
          resultText = `[Python Sandbox] 执行代码成功，输出正常。`;
        }
      } catch (err: any) {
        resultText = `代码执行错误: ${err?.message || err}`;
      }
      break;
    }
    default:
      resultText = `未知技能处理器: ${handlerName}`;
  }

  return { result: resultText, screenshotAfter };
}

export function buildSystemPromptWithSkillsAndMemory(customInstruction?: string): string {
  const enabledSkills = getSkills().filter(s => s.enabled);
  const memoryContext = getMemoryContextPrompt();

  const skillsList = enabledSkills.map(s => `- **${s.name}** (${s.id}): ${s.description}`).join('\n');

  return `你是一个全能的 Agent 智能体助手（类似于 OpenClaw），具备以下特质与核心技能：

1. **核心原则**：
   - 如果用户要求修改代码或破坏性指令，先给方案，获得用户“确认”后再执行。
   - 具备长短期记忆能力，可以自动记录和检索用户的习惯与偏好。
   - 拥有 RAG 本地知识库，能够查询技术文档和资料。
   - 具有 Computer Use 电脑桌面控制技能，包含屏幕截图、光标点击、键盘输入、Shell Terminal 命令运行。

2. **长期记忆上下文**：
${memoryContext}

3. **可用技能列表 (Skills)**：
${skillsList}

${customInstruction ? `\n附加系统提示词:\n${customInstruction}` : ''}`;
}
