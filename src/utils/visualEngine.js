const COLORS = {
  ink: '#263B32',
  green: '#6F9B78',
  paleGreen: '#DDEBDD',
  blue: '#7DAAC5',
  paleBlue: '#E1EFF5',
  gold: '#D8AE58',
  paleGold: '#F7EBCB',
  red: '#C87570',
  paleRed: '#F5E1DE',
  purple: '#9A86B8',
  palePurple: '#ECE6F5',
  white: '#FFFEFB',
  muted: '#718078'
};

const makeText = (x, y, text, options = {}) => ({
  type: 'text',
  x,
  y,
  text,
  fill: options.fill || COLORS.ink,
  fontSize: options.fontSize || 25,
  fontWeight: options.fontWeight || 500,
  textAnchor: options.textAnchor || 'middle'
});

const makeShape = (type, values = {}) => ({
  type,
  ...values
});

function createMoleculeVisual(title, description, caption) {
  const source = (title + ' ' + description + ' ' + caption).toLowerCase();

  let molecule = null;

  if (/\b(water|h2o)\b/.test(source)) {
    molecule = {
      formula: 'H₂O',
      name: 'Water',
      atoms: [
        { x: 500, y: 330, label: 'O', color: COLORS.paleRed, stroke: COLORS.red, radius: 72 },
        { x: 340, y: 540, label: 'H', color: COLORS.paleBlue, stroke: COLORS.blue, radius: 57 },
        { x: 660, y: 540, label: 'H', color: COLORS.paleBlue, stroke: COLORS.blue, radius: 57 }
      ],
      bonds: [[0, 1, 1], [0, 2, 1]],
      shape: 'Bent molecular geometry'
    };
  } else if (/\b(carbon dioxide|co2)\b/.test(source)) {
    molecule = {
      formula: 'CO₂',
      name: 'Carbon dioxide',
      atoms: [
        { x: 250, y: 430, label: 'O', color: COLORS.paleRed, stroke: COLORS.red, radius: 65 },
        { x: 500, y: 430, label: 'C', color: COLORS.paleGold, stroke: COLORS.gold, radius: 65 },
        { x: 750, y: 430, label: 'O', color: COLORS.paleRed, stroke: COLORS.red, radius: 65 }
      ],
      bonds: [[0, 1, 2], [1, 2, 2]],
      shape: 'Linear molecular geometry'
    };
  } else if (/\b(methane|ch4)\b/.test(source)) {
    molecule = {
      formula: 'CH₄',
      name: 'Methane',
      atoms: [
        { x: 500, y: 430, label: 'C', color: COLORS.paleGold, stroke: COLORS.gold, radius: 67 },
        { x: 500, y: 190, label: 'H', color: COLORS.paleBlue, stroke: COLORS.blue, radius: 48 },
        { x: 280, y: 540, label: 'H', color: COLORS.paleBlue, stroke: COLORS.blue, radius: 48 },
        { x: 720, y: 540, label: 'H', color: COLORS.paleBlue, stroke: COLORS.blue, radius: 48 },
        { x: 500, y: 700, label: 'H', color: COLORS.paleBlue, stroke: COLORS.blue, radius: 48 }
      ],
      bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]],
      shape: 'Tetrahedral molecular geometry (2D schematic)'
    };
  } else if (/\b(ammonia|nh3)\b/.test(source)) {
    molecule = {
      formula: 'NH₃',
      name: 'Ammonia',
      atoms: [
        { x: 500, y: 390, label: 'N', color: COLORS.palePurple, stroke: COLORS.purple, radius: 68 },
        { x: 300, y: 610, label: 'H', color: COLORS.paleBlue, stroke: COLORS.blue, radius: 48 },
        { x: 700, y: 610, label: 'H', color: COLORS.paleBlue, stroke: COLORS.blue, radius: 48 },
        { x: 500, y: 150, label: 'H', color: COLORS.paleBlue, stroke: COLORS.blue, radius: 48 }
      ],
      bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]],
      shape: 'Trigonal pyramidal molecular geometry (2D schematic)'
    };
  }

  if (!molecule) return null;

  const elements = [];

  molecule.bonds.forEach(([a, b, order]) => {
    const first = molecule.atoms[a];
    const second = molecule.atoms[b];
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const offsetX = length ? (-dy / length) * 10 : 0;
    const offsetY = length ? (dx / length) * 10 : 0;

    for (let i = 0; i < order; i++) {
      const offset = order === 1 ? 0 : (i === 0 ? -1 : 1);
      elements.push(makeShape('line', {
        x1: first.x + offsetX * offset,
        y1: first.y + offsetY * offset,
        x2: second.x + offsetX * offset,
        y2: second.y + offsetY * offset,
        stroke: COLORS.ink,
        strokeWidth: 9
      }));
    }
  });

  molecule.atoms.forEach(atom => {
    elements.push(
      makeShape('circle', {
        cx: atom.x,
        cy: atom.y,
        r: atom.radius,
        fill: atom.color,
        stroke: atom.stroke,
        strokeWidth: 5
      }),
      makeText(atom.x, atom.y + 15, atom.label, {
        fontSize: 42,
        fontWeight: 700
      })
    );
  });

  elements.push(
    makeText(500, 820, molecule.name + ' — ' + molecule.formula, {
      fontSize: 29,
      fontWeight: 700
    }),
    makeText(500, 875, molecule.shape, {
      fontSize: 22
    })
  );

  return {
    renderer: 'svg',
    kind: 'molecule',
    title,
    description,
    caption,
    viewBox: '0 0 1000 950',
    elements
  };
}

// Render AI-authored, subject-specific diagrams from a tightly constrained SVG
// primitive schema. Geometry and labels come from the lesson planner; the app
// validates every field and never executes model-provided markup.
function createStructuredVisual(visual) {
  const allowed = new Set(['line', 'rect', 'circle', 'ellipse', 'text', 'polyline', 'polygon']);
  const numeric = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'strokeWidth', 'fontSize']);
  const colour = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const source = Array.isArray(visual.elements) ? visual.elements.slice(0, 80) : [];
  if (source.length < 3) return null;

  const elements = source.map(item => {
    if (!item || typeof item !== 'object' || !allowed.has(item.type)) return null;
    const element = { type: item.type };
    for (const key of numeric) {
      if (item[key] === undefined) continue;
      const value = Number(item[key]);
      if (!Number.isFinite(value) || value < -100 || value > 1100) return null;
      element[key] = value;
    }

    if (item.type === 'text') {
      const label = String(item.text || '').replace(/[<>]/g, '').trim().slice(0, 90);
      if (!label || element.x === undefined || element.y === undefined) return null;
      element.text = label;
      element.fill = colour(item.fill) ? item.fill : COLORS.ink;
      element.fontSize = Math.min(48, Math.max(12, element.fontSize || 25));
      element.fontWeight = Number(item.fontWeight) >= 600 ? 700 : 500;
      element.textAnchor = ['start', 'middle', 'end'].includes(item.textAnchor) ? item.textAnchor : 'middle';
    } else {
      element.fill = item.fill === 'none' ? 'none' : (colour(item.fill) ? item.fill : 'none');
      element.stroke = colour(item.stroke) ? item.stroke : COLORS.ink;
      element.strokeWidth = Math.min(16, Math.max(1, element.strokeWidth || 3));

      const required = {
        line: ['x1', 'y1', 'x2', 'y2'],
        rect: ['x', 'y', 'width', 'height'],
        circle: ['cx', 'cy', 'r'],
        ellipse: ['cx', 'cy', 'rx', 'ry'],
        polyline: [],
        polygon: []
      }[item.type];
      if (required.some(key => element[key] === undefined)) return null;
      if (['width', 'height', 'r', 'rx', 'ry'].some(key => element[key] !== undefined && element[key] <= 0)) return null;

      if (item.type === 'polyline' || item.type === 'polygon') {
        const points = String(item.points || '').trim();
        if (!/^-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)(?:\s+-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?){1,49}$/.test(points)) return null;
        const coordinates = points.split(/[\s,]+/).map(Number);
        if (coordinates.some(value => !Number.isFinite(value) || value < -100 || value > 1100)) return null;
        element.points = points;
      }
    }
    return element;
  });

  // Reject the entire illustration if any primitive is malformed. Silently
  // dropping one part can change anatomy, apparatus, or vector relationships.
  if (elements.some(element => element === null)) return null;
  if (elements.filter(item => item.type === 'text').length < 1) return null;
  const renderStyle = ['isometric-3d', 'technical-illustration', 'hand-drawn', 'flat'].includes(visual.renderStyle)
    ? visual.renderStyle
    : 'flat';
  return {
    renderer: 'svg', kind: 'ai-structured-diagram', renderStyle,
    title: String(visual.title || 'Educational diagram').slice(0, 120),
    description: String(visual.description || '').slice(0, 500),
    caption: String(visual.caption || '').slice(0, 300),
    viewBox: '0 0 1000 1000', elements
  };
}

function identifyTemplate(visual) {
  const text = [visual.kind, visual.title, visual.purpose, visual.description]
    .join(' ')
    .toLowerCase();

  return /\b(water molecule|molecule|molecular structure|chemical bond)\b/.test(text)
    ? 'molecule'
    : null;
}

export function generateSectionVisuals(visualPlan = []) {
  // Visuals must be explicitly planned by the lesson model. Never infer a
  // diagram merely from a topic heading: that previously produced generic,
  // potentially misleading cell/graph/timeline illustrations.
  const candidates = Array.isArray(visualPlan) ? visualPlan.slice(0, 5) : [];

  return candidates
    .map(visual => {
      if (!visual || typeof visual !== 'object') return null;

      const title = String(visual.title || 'Educational illustration');
      const description = String(visual.description || '');
      const caption = String(visual.caption || title);
      const kind = identifyTemplate(visual);
      const structured = createStructuredVisual(visual);
      if (structured) return structured;

      // Keep only deterministic molecule layouts whose geometry is defined
      // by the known molecular formula. Other subjects require AI-authored,
      // validated primitives rather than placeholder diagrams.
      if (kind === 'molecule') return createMoleculeVisual(title, description, caption);
      return null;
    })
    .filter(Boolean)
    .map((visual, index) => ({
      ...visual,
      id: 'section-visual-' + index
    }));
}
