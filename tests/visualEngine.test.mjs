import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSectionVisuals } from '../src/utils/visualEngine.js';

test('renders a valid AI-authored structured illustration', () => {
  const visuals = generateSectionVisuals([{
    kind: 'anatomy',
    title: 'Human heart chamber schematic',
    description: 'A simplified labelled teaching schematic.',
    elements: [
      { type: 'text', x: 500, y: 80, text: 'Heart chambers' },
      { type: 'ellipse', cx: 400, cy: 300, rx: 100, ry: 150, fill: '#DDEBDD' },
      { type: 'ellipse', cx: 600, cy: 300, rx: 100, ry: 150, fill: '#E1EFF5' },
      { type: 'line', x1: 500, y1: 100, x2: 500, y2: 500, stroke: '#263B32' }
    ]
  }]);
  assert.equal(visuals.length, 1);
  assert.equal(visuals[0].kind, 'ai-structured-diagram');
  assert.equal(visuals[0].elements.length, 4);
});

test('rejects unsafe or incomplete geometry instead of drawing it', () => {
  const visuals = generateSectionVisuals([{
    kind: 'anatomy', title: 'Invalid drawing', elements: [
      { type: 'script', text: 'alert(1)' },
      { type: 'text', x: 99999, y: 0, text: 'Out of bounds' },
      { type: 'circle', cx: 100, cy: 100, r: -3 },
      { type: 'rect', x: 20, y: 20, width: 0, height: 40 }
    ]
  }]);
  assert.deepEqual(visuals, []);
});

test('retains the supported water molecule template', () => {
  const visuals = generateSectionVisuals([{ kind: 'molecule', title: 'Water molecule' }]);
  assert.equal(visuals.length, 1);
  assert.equal(visuals[0].kind, 'molecule');
  assert.ok(visuals[0].elements.some(element => element.type === 'text' && element.text === 'O'));
});

test('does not invent a generic visual for an unsupported concept', () => {
  const visuals = generateSectionVisuals([{ kind: 'anatomy', title: 'Unrecognised organ', description: 'No validated drawing supplied.' }]);
  assert.deepEqual(visuals, []);
});

test('rejects a whole diagram when one primitive is malformed', () => {
  const visuals = generateSectionVisuals([{
    kind: 'physics', title: 'Projectile trajectory schematic', elements: [
      { type: 'text', x: 500, y: 80, text: 'Trajectory' },
      { type: 'line', x1: 100, y1: 700, x2: 900, y2: 700 },
      { type: 'circle', cx: 300, cy: 300, r: -20 }
    ]
  }]);
  assert.deepEqual(visuals, []);
});

test('does not infer a generic visual from a lesson heading', () => {
  const visuals = generateSectionVisuals([], {
    subject: 'Biology', topic: 'Human heart anatomy',
    heading: 'The chambers of the heart'
  });
  assert.deepEqual(visuals, []);
});

test('renders known diatomic chemistry structures with the correct bond order', () => {
  const cases = [
    { title: 'Oxygen molecule O2', bondCount: 2, formula: 'O₂' },
    { title: 'Nitrogen molecule N2', bondCount: 3, formula: 'N₂' },
    { title: 'Hydrogen molecule H2', bondCount: 1, formula: 'H₂' },
    { title: 'Hydrogen chloride HCl', bondCount: 1, formula: 'HCl' }
  ];

  for (const item of cases) {
    const [visual] = generateSectionVisuals([{ kind: 'molecule', title: item.title }]);
    assert.ok(visual, item.title + ' should render');
    assert.equal(
      visual.elements.filter(element => element.type === 'line').length,
      item.bondCount,
      item.title + ' should have the correct bond order'
    );
    assert.ok(visual.elements.some(element => element.type === 'text' && element.text.includes(item.formula)));
  }
});


test('renders common hydrocarbon structures with correct bond multiplicity', () => {
  const cases = [
    { title: 'Ethene C2H4 molecule', bondLines: 6, formula: 'C₂H₄' },
    { title: 'Ethyne C2H2 molecule', bondLines: 5, formula: 'C₂H₂' },
    { title: 'Benzene C6H6 ring', bondLines: 15, formula: 'C₆H₆' }
  ];
  for (const item of cases) {
    const [visual] = generateSectionVisuals([{ kind: 'molecule', title: item.title }]);
    assert.ok(visual, item.title + ' should render');
    assert.equal(visual.elements.filter(element => element.type === 'line').length, item.bondLines);
    assert.ok(visual.elements.some(element => element.type === 'text' && element.text.includes(item.formula)));
  }
});


test('renders deterministic parent-function plots with labelled axes', () => {
  const cases = [
    { title: 'Graph of y = x', expected: 'Standard linear function: y = x' },
    { title: 'Parabola graph of y = x^2', expected: 'Standard quadratic function: y = x²' }
  ];
  for (const item of cases) {
    const [visual] = generateSectionVisuals([{ kind: 'mathematics graph', title: item.title }]);
    assert.ok(visual, item.title + ' should render');
    assert.equal(visual.kind, 'function-graph');
    assert.ok(visual.elements.some(element => element.type === 'text' && element.text === 'x'));
    assert.ok(visual.elements.some(element => element.type === 'text' && element.text === 'y'));
    assert.ok(visual.elements.some(element => element.type === 'polyline'));
    assert.ok(visual.elements.some(element => element.type === 'text' && element.text === item.expected));
  }
});
