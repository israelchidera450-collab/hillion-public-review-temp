import { useState, useRef, useEffect } from 'react'
import './App.css'
import Classroom from './components/Classroom'
import ClassroomErrorBoundary from './components/ClassroomErrorBoundary'
import HomeDashboard from './components/HomeDashboard'
import { getActiveLesson, saveActiveLesson, saveLesson, getLessons, clearActiveLesson, restoreStorageFromIndexedDB } from "./utils/lessonStorage"
import { generateSectionVisuals } from './utils/visualEngine'
import { checkAIAvailability, requestAI } from './utils/aiClient'
import './components/HomeDashboard.css'

function loadChatHistorySafely() {
  try {
    const raw = window.localStorage.getItem('hillion_chat_history')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn('[HILLION STORAGE] Chat history was not an array; starting with an empty chat history.')
      return []
    }
    return parsed
  } catch (error) {
    console.warn('[HILLION STORAGE] Chat history could not be read. The app will continue without crashing:', error)
    return []
  }
}

function saveChatHistorySafely(messages) {
  try {
    window.localStorage.setItem('hillion_chat_history', JSON.stringify(messages))
    return true
  } catch (error) {
    console.warn('[HILLION STORAGE] Chat history could not be saved. Existing lessons remain separate:', error)
    return false
  }
}


function App() {
  const [isSplashScreen, setIsSplashScreen] = useState(true)
  const [recoveryLesson, setRecoveryLesson] = useState(null)
  const [, setStorageReady] = useState(false)

useEffect(() => {
  const timer = setTimeout(() => {
    setIsSplashScreen(false)
  }, 2000)

  return () => clearTimeout(timer)
}, [])
  const [subject] = useState('Biology')
  const [lessonTopic, setLessonTopic] = useState('')
const [isClassroomOpen, setIsClassroomOpen] = useState(false)
  const [isPreparingLesson, setIsPreparingLesson] = useState(false)
  const [lessonContent, setLessonContent] = useState('')
  const [lessonTranscript, setLessonTranscript] = useState('')
  const [lessonConversation, setLessonConversation] = useState([])
  const [lessonSections, setLessonSections] = useState([])
  const [liveSectionContent, setLiveSectionContent] = useState('')
  const [liveSectionHeading, setLiveSectionHeading] = useState('')
  const [lessonTitle, setLessonTitle] = useState('')
  const [lessonSubject, setLessonSubject] = useState('')
  const [lessonDiagram, setLessonDiagram] = useState(null)
const [isLessonLoading, setIsLessonLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState(loadChatHistorySafely)
  const [isLoading, setIsLoading] = useState(false)
  const [tool, setTool] = useState('pen')
  const [drawingColor, setDrawingColor] = useState('#e5c98e')
const [textSize, setTextSize] = useState(22)
  const [penSize, setPenSize] = useState(4)
  const [eraserSize, setEraserSize] = useState(18)
  const [zoomLevel, setZoomLevel] = useState(100)
  const [drawings, setDrawings] = useState([])
  const [redoDrawings, setRedoDrawings] = useState([])
  const [preview, setPreview] = useState(null)

  const currentDrawing = useRef(null)
  const svgRef = useRef(null)
  const boardContentRef = useRef(null)
  const panStart = useRef(null)
  const lessonAbortRef = useRef(null)
  const liveDraftRef = useRef(null)
  const liveDraftSaveTimerRef = useRef(null)
  const liveSectionUiTimerRef = useRef(null)
  useEffect(() => {
  saveChatHistorySafely(messages)
}, [messages])

  useEffect(() => {
    let mounted = true;
    // Restore from the durable mirror only when both local copies are missing
    // or unusable. This completes before the recovery prompt is populated.
    restoreStorageFromIndexedDB().catch(error => {
      console.warn('[HILLION STORAGE] Startup backup check failed:', error);
    }).finally(() => {
      if (!mounted) return;
      setStorageReady(true);
      const savedLesson = getActiveLesson();
      if (
        savedLesson &&
        savedLesson.id &&
        savedLesson.status !== 'completed' &&
        Array.isArray(savedLesson.sections)
      ) {
        setRecoveryLesson(savedLesson);
      }
    });
    return () => { mounted = false; };
  }, []);

  function resumeSavedLesson() {
    if (!recoveryLesson) return;

    const savedLesson = recoveryLesson;
    const savedTopic = savedLesson.topic || savedLesson.title || '';
    const savedMode = savedLesson.learningMode || 'Topic';

    setRecoveryLesson(null);
    setIsClassroomOpen(true);
    setIsPreparingLesson(false);
    setLessonContent('');

    startLesson(savedTopic, savedMode, savedLesson);
  }

  function startFreshAfterRecovery() {
    clearActiveLesson();
    setRecoveryLesson(null);
  }

  function discardSavedLesson() {
    if (!recoveryLesson) return;

    clearActiveLesson();
    setRecoveryLesson(null);
  }

  function openSavedLesson(board) {
    if (!board) return;
    const restoredBoard = board.status === "completed"
      ? board
      : {
          ...board,
          status: "paused",
          transcript: "Saved lesson opened. Press Play to continue."
        };
    saveLesson(restoredBoard);
    saveActiveLesson(restoredBoard);
    lessonAbortRef.current?.abort('open-saved-lesson');
    setRecoveryLesson(null);
    setLessonTopic(board.topic || board.title || 'Saved lesson');
    setLessonTitle(board.title || board.topic || 'Saved lesson');
    setLessonSubject(board.subject || '');
    setLessonSections(Array.isArray(board.sections) ? board.sections : []);
    setLessonConversation(Array.isArray(board.conversation) ? board.conversation : []);
    setLessonContent(board.content || '');
    const savedDraft = board.liveDraft || null;
    liveDraftRef.current = savedDraft;
    setLiveSectionHeading(savedDraft?.heading || '');
    setLiveSectionContent(savedDraft?.content || '');
    setLessonTranscript(board.status === 'completed' ? 'This lesson is complete.' : 'Saved lesson opened.');
    setIsLessonLoading(false);
    setIsPreparingLesson(false);
    setIsClassroomOpen(true);
  }

  async function handleDashboardStart({ mode, topic, files = [], link = '', language = 'EN', teachingStyle = 'Normal' }) {
    const resourceNotes = [];
    if (link) resourceNotes.push(`Learner-supplied reference link (not fetched by HILLION): ${link}. Treat it as a lead only; do not quote or cite its contents unless the learner supplies the relevant text separately.`);
    for (const file of files) {
      const textLikeFile = file.type.startsWith('text/') ||
        /\.(txt|md|markdown|csv|json|html|htm|xml)$/i.test(file.name);
      if (textLikeFile && file.size <= 2 * 1024 * 1024) {
        try {
          let text = await file.text();
          if (/\.(html?|xml)$/i.test(file.name) || /html|xml/i.test(file.type)) {
            text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;|&#160;/gi, ' ')
              .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
          }
          resourceNotes.push('Uploaded source (' + file.name + '; ' + file.size + ' bytes):\n' + text.slice(0, 12000));
        } catch {
          resourceNotes.push('Uploaded file: ' + file.name + '. Its contents could not be read by this browser.');
        }
      } else {
        const reason = file.size > 2 * 1024 * 1024
          ? 'The file exceeds the 2 MB text-import limit.'
          : 'This file format is not yet extractable in this version.';
        resourceNotes.push('Uploaded file: ' + file.name + ' (' + (file.type || 'unknown type') + '). ' + reason);
      }
    }
    if (mode === 'Research Centre') {
      setIsClassroomOpen(true);
      setIsLessonLoading(true);
      setLessonTranscript('Searching public reference indexes. HILLION will distinguish retrieved summaries from unverified claims...');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const clean = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\s+/g, ' ').trim();
      const researchRecords = [];
      try {
        const requests = await Promise.allSettled([
          (async () => {
            const params = new URLSearchParams({
              action: 'query', list: 'search', srsearch: topic.split('\\n')[0].slice(0, 180),
              srlimit: '4', format: 'json', origin: '*'
            });
            const searchResponse = await fetch('https://en.wikipedia.org/w/api.php?' + params, { signal: controller.signal });
            if (!searchResponse.ok) throw new Error('Reference index unavailable');
            const searchData = await searchResponse.json();
            const titles = (searchData.query?.search || []).map(item => item.title).filter(Boolean).slice(0, 4);
            if (!titles.length) return [];
            const detailParams = new URLSearchParams({
              action: 'query', prop: 'extracts|info', exintro: '1', explaintext: '1',
              inprop: 'url', titles: titles.join('|'), format: 'json', formatversion: '2', origin: '*'
            });
            const detailResponse = await fetch('https://en.wikipedia.org/w/api.php?' + detailParams, { signal: controller.signal });
            if (!detailResponse.ok) throw new Error('Reference summaries unavailable');
            const detailData = await detailResponse.json();
            return (detailData.query?.pages || []).filter(page => page.extract).map(page => ({
              kind: 'encyclopedia summary', title: page.title, url: page.fullurl || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(page.title.replace(/ /g, '_'))),
              text: clean(page.extract).slice(0, 1800)
            }));
          })(),
          (async () => {
            const params = new URLSearchParams({
              'query.bibliographic': topic.split('\\n')[0].slice(0, 180),
              rows: '4', select: 'DOI,title,author,published,container-title,URL,type'
            });
            const response = await fetch('https://api.crossref.org/works?' + params, { signal: controller.signal });
            if (!response.ok) throw new Error('Academic index unavailable');
            const data = await response.json();
            return (data.message?.items || []).map(item => ({
              kind: 'academic publication metadata (not full text)',
              title: clean(item.title?.[0] || 'Untitled publication'),
              url: item.URL || (item.DOI ? 'https://doi.org/' + item.DOI : ''),
              text: [
                'Authors: ' + (item.author || []).slice(0, 5).map(person => [person.given, person.family].filter(Boolean).join(' ')).join(', '),
                'Published: ' + (item.published?.['date-parts']?.[0]?.join('-') || 'date not supplied'),
                'Journal/publisher: ' + (item['container-title']?.[0] || 'not supplied'),
                'DOI: ' + (item.DOI || 'not supplied')
              ].join('; ')
            })).filter(item => item.title && item.url);
          })()
        ]);
        for (const result of requests) {
          if (result.status === 'fulfilled') researchRecords.push(...result.value);
        }
      } catch (error) {
        console.warn('[HILLION RESEARCH] Public source lookup did not complete:', error?.message || error);
      } finally {
        clearTimeout(timeout);
      }
      const uniqueRecords = researchRecords.filter((record, index, all) =>
        record.url && all.findIndex(other => other.url === record.url) === index
      ).slice(0, 7);
      if (uniqueRecords.length) {
        resourceNotes.push(
          'PUBLIC RESEARCH SOURCES RETRIEVED BY HILLION (retrieval date: ' + new Date().toISOString().slice(0, 10) + '):\\n' +
          uniqueRecords.map((record, index) =>
            (index + 1) + '. [' + record.kind + '] ' + record.title + '\\nURL: ' + record.url + '\\n' + record.text
          ).join('\\n\\n')
        );
      } else {
        resourceNotes.push('LIVE RESEARCH LOOKUP: No public sources could be retrieved during this session. Continue using supplied materials and established knowledge, clearly label claims needing verification, and do not invent citations.');
      }
    }
    const languageName = ({ EN: 'English', FR: 'French', ES: 'Spanish' })[language] || 'English';
    const enrichedTopic = [topic, `Please teach in ${languageName}.`, ...resourceNotes].join('\n\n');
    setLessonTopic(topic);
    setLessonContent('');
    setIsPreparingLesson(false);
    setIsClassroomOpen(true);
    startLesson(enrichedTopic, mode, null, teachingStyle);
  }

  function getPosition(event) {
    const svg = svgRef.current
    const point = svg.createSVGPoint()

    point.x = event.clientX
    point.y = event.clientY

    return point.matrixTransform(svg.getScreenCTM().inverse())
  }
  function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (dx === 0 && dy === 0) {
    return Math.hypot(
      point.x - start.x,
      point.y - start.y
    )
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx +
        (point.y - start.y) * dy) /
        (dx * dx + dy * dy)
    )
  )

  const nearestX = start.x + t * dx
  const nearestY = start.y + t * dy

  return Math.hypot(
    point.x - nearestX,
    point.y - nearestY
  )
  }
function eraseAt(event) {
  const point = getPosition(event)

  const element = document.elementFromPoint(
    event.clientX,
    event.clientY
  )

  const drawingElement = element?.closest(
    '[data-drawing-index]'
  )

  if (!drawingElement) return

  const index = Number(
    drawingElement.getAttribute('data-drawing-index')
  )

  if (!Number.isInteger(index)) return

  setDrawings(previous => {
    const target = previous[index]

    if (!target) return previous

    // Remove complete objects such as text and shapes.
    if (target.type !== 'pen') {
      return previous.filter((_, i) => i !== index)
    }

    // Split handwriting around the erased area.
    const fragments = []
    let current = []

    const radius = eraserSize
    const points = target.points

    for (let i = 1; i < points.length; i++) {
      const distance = pointToSegmentDistance(
        point,
        points[i - 1],
        points[i]
      )

      if (distance <= radius) {
        if (current.length >= 2) {
          fragments.push({
            ...target,
            points: current
          })
        }

        current = []
      } else {
        if (current.length === 0) {
          current.push(points[i - 1])
        }

        current.push(points[i])
      }
    }

    if (current.length >= 2) {
      fragments.push({
        ...target,
        points: current
      })
    }

    return [
      ...previous.slice(0, index),
      ...fragments,
      ...previous.slice(index + 1)
    ]
  })

  setRedoDrawings([])
}
  function startDrawing(event) {
  event.preventDefault()

  if (tool === 'pan') {
    svgRef.current.setPointerCapture(event.pointerId)

    panStart.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: boardContentRef.current.scrollLeft,
      scrollTop: boardContentRef.current.scrollTop
    }

    return
  }

  const point = getPosition(event)
if (tool === 'eraser') {
  svgRef.current.setPointerCapture(event.pointerId)
  eraseAt(event)
  return
}
  if (tool === 'text') {
    const text = window.prompt('What would you like to write on the whiteboard?')

    if (text && text.trim()) {
  setDrawings(previous => [
    ...previous,
    {
      type: 'text',
      start: { x: point.x, y: point.y },
      text: text.trim(),
      color: drawingColor,
      size: textSize
    }
  ])
}

setTool('pen')
return
  }

  svgRef.current.setPointerCapture(event.pointerId)

  const drawing = {
  type: tool,
  start: point,
  end: point,
  points: [point],
  color: drawingColor,
  strokeWidth: penSize
  }

  currentDrawing.current = drawing
  setPreview(drawing)
  }

  function continueDrawing(event) {
  if (tool === 'pan' && panStart.current) {
    event.preventDefault()

    const dx = event.clientX - panStart.current.x
    const dy = event.clientY - panStart.current.y

    boardContentRef.current.scrollLeft =
      panStart.current.scrollLeft - dx

    boardContentRef.current.scrollTop =
      panStart.current.scrollTop - dy

    return
  }

  if (tool === 'eraser') {
    event.preventDefault()
    eraseAt(event)
    return
      }
    if (!currentDrawing.current) return

    event.preventDefault()
    const point = getPosition(event)
    const drawing = { ...currentDrawing.current }
    if (drawing.type === 'pen') {
      drawing.points = [...drawing.points, point]
    } else {
      drawing.end = point
    }

    currentDrawing.current = drawing
    setPreview(drawing)
  }

  function finishDrawing() {
  if (tool === 'pan') {
    panStart.current = null
    return
  }

  if (!currentDrawing.current) return

  const completedDrawing = currentDrawing.current

  setDrawings(previous => [...previous, completedDrawing])

  currentDrawing.current = null
  setPreview(null)
  }
function zoomIn() {
  setZoomLevel(previous => Math.min(previous + 10, 200))
}
  function zoomOut() {
  setZoomLevel(previous => Math.max(previous - 10, 50))
  }
  function resetZoom() {
  setZoomLevel(100)
  }
  function undoDrawing() {
  if (drawings.length === 0) return

  const lastDrawing = drawings[drawings.length - 1]

  setRedoDrawings(previous => [...previous, lastDrawing])

  setDrawings(previous => previous.slice(0, -1))
  }
  function redoDrawing() {
  if (redoDrawings.length === 0) return

  const lastDrawing = redoDrawings[redoDrawings.length - 1]

  setDrawings(previous => [...previous, lastDrawing])

  setRedoDrawings(previous => previous.slice(0, -1))
  }

  function clearBoard() {
    setDrawings([])
    setPreview(null)
    currentDrawing.current = null
  }

  function renderDrawing(drawing, index) {
    if (!drawing) return null
    if (drawing.type === 'diagram') {
      const nodes = Array.isArray(drawing.nodes) ? drawing.nodes : []
      const connections = Array.isArray(drawing.connections)
        ? drawing.connections
        : []

      const nodeMap = new Map(nodes.map(node => [node.id, node]))

      return (
        <g key={index} data-drawing-index={index}>
          <defs>
            {connections.map((connection, connectionIndex) => (
              <marker
                key={connectionIndex}
                id={`diagram-arrow-${index}-${connectionIndex}`}
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L7,3 z" fill={connection.color || '#64748b'} />
              </marker>
            ))}
          </defs>

          {connections.map((connection, connectionIndex) => {
            const from = nodeMap.get(connection.from)
            const to = nodeMap.get(connection.to)

            if (!from || !to) return null

            const fromX = from.x + (from.width || 120) / 2
            const fromY = from.y + (from.height || 65) / 2
            const toX = to.x + (to.width || 120) / 2
            const toY = to.y + (to.height || 65) / 2

            return (
              <line
                key={connectionIndex}
                x1={fromX}
                y1={fromY}
                x2={toX}
                y2={toY}
                stroke={connection.color || '#64748b'}
                strokeWidth="3"
                markerEnd={`url(#diagram-arrow-${index}-${connectionIndex})`}
              />
            )
          })}

          {nodes.map((node, nodeIndex) => {
            const width = node.width || 120
            const height = node.height || 65
            const fill = node.fill || '#fff8df'
            const stroke = node.stroke || '#b58b32'

            return (
              <g key={node.id || nodeIndex}>
                {node.shape === 'circle' ? (
                  <circle
                    cx={node.x + width / 2}
                    cy={node.y + height / 2}
                    r={Math.min(width, height) / 2}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth="3"
                  />
                ) : (
                  <rect
                    x={node.x}
                    y={node.y}
                    width={width}
                    height={height}
                    rx="10"
                    fill={fill}
                    stroke={stroke}
                    strokeWidth="3"
                  />
                )}

                <text
                  x={node.x + width / 2}
                  y={node.y + height / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#202020"
                  fontSize="17"
                  fontWeight="bold"
                >
                  {node.label || ''}
                </text>

                {node.detail && (
                  <text
                    x={node.x + width / 2}
                    y={node.y + height / 2 + 20}
                    textAnchor="middle"
                    fill="#444444"
                    fontSize="12"
                  >
                    {node.detail}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      )
    }

    if (drawing.type === 'eraser') {
  const points = drawing.points
    .map(point => `${point.x},${point.y}`)
    .join(' ')

  return (
    <polyline
      key={index}
            points={points}
      stroke="#ffffff"
      strokeWidth="36"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
    }
if (drawing.type === 'text') {
  return (
    <text
      key={index}
      data-drawing-index={index}
      x={drawing.start.x}
      y={drawing.start.y}
      fill={drawing.color || '#e5c98e'}
fontSize={drawing.size || 22}
      fontWeight="bold"
    >
      {drawing.text}
    </text>
  )
}
    const common = {
      key: index,
      'data-drawing-index': index,
      stroke: drawing.color || '#e5c98e',
      strokeWidth: drawing.strokeWidth || 4,
      fill: 'none',
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    }

    if (drawing.type === 'pen') {
      const points = drawing.points
        .map(point => `${point.x},${point.y}`)
        .join(' ')

      return <polyline {...common} points={points} />
    }

    if (drawing.type === 'line') {
      return (
        <line
          {...common}
          x1={drawing.start.x}
          y1={drawing.start.y}
          x2={drawing.end.x}
          y2={drawing.end.y}
        />
      )
    }

    if (drawing.type === 'rectangle') {
      return (
        <rect
          {...common}
          x={Math.min(drawing.start.x, drawing.end.x)}
          y={Math.min(drawing.start.y, drawing.end.y)}
          width={Math.abs(drawing.end.x - drawing.start.x)}
         height={Math.abs(drawing.end.y - drawing.start.y)}
        />
      )
    }
if (drawing.type === 'circle') {
  const dx = drawing.end.x - drawing.start.x
  const dy = drawing.end.y - drawing.start.y
  const radius = Math.sqrt(dx * dx + dy * dy)

  return (
    <circle
      {...common}
      cx={drawing.start.x}
      cy={drawing.start.y}
      r={radius}
    />
  )
}
    if (drawing.type === 'arrow') {
  const angle = Math.atan2(
    drawing.end.y - drawing.start.y,
    drawing.end.x - drawing.start.x
  )

  const size = 20

  const leftX = drawing.end.x - size * Math.cos(angle - Math.PI / 6)
  const leftY = drawing.end.y - size * Math.sin(angle - Math.PI / 6)

  const rightX = drawing.end.x - size * Math.cos(angle + Math.PI / 6)
  const rightY = drawing.end.y - size * Math.sin(angle + Math.PI / 6)

  return (
    <g key={index} data-drawing-index={index} stroke={drawing.color || '#e5c98e'} strokeWidth="4" fill="none" strokeLinecap="round">
      <line
        x1={drawing.start.x}
        y1={drawing.start.y}
        x2={drawing.end.x}
        y2={drawing.end.y}
      />
      <line
        x1={drawing.end.x}
        y1={drawing.end.y}
        x2={leftX}
        y2={leftY}
      />
      <line
        x1={drawing.end.x}
        y1={drawing.end.y}
        x2={rightX}
        y2={rightY}
      />
    </g>
  )
    }
    return null
  }

  async function sendMessage(event) {
  event.preventDefault()

  if (!message.trim() || isLoading) return

  const userMessage = message.trim()

  const wantsDiagram = /\b(diagram|draw|illustrate|illustration|flowchart|sketch|whiteboard)\b/i.test(userMessage)

  const updatedMessages = [
    ...messages,
    { role: 'user', content: userMessage }
  ]

  setMessages(updatedMessages)
  setMessage('')
  setIsLoading(true)

  try {
    const response = await requestAI({
        model: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
        messages: [
          {
            role: 'system',
            content: `You are HILLION, an intelligent, friendly academic tutor and natural conversational companion.

CONVERSATIONAL INTELLIGENCE:
- Understand ordinary human conversation, not just academic questions.
- Respond naturally and warmly to greetings, thanks, compliments, apologies, acknowledgements and casual conversation.
- When the learner says "thank you", respond appropriately, such as "You're very welcome! I'm glad I could help."
- When complimented, acknowledge it politely without sounding boastful.
- Recognise when the learner is confused, tired, frustrated, joking, taking a break or ending a conversation.
- Understand requests to pause, stop, continue or change subjects.
- Do not force academic explanations into ordinary social conversations.
- Keep simple social responses brief, natural and appropriate to the context.
- Maintain conversational context and remember what the learner was discussing.
- Never treat every message as a request for a new lesson.

PATIENT LEARNER INTERACTION:
- Respond calmly, patiently and respectfully when the learner says they do not know or are unsure.
- Recognise expressions such as "I don't know", "I'm not sure", "I forgot", "help me out", "give me a hint" and "show me how".
- Never shame, ridicule, pressure or make the learner feel unintelligent.
- When the learner does not know an answer, offer to work through it together.
- When the learner is unsure, encourage them to share their thinking without pressure.
- When asked for a hint, give a useful clue before revealing the complete answer.
- When asked for help, break the problem into manageable steps.
- When the learner makes a mistake, acknowledge their effort and explain the correction gently.
- When an explanation is still unclear, try a different approach, simpler language or another example.
- Adapt encouragement to the situation; avoid repetitive or exaggerated praise.
- Check whether the learner understands before moving forward when appropriate.

ACADEMIC TEACHING:


Your knowledge covers school, university and professional subjects, including Biology, Anatomy, Physiology, Microbiology, Chemistry, Organic Chemistry, Physics, Mathematics, Medicine, Engineering and many other fields.

The current subject is ${subject}, but you must also understand questions from other academic disciplines.

Teach like an excellent university lecturer:
- Explain concepts accurately and step by step.
- Use simple examples and practical applications.
- Break complicated topics into smaller sections.
- Identify important definitions, keywords, formulas and principles.
- Explain diagrams, structures and processes clearly.
- For chemistry, explain molecular and structural formulas.
- For biology and medicine, explain anatomical structures and their functions.
- For physics and mathematics, show equations and calculations step by step.

When teaching, prioritize clear visual explanations that can be transferred onto a digital whiteboard.

Never invent scientific facts. If uncertain, say so.

${wantsDiagram ? `
DIAGRAM OUTPUT:
The learner explicitly requested a visual diagram.
After your brief explanation, append:
[[HILLION_DIAGRAM]]
Then output one valid JSON object with "nodes" and "connections" arrays.
Each node must have: id, x, y, width, height, shape, label, detail.
Use coordinates within a 1000 by 1500 whiteboard.
Use 2 to 6 nodes, arranged clearly from top to bottom or left to right.
Use shape "rect" or "circle".
Each connection must have: from, to, color.
Connection IDs must match node IDs exactly.
Use scientifically accurate labels and relationships.
Do not put the JSON in Markdown code fences.
End the JSON block with:
[[/HILLION_DIAGRAM]]
Do not invent structures or relationships.
` : ''}`
          },
          ...updatedMessages
        ],
        temperature: 0.7,
        max_tokens: wantsDiagram ? 900 : 200
      })

    if (!response.ok) {
      throw new Error('The AI server returned an error.')
    }

    const data = await response.json()
    const rawAiReply = data.choices[0].message.content || ''
    let aiReply = rawAiReply
    let generatedDiagram = null

    const diagramMatch = rawAiReply.match(
      /\[\[HILLION_DIAGRAM\]\]([\s\S]*?)\[\[\/HILLION_DIAGRAM\]\]/
    )

    if (diagramMatch) {
      aiReply = rawAiReply.replace(diagramMatch[0], '').trim()

      try {
        const parsed = JSON.parse(diagramMatch[1].trim())

        if (
          Array.isArray(parsed.nodes) &&
          Array.isArray(parsed.connections) &&
          parsed.nodes.length >= 2 &&
          parsed.nodes.length <= 6
        ) {
          const safeNumber = (value, fallback, min, max) => {
            const number = Number(value)
            return Number.isFinite(number)
              ? Math.max(min, Math.min(max, number))
              : fallback
          }

          const safeColor = (value, fallback) =>
            typeof value === 'string' &&
            /^#[0-9a-fA-F]{6}$/.test(value)
              ? value
              : fallback

          const validNodes = parsed.nodes.map((node, index) => ({
            id: String(node.id || `node-${index}`),
            x: safeNumber(node.x, 80 + (index % 2) * 420, 10, 850),
            y: safeNumber(node.y, 120 + index * 160, 10, 1400),
            width: safeNumber(node.width, 160, 90, 220),
            height: safeNumber(node.height, 75, 55, 120),
            shape: node.shape === 'circle' ? 'circle' : 'rect',
            label: String(node.label || 'Concept').slice(0, 55),
            detail: String(node.detail || '').slice(0, 70),
            fill: safeColor(node.fill, '#fff8df'),
            stroke: safeColor(node.stroke, '#b58b32')
          }))

          const validIds = new Set(validNodes.map(node => node.id))

          const validConnections = parsed.connections
            .slice(0, 12)
            .filter(connection =>
              validIds.has(String(connection.from)) &&
              validIds.has(String(connection.to))
            )
            .map(connection => ({
              from: String(connection.from),
              to: String(connection.to),
              color: safeColor(connection.color, '#64748b')
            }))

          generatedDiagram = {
            type: 'diagram',
            nodes: validNodes,
            connections: validConnections
          }
        }
      } catch (diagramError) {
        console.warn('Hillion could not parse the generated diagram:', diagramError)
      }
    }

    if (generatedDiagram) {
      setDrawings(previous => [...previous, generatedDiagram])
      setRedoDrawings([])
    }

    setMessages(previous => [
      ...previous,
      { role: 'assistant', content: aiReply }
    ])

  } catch {
    setMessages(previous => [
      ...previous,
      {
        role: 'assistant',
        content: 'I could not connect to my AI brain. Please check that the local AI server is running.'
      }
    ])
  } finally {
    setIsLoading(false)
  }
  }

  function persistLiveDraft(status = 'in-progress') {
    const draft = liveDraftRef.current;
    if (!draft || !draft.content) return false;

    const activeLesson = getActiveLesson();
    if (!activeLesson?.id) return false;

    const updatedLesson = {
      ...activeLesson,
      liveDraft: draft,
      status,
      updatedAt: new Date().toISOString()
    };

    saveLesson(updatedLesson);
    saveActiveLesson(updatedLesson);
    return true;
  }

  function flushLiveSectionContent() {
    if (liveSectionUiTimerRef.current) {
      clearTimeout(liveSectionUiTimerRef.current);
      liveSectionUiTimerRef.current = null;
    }
    if (liveDraftRef.current) {
      setLiveSectionContent(liveDraftRef.current.content || '');
    }
  }

  function interruptLesson() {
    console.warn('[HILLION DIAGNOSTIC] interruptLesson() called:', {
      time: new Date().toISOString(),
      stack: new Error().stack
    });

    if (liveDraftSaveTimerRef.current) {
      clearTimeout(liveDraftSaveTimerRef.current);
      liveDraftSaveTimerRef.current = null;
    }

    flushLiveSectionContent();
    persistLiveDraft('paused');

    const activeLesson = getActiveLesson();

    if (activeLesson) {
      const interruptedLesson = {
        ...activeLesson,
        sections: lessonSections,
        liveDraft: liveDraftRef.current || activeLesson.liveDraft || null,
        conversation: lessonConversation,
        transcript: 'Hillion has paused the lesson. You can resume when ready.',
        status: 'paused',
        updatedAt: new Date().toISOString()
      };

      saveLesson(interruptedLesson);
      saveActiveLesson(interruptedLesson);
    }

    if (lessonAbortRef.current) {
      lessonAbortRef.current.abort('interruptLesson-called')
      setLessonTranscript('Hillion has paused the lesson. You can ask a question or continue when ready.')
    }
  }

  function resumeCurrentLesson() {
    const savedLesson = getActiveLesson();

    if (!savedLesson || savedLesson.status !== 'paused') return;
    if (isLessonLoading) return;

    const savedTopic = savedLesson.topic || savedLesson.title || lessonTopic;
    const savedMode = savedLesson.learningMode || 'Topic';

    startLesson(savedTopic, savedMode, savedLesson);
  }

  function mergeLessonContinuation(savedText, newText, sectionHeading) {
    const saved = String(savedText || '').trimEnd();
    let incoming = String(newText || '').trimStart();

    if (!incoming) return saved;
    if (!saved) return incoming;

    if (sectionHeading) {
      const lines = incoming.split(/\r?\n/);
      const cleanHeading = lines[0].trim()
        .replace(/^\\?#{1,6}\s*/, '')
        .replace(/\s+#+\s*$/, '')
        .trim();

      if (cleanHeading.toLowerCase() === sectionHeading.trim().toLowerCase()) {
        incoming = lines.slice(1).join('\n').trimStart();
      }
    }

    if (!incoming) return saved;

    const normalize = value => value.toLowerCase().replace(/\s+/g, ' ').trim();
    const a = normalize(saved);
    const b = normalize(incoming);

    let overlap = 0;

    for (let size = Math.min(a.length, b.length); size >= 30; size--) {
      if (a.slice(-size) === b.slice(0, size)) {
        overlap = size;
        break;
      }
    }

    if (overlap) {
      let count = 0;
      let cut = 0;

      while (cut < incoming.length && count < overlap) {
        if (/\s/.test(incoming[cut])) {
          if (count > 0 && !/\s/.test(incoming[cut - 1])) count++;
        } else {
          count++;
        }
        cut++;
      }

      incoming = incoming.slice(cut).trimStart();
    }

    if (!incoming) return saved;

    const savedWord = saved.match(/([A-Za-z0-9]+)$/)?.[1] || '';
    const incomingWord = incoming.match(/^([A-Za-z0-9]+)/)?.[1] || '';

    if (
      !overlap &&
      savedWord.length >= 2 &&
      incomingWord.length > savedWord.length &&
      incomingWord.toLowerCase().startsWith(savedWord.toLowerCase())
    ) {
      return saved + incoming.slice(savedWord.length);
    }

    if (/^[,.;:!?)}\]]/.test(incoming)) return saved + incoming;
    if (/^[\r\n]/.test(incoming)) return saved + incoming;

    if (/^(#{1,6}\s+|[-*+•]\s+|\d+[.)]\s+)/.test(incoming)) {
      return saved + '\n\n' + incoming;
    }

    return saved + ' ' + incoming;
  }
  async function startLesson(topic = lessonTopic, learningMode = 'Topic', resumeData = null, requestedTeachingStyle = 'Normal') {
    if (!topic.trim()) return;

    const teachingStyle = resumeData?.teachingStyle || requestedTeachingStyle || 'Normal';

    const isResuming = Boolean(resumeData?.id);
    const lessonId = isResuming
      ? resumeData.id
      : 'lesson-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    const lessonStartedAt = isResuming
      ? (resumeData.createdAt || new Date().toISOString())
      : new Date().toISOString();

    const storedSections = isResuming && Array.isArray(resumeData.sections)
      ? resumeData.sections
          .filter(section => section !== null && section !== undefined)
          .map((section, index) => {
            if (typeof section === 'string') {
              return {
                heading: 'Section ' + (index + 1),
                content: section,
                type: 'explanation'
              };
            }

            return {
              ...section,
              heading: typeof section.heading === 'string' ? section.heading : '',
              content: typeof section.content === 'string' ? section.content : '',
              type: typeof section.type === 'string' ? section.type : 'explanation'
            };
          })
      : [];

    const lastStoredSection = storedSections[storedSections.length - 1];
    const lastStoredText = String(lastStoredSection?.content || '').trim();

    const legacyIncomplete = !resumeData?.liveDraft &&
      Boolean(lastStoredSection) &&
      /\b(?:of|in|on|to|for|with|and|or|the|a|an|is|are|was|were|by|from|into)$/i.test(lastStoredText);

    const initialSections = legacyIncomplete
      ? storedSections.slice(0, -1)
      : storedSections;

    const savedLiveDraft = isResuming
      ? (resumeData.liveDraft || (legacyIncomplete ? {
          sectionIndex: storedSections.length - 1,
          heading: lastStoredSection.heading || '',
          content: lastStoredText
        } : null))
      : null;

    const initialConversation = isResuming
      ? (resumeData.conversation || [{ role: 'user', content: topic.split("\n")[0].trim() }])
      : [{ role: 'user', content: topic.split("\n")[0].trim() }];

    const savedPlan = isResuming && Array.isArray(resumeData.plannedSections)
      ? resumeData.plannedSections
      : null;

    const initialLessonData = {
      ...(resumeData || {}),
      id: lessonId,
      title: topic.split('\n')[0],
      topic,
      subject: resumeData?.subject || '',
      learningMode,
      teachingStyle,
      sections: initialSections,
      conversation: initialConversation,
      transcript: 'Hillion is preparing your lesson...',
      progress: resumeData?.progress || 0,
      status: 'in-progress',
      createdAt: lessonStartedAt,
      updatedAt: new Date().toISOString()
    };

    saveActiveLesson(initialLessonData);
    if (isResuming) saveLesson(initialLessonData);

    console.warn('[HILLION DIAGNOSTIC] startLesson() called:', {
      time: new Date().toISOString(),
      topic,
      isResuming,
      lessonId,
      completedSections: initialSections.length,
      previousLessonActive: Boolean(lessonAbortRef.current),
      stack: new Error().stack
    });

    lessonAbortRef.current?.abort('superseded-by-new-lesson');
    const controller = new AbortController();
    lessonAbortRef.current = controller;

    setIsLessonLoading(true);
    setLessonTranscript('Hillion is preparing your lesson...');
    setLessonContent('');
    setLessonSections(initialSections);
    setLessonConversation(initialConversation);
    setLessonTitle(topic.split('\n')[0]);
    setLessonSubject(resumeData?.subject || '');
    setLessonDiagram(resumeData?.diagram || null);
    const generate = async (messages, maxTokens, onChunk, requireComplete = false, continuationDepth = 0) => {
      const requestController = new AbortController();
      const timeoutState = { timedOut: false };
      const replyState = { text: '' };

      const abortFromLesson = () => {
        console.warn('[HILLION DIAGNOSTIC] Request aborted by lesson controller:', {
          time: new Date().toISOString(),
          reason: controller.signal.reason
        });
        requestController.abort(controller.signal.reason || 'lesson-controller-aborted');
      };

      if (controller.signal.aborted) {
        throw new DOMException("Lesson interrupted", "AbortError");
      }

      controller.signal.addEventListener("abort", abortFromLesson, { once: true });

      const timeoutId = setTimeout(() => {
        timeoutState.timedOut = true;
        console.warn('[HILLION DIAGNOSTIC] AI request timeout fired:', {
          time: new Date().toISOString(),
          timeoutMilliseconds: 1800000
        });
        requestController.abort('request-timeout');
      }, 1800000);

      try {
        const response = await requestAI({
            model: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
            messages,
            temperature: 0.3,
            repeat_penalty: 1.15,
            repeat_last_n: 256,
            frequency_penalty: 0.2,
            max_tokens: maxTokens,
            stream: true
          }, { signal: requestController.signal });

        if (!response.ok) {
          throw new Error("The AI server returned an error.");
        }

        if (!response.body) {
          throw new Error("The AI server did not provide a readable streaming response.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const finishState = { reason: null };

        const processLine = (line) => {
          const trimmed = line.trim();

          if (!trimmed.startsWith('data:')) return;

          const payload = trimmed.slice(5).trim();

          if (!payload || payload === '[DONE]') return;

          let event;

          try {
            event = JSON.parse(payload);
          } catch {
            return;
          }

          const choice = event.choices?.[0];
          if (choice?.finish_reason) finishState.reason = choice.finish_reason;
          const piece = choice?.delta?.content;

          if (typeof piece === 'string' && piece.length > 0) {
            replyState.text += piece;

            if (typeof onChunk === 'function') {
              onChunk(piece);
            }
          }
        };

        while (true) {
          const { value, done } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            processLine(line);
          }
        }

        buffer += decoder.decode();

        if (buffer.trim()) {
          processLine(buffer);
        }

        if (!replyState.text.trim()) {
          throw new Error("The AI returned an empty response.");
        }

        if (requireComplete && finishState.reason === 'length') {
          if (continuationDepth >= 3) {
            throw new Error(
              'Hillion reached its automatic continuation limit. Your saved draft is safe. Press Play to continue.'
            );
          }

          console.warn('[HILLION] Automatically continuing an incomplete section.');

          const continuation = await generate(
            [
              ...messages,
              { role: 'assistant', content: replyState.text },
              {
                role: 'user',
                content: 'Continue directly from your final words. Finish the incomplete sentence and continue the same explanation. Do not repeat any previous text or restart the section.'
              }
            ],
            maxTokens,
            onChunk,
            true,
            continuationDepth + 1
          );

          return replyState.text.trim() + continuation;
        }

        return replyState.text.trim();
      } catch (error) {
        // Preserve intentional pauses as pauses, not network failures.
        if (controller.signal.aborted) {
          throw new DOMException("Lesson interrupted", "AbortError");
        }

        if (timeoutState.timedOut) {
          throw new Error("The AI request exceeded its 30-minute safety limit. Your saved draft has been preserved. Please resume the lesson.");
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
        controller.signal.removeEventListener("abort", abortFromLesson);
      }
    };

    const parseJSON = (reply) => {
      const cleaned = String(reply || '')
        .replace(/^\x60\x60\x60json\s*/i, '')
        .replace(/^\x60\x60\x60\s*/, '')
        .replace(/\s*\x60\x60\x60$/, '')
        .trim();

      for (let start = 0; start < cleaned.length; start++) {
        if (cleaned[start] !== '{') continue;

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let index = start; index < cleaned.length; index++) {
          const character = cleaned[index];

          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (character === '\\') {
              escaped = true;
            } else if (character === '"') {
              inString = false;
            }
            continue;
          }

          if (character === '"') {
            inString = true;
          } else if (character === '{') {
            depth++;
          } else if (character === '}') {
            depth--;

            if (depth === 0) {
              const candidate = cleaned.slice(start, index + 1);

              try {
                return JSON.parse(candidate);
              } catch {
                break;
              }
            }
          }
        }
      }

      throw new Error(
        'The AI response did not contain a valid complete JSON object.'
      );
    };
    try {
      // Android checks the imported on-device model; browser preview keeps the HTTP health check.
      try {
        await checkAIAvailability({ signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw new DOMException('Lesson interrupted', 'AbortError');
        throw error;
      }

      let plan;

      if (savedPlan) {
        plan = {
          title: topic.split("\n")[0].trim(),
          subject: resumeData?.subject || '',
          sections: savedPlan
        };
        console.log('[HILLION RECOVERY] Reusing the original saved teaching plan.');
      } else {
        setLessonTranscript('Hillion is identifying the subject and organising the teaching sequence...');

        const outlineReply = await generate([
          {
            role: 'system',
            content: [
              'You are HILLION, an expert academic teacher.',
              'Identify the subject and create a logically ordered teaching outline.',
              ...(learningMode === 'Research Centre' ? [
                'RESEARCH CENTRE MODE: Treat the learner request as a structured research investigation, not a generic lesson.',
                'Organise the work around a precise research question, scope, key terms, background, evidence themes, methods or reasoning, limitations, and a balanced synthesis.',
                'Use only facts supported by reliable learned knowledge or source records explicitly supplied in the prompt. The app may attach a small number of retrieved public summaries and academic publication metadata; these are not full-paper access.',
                'Never claim to have opened a learner-supplied URL or read an uploaded file unless its actual contents are present in the prompt. Distinguish encyclopedia summaries from academic publication metadata; metadata is not evidence of a paper\u2019s findings.',
                'Never invent sources, authors, publication dates, page numbers, quotations, URLs, statistics, or citations. Clearly mark missing evidence and recommend what source needs checking.',
                'When using a retrieved encyclopedia extract, include a short source note with its exact supplied title and URL. Treat Crossref records only as leads for further reading, never as evidence of a study\u2019s results.',
                'Distinguish established findings from interpretation, uncertainty, and open questions.'
              ] : []),
              'Choose enough sections to cover the entire topic, not an arbitrary fixed number.',
              'For broad or multi-part topics, create as many logically distinct sections as necessary (often 8–14 or more); do not stop at five when important syllabus content remains.',
              'Include a final synthesis/revision section only after all substantive concepts have been taught.',
              'Progress from foundations to advanced understanding.',
              'Include essential concepts, terminology, processes and applications.',
              'Do not write lesson explanations.',
              'For each section, decide whether a visual would materially improve understanding. Do not force visuals into every section.',
              'When useful, add visualPlan as an array with at most one item per section. Use a subject-appropriate visual kind and describe only components and relationships you can state confidently.',
              'For a visualPlan item, also provide elements: an array of 3–50 simple SVG primitives on a 1000 by 1000 canvas. Allowed types: line, rect, circle, ellipse, text, polyline, polygon. Give numeric coordinates from 0 to 1000, short accurate text labels, and hex stroke/fill colours. Use line elements for connectors, not decorative arrows unless direction is scientifically meaningful. Keep labels readable and avoid unsupported anatomy, scale, or causal claims.',
              'Choose renderStyle per visual: isometric-3d for useful 3D/isometric views of molecules, cells, organs, landforms, machines, solids or apparatus; technical-illustration for engineering and apparatus; hand-drawn for classroom sketches; flat for maps, graphs and simple process diagrams. 3D views need consistent projection, visible front/top/side faces, coherent depth, occlusion and light/shadow facets. They are explanatory illustrations, not measured simulations.',
              'For 3D/isometric drawings, construct visible faces from coordinated polygons with shared vertices, consistent axes and coherent depth layers. Add callout lines and labels outside the object. Never invent hidden structures or dimensions.',
              'For graphs, label both axes and state whether the curve is schematic or quantitatively defined. For anatomy and apparatus, use only structures you can confidently position. If you cannot create a valid subject-specific diagram, omit elements and leave the visualPlan empty rather than inventing a generic drawing.',
              'Prefer subject-specific diagrams, labelled anatomy, molecular structures, isometric 3D illustrations, apparatus layouts, graphs, maps, timelines, geometry constructions, technical drawings or process illustrations as appropriate to the subject.',
              'For graphs, label both axes and state whether the curve is schematic or quantitatively defined. For anatomy and apparatus, use only structures you can confidently position. If you cannot create a valid subject-specific diagram, omit elements and leave the visualPlan empty rather than inventing a generic drawing.',
              'Prefer diagrams, labelled anatomy, molecular structures, apparatus layouts, graphs, maps, timelines, geometry constructions or process illustrations as appropriate to the subject.',
              'If an accurate specific diagram cannot be described confidently, leave visualPlan empty. Never invent labels, measurements, equations, causal arrows or scientific structures.',
              'Return ONLY valid JSON:',
              '{"title":"Lesson title","subject":"Subject","sections":[{"heading":"Section heading","goal":"Specific learning objective","type":"explanation","visualPlan":[{"kind":"appropriate_visual_type","renderStyle":"flat","title":"Specific visual title","purpose":"What the visual should help explain","description":"Accurate components and relationships to show","caption":"Short caption","elements":[{"type":"text","x":500,"y":100,"text":"Accurate label"},{"type":"line","x1":200,"y1":200,"x2":800,"y2":200,"stroke":"#263B32"},{"type":"rect","x":350,"y":300,"width":300,"height":180,"stroke":"#6F9B78","fill":"#DDEBDD"}]}]}',
              'Use accurate academic terminology. Keep visual descriptions concise and factually precise. Example element: {"type":"text","x":500,"y":100,"text":"Label"}.'
            ].join('\n')
          },
          {
            role: 'user',
            content: 'Learning mode: ' + learningMode + '. Topic: ' + topic
          }
        ], 1400);

        try {
          plan = parseJSON(outlineReply);

          if (!Array.isArray(plan.sections) || plan.sections.length === 0) {
            throw new Error('The outline contained no usable sections.');
          }
        } catch (outlineError) {
          if (controller.signal.aborted) {
            throw new DOMException('Lesson interrupted', 'AbortError');
          }

          console.warn('[HILLION RECOVERY] Using local recovery outline:', outlineError.message);

          const firstLine = topic.split('\n')[0].trim();
          const lowerTopic = topic.toLowerCase();

          let subject = 'General Studies';

          if (lowerTopic.includes('cell') || lowerTopic.includes('biology') ||
              lowerTopic.includes('photosynthesis') || lowerTopic.includes('anatomy')) {
            subject = 'Biology';
          } else if (lowerTopic.includes('chemistry') || lowerTopic.includes('molecule') ||
                     lowerTopic.includes('chemical')) {
            subject = 'Chemistry';
          } else if (lowerTopic.includes('physics') || lowerTopic.includes('force') ||
                     lowerTopic.includes('motion') || lowerTopic.includes('electricity')) {
            subject = 'Physics';
          } else if (lowerTopic.includes('mathematics') || lowerTopic.includes('algebra') ||
                     lowerTopic.includes('geometry')) {
            subject = 'Mathematics';
          }

          let fallbackSections;

          if (lowerTopic.includes('plant cell')) {
            fallbackSections = [
              ['Introduction to Cells and Plant Cells', 'Explain cells, cell theory and the organisation of plant cells.'],
              ['Cell Wall, Cell Membrane and Cytoplasm', 'Explain their structures, properties and functions.'],
              ['The Nucleus and Genetic Material', 'Explain the nucleus, DNA and control of cell activities.'],
              ['Cell Organelles and Their Functions', 'Explain the major organelles and their roles.'],
              ['Chloroplasts and Photosynthesis', 'Explain chloroplast structure, chlorophyll and photosynthesis.'],
              ['Vacuole, Turgor and Plant Cell Specialisation', 'Explain cell sap, turgor pressure and specialised plant cells.']
            ];
          } else {
            fallbackSections = [
              ['Foundations and Key Terminology', 'Introduce the topic and explain its essential terminology.'],
              ['Main Concepts and Components', 'Explain the important concepts, characteristics and components.'],
              ['Principles and Processes', 'Explain the underlying principles and how the processes work.'],
              ['Examples and Applications', 'Develop understanding through relevant examples and applications.'],
              ['Summary and Deeper Understanding', 'Connect the major ideas and reinforce understanding.']
            ];
          }

          plan = {
            title: firstLine,
            subject,
            sections: fallbackSections.map(([heading, goal]) => ({
              heading,
              goal,
              type: 'explanation',
              visualPlan: []
            }))
          };

          setLessonTranscript(
            'Hillion is using its recovery teaching plan and preparing your lesson...'
          );
        }
      }

      if (!Array.isArray(plan.sections) || plan.sections.length === 0) {
        throw new Error('Hillion could not create a valid lesson plan.');
      }

      const sections = plan.sections.map((section, index) => ({

        ...section,

        heading: String(section.heading || 'Section ' + (index + 1)),

        goal: String(section.goal || ''),

        visualPlan: Array.isArray(section.visualPlan)

          ? section.visualPlan

              .filter(visual =>

                visual &&

                typeof visual === 'object' &&

                typeof visual.title === 'string' &&

                typeof visual.description === 'string'

              )

              .map(visual => ({

                kind: String(visual.kind || 'educational_illustration').slice(0, 60),

                renderStyle: ['isometric-3d', 'technical-illustration', 'hand-drawn', 'flat'].includes(visual.renderStyle) ? visual.renderStyle : 'flat',

                title: visual.title.slice(0, 120),

                purpose: String(visual.purpose || '').slice(0, 500),

                description: visual.description.slice(0, 1500),

                caption: String(visual.caption || '').slice(0, 400),

                elements: Array.isArray(visual.elements) ? visual.elements.slice(0, 80) : []

              }))

          : []

      }));

      let diagramForLesson = resumeData?.diagram || null;
      const topicRequestsDiagram =
        /\b(?:diagram|draw|illustrat(?:e|ion)|flowchart|sketch|whiteboard)\b/i.test(topic);

            // Reusable topic-aware educational diagram library.
      // Common topics use instant templates; other requested diagrams use the AI fallback.
      const createDiagramTemplate = (kind, gossipMode) => {
        const layouts = {
          plantCell: {
            title: 'Structure of a Plant Cell',
            description: gossipMode
              ? 'A plant cell has specialised parts that work together to keep it alive.'
              : 'A plant cell contains membrane-bound organelles and a cellulose cell wall, each with specialised functions.',
            nodes: [
              ['wall', 'CELL WALL', 'Cellulose layer; support and protection', 'Strong outer layer that supports the cell'],
              ['membrane', 'CELL MEMBRANE', 'Selectively controls movement of substances', 'Controls what enters and leaves'],
              ['nucleus', 'NUCLEUS', 'Contains DNA; controls cell activities', 'Control centre containing genetic information'],
              ['cytoplasm', 'CYTOPLASM', 'Site of many metabolic reactions', 'Jelly-like interior where reactions occur'],
              ['chloroplast', 'CHLOROPLASTS', 'Contain chlorophyll for photosynthesis', 'Capture light energy using chlorophyll'],
              ['vacuole', 'LARGE VACUOLE', 'Cell sap; maintains turgor pressure', 'Stores cell sap and helps keep the cell firm'],
              ['mitochondria', 'MITOCHONDRIA', 'Aerobic respiration; ATP production', 'Release usable energy through respiration']
            ],
            edges: [['wall','membrane','surrounds'],['membrane','cytoplasm','encloses'],['nucleus','cytoplasm','within'],['chloroplast','cytoplasm','within'],['vacuole','cytoplasm','within'],['mitochondria','cytoplasm','within']]
          },
          animalCell: {
            title: 'Structure of an Animal Cell',
            description: 'An animal cell contains specialised organelles that perform essential functions.',
            nodes: [
              ['membrane','CELL MEMBRANE','Controls movement of substances','Controls what enters and leaves'],
              ['nucleus','NUCLEUS','Contains DNA and controls activities','Contains genetic instructions'],
              ['cytoplasm','CYTOPLASM','Site of many metabolic reactions','Where many cell reactions happen'],
              ['mitochondria','MITOCHONDRIA','Aerobic respiration and ATP production','Release usable energy'],
              ['ribosomes','RIBOSOMES','Sites of protein synthesis','Build proteins'],
              ['roughER','ROUGH ER','Processes and transports proteins','Helps process and move proteins'],
              ['golgi','GOLGI APPARATUS','Modifies and packages proteins','Packages materials for transport']
            ],
            edges: [['membrane','cytoplasm','encloses'],['nucleus','cytoplasm','within'],['mitochondria','cytoplasm','within'],['ribosomes','roughER','protein synthesis'],['roughER','golgi','transport']]
          },
          photosynthesis: {
            title: 'Photosynthesis in Green Plants',
            description: gossipMode
              ? 'Plants use light energy, water and carbon dioxide to make glucose and release oxygen.'
              : 'Chlorophyll absorbs light energy to convert carbon dioxide and water into glucose, releasing oxygen.',
            nodes: [
              ['sun','SUNLIGHT','Light energy absorbed by chlorophyll','Light energy captured by the leaf'],
              ['co2','CARBON DIOXIDE','Enters leaves through stomata','Enters through tiny leaf pores'],
              ['water','WATER','Absorbed by roots; transported in xylem','Roots absorb water and xylem carries it'],
              ['leaf','LEAF / CHLOROPLASTS','Chlorophyll absorbs light energy','Chlorophyll captures the sunlight'],
              ['glucose','GLUCOSE','Sugar used in respiration or stored','Sugar the plant can use or store'],
              ['oxygen','OXYGEN','Released through stomata','Oxygen leaves through the stomata']
            ],
            edges: [['sun','leaf','light energy'],['co2','leaf','carbon dioxide'],['water','leaf','water'],['leaf','glucose','produces'],['leaf','oxygen','releases']]
          },
          heart: {
            title: 'Human Heart and Blood Circulation',
            description: 'The heart pumps blood through the pulmonary and systemic circuits.',
            nodes: [
              ['body','BODY TISSUES','Deoxygenated blood returns via vena cava','Blood returns from the body'],
              ['ra','RIGHT ATRIUM','Receives deoxygenated blood','Receives blood returning to the heart'],
              ['rv','RIGHT VENTRICLE','Pumps blood to the lungs','Pumps blood towards the lungs'],
              ['lungs','LUNGS','Gas exchange adds oxygen to blood','Blood picks up oxygen in the lungs'],
              ['la','LEFT ATRIUM','Receives oxygenated blood','Receives oxygen-rich blood'],
              ['lv','LEFT VENTRICLE','Pumps blood through the aorta','Pumps blood around the body'],
              ['aorta','AORTA','Carries oxygenated blood to the body','Carries oxygen-rich blood to the body']
            ],
            edges: [['body','ra','vena cava'],['ra','rv','contracts'],['rv','lungs','pulmonary artery'],['lungs','la','pulmonary veins'],['la','lv','contracts'],['lv','aorta','pumps into'],['aorta','body','systemic circulation']]
          },
          neuron: {
            title: 'Structure of a Neuron',
            description: 'A neuron carries electrical impulses from one region of the nervous system to another.',
            nodes: [
              ['dendrites','DENDRITES','Receive signals from other cells','Receive incoming signals'],
              ['soma','CELL BODY','Contains nucleus and organelles','Contains the nucleus'],
              ['axon','AXON','Conducts impulses away from cell body','Carries the electrical impulse'],
              ['myelin','MYELIN SHEATH','Insulates axon and speeds transmission','Insulating layer that speeds signals'],
              ['nodes','NODES OF RANVIER','Gaps enabling saltatory conduction','Gaps that help impulses travel faster'],
              ['terminal','AXON TERMINALS','Release neurotransmitters','Send chemical messages onwards'],
              ['synapse','SYNAPSE','Junction between communicating cells','Tiny junction between cells']
            ],
            edges: [['dendrites','soma','receive'],['soma','axon','impulse travels'],['axon','myelin','insulated by'],['myelin','nodes','gaps between'],['axon','terminal','reaches'],['terminal','synapse','signals across']]
          },
          respiratory: {
            title: 'Human Respiratory System',
            description: 'Air travels through the airways to the alveoli, where gas exchange occurs.',
            nodes: [
              ['nose','NOSE / NASAL CAVITY','Filters, warms and moistens air','Prepares incoming air'],
              ['trachea','TRACHEA','Ciliated airway supported by cartilage','Air passes down the windpipe'],
              ['bronchi','BRONCHI','Carry air into each lung','Two main branches enter the lungs'],
              ['bronchioles','BRONCHIOLES','Smaller branches within the lungs','Smaller air passages'],
              ['alveoli','ALVEOLI','Gas exchange across thin moist walls','Tiny air sacs where gases are exchanged'],
              ['blood','CAPILLARIES','Oxygen enters blood; carbon dioxide leaves','Oxygen enters blood and carbon dioxide leaves'],
              ['diaphragm','DIAPHRAGM','Muscle changes thoracic cavity volume','Muscle helps the lungs expand and contract']
            ],
            edges: [['nose','trachea','air passes'],['trachea','bronchi','branches'],['bronchi','bronchioles','divide into'],['bronchioles','alveoli','lead to'],['alveoli','blood','gas exchange'],['diaphragm','alveoli','ventilation']]
          },
          digestive: {
            title: 'Human Digestive System',
            description: 'Food is digested, nutrients are absorbed and undigested material is eliminated.',
            nodes: [
              ['mouth','MOUTH','Chewing and salivary amylase begin digestion','Food is chewed and mixed with saliva'],
              ['oesophagus','OESOPHAGUS','Peristalsis moves food to stomach','Muscular tube moves food down'],
              ['stomach','STOMACH','Churns food; acid and protease act','Food is mixed with acid and enzymes'],
              ['liver','LIVER / GALLBLADDER','Bile is produced and stored','Bile helps emulsify fats'],
              ['small','SMALL INTESTINE','Digestion completed; nutrients absorbed','Most nutrients enter the blood here'],
              ['large','LARGE INTESTINE','Water and mineral salts absorbed','Water is absorbed from the remaining material'],
              ['rectum','RECTUM / ANUS','Stores and eliminates faeces','Waste is stored and removed']
            ],
            edges: [['mouth','oesophagus','swallowing'],['oesophagus','stomach','peristalsis'],['stomach','small','partly digested food'],['liver','small','bile'],['small','large','undigested material'],['large','rectum','waste']]
          },
          kidney: {
            title: 'Kidney and Nephron Function',
            description: 'The nephron filters blood, reabsorbs useful substances and forms urine.',
            nodes: [
              ['blood','BLOOD SUPPLY','Blood enters the kidney through renal artery','Blood arrives at the kidney'],
              ['glomerulus','GLOMERULUS','Ultrafiltration under blood pressure','Small substances are filtered from blood'],
              ['capsule','BOWMAN’S CAPSULE','Collects the filtrate','Collects the filtered fluid'],
              ['tubule','RENAL TUBULE','Selective reabsorption of useful substances','Useful substances return to the blood'],
              ['loop','LOOP OF HENLE','Creates concentration gradient','Helps concentrate the filtrate'],
              ['duct','COLLECTING DUCT','Water reabsorption; carries urine onward','Adjusts water content and collects urine'],
              ['urine','URINE','Contains urea, excess salts and water','Waste fluid leaves the kidney']
            ],
            edges: [['blood','glomerulus','enters'],['glomerulus','capsule','filtration'],['capsule','tubule','filtrate'],['tubule','loop','continues'],['loop','duct','flows into'],['duct','urine','forms']]
          },
          waterCycle: {
            title: 'The Water Cycle',
            description: 'Water continuously moves between Earth’s surface and the atmosphere.',
            nodes: [
              ['sun','SUN','Provides energy for evaporation','Sunlight provides the energy'],
              ['evaporation','EVAPORATION','Liquid water becomes water vapour','Water changes into vapour'],
              ['transpiration','TRANSPIRATION','Plants release water vapour','Plants release water vapour'],
              ['condensation','CONDENSATION','Water vapour cools to form droplets','Vapour cools and forms clouds'],
              ['precipitation','PRECIPITATION','Water falls as rain, snow or hail','Water falls from clouds'],
              ['collection','COLLECTION','Water gathers in rivers, lakes and oceans','Water collects on the surface'],
              ['infiltration','INFILTRATION','Water enters soil and groundwater','Some water soaks into the ground']
            ],
            edges: [['sun','evaporation','heats water'],['sun','transpiration','energy'],['evaporation','condensation','vapour rises'],['transpiration','condensation','vapour rises'],['condensation','precipitation','clouds release water'],['precipitation','collection','falls'],['collection','infiltration','soaks into soil']]
          },
          separation: {
            title: 'Separation Techniques',
            description: 'Different mixtures require different physical separation methods based on their properties.',
            nodes: [
              ['mixture','MIXTURE','Contains two or more substances','Different substances are mixed together'],
              ['filtration','FILTRATION','Separates insoluble solid from liquid','A filter traps an insoluble solid'],
              ['residue','RESIDUE','Solid retained by filter paper','The solid left on the filter'],
              ['filtrate','FILTRATE','Liquid that passes through filter','The liquid collected below'],
              ['evaporation','EVAPORATION','Recovers dissolved solid from solution','Liquid evaporates, leaving the solid'],
              ['distillation','DISTILLATION','Separates liquids by boiling point','Heating and condensation separate liquids'],
              ['chromatography','CHROMATOGRAPHY','Separates dissolved substances by movement','Different substances travel different distances']
            ],
            edges: [['mixture','filtration','insoluble solid'],['filtration','residue','retained'],['filtration','filtrate','passes through'],['filtrate','evaporation','recover dissolved solid'],['mixture','distillation','boiling points'],['mixture','chromatography','different movement']]
          },
          foodChain: {
            title: 'Food Chain and Energy Transfer',
            description: 'A food chain shows feeding relationships and the direction of energy transfer.',
            nodes: [
              ['sun','SUNLIGHT','Primary energy source for most ecosystems','The main energy source'],
              ['producer','PRODUCER','Photosynthetic organism makes its food','A plant makes its own food'],
              ['primary','PRIMARY CONSUMER','Herbivore feeds on producer','An animal eats the plant'],
              ['secondary','SECONDARY CONSUMER','Feeds on primary consumer','A predator eats the herbivore'],
              ['tertiary','TERTIARY CONSUMER','Higher-level consumer','A higher-level predator'],
              ['decomposer','DECOMPOSERS','Break down dead organisms and waste','Fungi and bacteria recycle nutrients'],
              ['nutrients','NUTRIENTS','Returned to the environment','Nutrients return to the soil']
            ],
            edges: [['sun','producer','energy'],['producer','primary','eaten by'],['primary','secondary','eaten by'],['secondary','tertiary','eaten by'],['producer','decomposer','dead material'],['tertiary','decomposer','dead material'],['decomposer','nutrients','releases']]
          },
          circuit: {
            title: 'Simple Electric Circuit',
            description: 'A complete conducting path allows electric current to flow from a cell through components.',
            nodes: [
              ['cell','CELL / BATTERY','Provides potential difference','Provides the energy that drives charge'],
              ['wire1','CONNECTING WIRE','Conducting path for charge','Metal wires connect the components'],
              ['switch','SWITCH','Opens or closes the circuit','Controls whether the circuit is complete'],
              ['lamp','LAMP','Transfers electrical energy to light','Converts electrical energy into light'],
              ['wire2','RETURN WIRE','Completes the conducting path','Provides the return path'],
              ['current','ELECTRIC CURRENT','Rate of flow of electric charge','Flow of electric charge'],
              ['voltage','VOLTAGE','Energy transferred per unit charge','Energy supplied to each unit of charge']
            ],
            edges: [['cell','wire1','supplies'],['wire1','switch','conducts'],['switch','lamp','if closed'],['lamp','wire2','current flows'],['wire2','cell','completes loop'],['cell','current','drives'],['cell','voltage','provides']]
          }
        };

        const item = layouts[kind];
        if (!item) return null;

        const positions = [
          [30, 70], [560, 70],
          [30, 390], [560, 390],
          [30, 710], [560, 710],
          [300, 1030]
        ];

        return {
          title: item.title,
          description: item.description,
          nodes: item.nodes.map((node, index) => ({
            id: node[0],
            label: node[1],
            detail: gossipMode ? node[3] : node[2],
            x: positions[index][0],
            y: positions[index][1],
            shape: 'rect'
          })),
          connections: item.edges.map(edge => ({
            from: edge[0],
            to: edge[1],
            label: edge[2]
          }))
        };
      };

      const diagramTopicMatchers = [
        ['plantCell', /\bplant\s+cell\b|\bstructure\s+of\s+a\s+plant\s+cell\b/i],
        ['animalCell', /\banimal\s+cell\b|\bstructure\s+of\s+an\s+animal\s+cell\b/i],
        ['photosynthesis', /\bphotosynthesis\b/i],
        ['heart', /\b(?:human\s+heart|heart\s+structure|blood\s+circulation|cardiac\s+cycle)\b/i],
        ['neuron', /\b(?:neuron|neurone|nerve\s+cell|nervous\s+system)\b/i],
        ['respiratory', /\b(?:respiratory\s+system|human\s+breathing|gas\s+exchange)\b/i],
        ['digestive', /\b(?:digestive\s+system|human\s+digestion|digestion\s+in\s+humans)\b/i],
        ['kidney', /\b(?:kidney|nephron|urine\s+formation)\b/i],
        ['waterCycle', /\bwater\s+cycle\b/i],
        ['separation', /\b(?:separation\s+techniques|filtration|distillation|chromatography)\b/i],
        ['foodChain', /\b(?:food\s+chain|food\s+web|energy\s+transfer\s+in\s+ecosystems)\b/i],
        ['circuit', /\b(?:electric\s+circuit|simple\s+circuit|series\s+and\s+parallel\s+circuit)\b/i]
      ];

      const matchedDiagramTopic = diagramTopicMatchers.find(
        ([, pattern]) => pattern.test(topic)
      );

      if (!diagramForLesson && matchedDiagramTopic) {
        diagramForLesson = createDiagramTemplate(
          matchedDiagramTopic[0],
          teachingStyle === 'Gossip'
        );
        console.log('[HILLION DIAGRAM] Instant topic template selected:', matchedDiagramTopic[0]);
      }

      if (!diagramForLesson && topicRequestsDiagram) {
        setLessonTranscript('Hillion is preparing your labelled educational diagram...');

        try {
          const diagramReply = await generate([
            {
              role: 'system',
              content: [
                'You are HILLION, an accurate educational scientific illustrator.',
                'Create a clear, labelled diagram directly relevant to the learner topic.',
                'Use scientifically correct labels, inputs, outputs, structures and relationships.',
                teachingStyle === 'Gossip'
                  ? 'Use a simple, friendly visual with short, approachable labels while preserving scientific accuracy.'
                  : 'Use a detailed, academically accurate educational diagram with precise labels.',
                'Create between 3 and 7 nodes.',
                'Each node must have a unique short id, a concise label, and a short explanatory detail.',
                'Position nodes on a 1000 by 1500 canvas. Each node is approximately 400 by 150 pixels.',
                'Keep x between 30 and 560 and y between 30 and 1300.',
                'Connections must refer to existing node ids.',
                'Return exactly this format, with no extra text:',
                '[[HILLION_DIAGRAM]]',
                '{"title":"Diagram title","description":"Short explanation","nodes":[{"id":"node1","label":"Label","detail":"Short detail","x":60,"y":100,"shape":"rect"}],"connections":[{"from":"node1","to":"node2","label":"relationship"}]}',
                '[[/HILLION_DIAGRAM]]',
                'Return valid JSON. Do not use Markdown fences.'
              ].join('\\n')
            },
            {
              role: 'user',
              content:
                'Create the labelled diagram for this lesson topic: ' + topic +
                '. Subject: ' + (plan.subject || 'Identify from topic') +
                '. Make the diagram useful to a student studying this topic.'
            }
          ], 750);

          const diagramMatch = diagramReply.match(
            /\[\[HILLION_DIAGRAM\]\]([\s\S]*?)\[\[\/HILLION_DIAGRAM\]\]/
          );

          if (!diagramMatch) {
            throw new Error('The AI did not return the required diagram format.');
          }

          const parsedDiagram = JSON.parse(diagramMatch[1].trim());

          if (!Array.isArray(parsedDiagram.nodes) || parsedDiagram.nodes.length < 2) {
            throw new Error('The generated diagram did not contain enough labelled nodes.');
          }

          const fallbackPositions = [
            [60, 100], [560, 100], [60, 430], [560, 430],
            [60, 760], [560, 760], [310, 1090]
          ];

          const validNodes = parsedDiagram.nodes.slice(0, 7).map((node, index) => {
            const fallback = fallbackPositions[index];
            const x = Number(node.x);
            const y = Number(node.y);

            return {
              id: String(node.id || 'node' + index).replace(/[^a-zA-Z0-9_-]/g, ''),
              label: String(node.label || 'Key concept').slice(0, 55),
              detail: String(node.detail || '').slice(0, 90),
              x: Math.max(20, Math.min(560, Number.isFinite(x) ? x : fallback[0])),
              y: Math.max(20, Math.min(1300, Number.isFinite(y) ? y : fallback[1])),
              shape: node.shape === 'circle' ? 'circle' : 'rect'
            };
          });

          const validIds = new Set(validNodes.map(node => node.id));

          const validConnections = Array.isArray(parsedDiagram.connections)
            ? parsedDiagram.connections
                .filter(edge => validIds.has(edge.from) && validIds.has(edge.to) && edge.from !== edge.to)
                .slice(0, 12)
                .map(edge => ({
                  from: edge.from,
                  to: edge.to,
                  label: String(edge.label || '').slice(0, 35)
                }))
            : [];

          diagramForLesson = {
            title: String(parsedDiagram.title || 'Educational diagram'),
            description: String(parsedDiagram.description || ''),
            nodes: validNodes,
            connections: validConnections
          };

          console.log('[HILLION DIAGRAM] Generated and validated lesson diagram.');
        } catch (diagramError) {
          if (controller.signal.aborted) throw diagramError;
          console.warn('[HILLION DIAGRAM] Diagram generation failed; continuing lesson:', diagramError);
        }
      }

      setLessonDiagram(diagramForLesson);


      const plannedLessonData = {
        ...initialLessonData,
        title: topic.split("\n")[0].trim(),
        topic,
        subject: plan.subject || '',
        plannedSections: sections,
        diagram: diagramForLesson,
        sections: initialSections,
        conversation: initialConversation,
        progress: Math.round((initialSections.length / sections.length) * 100),
        status: 'in-progress'
      };

      saveLesson(plannedLessonData);
      saveActiveLesson(plannedLessonData);

      setLessonTitle(topic.split("\n")[0].trim());
      setLessonSubject(plan.subject || '');
      setLessonTranscript(
        initialSections.length > 0
          ? 'Hillion is restoring your lesson and preparing section ' + (initialSections.length + 1) + '...'
          : 'Your lesson plan is ready. Hillion is preparing the first section...'
      );

      for (let index = initialSections.length; index < sections.length; index++) {
        const plannedSection = sections[index];

        const draftForThisSection =
          savedLiveDraft?.sectionIndex === index ? savedLiveDraft : null;

        liveDraftRef.current = {
          sectionIndex: index,
          heading: plannedSection.heading || 'Section ' + (index + 1),
          content: draftForThisSection?.content || ''
        };

        setLessonTranscript(
          'Hillion is teaching section ' + (index + 1) + ' of ' + sections.length + ': ' + (plannedSection.heading || 'Next section')
        )

        setLiveSectionHeading(plannedSection.heading || 'Section ' + (index + 1));
        setLiveSectionContent(draftForThisSection?.content || '');

        const sectionReply = await generate([
          {
            role: 'system',
            content: [
              'You are HILLION, a patient and intelligent academic teacher.',
              'Teach ONLY the requested section.',
              ...(learningMode === 'Research Centre' ? [
                'RESEARCH CENTRE MODE: Write this section as part of a careful research report. Keep claims proportional to the evidence available in the supplied context and established knowledge.',
                'Do not fabricate citations. Cite a retrieved or supplied source only when its exact title and URL are present in the context. For retrieved encyclopedia extracts, add a concise Sources used note with the exact URL. A publication record is metadata, not the full paper or proof of its conclusions.',
                'Separate evidence, interpretation, assumptions, and unresolved questions. Include counter-evidence or competing explanations where relevant.',
                'For research methods, explain why the method fits the question, what data it would require, ethical considerations, and its limitations.',
                'Do not present speculation as a finding or a proposed method as completed research.'
              ] : []),
              'Explain clearly and progressively, using accurate facts and appropriate examples.',
              'Use simple language first, then introduce academic terminology.',
              'For every formula or equation that is important to understanding the topic, teach the formula rather than merely displaying it.',
              'Explain every symbol, letter, subscript and superscript in the formula, including what each represents.',
              'Explain the meaning and appropriate units of each quantity wherever units apply.',
              'Explain what the formula calculates, the physical or mathematical meaning behind it, and when it should be used.',
              'Give at least one short, relevant worked example: state the known values, substitute them into the formula, show the calculation step by step, and clearly state the answer with its correct unit.',
              'Never assume the learner already understands mathematical notation or what a symbol means.',
              'Keep formula explanations and worked examples concise in Gossip Mode, but never omit essential symbol meanings, units, or calculation steps.',
              'Do not invent a formula or force an irrelevant formula into a topic. Use only formulas appropriate to the subject and section.',
              'For calculations, show formulas, substitutions and working.',
              'For Biology and Chemistry, explain structures and processes accurately.',
              'For Physics and Mathematics, show calculations step by step.',
              'For English, give correct examples.',
              teachingStyle === 'Gossip'
                ? 'TEACHING STYLE — GOSSIP MODE: Use short, lively, conversational explanations and relatable storytelling in neutral English. Be playful but respectful. Avoid local slang and forced terms of address. Keep each section noticeably shorter than Normal Mode. Preserve every essential definition, fact, process, formula and example needed to understand this section. Never sacrifice accuracy or important learning points.'
                : 'TEACHING STYLE — NORMAL MODE: Give a thorough, structured academic explanation appropriate to the topic. Build understanding from foundations, explain important details and relationships, and use relevant examples. Be complete without padding or repeating other sections.',
              'STRUCTURED EDUCATIONAL NOTES:',

              'Use ## for major subheadings and ### for smaller subheadings.',
              'Use separate, readable paragraphs. Never combine an entire lesson into one paragraph.',
              'Use bullet lists for functions, characteristics, properties and features.',
              'Use numbered lists ONLY for genuine sequences, procedures or ordered steps.',
              'Use Markdown tables when comparing two or more concepts.',
              'Use **bold** for important academic terms and vocabulary.',
              'Use ==highlighted text== for essential definitions and key concepts.',
              'Use proper mathematical notation throughout.\nWrap standalone equations and formulas in \\[ and \\] so they render as typeset mathematics.\nWrap inline mathematical expressions in \\( and \\).\nNever put mathematical equations or formulas inside backticks.\nUse proper subscripts, superscripts, fractions, Greek symbols and multiplication signs.\nFor calculations, show the formula, substitution, step-by-step working and clearly marked final answer.\nFor chemical formulas, preserve correct element symbols and subscripts, such as H₂O and CO₂.',
              'For definitions, clearly identify the term and explain its meaning.',
              'For examples, label them clearly and explain how they illustrate the concept.',
              'Keep formatting scientifically accurate and appropriate to the subject.',
              'Do not use HTML tags, decorative symbols or unnecessary numbering.',
              'Return the teaching explanation as plain Markdown, not JSON.',
              'Do not wrap the answer in JSON, quotation marks or code fences.',
              'Begin directly with the explanation.',
              'Do not repeat the entire lesson or teach unrelated sections.'
            ].join('\n')
          },
          {
            role: 'user',
            content: [
              'Original topic: ' + topic,
              'Subject: ' + (plan.subject || 'Identify from topic'),
              'Lesson title: ' + (plan.title || topic),
              'Section ' + (index + 1) + ' of ' + sections.length + ': ' + plannedSection.heading,
              'Section goal: ' + (plannedSection.goal || plannedSection.heading),
              'Teach this section fully enough to understand. Do not teach other sections.',
              ...(draftForThisSection ? [
                'IMPORTANT: This section was interrupted while being written.',
                'Continue ONLY the current section: ' + plannedSection.heading + '.',
                'Continue from the exact stopping point in the saved text.',
                'The saved text is already visible to the learner. Do not reproduce or summarise it.',
                'If the final word was cut off, repeat that word from its beginning and complete it.',
                'Complete the unfinished sentence before introducing any new paragraph or subheading.',
                'Do not introduce, write or preview the heading or content of another planned section.',
                'Do not restart, repeat completed explanations or change the current section topic.',
                'Finish teaching the current section fully, then stop.',
                'Previously saved text:',
                draftForThisSection.content
              ] : [])
            ].join('\n')
          }
        ], 1100, (chunk) => {
          liveDraftRef.current = {
            sectionIndex: index,
            heading: plannedSection.heading || 'Section ' + (index + 1),
            content: (liveDraftRef.current?.content || '') + chunk
          };

          if (!liveSectionUiTimerRef.current) {
            liveSectionUiTimerRef.current = setTimeout(() => {
              liveSectionUiTimerRef.current = null;
              setLiveSectionContent(liveDraftRef.current?.content || '');
            }, 100);
          }

          if (!liveDraftSaveTimerRef.current) {
            liveDraftSaveTimerRef.current = setTimeout(() => {
              liveDraftSaveTimerRef.current = null;
              persistLiveDraft('in-progress');
            }, 1000);
          }
        }, true);

        flushLiveSectionContent();

        if (controller.signal.aborted) {
          throw new DOMException("Lesson interrupted", "AbortError");
        }

        if (liveDraftSaveTimerRef.current) {
          clearTimeout(liveDraftSaveTimerRef.current);
          liveDraftSaveTimerRef.current = null;
        }

        persistLiveDraft('in-progress');

        let lessonSection

        try {
          lessonSection = parseJSON(sectionReply)
        } catch {
          lessonSection = {
            type: 'explanation',
            heading: plannedSection.heading || 'Section ' + (index + 1),
            content: sectionReply
          }
        }

        const generatedSectionVisuals =
          generateSectionVisuals(plannedSection.visualPlan, {
            subject: plan.subject || '',
            topic,
            heading: plannedSection.heading || '',
            goal: plannedSection.goal || ''
          });

        const completedSection = {
          type: lessonSection.type || plannedSection.type || "explanation",
          heading: lessonSection.heading || plannedSection.heading || "Section " + (index + 1),
          content: mergeLessonContinuation(
            draftForThisSection?.content,
            lessonSection.content || sectionReply,
            plannedSection.heading || lessonSection.heading
          ),
          visualPlan: Array.isArray(plannedSection.visualPlan)
            ? plannedSection.visualPlan
            : [],
          visuals: Array.isArray(lessonSection.visuals)
            ? lessonSection.visuals
            : Array.isArray(plannedSection.visuals) &&
              plannedSection.visuals.length > 0
              ? plannedSection.visuals
              : generatedSectionVisuals
        };

        setLessonSections(previous => {
          if (controller.signal.aborted) return previous;

          const updatedSections = [...previous, completedSection];

          saveLesson({
            id: lessonId,
            title: topic.split("\n")[0].trim(),
            topic,
            subject: plan.subject || '',
            plannedSections: sections,
            diagram: plannedLessonData.diagram || null,
            learningMode,
            teachingStyle,
            sections: updatedSections,
            liveDraft: null,
            conversation: [
              { role: 'user', content: topic.split("\n")[0].trim() },
              ...updatedSections.map(section => ({
                role: 'assistant',
                content: section.heading + "\n\n" + section.content
              }))
            ],
            transcript: 'Hillion is teaching your lesson...',
            progress: Math.round((updatedSections.length / sections.length) * 100),
            status: 'in-progress',
            createdAt: lessonStartedAt
          });

          saveActiveLesson({
            id: lessonId,
            title: topic.split("\n")[0].trim(),
            topic,
            subject: plan.subject || '',
            plannedSections: sections,
            diagram: plannedLessonData.diagram || null,
            learningMode,
            teachingStyle,
            sections: updatedSections,
            conversation: [
              { role: 'user', content: topic.split("\n")[0].trim() },
              ...updatedSections.map(section => ({
                role: 'assistant',
                content: section.heading + "\n\n" + section.content
              }))
            ],
            transcript: 'Hillion is teaching your lesson...',
            progress: Math.round((updatedSections.length / sections.length) * 100),
            status: 'in-progress',
            createdAt: lessonStartedAt
          });

          return updatedSections;
        });

        liveDraftRef.current = null;

        if (liveDraftSaveTimerRef.current) {
          clearTimeout(liveDraftSaveTimerRef.current);
          liveDraftSaveTimerRef.current = null;
        }

        setLessonConversation(previous => [...previous, {
          role: "assistant",
          content: completedSection.heading + "\n\n" + completedSection.content
        }]);

        setLiveSectionContent('');
        setLiveSectionHeading('');
      }

      const completedLesson = getLessons().find(lesson => lesson.id === lessonId);

      if (completedLesson) {
        const finalLesson = {
          ...completedLesson,
          title: topic.split("\n")[0].trim(),
          topic,
          subject: plan.subject || '',
          progress: 100,
          liveDraft: null,
          status: 'completed',
          transcript: 'Hillion has completed the planned teaching sections.'
        };

        saveLesson(finalLesson);
        saveActiveLesson(finalLesson);
      }

      setLessonTranscript('Hillion has completed the planned teaching sections.')
    } catch (error) {
      flushLiveSectionContent();
      if (liveDraftSaveTimerRef.current) {
        clearTimeout(liveDraftSaveTimerRef.current);
        liveDraftSaveTimerRef.current = null;
      }

      if (liveDraftRef.current?.content) {
        persistLiveDraft('paused');
      }

      console.error('[HILLION DIAGNOSTIC] Progressive lesson generation error:', {
        time: new Date().toISOString(),
        message: error?.message,
        name: error?.name,
        lessonControllerAborted: controller.signal.aborted,
        lessonAbortReason: controller.signal.reason || null,
        completedSections: lessonSections.length,
        error
      })

      if (error?.name === 'AbortError' && controller.signal.aborted) {
        setLessonTranscript('Hillion has paused the lesson. Your progress is saved. Press Play when you are ready to continue.');
      } else if (error?.name === 'AbortError') {
        setLessonTranscript('The lesson request was interrupted. Your saved progress is safe.');
      } else {
        const diagnosticMessage = error?.message || 'Unknown error';
        setLessonTranscript('Hillion could not complete the lesson: ' + diagnosticMessage);
        setLessonContent('Hillion could not continue this lesson: ' + diagnosticMessage + '. Your completed sections have been preserved.');
      }
    } finally {
      if (lessonAbortRef.current === controller) {
        lessonAbortRef.current = null
        setIsLessonLoading(false)
      }
    }
  }

  async function askClassroomQuestion(question, selectedPassage = '') {
    const shouldResumeAfterClarification = Boolean(
      isLessonLoading ||
      ['paused', 'in-progress'].includes(getActiveLesson()?.status)
    );
    if (isLessonLoading) {
      interruptLesson();
      const stopDeadline = Date.now() + 15000;
      while (lessonAbortRef.current && Date.now() < stopDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (lessonAbortRef.current) {
        throw new Error('The lecture is still stopping. Your saved progress is safe; please try the clarification again.');
      }
    }
    const cleanQuestion = String(question || '').trim();
    if (!cleanQuestion) return;

    const activeLesson = getActiveLesson();
    const recentContext = lessonSections
      .slice(-8)
      .map(section => `${section.heading || 'Lesson section'}\n${section.content || ''}`)
      .join('\n\n')
      .slice(-14000);
    const conversationContext = (lessonConversation || []).slice(-8);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
      const response = await requestAI({
          model: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
          messages: [
            {
              role: 'system',
              content: `You are HILLION, the academic tutor continuing an existing ${lessonSubject || 'academic'} lesson on "${lessonTopic}". The learner has interrupted to clarify a point. Explain only the requested point, not the whole lesson. If a selected passage is supplied, unpack its meaning sentence by sentence, define unfamiliar terms, explain every formula symbol and unit, and use a short example where useful. Do not repeat unrelated material or restart the lesson. Return only the clarification to place beside the relevant lesson section.`
            },
            ...conversationContext,
            { role: 'user', content: `Existing lesson context:\n${recentContext}\n\nExact selected passage: ${selectedPassage ? '“' + selectedPassage + '”' : 'No passage selected; infer the point from the question.'}\n\nLearner's follow-up question: ${cleanQuestion}` }
          ],
          temperature: 0.3,
          repeat_penalty: 1.15,
          max_tokens: 1400,
          stream: false
        }, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`AI server returned HTTP ${response.status}. Check that the HILLION AI engine is running.`);
      }

      const data = await response.json();
      const answer = data?.choices?.[0]?.message?.content?.trim();
      if (!answer) throw new Error('The AI server returned an empty answer.');

      const heading = selectedPassage
        ? 'Clarification: ' + selectedPassage.slice(0, 72)
        : `Follow-up: ${cleanQuestion.slice(0, 90)}`;
      const matchedSectionIndex = selectedPassage
        ? lessonSections.findIndex(section => String(section.content || '').includes(selectedPassage))
        : -1;
      const matchedLiveDraft = Boolean(
        selectedPassage &&
        String(liveDraftRef.current?.content || activeLesson?.liveDraft?.content || '').includes(selectedPassage)
      );
      const previousClarifications = Array.isArray(activeLesson?.clarifications)
        ? activeLesson.clarifications
        : [];
      const clarification = {
        id: `clarification-${Date.now()}`,
        heading,
        content: answer,
        clarifiedPassage: selectedPassage || '',
        question: cleanQuestion,
        afterSectionIndex: matchedSectionIndex >= 0 ? matchedSectionIndex : null,
        targetLiveDraft: matchedLiveDraft,
        createdAt: new Date().toISOString()
      };
      const updatedClarifications = [...previousClarifications, clarification];
      const updatedConversation = [
        ...(lessonConversation || []),
        { role: 'user', content: cleanQuestion },
        { role: 'assistant', content: `${heading}\n\n${answer}` }
      ];
      const updatedLesson = {
        ...(activeLesson || {}),
        id: activeLesson?.id || `lesson-${Date.now()}`,
        title: lessonTitle || lessonTopic || 'HILLION lesson',
        topic: lessonTopic,
        subject: lessonSubject,
        sections: lessonSections,
        clarifications: updatedClarifications,
        conversation: updatedConversation,
        resumeCheckpoint: {
          sectionCount: lessonSections.length,
          liveDraft: liveDraftRef.current ? {
            ...liveDraftRef.current,
            heading: liveDraftRef.current.heading || '',
            content: liveDraftRef.current.content || ''
          } : activeLesson?.liveDraft || null,
          clarifiedPassage: selectedPassage || '',
          clarificationId: clarification.id,
          updatedAt: new Date().toISOString()
        },
        transcript: 'Clarification added beside the relevant section. Resume to continue the lecture.',
        status: activeLesson?.status || 'paused',
        createdAt: activeLesson?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      setLessonConversation(updatedConversation);
      setLessonTranscript('Clarification complete. Hillion is resuming from the saved lecture position.');
      saveLesson(updatedLesson);
      saveActiveLesson(updatedLesson);
      if (shouldResumeAfterClarification && Array.isArray(updatedLesson.plannedSections) && updatedLesson.plannedSections.length) {
        await startLesson(
          updatedLesson.topic || lessonTopic,
          updatedLesson.learningMode || 'Topic',
          { ...updatedLesson, status: 'paused' },
          updatedLesson.teachingStyle || 'Normal'
        );
      }
      return answer;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('The AI took too long to answer. Your existing lesson has been preserved.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (!isSplashScreen && !isClassroomOpen && !isPreparingLesson) {
  return (
    <HomeDashboard
      recoveryLesson={recoveryLesson}
      onResumeLesson={resumeSavedLesson}
      onStartFresh={startFreshAfterRecovery}
      onDiscardLesson={discardSavedLesson}
      recentBoards={getLessons()}
      onOpenHistory={openSavedLesson}
      onStartLesson={handleDashboardStart}
    />
  )
  }
  if (isSplashScreen) {
  return (
    <div className="splash-screen">
      <div className="splash-icon">
        <div className="splash-highlight"></div>
        <h1>HILLION</h1>
        <span>AI TUTOR</span>
      </div>
    </div>
  )
}
if (isPreparingLesson) {
  return (
    <div className="preparing-screen">
      <div className="preparing-card">
        <div className="preparing-logo">H</div>
        <h1>Preparing your lesson</h1>
        <p>Hillion is organising your learning experience...</p>
        <div className="preparing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <small>PLEASE WAIT WHILE YOUR CLASSROOM IS PREPARED</small>
      </div>
    </div>
  )
}

if (isClassroomOpen) {
  return (
    <ClassroomErrorBoundary>
    <Classroom
      topic={lessonTopic}
      title={lessonTitle}
      subject={lessonSubject}
      diagram={lessonDiagram}
      content={lessonContent}
      transcript={lessonTranscript}
      conversation={lessonConversation}
      sections={lessonSections}
      clarifications={getActiveLesson()?.clarifications || []}
      liveSectionHeading={liveSectionHeading}
      liveSectionContent={liveSectionContent}
      loading={isLessonLoading}
      canResume={getActiveLesson()?.status === 'paused'}
      onResume={resumeCurrentLesson}
      onInterrupt={interruptLesson}
      onAskQuestion={askClassroomQuestion}
      onExit={() => {
        interruptLesson()
        setIsClassroomOpen(false)
      }}
    />
    </ClassroomErrorBoundary>
  )
}
  return (
  <HomeDashboard
    onStartLesson={({ mode, topic }) => {
      setLessonTopic(topic)
      setIsClassroomOpen(true)
      startLesson(topic, mode)
    }}
  />
)
return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">H</div>
          <div>
            <h2>HILLION</h2>
            <span>AI TUTOR</span>
          </div>
        </div>

        <button className="new-lesson">+ New Lesson</button>

        <div className="side-heading">LEARNING</div>
        <button className="side-link active">◈ Learning Space</button>
        <button className="side-link">▤ My Lessons</button>
        <button className="side-link">◷ Learning History</button>

        <div className="side-heading">YOUR ACCOUNT</div>
        <button className="side-link">⚙ Settings</button>

        <div className="sidebar-bottom">
          <div className="avatar">H</div>
          <div>
            <strong>My Learning Space</strong>
            <span>Personal Account</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="welcome">YOUR PERSONAL LEARNING SPACE</span>
            <h1>Let's learn something new.</h1>
          </div>
          <div className="status">
            <span className="status-dot"></span>
            AI TUTOR
          </div>
        </header>

        <div className="content">
          <section className="subject-section">
  <div className="section-title">
    <div>
      <h2>What do you want to learn?</h2>
      <p>Enter any topic and let Hillion teach you.</p>
    </div>
    <span>01 / NEW LESSON</span>
  </div>

  <form
    className="topic-entry"
    onSubmit={(event) => {
  event.preventDefault()

  if (lessonTopic.trim() && !isLessonLoading) {
    setIsClassroomOpen(true)
    startLesson()
  }
}}
  >
    <input
      type="text"
      value={lessonTopic}
      onChange={(event) => setLessonTopic(event.target.value)}
      placeholder="Enter a topic, e.g. Human Anatomy..."
    />

    <button type="submit">
      Start Learning →
    </button>
  </form>
</section>

          <section className="lesson-section">
            <div className="section-title">
              <div>
                <h2>Your teaching workspace</h2>
                <p>Learn, ask questions and explore ideas.</p>
              </div>
              <span>02 / WORKSPACE</span>
            </div>

            <div className="learning-layout">
              <div className="whiteboard">
                <div className="board-header">
                  <div>
                    <span className="board-label">
                      INTERACTIVE WHITEBOARD
                    </span>
                    <h3>{subject} Classroom</h3>
                  </div>
                  <span className="board-live">● READY</span>
                </div>

                <div className="board-toolbar">
                  <button
                    className={tool === 'pen' ? 'tool-active' : ''}
                    onClick={() => setTool('pen')}
                  >
                    ✎ Pen
                  </button>
                  <button
  className={tool === 'pan' ? 'tool-active' : ''}
  onClick={() => setTool('pan')}
>
  ✋ Pan
</button>
                  <button onClick={zoomIn}>
  ＋ Zoom In
</button>
                  <button onClick={zoomOut}>
  − Zoom Out
</button>
                  <button onClick={resetZoom}>
  ⟲ Reset
</button>
                  <span className="zoom-display">
  {zoomLevel}%
</span>

                  <button
                    className={tool === 'line' ? 'tool-active' : ''}
                    onClick={() => setTool('line')}
                  >
                    ／ Line
                  </button>
                  <button
  className={tool === 'circle' ? 'tool-active' : ''}
  onClick={() => setTool('circle')}
>
  ○ Circle
</button>
                  <button
  className={tool === 'arrow' ? 'tool-active' : ''}
  onClick={() => setTool('arrow')}
>
  ↗ Arrow
</button>
                  <button
  className={tool === 'text' ? 'tool-active' : ''}
  onClick={() => setTool('text')}
>
  T Text
</button>
                  <div className="text-controls">
  <label>
  Color:
  <input
    type="color"
    value={drawingColor}
    onChange={(event) => setDrawingColor(event.target.value)}
  />
</label>

  <label>
    Size:
    <input
      type="range"
      min="12"
      max="48"
      value={textSize}
      onChange={(event) => setTextSize(Number(event.target.value))}
    />
    {textSize}
  </label>
                    <label>
  Pen:
  <input
    type="range"
    min="1"
    max="16"
    value={penSize}
    onChange={(event) => setPenSize(Number(event.target.value))}
  />
  {penSize}px
</label>
                    <label>
  Eraser:
  <input
    type="range"
    min="5"
    max="50"
    value={eraserSize}
    onChange={(event) => setEraserSize(Number(event.target.value))}
  />
  {eraserSize}px
</label>
</div>
                  <button
                    className={tool === 'rectangle' ? 'tool-active' : ''}
                    onClick={() => setTool('rectangle')}
                  >
                    □ Rectangle
                  </button>
                  <button
  className={tool === 'eraser' ? 'tool-active' : ''}
  onClick={() => setTool('eraser')}
>
  ⌫ Eraser
</button>

                  <button onClick={undoDrawing}>↶ Undo</button>
                  <button
  onClick={redoDrawing}
  disabled={redoDrawings.length === 0}
>
  ↷ Redo
</button>
                  <button onClick={clearBoard}>✕ Clear</button>
                </div>

                <div className="board-content" ref={boardContentRef}>
                  <svg
  ref={svgRef}
  className="drawing-canvas"
  style={{
    width: `${zoomLevel}%`,
    height: `${15 * zoomLevel}px`
  }}
  viewBox="0 0 1000 1500"
                    preserveAspectRatio="none"
                    onPointerDown={startDrawing}
                    onPointerMove={continueDrawing}
                    onPointerUp={finishDrawing}
                    onPointerCancel={finishDrawing}
                  >
                    {drawings.map(renderDrawing)}
                    {preview && renderDrawing(preview, 'preview')}
                  </svg>

                  {drawings.length === 0 && !preview && (
                    <div className="board-empty-hint">
                      <span>✦</span>
                      <strong>Your digital whiteboard</strong>
                      <p>Select a tool above and draw here.</p>
                    </div>
                  )}
                </div>

                <div className="board-footer">
                  <span>HILLION DIGITAL CLASSROOM</span>
                  <span>WHITEBOARD 01</span>
                </div>
              </div>

              <div className="tutor-panel">
                <div className="tutor-header">
                  <div className="tutor-avatar">H</div>
                  <div>
                    <h3>Hillion Tutor</h3>
                    <span>YOUR AI STUDY PARTNER</span>
                  </div>
                </div>

                <div className="chat-area">
                  {messages.length === 0 ? (
                    <div className="welcome-message">
                      <div className="hello-icon">✦</div>
                      <h3>Hello, learner!</h3>
                      <p>
                        I'm ready to help you understand {subject} step by step.
                      </p>
                      <div
                        className="suggestion"
                        onClick={() => setMessage('Explain a difficult topic to me.')}
                      >
                        Explain a difficult topic to me.
                      </div>
                      <div
                        className="suggestion"
                        onClick={() => setMessage('Give me a practice question.')}
                      >
                        Give me a practice question.
                      </div>
                    </div>
                  ) : (
                    messages.map((msg, index) => (
  <div
    className={msg.role === 'user' ? 'user-message' : 'assistant-message'}
    key={index}
  >
    {msg.content}
  </div>
))
                  )}
                  {isLoading && (
  <div className="assistant-message">
    Hillion is thinking...
    <span className="thinking-dots"> ● ● ●</span>
  </div>
)}
                </div>

                <form className="chat-input" onSubmit={sendMessage}>
                  <input
                    value={message}
                    onChange={event => setMessage(event.target.value)}
                    placeholder="Ask your tutor anything..."
                  />
                  <button type="submit">↑</button>
                </form>

                <div className="chat-note">
                  Your personal learning assistant
                </div>
              </div>
            </div>
          </section>
        </div>

        <footer className="footer">
          <span>HILLION AI TUTOR © 2026</span>
          <span>BUILT FOR BETTER UNDERSTANDING.</span>
        </footer>
      </section>
    </main>
  )
}

export default App
