import React, { useState } from 'react';
import { AgentExecutionStep } from '../../lib/agent/types';
import { Terminal, Monitor, MousePointer, BookOpen, Brain, ChevronDown, ChevronUp, CheckCircle, Clock } from 'lucide-react';

interface AgentStepBadgeProps {
  steps: AgentExecutionStep[];
}

export const AgentStepBadge: React.FC<AgentStepBadgeProps> = ({ steps }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!steps || steps.length === 0) return null;

  return (
    <div className="my-2 border border-slate-700/80 bg-slate-900/90 rounded-xl overflow-hidden shadow-md text-slate-200">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-800 flex items-center justify-between text-xs font-semibold transition"
      >
        <div className="flex items-center gap-2 text-indigo-300">
          <Terminal className="w-4 h-4 text-indigo-400" />
          <span>Agent 执行流程轨迹 ({steps.length} 个步骤)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <span className="text-[11px] font-mono text-emerald-400">Tool Calls Done</span>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {isExpanded && (
        <div className="p-3 space-y-3 divide-y divide-slate-800/80 text-xs">
          {steps.map((step, idx) => (
            <div key={step.id || idx} className={idx > 0 ? 'pt-3' : ''}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-indigo-400 font-medium flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px]">
                    {step.stepNumber || idx + 1}
                  </span>
                  {step.toolName}
                </span>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                  <CheckCircle className="w-3 h-3" /> Completed
                </span>
              </div>

              {step.thought && (
                <p className="text-slate-400 italic text-[11px] mb-2 bg-slate-950/60 p-2 rounded border border-slate-800">
                  💭 思考: {step.thought}
                </p>
              )}

              {step.args && Object.keys(step.args).length > 0 && (
                <div className="text-[11px] font-mono text-slate-300 bg-slate-950 p-2 rounded mb-2 overflow-x-auto">
                  <span className="text-slate-500">参数: </span>
                  {JSON.stringify(step.args)}
                </div>
              )}

              {step.result && (
                <div className="text-[11px] font-mono text-slate-300 bg-slate-950/80 p-2 rounded border border-slate-800/80 whitespace-pre-wrap">
                  <span className="text-emerald-400">输出: </span>
                  {typeof step.result === 'string' ? step.result : JSON.stringify(step.result)}
                </div>
              )}

              {step.screenshotAfter && (
                <div className="mt-2 rounded border border-slate-800 overflow-hidden max-w-xs">
                  <img src={step.screenshotAfter} alt="Step screenshot" className="w-full object-cover" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
