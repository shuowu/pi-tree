import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from "d3-force";
import "./KnowledgeGraphModal.css";

/* ---- local types ---- */

interface Concept {
  term: string;
  description: string;
  chapter: string;
}
interface Relation {
  from: string;
  to: string;
  relation: string;
}
interface CrossRef {
  sourceId: string;
  title: string;
}
interface ConceptsData {
  concepts: Concept[];
  relations: Relation[];
  crossRefs: Record<string, CrossRef[]>;
}

export interface KnowledgeGraphModalProps {
  data: ConceptsData;
  onClose: () => void;
}

/* ---- helpers ---- */

const PALETTE = [
  "#9e6b3a", "#6b8f5e", "#8c5a6e", "#6e6e9e",
  "#b58234", "#4e8a8f", "#a85c48", "#5f8a4a",
  "#8a6e94", "#7a8c42",
];

function chapterColor(chapter: string): string {
  let h = 0;
  for (let i = 0; i < chapter.length; i++) h = (h * 31 + chapter.charCodeAt(i)) | 0;
  return PALETTE[((h % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

function edgeStyle(relation: string): { dash: string; marker: boolean } {
  switch (relation) {
    case "prerequisite":
    case "requires":
    case "prerequisite_for":
    case "causes":
      return { dash: "", marker: true };
    case "related_to":
    case "contradicts":
      return { dash: "6 4", marker: false };
    case "extends":
    case "part_of":
    case "uses":
      return { dash: "2 4", marker: false };
    default:
      return { dash: "6 4", marker: false };
  }
}

interface SimNode {
  id: string;
  concept: Concept;
  radius: number;
  color: string;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
  relation: string;
}

/* ---- Component ---- */

export function KnowledgeGraphModal({ data, onClose }: KnowledgeGraphModalProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);
  const rafRef = useRef(0);

  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [, tick] = useState(0); // force re-render on sim tick

  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Drag state
  const dragRef = useRef<{ node: SimNode; startX: number; startY: number } | null>(null);
  // Pan state
  const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);

  /* ---- ESC key ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  /* ---- track SVG size ---- */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSvgSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    setSvgSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ---- build simulation ---- */
  useEffect(() => {
    const degreeMap = new Map<string, number>();
    for (const r of data.relations) {
      degreeMap.set(r.from, (degreeMap.get(r.from) ?? 0) + 1);
      degreeMap.set(r.to, (degreeMap.get(r.to) ?? 0) + 1);
    }
    const maxDeg = Math.max(1, ...degreeMap.values());

    const simNodes: SimNode[] = data.concepts.map((c, i) => {
      const deg = degreeMap.get(c.term) ?? 0;
      const radius = 8 + (deg / maxDeg) * 16;
      const angle = (2 * Math.PI * i) / data.concepts.length;
      return {
        id: c.term,
        concept: c,
        radius,
        color: chapterColor(c.chapter),
        x: Math.cos(angle) * 150,
        y: Math.sin(angle) * 150,
      };
    });

    const nodeSet = new Set(simNodes.map((n) => n.id));
    const simLinks: SimLink[] = data.relations
      .filter((r) => nodeSet.has(r.from) && nodeSet.has(r.to))
      .map((r) => ({ source: r.from, target: r.to, relation: r.relation }));

    setNodes(simNodes);
    setLinks(simLinks);

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(100)
      )
      .force("charge", forceManyBody().strength(-200))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<SimNode>().radius((d) => d.radius + 6))
      .alpha(1)
      .alphaDecay(0.02);

    sim.on("tick", () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => tick((t) => t + 1));
    });

    simRef.current = sim;
    return () => { sim.stop(); cancelAnimationFrame(rafRef.current); };
  }, [data]);

  /* ---- zoom ---- */
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setTransform((t) => {
      const newK = Math.min(5, Math.max(0.15, t.k * factor));
      const rect = svgRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      return {
        k: newK,
        x: mx - (mx - t.x) * (newK / t.k),
        y: my - (my - t.y) * (newK / t.k),
      };
    });
  }, []);

  /* ---- pan ---- */
  const onBgDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".kg-node")) return;
      panRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y };
    },
    [transform]
  );

  /* ---- node drag ---- */
  const onNodeDown = useCallback((e: React.MouseEvent, node: SimNode) => {
    e.stopPropagation();
    dragRef.current = { node, startX: e.clientX, startY: e.clientY };
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  /* ---- shared mouse move / up ---- */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const { node } = dragRef.current;
        const dx = (e.clientX - dragRef.current.startX) / transform.k;
        const dy = (e.clientY - dragRef.current.startY) / transform.k;
        node.fx = node.x + dx;
        node.fy = node.y + dy;
        dragRef.current.startX = e.clientX;
        dragRef.current.startY = e.clientY;
        node.x = node.fx;
        node.y = node.fy;
        simRef.current?.alpha(0.3).restart();
      } else if (panRef.current) {
        const dx = e.clientX - panRef.current.startX;
        const dy = e.clientY - panRef.current.startY;
        setTransform((t) => ({ ...t, x: panRef.current!.tx + dx, y: panRef.current!.ty + dy }));
      }
    };
    const onUp = () => {
      if (dragRef.current) {
        // keep node pinned where dropped
        dragRef.current = null;
      }
      panRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [transform.k]);

  /* ---- highlight helpers ---- */
  const neighbors = useCallback(
    (nodeId: string): Set<string> => {
      const s = new Set<string>([nodeId]);
      for (const l of links) {
        const sid = typeof l.source === "string" ? l.source : l.source.id;
        const tid = typeof l.target === "string" ? l.target : l.target.id;
        if (sid === nodeId) s.add(tid);
        if (tid === nodeId) s.add(sid);
      }
      return s;
    },
    [links]
  );

  const isHighlighted = useCallback(
    (id: string) => !selectedNode || neighbors(selectedNode).has(id),
    [selectedNode, neighbors]
  );

  const isLinkHighlighted = useCallback(
    (l: SimLink) => {
      if (!selectedNode) return true;
      const sid = typeof l.source === "string" ? l.source : l.source.id;
      const tid = typeof l.target === "string" ? l.target : l.target.id;
      return sid === selectedNode || tid === selectedNode;
    },
    [selectedNode]
  );

  /* ---- hover ---- */
  const onNodeHover = useCallback(
    (e: React.MouseEvent, node: SimNode | null) => {
      setHoveredNode(node);
      if (node) {
        const rect = svgRef.current!.getBoundingClientRect();
        setTooltipPos({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 10 });
      }
    },
    []
  );

  /* ---- render ---- */
  return createPortal(
    <div className="kg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="kg-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="kg-header">
          <span className="kg-title">Knowledge Graph</span>
          <span className="kg-count">{data.concepts.length} concepts · {data.relations.length} relations</span>
          <button className="kg-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Canvas */}
        <div className="kg-canvas-wrap">
          <svg
            ref={svgRef}
            className="kg-svg"
            onWheel={onWheel}
            onMouseDown={onBgDown}
            onClick={() => setSelectedNode(null)}
          >
            <defs>
              <marker id="kg-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 Z" fill="var(--text-muted)" />
              </marker>
            </defs>
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`} style={{ transformOrigin: "center" }}>
              {/* Center offset group */}
              <g transform={`translate(${svgSize.w / 2 / transform.k},${svgSize.h / 2 / transform.k})`}>
                {/* Edges */}
                {links.map((l, i) => {
                  const src = typeof l.source === "string" ? nodes.find((n) => n.id === l.source) : l.source;
                  const tgt = typeof l.target === "string" ? nodes.find((n) => n.id === l.target) : l.target;
                  if (!src || !tgt) return null;
                  const style = edgeStyle(l.relation);
                  return (
                    <line
                      key={i}
                      className={`kg-edge${isLinkHighlighted(l) ? "" : " kg-dim"}`}
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke="var(--text-muted)"
                      strokeWidth={1.2}
                      strokeDasharray={style.dash || undefined}
                      markerEnd={style.marker ? "url(#kg-arrow)" : undefined}
                    />
                  );
                })}

                {/* Nodes */}
                {nodes.map((node) => (
                  <g
                    key={node.id}
                    className={`kg-node${isHighlighted(node.id) ? "" : " kg-dim"}`}
                    onMouseDown={(e) => onNodeDown(e, node)}
                    onMouseEnter={(e) => onNodeHover(e, node)}
                    onMouseLeave={(e) => onNodeHover(e, null)}
                    onClick={(e) => { e.stopPropagation(); setSelectedNode((s) => (s === node.id ? null : node.id)); }}
                  >
                    <circle cx={node.x} cy={node.y} r={node.radius} fill={node.color} opacity={0.85} />
                    <text
                      className="kg-label"
                      x={node.x}
                      y={node.y - node.radius - 4}
                      textAnchor="middle"
                    >
                      {node.concept.term.length > 20 ? node.concept.term.slice(0, 18) + "…" : node.concept.term}
                    </text>
                  </g>
                ))}
              </g>
            </g>
          </svg>

          {/* Tooltip */}
          {hoveredNode && (
            <div className="kg-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
              <div className="kg-tooltip-term">{hoveredNode.concept.term}</div>
              <div className="kg-tooltip-desc">{hoveredNode.concept.description}</div>
              {hoveredNode.concept.chapter && (
                <div className="kg-tooltip-chapter">📖 {hoveredNode.concept.chapter}</div>
              )}
            </div>
          )}

          {/* Legend */}
          <div className="kg-legend">
            <div className="kg-legend-item">
              <span className="kg-legend-line kg-legend-line--solid" />
              prerequisite / requires
            </div>
            <div className="kg-legend-item">
              <span className="kg-legend-line kg-legend-line--dashed" />
              related / contradicts
            </div>
            <div className="kg-legend-item">
              <span className="kg-legend-line kg-legend-line--dotted" />
              extends / part of / uses
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
