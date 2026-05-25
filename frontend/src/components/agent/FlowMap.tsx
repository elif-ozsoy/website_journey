import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { AgentStep } from "./agentTypes";
import ScreenshotCard from "./ScreenshotCard";

// ── Layout ───────────────────────────────────────────────────────────────────
const NODE_W = 210;
const NODE_H = 172;
const GAP_X = 120;
const PAD_X = 160;
const NODE_Y = 230;
const CANVAS_H = 640;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.5;

// ── Action styling ────────────────────────────────────────────────────────────
const ACTION_COLORS: Record<string, string> = {
  click_element: "#185FA5",
  input_text: "#059669",
  go_to_url: "#d97706",
  scroll: "#0891b2",
  go_back: "#f43f5e",
  extract_content: "#7c3aed",
  done: "#16a34a",
  unknown: "#475569",
};

const ACTION_ICONS: Record<string, string> = {
  click_element: "🖱️",
  input_text: "⌨️",
  go_to_url: "🔗",
  scroll: "↕️",
  go_back: "←",
  extract_content: "📋",
  done: "✓",
  search_google: "🔍",
  open_tab: "🗂️",
  switch_tab: "⇄",
};

function aColor(t: string) { return ACTION_COLORS[t] ?? "#475569"; }
function aIcon(t: string)  { return ACTION_ICONS[t] ?? "⚡"; }
function nodeLeft(gi: number) { return PAD_X + gi * (NODE_W + GAP_X); }
function canvasWidth(n: number) { return 2 * PAD_X + n * NODE_W + Math.max(0, n - 1) * GAP_X; }

// ── Same-element revisit detection ────────────────────────────────────────────
function sameElement(a: AgentStep, b: AgentStep): boolean {
  const ac = a.element_coordinates, bc = b.element_coordinates;
  if (!ac || !bc || a.url !== b.url) return false;
  const T = 3;
  return Math.abs(ac.x - bc.x) < T && Math.abs(ac.y - bc.y) < T &&
         Math.abs(ac.width - bc.width) < T && Math.abs(ac.height - bc.height) < T;
}

// ── Step grouping ─────────────────────────────────────────────────────────────
// Consecutive steps are bundled as a retry group only when they share a
// pixel-identical screenshot AND target the same element.  Steps that merely
// happen on the same static page (same screenshot, different elements) each
// get their own group so they appear as distinct nodes in the flow.
interface StepGroup { steps: AgentStep[]; isRetry: boolean; }

function buildGroups(steps: AgentStep[]): StepGroup[] {
  if (!steps.length) return [];
  const groups: StepGroup[] = [];
  let i = 0;
  while (i < steps.length) {
    const base = steps[i].screenshot_base64;
    let j = i + 1;
    while (
      j < steps.length &&
      steps[j].screenshot_base64 === base &&
      base !== "" &&
      sameElement(steps[i], steps[j])
    ) j++;
    groups.push({ steps: steps.slice(i, j), isRetry: j > i + 1 });
    i = j;
  }
  return groups;
}

interface LoopEdge { from: number; to: number; arcH: number; }

function buildLoopEdges(groups: StepGroup[]): LoopEdge[] {
  const edges: LoopEdge[] = [];
  const countByTarget = new Map<number, number>();
  for (let j = 1; j < groups.length; j++) {
    for (let i = 0; i < j; i++) {
      if (sameElement(groups[i].steps[0], groups[j].steps[0])) {
        const n = countByTarget.get(i) ?? 0;
        edges.push({ from: j, to: i, arcH: 85 + n * 52 });
        countByTarget.set(i, n + 1);
        break;
      }
    }
  }
  return edges;
}

// ── SVG paths ─────────────────────────────────────────────────────────────────
function forwardPath(fromI: number, toI: number): string {
  const x1 = nodeLeft(fromI) + NODE_W, y = NODE_Y + NODE_H / 2;
  const x2 = nodeLeft(toI), cx = (x1 + x2) / 2;
  return `M ${x1} ${y} C ${cx} ${y} ${cx} ${y} ${x2} ${y}`;
}

function loopArcPath(fromI: number, toI: number, arcH: number): string {
  const fx = nodeLeft(fromI) + NODE_W / 2, fy = NODE_Y;
  const tx = nodeLeft(toI)  + NODE_W / 2, ty = NODE_Y;
  const cy = NODE_Y - arcH;
  return `M ${fx} ${fy} C ${fx} ${cy} ${tx} ${cy} ${tx} ${ty}`;
}

// Self-loop: curves to the right and back, arrowhead points back into the node
function selfLoopPath(gi: number): string {
  const x = nodeLeft(gi) + NODE_W + 2;
  const yT = NODE_Y + NODE_H / 3;
  const yB = NODE_Y + 2 * NODE_H / 3;
  return `M ${x} ${yT} C ${x + 58} ${yT} ${x + 58} ${yB} ${x} ${yB}`;
}

// ── Mini thumbnail for picker/retry panels ────────────────────────────────────
function MiniThumb({
  step, size = 72, onClick, label,
}: { step: AgentStep; size?: number; onClick: () => void; label?: string }) {
  const h = Math.round(size * 0.72);
  return (
    <div className="flex-shrink-0 cursor-pointer group/thumb" onClick={onClick}>
      <div
        className="relative rounded-lg overflow-hidden border-2 border-transparent group-hover/thumb:border-indigo-400 transition-colors shadow"
        style={{ width: size, height: h }}
      >
        {(step.screenshot_base64 || step.screenshot_url)
          ? <img src={step.screenshot_base64 ? `data:image/png;base64,${step.screenshot_base64}` : step.screenshot_url!} alt="" className="w-full h-full object-cover" draggable={false} />
          : <div className="h-full bg-slate-700 flex items-center justify-center text-slate-400 text-xs">—</div>
        }
        <div className="absolute top-0.5 left-0.5 bg-slate-900/80 text-white rounded text-xs font-black px-1">
          #{step.step_number}
        </div>
      </div>
      {label && (
        <div className="text-xs text-slate-300 font-bold text-center mt-1 uppercase tracking-tight truncate" style={{ width: size }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props { steps: AgentStep[]; containerHeight?: string; }

export default function FlowMap({ steps, containerHeight = "calc(100vh - 182px)" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [panX, setPanX]         = useState(60);
  const [panY, setPanY]         = useState(40);
  const [zoom, setZoom]         = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  // Modal state
  const [selected, setSelected]         = useState<AgentStep | null>(null);
  const [showNextPicker, setShowNextPicker] = useState(false);

  // Which retry-group nodes are expanded in the canvas
  const [expandedRetry, setExpandedRetry] = useState<Set<number>>(new Set());

  const dragRef    = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const wasDragRef = useRef(false);
  const wheelRef   = useRef<((e: WheelEvent) => void) | null>(null);

  // Filter out mousemove and other noisy events
  const filteredSteps = useMemo(() => {
    const noisy = ['mousemove', 'pointermove', 'mouseover', 'mouseenter', 'mouseleave', 'mouseout'];
    return steps.filter(step => {
      const actionType = step.action_type.toLowerCase();
      return !noisy.some(n => actionType.includes(n));
    });
  }, [steps]);

  const groups      = useMemo(() => buildGroups(filteredSteps), [filteredSteps]);
  const loopEdges   = useMemo(() => buildLoopEdges(groups), [groups]);
  const totalW      = useMemo(() => canvasWidth(groups.length), [groups.length]);
  const actionTypes = useMemo(() => [...new Set(filteredSteps.map(s => s.action_type))], [filteredSteps]);

  // ── Fit-to-view ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !groups.length) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const s = Math.min(Math.max(Math.min((width - 80) / totalW, (height - 80) / CANVAS_H), MIN_ZOOM), 1);
    setPanX((width  - totalW  * s) / 2);
    setPanY((height - CANVAS_H * s) / 2);
    setZoom(s);
  }, [groups.length, totalW]);

  // ── Non-passive wheel (needed for preventDefault) ─────────────────────────
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setZoom(pz => {
      const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pz * factor));
      const r = nz / pz;
      setPanX(px => mx - (mx - px) * r);
      setPanY(py => my - (my - py) * r);
      return nz;
    });
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current?.(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const fitView = useCallback(() => {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const s = Math.min(Math.max(Math.min((width - 80) / totalW, (height - 80) / CANVAS_H), MIN_ZOOM), 1);
    setPanX((width  - totalW  * s) / 2);
    setPanY((height - CANVAS_H * s) / 2);
    setZoom(s);
  }, [totalW]);

  // ── Modal navigation helpers ──────────────────────────────────────────────
  const selectedIndex = selected
    ? filteredSteps.findIndex(s => s.step_number === selected.step_number)
    : -1;

  const prevStep = selectedIndex > 0 ? filteredSteps[selectedIndex - 1] : null;
  const nextStep = selectedIndex >= 0 && selectedIndex < filteredSteps.length - 1
    ? filteredSteps[selectedIndex + 1] : null;

  // If the steps immediately following share an identical screenshot, they form
  // a retry cluster → show a picker instead of jumping blindly.
  const nextPickerSteps = useMemo((): AgentStep[] => {
    if (selectedIndex < 0) return [];
    const ni = selectedIndex + 1;
    if (ni >= filteredSteps.length) return [];
    const base = filteredSteps[ni].screenshot_base64;
    if (!base) return [];
    const group: AgentStep[] = [];
    let k = ni;
    while (k < filteredSteps.length && filteredSteps[k].screenshot_base64 === base) { group.push(filteredSteps[k]); k++; }
    return group.length > 1 ? group : [];
  }, [selectedIndex, filteredSteps]);

  const navigatePrev = useCallback(() => {
    if (prevStep) { setSelected(prevStep); setShowNextPicker(false); }
  }, [prevStep]);

  const navigateNext = useCallback(() => {
    if (nextPickerSteps.length > 0) {
      setShowNextPicker(p => !p);
    } else if (nextStep) {
      setSelected(nextStep);
      setShowNextPicker(false);
    }
  }, [nextPickerSteps, nextStep]);

  // ── Keyboard handler for modal ────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")  { e.preventDefault(); navigatePrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); navigateNext(); }
      if (e.key === "Escape")     {
        if (showNextPicker) setShowNextPicker(false);
        else setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, navigatePrev, navigateNext, showNextPicker]);

  const SVG_W = Math.max(totalW, 800);

  if (!filteredSteps.length) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <p className="text-sm font-medium">Waiting for steps…</p>
      </div>
    );
  }

  // START pill geometry
  const startPillW = 62, startPillH = 30;
  const startPillX = PAD_X - GAP_X / 2 - startPillW / 2 - 18;
  const arrowY     = NODE_Y + NODE_H / 2;

  return (
    <>
      {/* ── Infinite canvas ──────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className={`relative w-full overflow-hidden select-none bg-slate-50 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ height: containerHeight, minHeight: 400 }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          wasDragRef.current = false;
          dragRef.current = { sx: e.clientX, sy: e.clientY, px: panX, py: panY };
          setIsDragging(true);
        }}
        onMouseMove={(e) => {
          if (!dragRef.current) return;
          const dx = e.clientX - dragRef.current.sx;
          const dy = e.clientY - dragRef.current.sy;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragRef.current = true;
          setPanX(dragRef.current.px + dx);
          setPanY(dragRef.current.py + dy);
        }}
        onMouseUp={() => { dragRef.current = null; setIsDragging(false); }}
        onMouseLeave={() => { dragRef.current = null; setIsDragging(false); }}
      >
        {/* Dot-grid background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${panX % (24 * zoom)}px ${panY % (24 * zoom)}px`,
          }}
        />

        {/* ── Transformed canvas ─────────────────────────────────────── */}
        <div
          style={{
            position: "absolute", left: 0, top: 0,
            transformOrigin: "0 0",
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            width: SVG_W, height: CANVAS_H,
            willChange: "transform",
          }}
        >
          {/* ── SVG arrow layer ──────────────────────────────────────── */}
          <svg
            style={{ position: "absolute", inset: 0, width: SVG_W, height: CANVAS_H, overflow: "visible" }}
            className="pointer-events-none"
          >
            <defs>
              <marker id="ah-start" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8Z" fill="#64748b" />
              </marker>
              {actionTypes.map(t => (
                <marker key={t} id={`ah-${t}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0 L8 4 L0 8Z" fill={aColor(t)} />
                </marker>
              ))}
              <marker id="ah-loop" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8Z" fill="#8b5cf6" />
              </marker>
              <marker id="ah-retry" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8Z" fill="#f59e0b" />
              </marker>
            </defs>

            {/* START → group 0 */}
            <line
              x1={startPillX + startPillW} y1={arrowY}
              x2={nodeLeft(0) - 4}         y2={arrowY}
              stroke="#64748b" strokeWidth="2.5" markerEnd="url(#ah-start)"
            />

            {/* Forward arrows between groups (colored by the leaving group's last action) */}
            {groups.slice(0, -1).map((group, gi) => {
              const rep = group.steps[group.steps.length - 1];
              return (
                <path key={`fwd-${gi}`}
                  d={forwardPath(gi, gi + 1)}
                  stroke={aColor(rep.action_type)} strokeWidth="2.5"
                  fill="none" markerEnd={`url(#ah-${rep.action_type})`}
                />
              );
            })}

            {/* Self-loops for retry groups */}
            {groups.map((group, gi) => !group.isRetry ? null : (
              <g key={`self-${gi}`}>
                <path
                  d={selfLoopPath(gi)}
                  stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="6 3"
                  fill="none" markerEnd="url(#ah-retry)"
                />
                <text
                  x={nodeLeft(gi) + NODE_W + 32}
                  y={NODE_Y + NODE_H / 2 - 20}
                  textAnchor="middle" fontSize="9" fontWeight="700"
                  fill="#d97706" fontFamily="var(--font-sans)" letterSpacing="0.06em"
                >
                  retry ×{group.steps.length}
                </text>
              </g>
            ))}

            {/* Revisit loop arcs (above nodes) */}
            {loopEdges.map((edge, idx) => (
              <g key={`loop-${idx}`}>
                <path
                  d={loopArcPath(edge.from, edge.to, edge.arcH)}
                  stroke="#8b5cf6" strokeWidth="2" strokeDasharray="7 4"
                  fill="none" markerEnd="url(#ah-loop)"
                />
                <text
                  x={(nodeLeft(edge.from) + NODE_W / 2 + nodeLeft(edge.to) + NODE_W / 2) / 2}
                  y={NODE_Y - edge.arcH - 6}
                  textAnchor="middle" fontSize="9" fontWeight="700"
                  fill="#8b5cf6" fontFamily="var(--font-sans)" letterSpacing="0.08em"
                >
                  revisit
                </text>
              </g>
            ))}
          </svg>

          {/* ── START pill ───────────────────────────────────────────── */}
          <div
            style={{
              position: "absolute",
              left: startPillX,
              top: NODE_Y + NODE_H / 2 - startPillH / 2,
              width: startPillW, height: startPillH,
            }}
            className="bg-slate-900 text-white rounded-full flex items-center justify-center shadow-lg"
          >
            <span className="text-xs font-black tracking-widest uppercase">START</span>
          </div>

          {/* ── Group nodes ──────────────────────────────────────────── */}
          {groups.map((group, gi) => {
            const rep   = group.steps[0];
            const thumbH = NODE_H - 38;
            const isOpen = expandedRetry.has(gi);

            return (
              <div key={gi} style={{ position: "absolute", left: nodeLeft(gi), top: NODE_Y, width: NODE_W }}>

                {/* ── Main node card ───────────────────────────────── */}
                <div
                  style={{ width: NODE_W, height: NODE_H, cursor: "pointer" }}
                  className={`bg-white rounded-xl border shadow-md hover:shadow-xl transition-all duration-200 group overflow-hidden ${
                    group.isRetry ? "border-amber-300" : "border-slate-200 hover:border-indigo-300"
                  }`}
                  onClick={(e) => {
                    if (wasDragRef.current) return;
                    e.stopPropagation();
                    if (group.isRetry) {
                      setExpandedRetry(prev => {
                        const next = new Set(prev);
                        next.has(gi) ? next.delete(gi) : next.add(gi);
                        return next;
                      });
                    } else {
                      setSelected(rep);
                    }
                  }}
                >
                  {/* Screenshot thumbnail */}
                  <div className="relative overflow-hidden bg-slate-100" style={{ height: thumbH }}>
                    {(rep.screenshot_base64 || rep.screenshot_url)
                      ? (
                        <>
                          <img
                            src={rep.screenshot_base64 ? `data:image/png;base64,${rep.screenshot_base64}` : rep.screenshot_url!}
                            alt=""
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            draggable={false}
                          />
                        </>
                      )
                      : <div className="h-full flex items-center justify-center text-slate-400 text-xs font-bold">No Image</div>
                    }

                    {/* Badge */}
                    {group.isRetry
                      ? (
                        <div className="absolute top-1.5 left-1.5 px-2 h-6 bg-amber-500 text-white rounded-lg flex items-center gap-1 text-xs font-black shadow-md">
                          ↺ ×{group.steps.length}
                        </div>
                      )
                      : (
                        <div
                          className="absolute top-1.5 left-1.5 w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-black shadow-md"
                          style={{ backgroundColor: aColor(rep.action_type) }}
                        >
                          {rep.step_number}
                        </div>
                      )
                    }

                    {/* Hover hint */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-slate-900/30">
                      <span className="text-xs font-black uppercase tracking-widest text-white bg-slate-900/70 px-2 py-1 rounded-lg">
                        {group.isRetry ? (isOpen ? "Collapse ↑" : `View ${group.steps.length} retries`) : "Inspect →"}
                      </span>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="h-[38px] px-2.5 flex items-center border-t border-slate-100 bg-white">
                    {group.isRetry
                      ? <span className="text-xs font-black uppercase tracking-tight text-amber-600 truncate">↺ retry ×{group.steps.length}</span>
                      : <span className="text-xs font-black uppercase tracking-tight truncate" style={{ color: aColor(rep.action_type) }}>
                          {aIcon(rep.action_type)} {rep.action_type.replace(/_/g, " ")}
                        </span>
                    }
                  </div>
                </div>

                {/* ── Retry expand panel ───────────────────────────── */}
                {group.isRetry && isOpen && (
                  <div
                    className="absolute z-20 mt-2 p-2.5 bg-white border border-amber-200 rounded-xl shadow-xl flex gap-2 overflow-x-auto"
                    style={{ top: NODE_H + 4, left: 0, minWidth: NODE_W, maxWidth: 380 }}
                    onClick={e => e.stopPropagation()}
                  >
                    {group.steps.map(s => (
                      <MiniThumb
                        key={s.step_number}
                        step={s}
                        size={72}
                        label={s.action_type.replace(/_/g, " ")}
                        onClick={() => {
                          if (!wasDragRef.current) setSelected(s);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Zoom controls ─────────────────────────────────────────── */}
        <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5">
          {([
            { label: "+",  title: "Zoom in",       fn: () => setZoom(z => Math.min(MAX_ZOOM, z * 1.2)) },
            { label: "−",  title: "Zoom out",      fn: () => setZoom(z => Math.max(MIN_ZOOM, z / 1.2)) },
            { label: "⊡", title: "Fit to screen", fn: fitView },
          ] as const).map(({ label, title, fn }) => (
            <button key={label} title={title} onClick={fn}
              className="w-8 h-8 bg-white border border-slate-200 rounded-lg shadow-sm flex items-center justify-center text-slate-600 hover:text-indigo-600 font-bold text-sm hover:bg-slate-50 transition-colors"
            >{label}</button>
          ))}
        </div>

        {/* ── Legend ────────────────────────────────────────────────── */}
        <div className="absolute bottom-4 left-4 z-10 pointer-events-none flex items-center gap-4">
          <span className="text-xs text-slate-400 font-medium">Drag · Scroll to zoom · Click to inspect</span>
          {groups.some(g => g.isRetry) && (
            <span className="flex items-center gap-1 text-xs font-bold text-amber-500">
              <svg width="20" height="8"><line x1="0" y1="4" x2="14" y2="4" stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 3"/><polygon points="14,1 20,4 14,7" fill="#f59e0b"/></svg>
              retry
            </span>
          )}
          {loopEdges.length > 0 && (
            <span className="flex items-center gap-1 text-xs font-bold text-violet-500">
              <svg width="20" height="8"><line x1="0" y1="4" x2="14" y2="4" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="5 3"/><polygon points="14,1 20,4 14,7" fill="#8b5cf6"/></svg>
              revisit
            </span>
          )}
        </div>
      </div>

      {/* ── Step detail modal ──────────────────────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-6"
          onClick={() => { setSelected(null); setShowNextPicker(false); }}
        >
          <div
            className="w-full max-w-5xl max-h-[92vh] flex flex-col gap-2"
            onClick={e => e.stopPropagation()}
          >
            {/* ── Navigation bar ──────────────────────────────────── */}
            <div className="flex items-center justify-between">
              {/* Prev button */}
              <button
                disabled={!prevStep}
                onClick={navigatePrev}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
                  prevStep
                    ? "bg-white text-slate-900 border-slate-200 shadow-sm hover:bg-slate-50"
                    : "opacity-30 pointer-events-none bg-white/30 text-slate-400 border-white/20"
                }`}
              >
                ← {prevStep ? `Step ${prevStep.step_number}` : "—"}
              </button>

              {/* Center: step counter + close */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-white drop-shadow">
                  Step {selected.step_number} / {filteredSteps.length}
                </span>
                <button
                  onClick={() => { setSelected(null); setShowNextPicker(false); }}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/40 text-white font-bold transition-colors"
                  title="Close (Esc)"
                >✕</button>
              </div>

              {/* Next button */}
              <button
                disabled={!nextStep && !nextPickerSteps.length}
                onClick={navigateNext}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
                  nextStep || nextPickerSteps.length
                    ? "bg-white text-slate-900 border-slate-200 shadow-sm hover:bg-slate-50"
                    : "opacity-30 pointer-events-none bg-white/30 text-slate-400 border-white/20"
                }`}
              >
                {nextPickerSteps.length > 0
                  ? `${nextPickerSteps.length} retries ↓`
                  : nextStep
                  ? `Step ${nextStep.step_number} →`
                  : "—"}
              </button>
            </div>

            {/* ── Retry picker strip ───────────────────────────────── */}
            {showNextPicker && nextPickerSteps.length > 0 && (
              <div className="flex gap-2 px-1 overflow-x-auto pb-1 pt-1">
                <span className="text-xs text-white/60 font-bold self-center uppercase tracking-wider flex-shrink-0 mr-1">Retries:</span>
                {nextPickerSteps.map(s => (
                  <MiniThumb
                    key={s.step_number}
                    step={s}
                    size={100}
                    label={s.action_type.replace(/_/g, " ")}
                    onClick={() => { setSelected(s); setShowNextPicker(false); }}
                  />
                ))}
              </div>
            )}

            {/* ── Expanded card ────────────────────────────────────── */}
            <div className="overflow-auto rounded-2xl shadow-2xl">
              <ScreenshotCard
                step={selected}
                isExpanded
                onClick={() => { setSelected(null); setShowNextPicker(false); }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
