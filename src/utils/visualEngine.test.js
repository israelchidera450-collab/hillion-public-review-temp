import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSectionVisuals } from './visualEngine.js';

test('known water molecule uses the deterministic molecular template', () => {
  const [visual] = generateSectionVisuals([{
    kind: 'molecule',
    title: 'Water molecule (H2O)',
    description: 'A bent molecular geometry',
    caption: 'Two hydrogen atoms bonded to oxygen'
  }]);
  assert.ok(visual, 'expected a water molecule illustration');
  assert.equal(visual.kind, 'molecule');
  assert.match(JSON.stringify(visual), /H₂O/);
});

test('unsupported topics do not receive an invented generic diagram', () => {
  const visuals = generateSectionVisuals([{
    kind: 'photosynthesis',
    title: 'Photosynthesis',
    description: 'How plants convert light energy into chemical energy',
    caption: 'Photosynthesis'
  }]);
  assert.deepEqual(visuals, []);
});

test('malformed structured diagrams are rejected as a whole', () => {
  const visuals = generateSectionVisuals([{
    kind: 'diagram',
    title: 'Cell process',
    renderStyle: 'technical-illustration',
    elements: [
      { type: 'text', x: 100, y: 100, text: 'Start' },
      { type: 'line', x1: 100, y1: 100, x2: 200, y2: 200 },
      { type: 'rect', x: 10, y: 10, width: -4, height: 30 }
    ]
  }]);
  assert.deepEqual(visuals, []);
});

test('valid structured diagrams retain their declared visual style and labels', () => {
  const [visual] = generateSectionVisuals([{
    kind: 'diagram',
    title: 'Energy transfer',
    description: 'A simple labelled sequence',
    renderStyle: 'technical-illustration',
    elements: [
      { type: 'text', x: 100, y: 120, text: 'Input energy' },
      { type: 'line', x1: 150, y1: 120, x2: 300, y2: 120 },
      { type: 'rect', x: 300, y: 80, width: 180, height: 80, fill: '#DDEBDD' }
    ]
  }]);
  assert.ok(visual, 'expected a valid structured diagram');
  assert.equal(visual.renderStyle, 'technical-illustration');
  assert.ok(visual.elements.some(element => element.text === 'Input energy'));
});
