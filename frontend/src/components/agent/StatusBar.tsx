export default function StatusBar({ state, stepCount }: any) {
  return (
    <div className="px-8 py-3 bg-white border-b border-slate-100 flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* Simple State Badge */}
        <div className={`text-xs uppercase tracking-widest font-bold px-2 py-0.5 rounded ${
          state === 'running' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
        }`}>
          {state}
        </div>
        
        {/* Step Counter as a subtle label */}
        <span className="text-sm text-slate-400 font-medium">
          {stepCount} {stepCount === 1 ? 'Step' : 'Steps'} captured
        </span>
      </div>

      {/* Action hint */}
      <span className="text-xs text-slate-300 italic">
        {state === 'running' ? 'Streaming live data...' : 'Reviewing history'}
      </span>
    </div>
  );
}