import { AgentStep } from "./agentTypes";

interface Props { step: AgentStep; isExpanded?: boolean; isSelected?: boolean; onClick: () => void; }

// Using our high-contrast light mode palette
const ACTION_COLORS: Record<string, string> = {
  click_element: "#185FA5",
  input_text: "#059669",    // Emerald 600
  go_to_url: "#d97706",     // Amber 600
  scroll: "#0891b2",        // Cyan 600
  go_back: "#f43f5e",       // Rose 500
  extract_content: "#7c3aed", // Violet 600
  done: "#16a34a",          // Green 600
  unknown: "#475569",       // Slate 600
};

const ACTION_ICONS: Record<string, string> = {
  click_element: "🖱️", input_text: "⌨️", go_to_url: "🔗", scroll: "↕️",
  go_back: "←", extract_content: "📋", done: "✓", search_google: "🔍",
  open_tab: "🗂️", switch_tab: "⇄",
};

function color(type: string) { return ACTION_COLORS[type] ?? ACTION_COLORS.unknown; }
function icon(type: string) { return ACTION_ICONS[type] ?? "⚡"; }

export default function ScreenshotCard({ step, isExpanded = false, isSelected = false, onClick }: Props) {
  const c = color(step.action_type);
  const imgSrc = step.screenshot_base64
    ? `data:image/png;base64,${step.screenshot_base64}`
    : step.screenshot_url ?? null;
  const hasShot = !!imgSrc;

  if (isExpanded) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        {/* HEADER: High Contrast Light */}
        <div className="px-6 py-4 flex items-center gap-4 border-b border-slate-100 bg-slate-50/50">
          <span className="text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-md text-white shadow-sm" style={{ backgroundColor: c }}>
            Step {step.step_number}
          </span>
          <div className="flex-1 min-w-0">
             <p className="text-xs font-bold text-slate-900 truncate uppercase tracking-tighter">
               {step.action_type.replace(/_/g, " ")}
             </p>
             <p className="text-xs font-medium text-slate-500 truncate lowercase">{step.url}</p>
          </div>
          <button onClick={onClick} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200 transition-colors text-slate-400 hover:text-slate-900 font-bold">✕</button>
        </div>

        <div className="flex flex-col lg:flex-row">
          {/* IMAGE AREA */}
          <div className="flex-1 relative bg-slate-100 min-h-[400px] flex items-center justify-center overflow-hidden">
            {hasShot ? (
              <div className="relative group">
                <img
                  src={imgSrc!}
                  alt={`Step ${step.step_number}`}
                  className="max-w-full h-auto shadow-sm"
                  draggable={false}
                />
              </div>
            ) : (
              <div className="text-slate-400 font-medium">No visual captured</div>
            )}
          </div>

          {/* SIDEBAR AREA: Clean Slate theme */}
          <div className="w-full lg:w-80 p-6 flex flex-col gap-6 bg-white border-l border-slate-100 overflow-auto max-h-[600px]">
            {step.thought && (
              <section>
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">The AI Thought</h4>
                <p className="text-sm text-slate-800 leading-relaxed font-medium">"{step.thought}"</p>
              </section>
            )}
            
            {step.reasoning && (
              <section className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Evaluation</h4>
                <p className="text-xs text-slate-600 leading-relaxed">{step.reasoning}</p>
              </section>
            )}

            {Object.keys(step.action_details).length > 0 && (
              <section>
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Action Details</h4>
                <pre className="text-xs font-mono text-indigo-600 bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 overflow-auto">
                  {JSON.stringify(step.action_details, null, 2)}
                </pre>
              </section>
            )}
          </div>
        </div>
      </div>
    );
  }

  // MINIFIED CARD (Grid View)
  return (
    <div 
      onClick={onClick} 
      className={`group relative cursor-pointer rounded-xl overflow-hidden border transition-all duration-200 hover:shadow-xl ${
        isSelected ? "border-indigo-500 ring-4 ring-indigo-50" : "border-slate-200 hover:border-slate-400"
      }`}
    >
      <div className="aspect-video relative bg-slate-100 overflow-hidden">
        {hasShot ? (
          <>
            <img src={imgSrc!} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 text-xs font-bold uppercase">No Image</div>
        )}
        <div className="absolute top-2 left-2 w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-black shadow-lg" style={{ backgroundColor: c }}>
          {step.step_number}
        </div>
      </div>
      <div className="bg-white p-3 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700 truncate uppercase tracking-tight">
          {icon(step.action_type)} {step.action_type.replace(/_/g, " ")}
        </span>
      </div>
    </div>
  );
}