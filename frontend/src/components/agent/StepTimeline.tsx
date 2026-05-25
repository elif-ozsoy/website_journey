import { AgentStep } from "./agentTypes";

interface Props { steps: AgentStep[]; onSelectStep: (n: number) => void; }

// High-contrast themes: Deep text on pale backgrounds
const ACTION_THEMES: Record<string, { bg: string; text: string; dot: string }> = {
  click_element: { bg: "bg-indigo-100", text: "text-indigo-900", dot: "bg-indigo-600" },
  input_text: { bg: "bg-emerald-100", text: "text-emerald-900", dot: "bg-emerald-600" },
  go_to_url: { bg: "bg-amber-100", text: "text-amber-900", dot: "bg-amber-600" },
  scroll: { bg: "bg-cyan-100", text: "text-cyan-900", dot: "bg-cyan-600" },
  extract_content: { bg: "bg-purple-100", text: "text-purple-900", dot: "bg-purple-600" },
  done: { bg: "bg-blue-600", text: "text-white", dot: "bg-blue-600" },
  unknown: { bg: "bg-slate-200", text: "text-slate-900", dot: "bg-slate-600" },
};

export default function StepTimeline({ steps, onSelectStep }: Props) {
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-10 border-l-2 border-indigo-500 pl-4">
        Live Activity Log
      </h3>
      
      <div className="relative">
        {/* Timeline Spine: Slightly darker for visibility */}
        <div className="absolute left-[11px] top-2 bottom-0 w-[2px] bg-slate-200" />
        
        <div className="space-y-12 pl-10">
          {steps.map((step) => {
            const theme = ACTION_THEMES[step.action_type] ?? ACTION_THEMES.unknown;
            
            return (
              <div key={step.step_number} className="relative group">
                {/* Step Marker */}
                <div className={`absolute -left-[37px] top-1 w-6 h-6 rounded-full border-4 border-white shadow-md flex items-center justify-center text-xs font-black text-white z-10 ${theme.dot}`}>
                  {step.step_number}
                </div>

                <div 
                  className="p-2 -m-2 rounded-xl transition-colors hover:bg-slate-50/80 cursor-pointer" 
                  onClick={() => onSelectStep(step.step_number)}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-xs font-bold uppercase tracking-tighter px-2 py-0.5 rounded ${theme.bg} ${theme.text}`}>
                      {step.action_type.replace(/_/g, " ")}
                    </span>
                    {/* URL: Darkened from 400 to 600 */}
                    <span className="text-xs text-slate-600 font-semibold truncate bg-slate-100 px-2 py-0.5 rounded">
                      {step.url ? new URL(step.url).hostname : 'browser'}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {/* Primary Thought: High Contrast */}
                    {step.thought && (
                      <p className="text-sm text-slate-900 leading-snug font-medium">
                        {step.thought}
                      </p>
                    )}
                    
                    {/* Reasoning: Darkened from 500 to 700 */}
                    {step.reasoning && (
                      <div className="flex gap-2 items-start">
                         <span className="text-xs font-black text-slate-400 uppercase mt-1 tracking-tighter">Logic</span>
                         <p className="text-sm text-slate-700 leading-relaxed border-l border-slate-200 pl-3">
                           {step.reasoning}
                         </p>
                      </div>
                    )}
                  </div>

                  {/* Code Snippet: Higher contrast background */}
                  {Object.keys(step.action_details).length > 0 && (
                    <div className="mt-4 p-3 bg-slate-900 rounded-lg shadow-inner">
                      <pre className="text-xs font-mono text-indigo-300 whitespace-pre-wrap">
                        {JSON.stringify(step.action_details, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div className="mt-3 text-xs font-bold text-indigo-600 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    VIEW SCREENSHOT <span>→</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}