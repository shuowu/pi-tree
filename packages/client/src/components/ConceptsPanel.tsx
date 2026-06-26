import { useState, useEffect, useCallback } from "react";
import { Lightbulb, ChevronDown, ChevronRight, BookOpen, Network } from "lucide-react";
import { KnowledgeGraphModal } from "./KnowledgeGraphModal";
import "./ConceptsPanel.css";

const API = import.meta.env.VITE_API_URL || "/api";

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

export function ConceptsPanel({ sourceId, onNavigateChapter }: { sourceId: string; onNavigateChapter?: (title: string) => void }) {
  const [data, setData] = useState<ConceptsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showGraph, setShowGraph] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/library/sources/${sourceId}/concepts`);
      if (!res.ok) return;
      setData(await res.json());
    } catch (err) {
      console.error("Failed to load concepts:", err);
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="concepts-empty">Loading…</div>;
  }

  if (!data || data.concepts.length === 0) {
    return (
      <div className="concepts-empty">
        <Lightbulb size={28} strokeWidth={1.5} />
        <p>No concepts extracted yet</p>
        <span className="concepts-empty-hint">
          Concepts are extracted automatically when a source is processed.
        </span>
      </div>
    );
  }

  const toggle = (term: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  };

  // Get relations involving a concept
  const getRelations = (term: string): Relation[] => {
    return data.relations.filter((r) => r.from === term || r.to === term);
  };

  // Render a relation as JSX with a clickable link to the target concept
  const renderRelation = (rel: Relation, term: string, idx: number) => {
    const labels: Record<string, [string, string]> = {
      part_of: ["part of", "includes"],
      extends: ["extends", "extended by"],
      uses: ["uses", "used by"],
      prerequisite_for: ["prerequisite for", "requires"],
      causes: ["causes", "caused by"],
      contradicts: ["contradicts", "contradicts"],
    };
    const [forward, reverse] = labels[rel.relation] ?? [rel.relation, rel.relation];
    const isForward = rel.from === term;
    const label = isForward ? forward : reverse;
    const target = isForward ? rel.to : rel.from;

    const scrollToTerm = (t: string) => {
      // Expand the target concept and scroll to it
      setExpanded((prev) => new Set(prev).add(t));
      // Use a small delay to let the DOM update if needed
      setTimeout(() => {
        const el = document.getElementById(`concept-${t}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.classList.add("concept-card-highlight");
        setTimeout(() => el?.classList.remove("concept-card-highlight"), 1200);
      }, 50);
    };

    return (
      <span key={idx} className="concept-relation">
        {label}{" "}
        <button className="concept-relation-link" onClick={() => scrollToTerm(target)}>
          {target}
        </button>
      </span>
    );
  };


  return (
    <div className="concepts-panel">
      <div className="concepts-header">
        <span className="concepts-count">{data.concepts.length} concepts</span>
        <button className="concepts-graph-btn" onClick={() => setShowGraph(true)} title="View knowledge graph">
          <Network size={14} /> Graph
        </button>
      </div>
      <div className="concepts-list">
        {data.concepts.map((concept) => {
          const isExpanded = expanded.has(concept.term);
          const relations = getRelations(concept.term);
          const crossRefs = data.crossRefs[concept.term];
          const hasDetails = relations.length > 0 || crossRefs?.length > 0 || !!concept.chapter;

          return (
            <div key={concept.term} id={`concept-${concept.term}`} className="concept-card">
              <button
                className="concept-card-main"
                onClick={() => toggle(concept.term)}
              >
                <div className="concept-card-left">
                  {hasDetails ? (
                    isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                  ) : (
                    <span className="concept-card-dot" />
                  )}
                </div>
                <div className="concept-card-content">
                  <div className="concept-card-top">
                    <span className="concept-term">{concept.term}</span>
                    {crossRefs?.length > 0 && (
                      <span className="concept-cross-badge" title={`Also in ${crossRefs.length} other source${crossRefs.length > 1 ? "s" : ""}`}>
                        📚 {crossRefs.length}
                      </span>
                    )}
                  </div>
                  <span className="concept-desc">{concept.description}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="concept-details">
                  {concept.chapter && (
                    <button
                      className="concept-chapter"
                      onClick={() => onNavigateChapter?.(concept.chapter)}
                      title="Navigate to this chapter"
                    >
                      <BookOpen size={12} />
                      <span>{concept.chapter}</span>
                    </button>
                  )}

                  {relations.length > 0 && (
                    <div className="concept-relations">
                      {relations.map((rel, i) => renderRelation(rel, concept.term, i))}
                    </div>
                  )}

                  {crossRefs?.length > 0 && (
                    <div className="concept-cross-refs">
                      <span className="concept-cross-label">Also in:</span>
                      {crossRefs.map((ref) => (
                        <a
                          key={ref.sourceId}
                          className="concept-cross-link"
                          href={`/source/${ref.sourceId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            window.location.href = `/source/${ref.sourceId}`;
                          }}
                        >
                          {ref.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showGraph && data && (
        <KnowledgeGraphModal data={data} onClose={() => setShowGraph(false)} />
      )}
    </div>
  );
}
