"use client";

import Link from "next/link";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  type TrackerSession,
  type AnalyticsEvent,
  type Journey,
  type PageJourneyContext,
  fetchSessions,
  fetchEventsByType,
  buildJourneys,
  buildClicksByPath,
  uniquePaths,
  journeyContextForPath,
  generateDemoData,
} from "../lib/api";

// ─── Heatmap canvas drawing ─────────────────────────────────────────────────

const CLICK_COLORMAP: [number, number, number][] = [
  [0, 0, 255],
  [0, 255, 255],
  [0, 255, 0],
  [255, 255, 0],
  [255, 0, 0],
];

const MOVE_COLORMAP: [number, number, number][] = [
  [80, 0, 200],
  [120, 60, 255],
  [0, 180, 255],
  [0, 255, 200],
  [200, 255, 255],
];

function heatColor(
  t: number,
  colormap: [number, number, number][]
): [number, number, number] {
  const n = colormap.length - 1;
  const seg = Math.min(t * n, n - 0.001);
  const i = Math.floor(seg);
  const f = seg - i;
  return colormap[i].map(
    (c, j) => Math.round(c + f * (colormap[i + 1][j] - c))
  ) as [number, number, number];
}

function drawHeatLayer(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  points: { x: number; y: number }[],
  radius: number,
  colormap: [number, number, number][],
  intensityScale: number,
  alphaScale: number
) {
  if (points.length === 0) return;

  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const octx = off.getContext("2d")!;
  octx.globalCompositeOperation = "lighter";

  for (const { x, y } of points) {
    const g = octx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, "rgba(255,255,255,0.35)");
    g.addColorStop(0.4, "rgba(255,255,255,0.15)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    octx.fillStyle = g;
    octx.beginPath();
    octx.arc(x, y, radius, 0, Math.PI * 2);
    octx.fill();
  }

  const imgData = octx.getImageData(0, 0, W, H);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const intensity = d[i] / 255;
    if (intensity > 0.004) {
      const [r, g, b] = heatColor(Math.min(intensity * intensityScale, 1), colormap);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
      d[i + 3] = Math.min(240, Math.round(intensity * alphaScale));
    } else {
      d[i + 3] = 0;
    }
  }
  octx.putImageData(imgData, 0, 0);
  ctx.drawImage(off, 0, 0);
}

// ─── Main page ──────────────────────────────────────────────────────────────

type DeviceFilter = "all" | "desktop" | "mobile" | "tablet";
type HeatType = "clicks" | "moves" | "both";

export default function HeatmapPage() {
  // ── Config state ──────────────────────────────────────────────────────────
  const [apiUrl, setApiUrl] = useState("http://localhost:8080");
  const [siteSlug, setSiteSlug] = useState("");
  const [selectedPath, setSelectedPath] = useState("/");
  const [pathList, setPathList] = useState<string[]>([]);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>("all");
  const [heatType, setHeatType] = useState<HeatType>("both");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDemoMode, setIsDemoMode] = useState(false);

  // ── Data state ────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<TrackerSession[]>([]);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [clicksByPath, setClicksByPath] = useState<Map<string, AnalyticsEvent[]>>(new Map());
  const [movesByPath, setMovesByPath] = useState<Map<string, AnalyticsEvent[]>>(new Map());
  const [jCtx, setJCtx] = useState<PageJourneyContext | null>(null);
  const [totalClicks, setTotalClicks] = useState(0);
  const [totalMoves, setTotalMoves] = useState(0);

  // ── Canvas page-height state ──────────────────────────────────────────────
  const [pageHeight, setPageHeight] = useState(0); // 0 = use container height

  // ── Refs ──────────────────────────────────────────────────────────────────
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Fetch from backend ────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    const slug = siteSlug.trim();
    if (!slug) { setError("Please enter a site slug."); return; }
    setLoading(true); setError("");
    try {
      const base = apiUrl.replace(/\/$/, "");
      const [sess, pvEvs, clEvs, mvEvs] = await Promise.all([
        fetchSessions(base, slug),
        fetchEventsByType(base, slug, "pageview"),
        fetchEventsByType(base, slug, "click"),
        fetchEventsByType(base, slug, "mousemove"),
      ]);
      const js = buildJourneys(sess, pvEvs);
      const cbp = buildClicksByPath(clEvs);
      const mbp = buildClicksByPath(mvEvs);
      const paths = uniquePaths(pvEvs);

      setSessions(sess);
      setJourneys(js);
      setClicksByPath(cbp);
      setMovesByPath(mbp);
      setPathList(paths);
      if (paths.length && !paths.includes(selectedPath)) setSelectedPath(paths[0]);
      setIsDemoMode(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, siteSlug, selectedPath]);

  // ── Load demo data ────────────────────────────────────────────────────────
  const loadDemo = useCallback(() => {
    const { sessions: sess, pageviewEvents: pvEvs, clickEvents: clEvs } =
      generateDemoData();
    const js = buildJourneys(sess, pvEvs);
    const cbp = buildClicksByPath(clEvs);
    const paths = uniquePaths(pvEvs);

    setSessions(sess);
    setJourneys(js);
    setClicksByPath(cbp);
    setMovesByPath(new Map());
    setPathList(paths);
    setSelectedPath("/");
    setSiteSlug("demo");
    setIsDemoMode(true);
    setError("");
  }, []);

  // ── Recompute journey context when selection changes ───────────────────────
  useEffect(() => {
    if (!journeys.length) { setJCtx(null); return; }
    setJCtx(journeyContextForPath(journeys, selectedPath, deviceFilter));
    setTotalClicks(clicksByPath.get(selectedPath)?.length ?? 0);
    setTotalMoves(movesByPath.get(selectedPath)?.length ?? 0);
  }, [journeys, selectedPath, deviceFilter, clicksByPath, movesByPath]);

  // ── Extract canvas points from events ────────────────────────────────────
  const extractPoints = useCallback(
    (events: AnalyticsEvent[]): { x: number; y: number; rawY: number }[] => {
      const sessMap = new Map(sessions.map((s) => [s.id, s]));
      const container = containerRef.current;
      const W = container?.clientWidth ?? 1280;

      return events.flatMap((ev) => {
        let parsed: { x?: number; y?: number; pageX?: number; pageY?: number } = {};
        try { parsed = JSON.parse(ev.data ?? "{}"); } catch { return []; }

        const rawX = parsed.pageX ?? parsed.x;
        const rawY = parsed.pageY ?? parsed.y;
        if (rawX == null || rawY == null) return [];

        const sess = sessMap.get(ev.session_id);
        const vw = sess?.viewport_w ?? 1280;
        return [{ x: (rawX / vw) * W, y: rawY, rawY }];
      });
    },
    [sessions]
  );

  // ── Draw heat map ─────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const W = container.clientWidth;
    if (W === 0) return;

    const clicks = heatType !== "moves" ? (clicksByPath.get(selectedPath) ?? []) : [];
    const moves  = heatType !== "clicks" ? (movesByPath.get(selectedPath) ?? []) : [];

    const clickPts = extractPoints(clicks);
    const movePts  = extractPoints(moves);

    // Compute page height from max raw pageY across all visible events
    let maxRawY = 0;
    for (const p of [...clickPts, ...movePts]) {
      if (p.rawY > maxRawY) maxRawY = p.rawY;
    }
    const computedH = Math.max(container.clientHeight, maxRawY + 300);
    setPageHeight(computedH);

    canvas.width = W;
    canvas.height = computedH;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, computedH);

    if (movePts.length > 0) {
      const r = Math.max(18, Math.min(50, W / 28));
      drawHeatLayer(ctx, W, computedH, movePts, r, MOVE_COLORMAP, 3.5, 600);
    }
    if (clickPts.length > 0) {
      const r = Math.max(32, Math.min(100, W / 16));
      drawHeatLayer(ctx, W, computedH, clickPts, r, CLICK_COLORMAP, 3.2, 900);
    }
  }, [clicksByPath, movesByPath, selectedPath, heatType, extractPoints]);

  useEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  // ── iframe src ────────────────────────────────────────────────────────────
  const iframeSrc = useMemo(
    () => siteSlug && !isDemoMode
      ? `${apiUrl.replace(/\/$/, "")}/site/${siteSlug}${selectedPath}?notasks=1`
      : null,
    [apiUrl, siteSlug, isDemoMode, selectedPath]
  );

  const iframeH = pageHeight > 0 ? pageHeight : "100%";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "var(--font-ibm), 'IBM Plex Sans', system-ui, sans-serif", background: "#e8eaf0" }}>
      {/* ── Top bar ── */}
      <header style={topbarStyle}>
        <div style={logoStyle}>
          <span style={logoIconStyle}>C</span>
          CipherCorgi
        </div>
        <span style={{ color: "#9ba3b8", fontSize: ".82rem" }}>/ Journey Heatmap</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <GhostBtn onClick={loadDemo}>Load demo</GhostBtn>
          <Link href="/" style={{ ...ghostBtnBase, textDecoration: "none" }}>← Dashboard</Link>
        </div>
      </header>

      {/* ── Config bar ── */}
      <div style={configBarStyle}>
        <CfgLabel>API URL</CfgLabel>
        <CfgInput value={apiUrl} onChange={setApiUrl} width={210} placeholder="http://localhost:8080" />
        <Sep />
        <CfgLabel>Site slug</CfgLabel>
        <CfgInput value={siteSlug} onChange={setSiteSlug} width={140} placeholder="e.g. abc12345" />
        <Sep />
        <CfgLabel>Page</CfgLabel>
        <select
          value={selectedPath}
          onChange={(e) => setSelectedPath(e.target.value)}
          style={selectStyle}
        >
          {pathList.length === 0 && <option value={selectedPath}>{selectedPath}</option>}
          {pathList.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Sep />
        {(["all", "desktop", "mobile", "tablet"] as DeviceFilter[]).map((d) => (
          <Chip key={d} active={deviceFilter === d} onClick={() => setDeviceFilter(d)}>
            {d === "all" ? "All" : d.charAt(0).toUpperCase() + d.slice(1)}
          </Chip>
        ))}
        <Sep />
        <CfgLabel>Show</CfgLabel>
        {(["clicks", "moves", "both"] as HeatType[]).map((t) => (
          <Chip key={t} active={heatType === t} onClick={() => setHeatType(t)}>
            {t === "clicks" ? "Clicks" : t === "moves" ? "Movement" : "Both"}
          </Chip>
        ))}
        <Sep />
        <button onClick={fetchData} disabled={loading} style={primaryBtnStyle(loading)}>
          {loading ? <><Spinner />Loading…</> : "Fetch data"}
        </button>
        {error && <span style={{ color: "#e84040", fontSize: ".72rem", maxWidth: 240 }}>{error}</span>}
      </div>

      {/* ── Main layout ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* ── Iframe + canvas ── */}
        <div
          ref={containerRef}
          style={{ position: "relative", flex: 1, overflow: "auto", background: "#f4f6fb" }}
        >
          {iframeSrc ? (
            <iframe
              ref={iframeRef}
              src={iframeSrc}
              title="Site preview"
              scrolling="no"
              style={{
                width: "100%",
                height: iframeH,
                minHeight: "100%",
                border: "none",
                display: "block",
              }}
            />
          ) : (
            <div style={{ height: Math.max(pageHeight, 600) || "100%", position: "relative" }}>
              <EmptyState demo={isDemoMode} hasSlug={!!siteSlug} />
            </div>
          )}

          {/* Heat overlay — scrolls with content */}
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              pointerEvents: "none",
            }}
          />

          {/* Page info badge — sticky at top */}
          {jCtx && (
            <div style={{ ...pageBadgeStyle, position: "sticky" }}>
              <span style={{ fontWeight: 800 }}>{selectedPath}</span>
              <span style={{ color: "#a29bfe" }}>·</span>
              <span>{jCtx.visitCount} visits</span>
              {totalClicks > 0 && <><span style={{ color: "#a29bfe" }}>·</span><span>{totalClicks} clicks</span></>}
              {totalMoves > 0 && <><span style={{ color: "#a29bfe" }}>·</span><span>{totalMoves} move samples</span></>}
            </div>
          )}

          {/* Legend */}
          {(totalClicks > 0 || totalMoves > 0) && <HeatLegend heatType={heatType} />}
        </div>

        {/* ── Journey sidebar ── */}
        <aside style={sidebarStyle}>
          {jCtx ? (
            <JourneySidebar
              path={selectedPath}
              ctx={jCtx}
              sessions={sessions.length}
            />
          ) : (
            <div style={{ padding: 20, color: "#9ba3b8", fontSize: ".78rem" }}>
              Load data to see journey context.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Journey Sidebar ────────────────────────────────────────────────────────

function JourneySidebar({
  path, ctx, sessions,
}: {
  path: string;
  ctx: PageJourneyContext;
  sessions: number;
}) {
  const visitRate = sessions > 0
    ? `${((ctx.visitCount / sessions) * 100).toFixed(0)}%`
    : "—";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: "#f0eeff", border: "1px solid #a29bfe", borderRadius: 10, padding: "10px 12px" }}>
        <div style={eyebrowStyle}>Selected page</div>
        <div style={{ fontWeight: 800, fontSize: ".88rem", color: "#1a1d2e", wordBreak: "break-all" }}>{path}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { val: sessions,         lbl: "Sessions" },
          { val: ctx.visitCount,   lbl: "Page visits" },
          { val: visitRate,        lbl: "Visit rate" },
          { val: ctx.entryCount,   lbl: "Entry point" },
        ].map(({ val, lbl }) => (
          <StatCell key={lbl} val={val} lbl={lbl} />
        ))}
      </div>

      <FlowPanel title="↙ Arriving from" pages={ctx.fromPages} color="#6c5ce7" />
      <FlowPanel title="↗ Navigating to" pages={ctx.toPages} color="#00b2aa" />

      {ctx.topJourneys.length > 0 && (
        <div>
          <div style={eyebrowStyle}>Top journeys through this page</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ctx.topJourneys.map(([key, count], i) => (
              <JourneyRow key={i} journey={key} count={count} activePath={path} rank={i + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ val, lbl }: { val: string | number; lbl: string }) {
  return (
    <div style={{ background: "#f8f9fc", border: "1px solid #dde1ed", borderRadius: 9, padding: "10px 12px" }}>
      <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#6c5ce7" }}>{val}</div>
      <div style={{ fontSize: ".68rem", color: "#9ba3b8", fontWeight: 500 }}>{lbl}</div>
    </div>
  );
}

function FlowPanel({
  title, pages, color,
}: {
  title: string;
  pages: [string, number][];
  color: string;
}) {
  if (pages.length === 0) return null;
  const max = pages[0][1];
  return (
    <div>
      <div style={eyebrowStyle}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {pages.map(([p, count]) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, background: "#f8f9fc", border: "1px solid #dde1ed", borderRadius: 7, padding: "5px 9px", minWidth: 0 }}>
              <div style={{ fontSize: ".7rem", fontWeight: 600, color: "#1a1d2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>{p}</div>
              <div style={{ height: 3, borderRadius: 2, background: "#eef0f5" }}>
                <div style={{ height: "100%", borderRadius: 2, background: color, width: `${(count / max) * 100}%`, transition: "width .3s" }} />
              </div>
            </div>
            <div style={{ fontSize: ".69rem", color: "#9ba3b8", fontWeight: 700, width: 26, textAlign: "right", flexShrink: 0 }}>{count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JourneyRow({
  journey, count, activePath, rank,
}: {
  journey: string; count: number; activePath: string; rank: number;
}) {
  const steps = journey.split(" → ");
  return (
    <div style={{ background: "#f8f9fc", border: "1px solid #dde1ed", borderRadius: 8, padding: "7px 10px" }}>
      <div style={{ fontSize: ".67rem", color: "#9ba3b8", marginBottom: 4, fontWeight: 700 }}>
        #{rank} · {count} session{count === 1 ? "" : "s"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
        {steps.map((s, j) => (
          <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            {j > 0 && <span style={{ color: "#9ba3b8", fontSize: ".72rem" }}>›</span>}
            <span style={{
              background: s === activePath ? "#f0eeff" : "#fff",
              border: `1px solid ${s === activePath ? "#a29bfe" : "#dde1ed"}`,
              color: s === activePath ? "#6c5ce7" : "#1a1d2e",
              borderRadius: 4, padding: "1px 5px",
              fontSize: ".65rem", fontWeight: s === activePath ? 700 : 500,
            }}>{s}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Small components ───────────────────────────────────────────────────────

function EmptyState({ demo, hasSlug }: { demo: boolean; hasSlug: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 400, gap: 14, color: "#9ba3b8", padding: 32 }}>
      <div style={{ fontSize: 52 }}>🌐</div>
      <p style={{ fontSize: ".82rem", textAlign: "center", maxWidth: 300, lineHeight: 1.65 }}>
        {demo
          ? "Demo mode active — heat map is drawn above. Enter a real site slug and fetch data to see the live proxied site."
          : hasSlug
            ? <>Enter API URL and site slug, then click <strong style={{ color: "#6c5ce7" }}>Fetch data</strong> to load the live site with heat overlay.</>
            : <>Enter a site slug and click <strong style={{ color: "#6c5ce7" }}>Fetch data</strong> — or click <strong style={{ color: "#6c5ce7" }}>Load demo</strong> to preview with synthetic data.</>
        }
      </p>
    </div>
  );
}

function HeatLegend({ heatType }: { heatType: HeatType }) {
  return (
    <div style={{
      position: "sticky", bottom: 16, left: 16, float: "left",
      background: "rgba(26,29,46,.88)", borderRadius: 9, padding: "7px 14px",
      color: "#fff", fontSize: ".71rem", fontWeight: 500,
      display: "inline-flex", alignItems: "center", gap: 9,
      backdropFilter: "blur(6px)",
    }}>
      {heatType !== "clicks" && (
        <>
          <span style={{ color: "#9ba3b8" }}>Low</span>
          <div style={{ width: 60, height: 8, borderRadius: 4, background: "linear-gradient(to right,#5000c8,#783cff,#00b4ff,#00ffc8,#c8ffff)" }} />
          <span style={{ color: "#9ba3b8" }}>High</span>
          <span style={{ color: "#a29bfe" }}>movement</span>
        </>
      )}
      {heatType === "both" && <span style={{ color: "#555" }}>|</span>}
      {heatType !== "moves" && (
        <>
          <span style={{ color: "#9ba3b8" }}>Low</span>
          <div style={{ width: 60, height: 8, borderRadius: 4, background: "linear-gradient(to right,#0000ff,#00ffff,#00ff00,#ffff00,#ff0000)" }} />
          <span style={{ color: "#9ba3b8" }}>High</span>
          <span style={{ color: "#fd79a8" }}>clicks</span>
        </>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 13, height: 13,
      border: "2px solid rgba(255,255,255,.35)", borderTopColor: "#fff",
      borderRadius: "50%", animation: "hm-spin .5s linear infinite",
    }} />
  );
}

function GhostBtn({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return <button onClick={onClick} style={ghostBtnBase}>{children}</button>;
}

function CfgLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: ".75rem", fontWeight: 700, color: "#5a6178", whiteSpace: "nowrap" }}>{children}</span>;
}

function CfgInput({
  value, onChange, width, placeholder,
}: { value: string; onChange: (v: string) => void; width: number; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        border: "1px solid #dde1ed", borderRadius: 7, padding: "5px 10px",
        fontSize: ".8rem", color: "#1a1d2e", background: "#fff", outline: "none",
        fontFamily: "inherit", width,
        transition: "border-color .15s",
      }}
      onFocus={(e) => (e.target.style.borderColor = "#a29bfe")}
      onBlur={(e) => (e.target.style.borderColor = "#dde1ed")}
    />
  );
}

function Sep() {
  return <div style={{ height: 26, width: 1, background: "#dde1ed", flexShrink: 0 }} />;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{
      background: active ? "#f0eeff" : "#eef0f5",
      border: `1px solid ${active ? "#a29bfe" : "#dde1ed"}`,
      color: active ? "#6c5ce7" : "#5a6178",
      borderRadius: 6, padding: "4px 10px", fontSize: ".71rem",
      fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    }}>
      {children}
    </button>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const topbarStyle: CSSProperties = {
  background: "#1a1d2e", display: "flex", alignItems: "center",
  height: 48, padding: "0 20px", gap: 12,
  borderBottom: "1px solid #2a2d3a", flexShrink: 0, zIndex: 100,
};
const logoStyle: CSSProperties = {
  fontWeight: 700, color: "#fff", fontSize: ".95rem",
  display: "flex", alignItems: "center", gap: 8,
  borderRight: "1px solid #2a2d3a", paddingRight: 16, marginRight: 4, height: "100%",
};
const logoIconStyle: CSSProperties = {
  background: "#6c5ce7", width: 22, height: 22, borderRadius: 6,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: ".75rem", fontWeight: 800, color: "#fff",
};
const configBarStyle: CSSProperties = {
  background: "#fff", borderBottom: "1px solid #dde1ed",
  padding: "10px 20px", display: "flex", alignItems: "center",
  gap: 10, flexShrink: 0, flexWrap: "wrap",
  boxShadow: "0 1px 4px rgba(0,0,0,.06)",
};
const selectStyle: CSSProperties = {
  border: "1px solid #dde1ed", borderRadius: 7, padding: "5px 10px",
  fontSize: ".8rem", fontFamily: "inherit", color: "#1a1d2e",
  background: "#fff", cursor: "pointer", minWidth: 180,
};
const primaryBtnStyle = (disabled: boolean): CSSProperties => ({
  background: "#6c5ce7", color: "#fff", border: "none", borderRadius: 8,
  padding: "7px 16px", fontWeight: 700, fontSize: ".78rem",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.65 : 1, fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", gap: 6,
  boxShadow: "0 3px 12px rgba(108,92,231,.25)",
});
const ghostBtnBase: CSSProperties = {
  background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)",
  color: "#9ba3b8", borderRadius: 7, padding: "5px 12px",
  fontSize: ".72rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const sidebarStyle: CSSProperties = {
  width: 300, flexShrink: 0, background: "#fff",
  borderLeft: "1px solid #dde1ed",
  display: "flex", flexDirection: "column", overflow: "hidden",
};
const pageBadgeStyle: CSSProperties = {
  top: 12, left: 16,
  background: "rgba(26,29,46,.88)", borderRadius: 8,
  padding: "6px 12px", color: "#fff", fontSize: ".72rem", fontWeight: 500,
  display: "inline-flex", alignItems: "center", gap: 8,
  backdropFilter: "blur(6px)", maxWidth: "calc(100% - 32px)",
  zIndex: 10, margin: "12px 0 0 16px",
};
const eyebrowStyle: CSSProperties = {
  fontSize: ".68rem", fontWeight: 700, color: "#9ba3b8",
  textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 7,
};
