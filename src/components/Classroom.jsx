import { Fragment, memo, useState, useEffect, useRef } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import './Classroom.css'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const HillionSpeechRecognition = registerPlugin('HillionSpeechRecognition')


function playMicToggleSound(isStarting) {
  // A short, quiet confirmation tone only on a successful mic state change.
  // It never runs from recognition result/audio callbacks.
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(isStarting ? 740 : 520, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(isStarting ? 980 : 390, context.currentTime + 0.055);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.075);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    oscillator.onended = () => context.close().catch(() => {});
  } catch {
    // Audio feedback is optional; mic functionality must not depend on it.
  }
}

function AvatarIcon({ speaking = false, mouthShape = 'closed' }) {
  return (
    <svg viewBox="0 0 60 60" aria-hidden="true">
      <circle cx="30" cy="30" r="29" fill="#DDF2D9" />
      <path d="M10 60 Q12 43 30 43 Q48 43 50 60" fill="#26965B" />
      <path d="M18 25 Q15 7 31 7 Q47 7 44 27 L42 40 L18 40Z" fill="#211B18" />
      <ellipse cx="30" cy="29" rx="13" ry="16" fill="#9B5D3F" />
      <path d="M17 24 Q17 8 31 8 Q44 8 44 24 L39 18 Q29 23 18 19Z" fill="#211B18" />
      <ellipse cx="25.2" cy="29" rx="2.6" ry="2.1" fill="#FFF9F1" />
      <ellipse cx="35.8" cy="29" rx="2.6" ry="2.1" fill="#FFF9F1" />
      <circle className={`avatar-pupil ${speaking ? 'avatar-pupil-speaking' : ''}`} cx="25.8" cy="29.1" r="1.35" fill="#241A16" />
      <circle className={`avatar-pupil ${speaking ? 'avatar-pupil-speaking' : ''}`} cx="36.4" cy="29.1" r="1.35" fill="#241A16" />
      <ellipse className={`avatar-mouth avatar-mouth-${mouthShape} ${speaking ? 'avatar-mouth-speaking' : ''}`}
        cx="30" cy="37" rx="4" ry="1.2" fill="#542D24" />
      <path d="M24 44 L30 51 L36 44" fill="#F5F5F0" />
    </svg>
  )
}

function SpeechIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <path d="M3 5 Q3 3 6 3 H18 Q21 3 21 6 V14 Q21 17 18 17 H10 L5 21 V17 Q3 16 3 13Z"
        fill="white" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 19 H20 L24 22 V10 Q24 8 22 8 H21"
        fill="white" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function VolumeIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <path d="M3 11 H8 L15 5 V23 L8 17 H3Z" fill="currentColor" />
      <path d="M19 10 Q24 14 19 18 M21 6 Q29 14 21 22"
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2" y="6" width="24" height="16" rx="3"
        fill="none" stroke="currentColor" strokeWidth="1.7" />
      {[6, 11, 16, 21].map(x =>
        [11, 15].map(y =>
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor" />
        )
      )}
      <path d="M9 19 H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="11" y="3" width="10" height="17" rx="5" fill="white" />
      <path d="M7 15 Q7 25 16 25 Q25 25 25 15"
        fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M16 25 V29 M11 29 H21"
        fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}


function renderMath(expression, displayMode = false) {
  try {
    return (
      <span
        className={displayMode ? "lesson-display-math" : "lesson-inline-math"}
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(expression.trim(), {
            throwOnError: false,
            displayMode,
            output: "htmlAndMathml",
            strict: "ignore"
          })
        }}
      />
    );
  } catch {
    return <code>{expression}</code>;
  }
}

function renderInlineText(text) {
  const pattern = /(\\$\\$[\\s\\S]+?\\$\\$|\\$[^$\\n]+\\$|\\\\\\([\\s\\S]+?\\\\\\)|\\\\\\[[\\s\\S]+?\\\\\\]|\\*\\*.*?\\*\\*|==.*?==|`.*?`|\\*[^*\\n]+\\*)/g;

  return String(text).split(pattern).map((part, index) => {
    if (part.startsWith("$$") && part.endsWith("$$")) {
      return <span key={index}>{renderMath(part.slice(2, -2), true)}</span>;
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      return <span key={index}>{renderMath(part.slice(1, -1))}</span>;
    }
    if (part.startsWith("\\(") && part.endsWith("\\)")) {
      return <span key={index}>{renderMath(part.slice(2, -2))}</span>;
    }
    if (part.startsWith("\\[") && part.endsWith("\\]")) {
      return <span key={index}>{renderMath(part.slice(2, -2), true)}</span>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("==") && part.endsWith("==")) {
      return <mark key={index}>{part.slice(2, -2)}</mark>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

const LessonContentRenderer = memo(function LessonContentRenderer({ content, sectionHeading = "", isStreaming = false }) {
  const richContentRef = useRef(null);
  const penRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!isStreaming) return;
    const root = richContentRef.current;
    const pen = penRef.current;
    if (!root || !pen) return;

    const placePen = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let lastVisibleRect = null;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const value = node.nodeValue || '';
        // Ignore whitespace-only tails, hidden accessibility copies and
        // non-rendered math annotations so the tip stays on the last inked glyph.
        if (!value.trim()) continue;
        const parent = node.parentElement;
        if (parent?.closest('[aria-hidden="true"], script, style, .katex-mathml, .visually-hidden')) continue;
        let offset = value.length - 1;
        while (offset >= 0 && /\\s/.test(value[offset])) offset--;
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rects = range.getClientRects();
        const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) lastVisibleRect = rect;
      }
      if (!lastVisibleRect) {
        pen.style.opacity = '0';
        return;
      }
      const rect = lastVisibleRect;
      const rootRect = root.getBoundingClientRect();
      // Position the pen tip at the actual final rendered glyph, including
      // wrapped lines, lists, inline emphasis and KaTeX output.
      pen.style.left = `${rect.right - rootRect.left + root.scrollLeft - 3}px`;
      pen.style.top = `${rect.bottom - rootRect.top + root.scrollTop - 15}px`;
      pen.style.opacity = '1';
    };

    const schedule = () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(placePen);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const board = root.closest('.classroom-board');
    board?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      board?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [content, sectionHeading, isStreaming]);

  function cleanStreamingText(value) {
    if (!isStreaming) return value;
    return value.split("\n").map(line => {
      for (const marker of ["**", "==", "`", "$"]) {
        const count = line.split(marker).length - 1;
        if (count % 2 !== 0) {
          line = line.slice(0, line.lastIndexOf(marker));
        }
      }
      return line;
    }).join("\n");
  }
  let source = cleanStreamingText(String(content || "").replace(/\r/g, ""));
  const expectedHeading = String(sectionHeading || "").trim().toLowerCase();
  const firstLine = source.split("\n", 1)[0].trim();
  const cleanFirstLine = firstLine.replace(/^#{1,6}\s*/, "").replace(/\s+#+\s*$/, "").trim().toLowerCase();

  if (expectedHeading && cleanFirstLine === expectedHeading) {
    const newline = source.indexOf("\n");
    source = newline === -1 ? "" : source.slice(newline + 1);
  }

  const lines = source.split("\n");
  const blocks = [];
  let index = 0;

  // Models sometimes omit TeX delimiters even when they correctly output an
  // equation. Typeset short, equation-shaped standalone lines as display math
  // while leaving ordinary prose and chemical formula text untouched.
  const getStandaloneMath = (value) => {
    let candidate = value.trim();
    candidate = candidate.replace(/^(?:formula|equation|working|substitution|final answer)\\s*:\\s*/i, "");
    if (!candidate || candidate.length > 110 || !candidate.includes("=")) return null;
    if (/\\b(?:the|and|with|from|because|therefore|where|when|this|that|is|are)\\b/i.test(candidate)) return null;
    const hasMathSyntax = /[+*/×÷^_=<>\\\\]|\\\\(?:frac|sqrt|times|cdot|pi|sum|sqrt|left|right)|[₀-₉⁰-⁹]/.test(candidate);
    const wordCount = (candidate.match(/[A-Za-z]+/g) || []).length;
    if (!hasMathSyntax || wordCount > 9) return null;
    return candidate;
  };

  const isBlockStart = (value) => {
    const line = value.trim();
    return (
      /^(#{1,6})\s+/.test(line) ||
      /^[-*+•]\s+/.test(line) ||
      /^\d+[.)]\s+/.test(line) ||
      line.startsWith("|") ||
      line.startsWith("$$") ||
      line.startsWith("\\[")
    );
  };

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index++;
      continue;
    }

    const unwrappedEquation = getStandaloneMath(line);
    if (unwrappedEquation) {
      blocks.push(
        <div className="lesson-display-math-wrapper" key={"auto-math-" + index}>
          {renderMath(unwrappedEquation, true)}
        </div>
      );
      index++;
      continue;
    }

    if (line.startsWith("$") || line.startsWith("\\[")) {
      const closing = line.startsWith("$$") ? "$$" : "\\]";
      let expression = line.slice(2);
      const closingPosition = expression.indexOf(closing);

      if (closingPosition !== -1) {
        expression = expression.slice(0, closingPosition);
        index++;
      } else {
        index++;
        while (index < lines.length) {
          const current = lines[index].trim();
          const position = current.indexOf(closing);

          if (position !== -1) {
            expression += "\n" + current.slice(0, position);
            index++;
            break;
          }

          expression += "\n" + lines[index];
          index++;
        }
      }

      blocks.push(
        <div className="lesson-display-math-wrapper" key={"math-" + index}>
          {renderMath(expression, true)}
        </div>
      );
      continue;
    }

    if (
      line.startsWith("|") &&
      index + 1 < lines.length &&
      /^\|?[\s:|-]+\|?$/.test(lines[index + 1].trim())
    ) {
      const tableRows = [line];
      index += 2;

      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableRows.push(lines[index].trim());
        index++;
      }

      const cells = tableRows.map(row =>
        row.split("|").slice(1, -1).map(cell => cell.trim())
      );

      blocks.push(
        <div className="lesson-table-wrapper" key={"table-" + index}>
          <table className="lesson-table">
            <thead>
              <tr>
                {(cells[0] || []).map((cell, cellIndex) =>
                  <th key={cellIndex}>{renderInlineText(cell)}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {cells.slice(1).map((row, rowIndex) =>
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) =>
                    <td key={cellIndex}>{renderInlineText(cell)}</td>
                  )}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);

    if (heading) {
      const Tag = heading[1].length === 1 ? "h3" : "h4";
      blocks.push(
        <Tag className="lesson-inline-heading" key={"heading-" + index}>
          {renderInlineText(heading[2])}
        </Tag>
      );
      index++;
      continue;
    }

    if (/^[-*+•]\s+/.test(line)) {
      const items = [];

      while (index < lines.length && /^\s*[-*+•]\s+/.test(lines[index])) {
        items.push(lines[index].trim().replace(/^[-*+•]\s+/, ""));
        index++;
      }

      blocks.push(
        <ul className="lesson-bullet-list" key={"list-" + index}>
          {items.map((item, itemIndex) =>
            <li key={itemIndex}>{renderInlineText(item)}</li>
          )}
        </ul>
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items = [];

      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        const match = lines[index].trim().match(/^(\d+)[.)]\s+(.+)$/);
        if (match) items.push({ number: Number(match[1]), text: match[2] });
        index++;
      }

      blocks.push(
        <ol
          className="lesson-numbered-list"
          start={items[0]?.number || 1}
          key={"numbered-" + index}
        >
          {items.map((item, itemIndex) =>
            <li value={item.number} key={itemIndex}>
              {renderInlineText(item.text)}
            </li>
          )}
        </ol>
      );
      continue;
    }

    const paragraph = [line];
    index++;

    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index++;
    }

    const text = paragraph.join(" ");
    const definition = /^(definition|key definition|meaning):/i.test(text);

    blocks.push(
      <p
        className={definition ? "lesson-definition-text" : "lesson-paragraph"}
        key={"paragraph-" + index}
      >
        {renderInlineText(text)}
      </p>
    );
  }

  return (
    <div className="lesson-rich-content" ref={richContentRef}>
      {blocks}
      {isStreaming && (
        <span ref={penRef} className="hillion-writing-pen" aria-label="Hillion writing position"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 23.5 21.8 6.7a3.2 3.2 0 0 1 4.5 0l.9.9a3.2 3.2 0 0 1 0 4.5L10.4 28.9 4 30z" fill="#F5D47A" stroke="#263B32" strokeWidth="1.7" strokeLinejoin="round"/><path d="m19.8 8.7 6.5 6.5M4 30l6.4-1.1-5.3-5.4z" fill="#fff" stroke="#263B32" strokeWidth="1.4"/><path d="m4 30 1.1-6.5 5.3 5.4z" fill="#263B32"/></svg></span>
      )}
    </div>
  );
});



function usePinchZoom(viewportRef, zoom, setZoom, minZoom = 0.75, maxZoom = 3) {
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const pinchStartRef = { current: null };
    const distance = (touches) => Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY
    );

    const onStart = (event) => {
      if (event.touches.length !== 2) return;
      pinchStartRef.current = {
        distance: Math.max(1, distance(event.touches)),
        zoom: zoomRef.current
      };
    };

    const onMove = (event) => {
      if (event.touches.length !== 2 || !pinchStartRef.current) return;
      event.preventDefault();
      const next = pinchStartRef.current.zoom * distance(event.touches) / pinchStartRef.current.distance;
      setZoom(Math.min(maxZoom, Math.max(minZoom, Number(next.toFixed(2)))));
    };

    const onEnd = (event) => {
      if (event.touches.length < 2) pinchStartRef.current = null;
    };

    viewport.addEventListener('touchstart', onStart, { passive: true });
    viewport.addEventListener('touchmove', onMove, { passive: false });
    viewport.addEventListener('touchend', onEnd, { passive: true });
    viewport.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      viewport.removeEventListener('touchstart', onStart);
      viewport.removeEventListener('touchmove', onMove);
      viewport.removeEventListener('touchend', onEnd);
      viewport.removeEventListener('touchcancel', onEnd);
    };
  }, [viewportRef, setZoom, minZoom, maxZoom]);
}

const LessonDiagram = memo(function LessonDiagram({ diagram }) {
  const [diagramZoom, setDiagramZoom] = useState(1);
  const diagramViewportRef = useRef(null);
  usePinchZoom(diagramViewportRef, diagramZoom, setDiagramZoom, 0.75, 2.5);

  if (!diagram || !Array.isArray(diagram.nodes) || diagram.nodes.length === 0) {
    return null;
  }

  const nodes = diagram.nodes
    .filter(node => node && typeof node === 'object')
    .map((node, index) => ({
      ...node,
      id: node.id ?? 'node-' + index,
      x: Number.isFinite(Number(node.x)) ? Number(node.x) : 100,
      y: Number.isFinite(Number(node.y)) ? Number(node.y) : 100,
      label: String(node.label ?? ''),
      detail: String(node.detail ?? '')
    }));

  if (!nodes.length) return null;

  const connections = Array.isArray(diagram.connections)
    ? diagram.connections.filter(edge => edge && typeof edge === 'object')
    : [];

  const nodeMap = new Map(nodes.map(node => [node.id, node]));

  return (
    <section className="lesson-diagram" aria-label="Educational diagram">
      <div className="lesson-diagram-heading">
        <h2>{diagram.title || 'Educational diagram'}</h2>

        <div className="diagram-zoom-controls" aria-label="Diagram zoom controls">
          <button
            type="button"
            onClick={() => setDiagramZoom(value => Math.max(0.75, Number((value - 0.25).toFixed(2))))}
            disabled={diagramZoom <= 0.75}
            aria-label="Zoom diagram out"
          >−</button>

          <button
            type="button"
            onClick={() => setDiagramZoom(1)}
            aria-label="Reset diagram zoom"
          >{Math.round(diagramZoom * 100)}%</button>

          <button
            type="button"
            onClick={() => setDiagramZoom(value => Math.min(2.5, Number((value + 0.25).toFixed(2))))}
            disabled={diagramZoom >= 2.5}
            aria-label="Zoom diagram in"
          >+</button>
        </div>
      </div>

      {diagram.description && (
        <p className="lesson-diagram-description">{diagram.description}</p>
      )}

      <div className="lesson-diagram-viewport" ref={diagramViewportRef}>
        <svg
          className="lesson-diagram-svg"
          viewBox="0 0 1000 1500"
          role="img"
          aria-label={diagram.title || 'Labelled educational diagram'}
          style={{ width: (diagramZoom * 100) + '%', maxHeight: 'none' }}
        >
          <defs>
            <marker
              id="hillion-diagram-arrow"
              markerWidth="12"
              markerHeight="12"
              refX="9"
              refY="6"
              orient="auto"
            >
              <path d="M0,0 L12,6 L0,12 Z" fill="#36845c" />
            </marker>
          </defs>

          {connections.map((edge, index) => {
            const from = nodeMap.get(edge.from);
            const to = nodeMap.get(edge.to);
            if (!from || !to) return null;

            const x1 = from.x + 200;
            const y1 = from.y + 75;
            const x2 = to.x + 200;
            const y2 = to.y + 75;
            const middleX = (x1 + x2) / 2;
            const middleY = (y1 + y2) / 2;

            return (
              <g key={index}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#36845c"
                  strokeWidth="7"
                  markerEnd="url(#hillion-diagram-arrow)"
                />
                {edge.label && (
                  <text
                    x={middleX}
                    y={middleY - 14}
                    textAnchor="middle"
                    fontSize="27"
                    fill="#315f47"
                    fontWeight="600"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {nodes.map((node, index) => (
            <g key={node.id || index}>
              {node.shape === 'circle' ? (
                <ellipse
                  cx={node.x + 200}
                  cy={node.y + 75}
                  rx="195"
                  ry="70"
                  fill="#edf7ed"
                  stroke="#36845c"
                  strokeWidth="6"
                />
              ) : (
                <rect
                  x={node.x}
                  y={node.y}
                  width="400"
                  height="150"
                  rx="22"
                  fill="#edf7ed"
                  stroke="#36845c"
                  strokeWidth="6"
                />
              )}

              <text
                x={node.x + 200}
                y={node.y + 65}
                textAnchor="middle"
                fontSize="39"
                fontWeight="750"
                fill="#203d2c"
              >
                {node.label}
              </text>

              {node.detail && (
                <text
                  x={node.x + 200}
                  y={node.y + 108}
                  textAnchor="middle"
                  fontSize="27"
                  fill="#40594a"
                >
                  {node.detail.length > 34
                    ? node.detail.slice(0, 34) + '…'
                    : node.detail}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
});


const SectionSvgIllustration = memo(function SectionSvgIllustration({ visual }) {
  const [zoom, setZoom] = useState(1);
  const visualViewportRef = useRef(null);
  usePinchZoom(visualViewportRef, zoom, setZoom, 0.75, 3);

  if (!visual || !Array.isArray(visual.elements) ||
      visual.elements.length === 0) return null;

  const allowedShapes = new Set([
    'path', 'circle', 'ellipse', 'rect',
    'line', 'polyline', 'polygon', 'text'
  ]);

  const viewBoxPattern = /^\s*[\d.-]+\s+[\d.-]+\s+[\d.]+\s+[\d.]+\s*$/;
  const viewBox = viewBoxPattern.test(String(visual.viewBox || ''))
    ? visual.viewBox
    : '0 0 1000 1000';

  const numberValue = (value, fallback = undefined) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  return (
    <section className={`lesson-visual-illustration lesson-visual-style-${visual.renderStyle || "flat"}`}>
      <div className="lesson-diagram-heading">
        <h2>{visual.title || 'Educational illustration'}</h2>
        <div className="diagram-zoom-controls">
          <button type="button"
            onClick={() => setZoom(v => Math.max(0.75, Number((v - 0.25).toFixed(2))))}
            disabled={zoom <= 0.75}
            aria-label="Zoom illustration out">−</button>
          <button type="button" onClick={() => setZoom(1)}
            aria-label="Reset illustration zoom">{Math.round(zoom * 100)}%</button>
          <button type="button"
            onClick={() => setZoom(v => Math.min(3, Number((v + 0.25).toFixed(2))))}
            disabled={zoom >= 3}
            aria-label="Zoom illustration in">+</button>
        </div>
      </div>

      {visual.description && (
        <p className="lesson-visual-description">{visual.description}</p>
      )}

      <div className="lesson-visual-viewport" ref={visualViewportRef}>
        <svg className="lesson-visual-svg" viewBox={viewBox}
          role="img"
          aria-label={visual.title || 'Educational illustration'}
          style={{ width: (zoom * 100) + '%' }}>
          {visual.elements.slice(0, 250).map((element, index) => {
            if (!element || typeof element !== 'object' ||
                !allowedShapes.has(element.type)) return null;

            const Shape = element.type;
            const common = {
              key: index,
              fill: element.fill || (Shape === 'text' ? '#263b32' : 'none'),
              stroke: element.stroke || 'none',
              strokeWidth: numberValue(element.strokeWidth, 2),
              opacity: numberValue(element.opacity, 1),
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            };

            if (Shape === 'path') {
              return <path {...common} key={index} d={String(element.d || '').slice(0, 5000)} />;
            }

            if (Shape === 'polyline' || Shape === 'polygon') {
              return <Shape {...common} key={index} points={String(element.points || '').slice(0, 5000)} />;
            }

            if (Shape === 'text') {
              return (
                <text {...common} key={index}
                  x={numberValue(element.x, 0)}
                  y={numberValue(element.y, 0)}
                  fontSize={numberValue(element.fontSize, 24)}
                  fontWeight={numberValue(element.fontWeight, 500)}
                  textAnchor={element.textAnchor || 'middle'}>
                  {String(element.text || '').slice(0, 250)}
                </text>
              );
            }

            const coordinates = {};
            for (const key of [
              'x', 'y', 'x1', 'y1', 'x2', 'y2',
              'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height'
            ]) {
              const value = numberValue(element[key]);
              if (value !== undefined) coordinates[key] = value;
            }

            return <Shape {...common} key={index} {...coordinates} />;
          })}
        </svg>
      </div>

      {(visual.caption || visual.title) && (
        <div className="lesson-visual-caption">
          {visual.caption || visual.title}
        </div>
      )}
    </section>
  );
});

function Classroom({ topic, title, subject, content, transcript = '', conversation = [], sections = [], clarifications = [], liveSectionHeading = '', liveSectionContent = '', diagram = null, loading, canResume = false, onResume, onInterrupt, onExit, onAskQuestion }) {
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false)
  const [isMicActive, setIsMicActive] = useState(false)
  const micActiveRef = useRef(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [avatarMouthShape, setAvatarMouthShape] = useState('closed')
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [questionDraft, setQuestionDraft] = useState('')
  const [isAskingQuestion, setIsAskingQuestion] = useState(false)
  const [questionError, setQuestionError] = useState('')
  const [selectedPassage, setSelectedPassage] = useState('')
  const recognitionRef = useRef(null)
  const [progressStage, setProgressStage] = useState(0)
  const recognitionDisposedRef = useRef(false)
  const speechRef = useRef(null)
  const speechQueueRef = useRef([])
  const speechIndexRef = useRef(0)
  const hillionVoiceRef = useRef(null)
  const autoNarrationPreviousRef = useRef(liveSectionContent)
  const autoNarrationBufferRef = useRef('')
  const [zoom, setZoom] = useState(1)
  const [activeToolbarPanel, setActiveToolbarPanel] = useState(null)
  const [viewMode, setViewMode] = useState('1x')
  const [voicePreference, setVoicePreference] = useState(() => localStorage.getItem('hillion_voice_preference') || 'neutral')
  const [isExpanded, setIsExpanded] = useState(false)
  const [isFollowingLive, setIsFollowingLive] = useState(true)
  const [showReturnToLive, setShowReturnToLive] = useState(false)
  const boardRef = useRef(null)
  const avatarControlRef = useRef(null)
  const pinchRef = useRef(null)
  const zoomRef = useRef(zoom)
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  useEffect(() => {
    const updateAvatarGaze = (event) => {
      const avatar = avatarControlRef.current
      if (!avatar) return
      const bounds = avatar.getBoundingClientRect()
      const centerX = bounds.left + bounds.width / 2
      const centerY = bounds.top + bounds.height / 2
      const x = Math.max(-1.25, Math.min(1.25, (event.clientX - centerX) / Math.max(1, window.innerWidth / 2) * 1.8))
      const y = Math.max(-0.8, Math.min(0.8, (event.clientY - centerY) / Math.max(1, window.innerHeight / 2) * 1.2))
      avatar.style.setProperty('--avatar-gaze-x', `${x.toFixed(2)}px`)
      avatar.style.setProperty('--avatar-gaze-y', `${y.toFixed(2)}px`)
    }
    window.addEventListener('pointermove', updateAvatarGaze, { passive: true })
    return () => window.removeEventListener('pointermove', updateAvatarGaze)
  }, [])
  // Keep the microphone indicator, native/browser recognition callbacks and
  // confirmation tones in one state transition path. This prevents duplicate
  // tones when Android reports a final result after the user taps Stop.
  function setMicActive(nextActive) {
    const next = Boolean(nextActive)
    if (micActiveRef.current === next) return
    micActiveRef.current = next
    setIsMicActive(next)
  }

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined
    recognitionDisposedRef.current = false
    const handles = []

    HillionSpeechRecognition.addListener('speechResult', event => {
      if (event?.transcript) setQuestionDraft(event.transcript)
      if (event?.isFinal) setMicActive(false)
    }).then(handle => {
      if (recognitionDisposedRef.current) handle.remove()
      else handles.push(handle)
    }).catch(error => {
      if (!recognitionDisposedRef.current) {
        setQuestionError(`Android speech recognition could not start (${error?.message || 'unknown error'}). You can type your question instead.`)
      }
    })

    HillionSpeechRecognition.addListener('speechError', event => {
      setQuestionError(`Android speech recognition error (${event?.error ?? 'unknown'}). You can type your question instead.`)
      setMicActive(false)
    }).then(handle => {
      if (recognitionDisposedRef.current) handle.remove()
      else handles.push(handle)
    }).catch(error => {
      if (!recognitionDisposedRef.current) {
        setQuestionError(`Android speech recognition error listener failed (${error?.message || 'unknown error'}). You can type your question instead.`)
      }
    })

    return () => {
      recognitionDisposedRef.current = true
      handles.forEach(handle => handle.remove())
    }
  }, [])

  function speakNextChunk() {
    const queue = speechQueueRef.current
    const index = speechIndexRef.current
    if (!queue[index]) {
      speechRef.current = null
      setIsSpeaking(false)
      return
    }

    const utterance = new SpeechSynthesisUtterance(queue[index])
    const selectedVoice = hillionVoiceRef.current
    if (selectedVoice) {
      utterance.voice = selectedVoice
      utterance.lang = selectedVoice.lang
    } else {
      utterance.lang = 'en-US'
    }
    utterance.rate = 0.92
    utterance.pitch = 1
    utterance.onstart = () => {
      setIsSpeaking(true)
      setAvatarMouthShape('open')
    }
    // Android/browser engines expose word boundaries inconsistently, not true phoneme timing.
    utterance.onboundary = event => {
      if (event.name && event.name !== 'word') return
      const spokenWord = utterance.text.slice(event.charIndex || 0).split(/\s+/)[0] || ''
      const letters = spokenWord.toLowerCase().replace(/[^a-z]/g, '')
      const first = letters[0] || ''
      const vowelCount = (letters.match(/[aeiouy]/g) || []).length
      if (!letters || /^[bmpfvw]/.test(first)) setAvatarMouthShape('closed')
      else if (/^[ouw]/.test(first)) setAvatarMouthShape('round')
      else if (/^[eiy]/.test(first)) setAvatarMouthShape('wide')
      else setAvatarMouthShape(vowelCount ? 'open' : 'closed')
    }
    utterance.onend = () => {
      setAvatarMouthShape('closed')
      speechIndexRef.current += 1
      if (speechIndexRef.current < speechQueueRef.current.length) {
        speakNextChunk()
      } else {
        speechRef.current = null
        speechQueueRef.current = []
        speechIndexRef.current = 0
        setIsSpeaking(false)
      }
    }
    utterance.onerror = (event) => {
      // Android may report a cancelled utterance while replacing the queue.
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        console.warn('Hillion narration stopped:', event.error)
      }
      speechRef.current = null
      speechQueueRef.current = []
      speechIndexRef.current = 0
      setIsSpeaking(false)
      setAvatarMouthShape('closed')
    }
    speechRef.current = utterance
    window.speechSynthesis.speak(utterance)
  }


  useEffect(() => {
    if (!('speechSynthesis' in window) ||
        typeof window.SpeechSynthesisUtterance === 'undefined') return;

    // Discover installed English voices and prefer a downloaded US English voice.
    const speechEngine = window.speechSynthesis;

    const selectHillionVoice = () => {
      const voices = speechEngine.getVoices() || [];
      const preferences = ['en-us', 'en-ng', 'en-gb', 'en-in', 'en-au'];

      const englishVoices = voices.filter(voice =>
        /^en(-|$)/i.test(voice.lang || '')
      );

      const localeMatches = preferences.flatMap(locale =>
        englishVoices.filter(voice => (voice.lang || '').toLowerCase() === locale)
      );
      const available = localeMatches.length ? localeMatches : englishVoices;
      const nameMatches = voice => {
        const name = String(voice.name || '').toLowerCase();
        if (voicePreference === 'female') return /female|woman|zira|samantha|victoria|karen|moira|tessa|aria|jenny|susan/.test(name);
        if (voicePreference === 'male') return /male|man|david|daniel|alex|george|james|guy|ryan|thomas/.test(name);
        return false;
      };
      const selected = voicePreference === 'neutral'
        ? (available.find(voice => voice.default && voice.localService) ||
           available.find(voice => voice.default) ||
           available.find(voice => voice.localService) || available[0] || null)
        : (available.find(nameMatches) ||
           available.find(voice => voice.localService) || available[0] || null);

      hillionVoiceRef.current = selected;

      window.__HILLION_TTS_VOICES__ = voices.map(voice => ({
        name: voice.name,
        language: voice.lang,
        local: voice.localService,
        default: voice.default
      }));

      console.info('[HILLION VOICE] Available voices:', window.__HILLION_TTS_VOICES__);
      console.info('[HILLION VOICE] Selected:', selected?.name || 'System default');
    };

    selectHillionVoice();
    speechEngine.addEventListener?.('voiceschanged', selectHillionVoice);
    // The voice preference is a dependency of this effect. Remove the old
    // listener whenever it reruns so Android does not accumulate stale handlers.
    const removeVoiceListener = () =>
      speechEngine.removeEventListener?.('voiceschanged', selectHillionVoice);

    const previous = autoNarrationPreviousRef.current;
    const current = String(liveSectionContent || '');

    // A reset or restored draft is not treated as newly written text.
    if (!current.startsWith(previous)) {
      autoNarrationPreviousRef.current = current;
      removeVoiceListener();
      return;
    }

    const addedText = current.slice(previous.length);
    autoNarrationPreviousRef.current = current;

    if (addedText) {
      const cleanText = addedText
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\*\*|==|[*_`>]/g, '')
        .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
        .replace(/\$([^$]+)\$/g, '$1')
        .replace(/\\\[|\\\]|\\\(|\\\)/g, '')
        .replace(/\s+/g, ' ');

      autoNarrationBufferRef.current += cleanText;

      const buffer = autoNarrationBufferRef.current;
      const sentences = buffer.match(/[^.!?]+[.!?]+(?:["')\]]*)/g) || [];

      if (sentences.length) {
        speechQueueRef.current.push(...sentences.map(item => item.trim()).filter(Boolean));
        autoNarrationBufferRef.current = buffer.slice(
          sentences.join('').length
        );
      }

      // Prevent a very long paragraph from waiting indefinitely for punctuation.
      if (autoNarrationBufferRef.current.length > 260) {
        const pending = autoNarrationBufferRef.current;
        const splitAt = pending.lastIndexOf(' ', 220);
        if (splitAt > 80) {
          speechQueueRef.current.push(pending.slice(0, splitAt).trim());
          autoNarrationBufferRef.current = pending.slice(splitAt + 1);
        }
      }
    }

    // Speak any remaining text when the lesson finishes or pauses.
    if (!loading && autoNarrationBufferRef.current.trim()) {
      speechQueueRef.current.push(autoNarrationBufferRef.current.trim());
      autoNarrationBufferRef.current = '';
    }

    if (speechQueueRef.current.length && !speechRef.current) {
      speakNextChunk();
    }

    return removeVoiceListener;
  }, [liveSectionContent, loading, voicePreference]);

  const zoomIn = () => setZoom(value => Math.min(2, Number((value + 0.1).toFixed(1))))
  const zoomOut = () => setZoom(value => Math.max(0.5, Number((value - 0.1).toFixed(1))))
  const resetZoom = () => setZoom(1)

  function stopNarration() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    speechRef.current = null
    speechQueueRef.current = []
    speechIndexRef.current = 0
    setIsSpeaking(false)
  }


  function toggleNarration() {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') {
      setIsSpeaking(false)
      return
    }

    if (window.speechSynthesis.speaking || window.speechSynthesis.pending || speechRef.current) {
      stopNarration()
      return
    }

    const lessonText = [
      title || topic,
      ...sections.map(section => `${section.heading || ''}. ${section.content || ''}`),
      liveSectionHeading,
      liveSectionContent,
      content
    ].filter(Boolean).join('\n\n')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#*_`>]/g, ' ')
      .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
      .replace(/\$([^$]+)\$/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()

    if (!lessonText) return

    // Short utterances are more reliable on Android Chrome than one very long utterance.
    const sentences = lessonText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [lessonText]
    const chunks = []
    let chunk = ''
    for (const sentence of sentences) {
      const clean = sentence.trim()
      if (!clean) continue
      if ((chunk + ' ' + clean).trim().length > 1800 && chunk) {
        chunks.push(chunk.trim())
        chunk = clean
      } else {
        chunk = (chunk + ' ' + clean).trim()
      }
    }
    if (chunk) chunks.push(chunk)

    speechQueueRef.current = chunks
    speechIndexRef.current = 0
    speakNextChunk()
  }

  useEffect(() => () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      window.speechSynthesis.removeEventListener?.('voiceschanged', () => {})
    }
    speechQueueRef.current = []
    speechRef.current = null
  }, [])

  function returnToLiveLesson() {
    const board = boardRef.current;
    if (!board) return;

    setIsFollowingLive(true);
    setShowReturnToLive(false);

    requestAnimationFrame(() => {
      board.scrollTo({
        top: board.scrollHeight,
        behavior: 'smooth'
      });
    });
  }


  useEffect(() => {
    const board = boardRef.current
    if (!board) return

    const getDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      return Math.hypot(dx, dy)
    }

    const getMidpoint = (touches) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2
    })

    const handleTouchStart = (event) => {
      if (event.touches.length !== 2) return

      const midpoint = getMidpoint(event.touches)
      const rect = board.getBoundingClientRect()

      pinchRef.current = {
        distance: getDistance(event.touches),
        zoom: zoomRef.current,
        scrollLeft: board.scrollLeft,
        scrollTop: board.scrollTop,
        midpointX: midpoint.x - rect.left,
        midpointY: midpoint.y - rect.top
      }
    }

    const handleTouchMove = (event) => {
      if (event.touches.length !== 2 || !pinchRef.current) return

      event.preventDefault()

      const start = pinchRef.current
      const midpoint = getMidpoint(event.touches)
      const rect = board.getBoundingClientRect()
      const currentX = midpoint.x - rect.left
      const currentY = midpoint.y - rect.top

      const nextZoom = Math.min(
        2,
        Math.max(0.5, start.zoom * getDistance(event.touches) / start.distance)
      )

      const contentX = (start.scrollLeft + start.midpointX) / start.zoom
      const contentY = (start.scrollTop + start.midpointY) / start.zoom

      setZoom(Number(nextZoom.toFixed(2)))

      requestAnimationFrame(() => {
        board.scrollLeft = contentX * nextZoom - currentX
        board.scrollTop = contentY * nextZoom - currentY
      })
    }

    const handleTouchEnd = (event) => {
      if (event.touches.length < 2) {
        pinchRef.current = null
      }
    }

    board.addEventListener('touchstart', handleTouchStart, { passive: true })
    board.addEventListener('touchmove', handleTouchMove, { passive: false })
    board.addEventListener('touchend', handleTouchEnd, { passive: true })
    board.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      board.removeEventListener('touchstart', handleTouchStart)
      board.removeEventListener('touchmove', handleTouchMove)
      board.removeEventListener('touchend', handleTouchEnd)
      board.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [])




  // HILLION SMART BOARD FOLLOW
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const touchStartY = { current: 0 };

    const pauseFollowing = () => {
      setIsFollowingLive(false);
      setShowReturnToLive(true);
    };

    const handleWheel = (event) => {
      if (event.deltaY < 0) {
        pauseFollowing();
      }
    };

    const handleTouchStart = (event) => {
      if (event.touches.length !== 1) {
        return;
      }

      touchStartY.current = event.touches[0].clientY;
    };

    const handleTouchMove = (event) => {
      if (event.touches.length !== 1) return;

      const movement = event.touches[0].clientY - touchStartY.current;

      if (movement > 8) {
        pauseFollowing();
      }
    };

    const handleTouchEnd = () => {
    };

    board.addEventListener('wheel', handleWheel, { passive: true });
    board.addEventListener('touchstart', handleTouchStart, { passive: true });
    board.addEventListener('touchmove', handleTouchMove, { passive: true });
    board.addEventListener('touchend', handleTouchEnd, { passive: true });
    board.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      board.removeEventListener('wheel', handleWheel);
      board.removeEventListener('touchstart', handleTouchStart);
      board.removeEventListener('touchmove', handleTouchMove);
      board.removeEventListener('touchend', handleTouchEnd);
      board.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !isFollowingLive) return;

    const frame = requestAnimationFrame(() => {
      board.scrollTo({
        top: board.scrollHeight,
        behavior: 'smooth'
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [liveSectionContent, sections.length, isFollowingLive]);

  useEffect(() => {
    if (!loading) return

    const timer = setInterval(() => {
      setProgressStage(stage => (stage + 1) % 5)
    }, 2500)

    return () => clearInterval(timer)
  }, [loading])


  const handleDownload = () => {
    const lessonText = [
      title || topic,
      subject ? 'Subject: ' + subject : '',
      '',
      ...sections.map(section =>
        (section.heading || section.type || 'Lesson section') + '\n' + section.content
      ),
      content || ''
    ].filter(Boolean).join('\n\n')

    const blob = new Blob([lessonText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = (title || topic || 'Hillion-lesson').replace(/[^a-z0-9-_]/gi, '-') + '.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleShare = async () => {
    const shareText = (title || topic) + '\n' +
      sections.map(section => (section.heading || '') + '\n' + section.content).join('\n\n')

    try {
      if (navigator.share) {
        await navigator.share({ title: title || topic, text: shareText })
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText)
        alert('Lesson copied. You can now paste and share it.')
      } else {
        handleDownload()
      }
    } catch (error) {
      if (error.name !== 'AbortError') console.error('Sharing failed:', error)
    }
  }

  const toggleExpanded = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.querySelector('.classroom-screen')?.requestFullscreen?.()
        setIsExpanded(true)
      } else {
        await document.exitFullscreen()
        setIsExpanded(false)
      }
    } catch (error) {
      console.error('Fullscreen unavailable:', error)
      setIsExpanded(value => !value)
    }
  }

  async function submitClassroomQuestion(event) {
    event?.preventDefault?.();
    const question = questionDraft.trim();
    if (!question || isAskingQuestion || typeof onAskQuestion !== 'function') return;
    setIsAskingQuestion(true);
    setQuestionError('');
    try {
      await onAskQuestion(question, selectedPassage);
      setSelectedPassage('');
      setQuestionDraft('');
      setIsComposerOpen(false);
    } catch (error) {
      setQuestionError(error?.message || 'Hillion could not answer that question.');
    } finally {
      setIsAskingQuestion(false);
    }
  }

  async function toggleQuestionMicrophone() {
    setIsComposerOpen(true)
    setQuestionError('')

    if (Capacitor.isNativePlatform()) {
      try {
        if (isMicActive) {
          await HillionSpeechRecognition.stopListening()
          setMicActive(false)
          playMicToggleSound(false)
        } else {
          await HillionSpeechRecognition.startListening()
          setMicActive(true)
          playMicToggleSound(true)
        }
      } catch (error) {
        setMicActive(false)
        setQuestionError(error?.message || 'Android could not start speech recognition. You can type your question instead.')
      }
      return
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      setMicActive(false)
      playMicToggleSound(false)
      return
    }
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) {
      setQuestionError('Speech recognition is not available in this browser. You can type your question instead.')
      return
    }
    const recognition = new SpeechRecognitionAPI()
    recognition.lang = 'en-GB'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.onresult = event => {
      const transcriptText = Array.from(event.results)
        .map(result => result[0]?.transcript || '')
        .join(' ')
        .trim()
      setQuestionDraft(transcriptText)
    }
    recognition.onerror = event => {
      setQuestionError(event.error === 'not-allowed'
        ? 'Microphone permission was denied. Allow microphone access in Android settings or type your question.'
        : `Speech recognition failed (${event.error || 'unknown error'}). You can type your question instead.`)
      setMicActive(false)
      recognitionRef.current = null
    }
    recognition.onend = () => {
      setMicActive(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
      setMicActive(true)
      playMicToggleSound(true)
    }
    catch (error) {
      setMicActive(false)
      recognitionRef.current = null
      setQuestionError(error?.message || 'Could not start speech recognition.')
    }
  }

  useEffect(() => () => {
    recognitionRef.current?.stop?.();
  }, []);

  return (
    <main className="classroom-screen">

      <header className="classroom-header">
        <button className="header-icon-button" onClick={onExit} aria-label="Exit classroom" title="Exit classroom">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7" /></svg>
        </button>
        <span>HILLION AI TUTOR</span>
        <button className="header-icon-button" onClick={() => setActiveToolbarPanel(activeToolbarPanel === 'menu' ? null : 'menu')} aria-label="Lesson navigation" title="Lesson navigation">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <button className="header-icon-button" onClick={() => setActiveToolbarPanel(activeToolbarPanel === 'more' ? null : 'more')} aria-label="More options" title="More options">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>
        </button>
        <button className="header-icon-button" onClick={() => setActiveToolbarPanel(activeToolbarPanel === 'comments' ? null : 'comments')} aria-label="Comments" title="Lesson discussion">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-9.5A7.5 7.5 0 0 1 10.5 4H12a8 8 0 0 1 8 7.5Z" /></svg>
        </button>
        <button className="header-icon-button header-view-button" onClick={() => setActiveToolbarPanel(activeToolbarPanel === 'view' ? null : 'view')} aria-label="Viewing mode" title="Viewing mode">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg><small>{viewMode}</small>
        </button>
        <button className="header-icon-button" onClick={handleDownload} aria-label="Download lesson" title="Download lesson">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16" /></svg>
        </button>
        <button className="header-icon-button" onClick={handleShare} aria-label="Share lesson" title="Share lesson">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.5-4.5m-7.5 7 7.5 4.5" /></svg>
        </button>
        <button className="header-icon-button" onClick={toggleExpanded} aria-label="Expand classroom" title={isExpanded ? 'Restore classroom' : 'Expand classroom'}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{isExpanded ? <path d="M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5" /> : <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />}</svg>
        </button>
      </header>

      {activeToolbarPanel && (
        <div className="toolbar-panel">
          {activeToolbarPanel === 'menu' && (
            <>
              <strong>Lesson navigation</strong>
              <button onClick={() => setActiveToolbarPanel(null)}>Lesson overview</button>
              {sections.map((section, index) => (
                <button key={index} onClick={() => {
                  document.querySelectorAll('.lesson-section')[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  setActiveToolbarPanel(null)
                }}>
                  {index + 1}. {section.heading || section.type || 'Lesson section'}
                </button>
              ))}
            </>
          )}

          {activeToolbarPanel === 'more' && (
            <>
              <strong>More classroom options</strong>
              <label className="voice-preference-control" htmlFor="hillion-voice-preference">Narration voice</label>
              <select
                id="hillion-voice-preference"
                className="voice-preference-select"
                value={voicePreference}
                onChange={event => {
                  const next = event.target.value;
                  setVoicePreference(next);
                  localStorage.setItem('hillion_voice_preference', next);
                  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                  speechRef.current = null;
                  speechQueueRef.current = [];
                  speechIndexRef.current = 0;
                  setIsSpeaking(false);
                }}
              >
                <option value="female">Female voice</option>
                <option value="male">Male voice</option>
                <option value="neutral">Neutral / system default</option>
              </select>
              <button onClick={resetZoom}>Reset board zoom to 100%</button>
              <button onClick={() => setIsTranscriptOpen(!isTranscriptOpen)}>Toggle live transcript</button>
              <button onClick={handleDownload}>Download lesson notes</button>
              <button onClick={() => setActiveToolbarPanel(null)}>Close options</button>
            </>
          )}

          {activeToolbarPanel === 'comments' && (
            <>
              <strong>Lesson discussion</strong>
              <p>Follow your learning conversation in the live transcript.</p>
              <button onClick={() => {
                setIsTranscriptOpen(true)
                setActiveToolbarPanel(null)
              }}>Open live transcript</button>
            </>
          )}

          {activeToolbarPanel === 'view' && (
            <>
              <strong>Viewing mode</strong>
              {['1x', 'Fit', 'Focus'].map(mode => (
                <button
                  key={mode}
                  className={viewMode === mode ? 'toolbar-option-active' : ''}
                  onClick={() => {
                    setViewMode(mode)
                    if (mode === '1x') resetZoom()
                    if (mode === 'Fit') setZoom(0.8)
                    if (mode === 'Focus') setZoom(1.2)
                    setActiveToolbarPanel(null)
                  }}
                >
                  {mode === '1x' ? 'Standard view' : mode === 'Fit' ? 'Fit board' : 'Focus view'}
                  {viewMode === mode ? ' ✓' : ''}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <nav className="classroom-zoom-toolbar" aria-label="Board zoom controls">
        <button onClick={zoomOut} aria-label="Zoom out" disabled={zoom <= 0.5}>−</button>
        <button onClick={resetZoom} aria-label="Reset zoom" title="Reset to 100%">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={zoomIn} aria-label="Zoom in" disabled={zoom >= 2}>+</button>
      </nav>

      <section ref={boardRef} className="classroom-board" onMouseUp={() => {
        const text = window.getSelection?.()?.toString?.().trim() || '';
        if (text.length > 2 && text.length <= 1600) {
          setSelectedPassage(text);
          setIsComposerOpen(true);
        }
      }} onTouchEnd={() => {
        window.setTimeout(() => {
          const text = window.getSelection?.()?.toString?.().trim() || '';
          if (text.length > 2 && text.length <= 1600) {
            setSelectedPassage(text);
            setIsComposerOpen(true);
          }
        }, 0);
      }}>
        <div className="board-paper" style={{ zoom: zoom }}>
          {subject && (
            <div className="lesson-subject">{subject}</div>
          )}
          <h1>{title || topic}</h1>
          {diagram && <LessonDiagram diagram={diagram} />}

          {sections.length > 0 || liveSectionContent ? (
            <div className="lesson-content">
              {sections.map((section, index) => (
                <Fragment key={section.id || index}>
                <article
                  className={`lesson-section lesson-section-${section.type || 'explanation'}`}
                >
                  <h2>{section.heading || section.type || 'Lesson section'}</h2>
                  <div className="lesson-section-content">
                    <LessonContentRenderer content={section.content} sectionHeading={section.heading} />
                  </div>
                  {Array.isArray(section.visuals) && section.visuals.map((visual, visualIndex) => {
                    if (!visual || typeof visual !== 'object') return null;

                    if (Array.isArray(visual.nodes) && visual.nodes.length > 0) {
                      return (
                        <LessonDiagram
                          key={visual.id || visualIndex}
                          diagram={visual}
                        />
                      );
                    }

                    if (
                      visual.renderer === 'svg' &&
                      Array.isArray(visual.elements)
                    ) {
                      return (
                        <SectionSvgIllustration
                          key={visual.id || visualIndex}
                          visual={visual}
                        />
                      );
                    }

                    if (typeof visual.src === 'string' && visual.src.trim()) {
                      return (
                        <figure className="lesson-section-visual-image" key={visual.id || visualIndex}>
                          <img
                            src={visual.src}
                            alt={visual.alt || visual.title || section.heading || 'Educational illustration'}
                            loading="lazy"
                          />
                          {(visual.caption || visual.title) && (
                            <figcaption>{visual.caption || visual.title}</figcaption>
                          )}
                        </figure>
                      );
                    }

                    return null;
                  })}
                </article>
                {clarifications.filter(item => item.afterSectionIndex === index).map(item => (
                  <article className="lesson-section-clarification" key={item.id}>
                    <h3>{item.heading || 'Clarification'}</h3>
                    {item.clarifiedPassage && <blockquote>{item.clarifiedPassage}</blockquote>}
                    <div className="lesson-section-content">
                      <LessonContentRenderer content={item.content} sectionHeading={item.heading} />
                    </div>
                  </article>
                ))}
                </Fragment>
              ))}
              {liveSectionContent && (
                <article className="lesson-section lesson-section-explanation lesson-section-live">
                  <h2>{liveSectionHeading || 'Hillion is preparing this section...'}</h2>
                  <div className="lesson-section-content">
                    <LessonContentRenderer content={liveSectionContent} sectionHeading={liveSectionHeading} isStreaming />
                  </div>
                </article>
              )}
              {clarifications.filter(item => item.targetLiveDraft || item.afterSectionIndex === null).map(item => (
                <article className="lesson-section-clarification" key={item.id}>
                  <h3>{item.heading || 'Clarification'}</h3>
                  {item.clarifiedPassage && <blockquote>{item.clarifiedPassage}</blockquote>}
                  <div className="lesson-section-content">
                    <LessonContentRenderer content={item.content} sectionHeading={item.heading} />
                  </div>
                </article>
              ))}
            </div>
          ) : content ? (
            <div className="lesson-content"><LessonContentRenderer content={content} /></div>
          ) : loading ? (
            <div className="lesson-loading-board">
              <div className="lesson-loading-spinner"></div>
              <h2>Preparing your lesson</h2>
              <p>Hillion is organising the explanations, examples and learning materials for:</p>
              <strong>{topic}</strong>
              <small>Your classroom is ready. Your lesson will appear here as soon as it is generated.</small>
            </div>
          ) : null}
        </div>
      </section>

      {showReturnToLive && (
        <button
          className="return-to-live-button"
          onClick={returnToLiveLesson}
          type="button"
        >
          ↓ Return to live lesson
        </button>
      )}

      {isTranscriptOpen && (
        <div className="transcript-panel">
          <strong>Live transcript</strong>
            <div className="transcript-conversation">
              {conversation.map((entry, index) => (
                <div className={"transcript-entry " + (entry.role === "user" ? "transcript-user" : "transcript-hillion")} key={index}>
                  <span className="transcript-speaker">{entry.role === "user" ? "You" : "Hillion"}</span>
                  <p>{entry.content}</p>
                </div>
              ))}
            </div>
            {transcript && <p className="transcript-status">{transcript}</p>}
            {loading && (
              <div className="hillion-thinking">
                <span>Hillion is thinking</span>
                <div className="thinking-dots">
                  <i></i><i></i><i></i>
                </div>
                <small>{[
                  "Understanding your question...",
                  "Identifying the subject...",
                  "Organising your lesson...",
                  "Preparing explanations and examples...",
                  "Building your classroom..."
                ][progressStage]}</small>
              </div>
            )}
            {!loading && !transcript && conversation.length === 0 && (
              <p>Your learning conversation will appear here.</p>
            )}
        </div>
      )}

      {isComposerOpen && (
        <form className="classroom-question-composer" onSubmit={submitClassroomQuestion}>
          <label htmlFor="hillion-follow-up">Ask a follow-up question</label>
          {selectedPassage && (
            <div className="selected-passage-context">
              <strong>Passage selected for clarification</strong>
              <p>“{selectedPassage}”</p>
              <button type="button" onClick={() => setSelectedPassage('')}>Clear selection</button>
            </div>
          )}
          <div className="classroom-question-row">
            <input
              id="hillion-follow-up"
              value={questionDraft}
              onChange={event => setQuestionDraft(event.target.value)}
              placeholder={selectedPassage ? "Ask about the selected passage, or tap Send to explain it..." : "Ask Hillion to explain, clarify or add an example..."}
              disabled={isAskingQuestion}
            />
            <button type="submit" disabled={!questionDraft.trim() || isAskingQuestion}>
              {isAskingQuestion ? '...' : 'Send'}
            </button>
          </div>
          {questionError && <p className="classroom-question-error" role="status">{questionError}</p>}
        </form>
      )}

      <footer className="floating-controls" aria-label="Classroom controls">
        <div className="control-cluster control-presence">
          <button ref={avatarControlRef} className={`avatar-control ${isSpeaking ? 'avatar-speaking' : ''}`} aria-label={isSpeaking ? 'Hillion is speaking' : 'Hillion voice indicator'} title={isSpeaking ? 'Hillion is speaking' : 'Hillion tutor'}>
            <AvatarIcon speaking={isSpeaking} mouthShape={avatarMouthShape} />
            <span className="avatar-badge">✦</span>
          </button>
        </div>

        <div className="control-cluster control-learning" aria-label="Lesson playback">
          <button className={`round-control ${isTranscriptOpen ? 'narration-active' : ''}`} onClick={() => setIsTranscriptOpen(!isTranscriptOpen)} aria-label="Toggle transcript" title="Lesson transcript">
            <SpeechIcon />
          </button>
          <button className="round-control" onClick={loading ? onInterrupt : onResume} aria-label={loading ? 'Pause lesson' : 'Resume lesson'} title={loading ? 'Pause lesson' : (canResume ? 'Resume lesson' : 'Lesson is not paused')} disabled={!loading && !canResume}>
            {loading ? <span>■</span> : <span>▶</span>}
          </button>
          <button className={`round-control ${isSpeaking ? 'narration-active' : ''}`} onClick={toggleNarration} aria-label={isSpeaking ? 'Stop narration' : 'Read lesson aloud'} title={isSpeaking ? 'Stop narration' : 'Read lesson aloud'}>
            <VolumeIcon />
          </button>
        </div>

        <div className="control-cluster control-input" aria-label="Ask a question">
          <button className={`round-control ${isComposerOpen ? 'narration-active' : ''}`} onClick={() => { setIsComposerOpen(value => !value); setQuestionError(''); }} aria-label="Open keyboard question" title="Type a follow-up question">
            <KeyboardIcon />
          </button>
          <button className={`microphone-control ${isMicActive ? 'mic-active' : ''}`} onClick={toggleQuestionMicrophone} aria-label={isMicActive ? 'Stop microphone' : 'Ask by voice'} title={isMicActive ? 'Stop listening' : 'Ask by voice'}>
            <MicrophoneIcon />
          </button>
        </div>
      </footer>

    </main>
  )
}

export default Classroom
