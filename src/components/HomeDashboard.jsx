import { useMemo, useRef, useState } from 'react'
import { getLessons, updateLesson, deleteLesson } from '../utils/lessonStorage'
import { createRecoveryBackup, restoreRecoveryBackup } from '../utils/recoveryBackup'
import { Capacitor, registerPlugin } from '@capacitor/core'

const HillionModelManager = registerPlugin('HillionModelManager')
const HillionInference = registerPlugin('HillionInference')

export default function HomeDashboard({
  onStartLesson,
  onOpenHistory,
  recentBoards = [],
  recoveryLesson = null,
  onResumeLesson,
  onStartFresh,
  onDiscardLesson,
}) {
  const [mode, setMode] = useState('Topic')
  const [teachingStyle, setTeachingStyle] = useState('Normal')
  const [input, setInput] = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [link, setLink] = useState('')
  const [language, setLanguage] = useState('EN')
  const [menuOpen, setMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelStatus, setModelStatus] = useState({ ready: false, sizeMB: 0 })
  const [modelBusy, setModelBusy] = useState(false)
  const [modelMessage, setModelMessage] = useState('')
  const [historyRevision, setHistoryRevision] = useState(0)
  const historyLessons = useMemo(() => getLessons(), [recentBoards, historyRevision])
  const [managementLesson, setManagementLesson] = useState(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryBackupFile, setRecoveryBackupFile] = useState(null)

  const fileInputRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const longPressTriggeredRef = useRef(false)

  function refreshHistory() {
    setHistoryRevision(revision => revision + 1)
  }

  function stopLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function beginLongPress(board) {
    longPressTriggeredRef.current = false
    stopLongPress()
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      setManagementLesson(board)
    }, 600)
  }

  function openLessonFromHistory(board) {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }
    setHistoryOpen(false)
    onOpenHistory?.(board)
  }

  function togglePin(board) {
    updateLesson(board.id, { pinned: !board.pinned })
    refreshHistory()
    setManagementLesson(null)
  }

  function beginRename(board) {
    renameTargetRef.current = board
    setRenameValue(board.title || board.topic || '')
    setRenameOpen(true)
    setManagementLesson(null)
  }

  function saveRename() {
    if (!renameValue.trim()) return
    const target = renameTargetRef.current
    if (!target || !renameValue.trim()) return
    updateLesson(target.id, { title: renameValue.trim() })
    refreshHistory()
    setRenameOpen(false)
    renameTargetRef.current = null
  }

  function confirmDelete() {
    if (!deleteTarget) return
    deleteLesson(deleteTarget.id)
    refreshHistory()
    setDeleteTarget(null)
  }

  const renameTargetRef = useRef(null)


  async function exportRecoveryBackup() {
    setRecoveryBusy(true)
    setRecoveryMessage('Preparing encrypted backup…')
    try {
      const result = await createRecoveryBackup()
      const blob = new Blob([JSON.stringify(result.backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'HILLION-encrypted-recovery-backup.json'
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      setRecoveryCode(result.recoveryCode)
      setRecoveryMessage('Encrypted backup exported. Keep the recovery code and downloaded file in separate safe places.')
    } catch (error) {
      setRecoveryMessage(error?.message || 'Could not create a recovery backup.')
    } finally {
      setRecoveryBusy(false)
    }
  }

  async function importRecoveryBackup() {
    if (!recoveryBackupFile || !recoveryCode.trim()) {
      setRecoveryMessage('Choose your HILLION backup file and enter its recovery code.')
      return
    }
    setRecoveryBusy(true)
    setRecoveryMessage('Verifying and restoring backup…')
    try {
      const parsed = JSON.parse(await recoveryBackupFile.text())
      const result = await restoreRecoveryBackup({ backup: parsed, recoveryCode: recoveryCode.trim() })
      setRecoveryMessage(`Restored ${result.restoredKeys.length} HILLION data records. Restart HILLION to reload the restored workspace.`)
    } catch (error) {
      setRecoveryMessage(error?.message || 'Could not restore this backup.')
    } finally {
      setRecoveryBusy(false)
    }
  }

  async function refreshModelStatus() {
    if (!Capacitor.isNativePlatform()) return
    try {
      const status = await HillionModelManager.getModelStatus()
      setModelStatus(status)
    } catch (error) {
      setModelMessage(error?.message || 'Could not check on-device model storage.')
    }
  }

  async function importOnDeviceModel() {
    if (!Capacitor.isNativePlatform()) {
      setModelMessage('Model import is available in the installed Android app, not the web preview.')
      return
    }
    setModelBusy(true)
    setModelMessage('Choose your .gguf model. HILLION will copy it into private app storage.')
    try {
      // Release any previous model from RAM before replacing its file.
      try { await HillionInference.unloadModel() } catch { }
      const result = await HillionModelManager.importModel()
      setModelStatus(result)
      setModelMessage(`Model stored successfully (${result.sizeMB} MB). HILLION will load it on-device when you start your first lesson.`)
    } catch (error) {
      const message = error?.message || 'Model import did not complete.'
      setModelMessage(message)
    } finally {
      setModelBusy(false)
    }
  }

  async function removeOnDeviceModel() {
    if (!Capacitor.isNativePlatform()) return
    setModelBusy(true)
    try {
      try { await HillionInference.unloadModel() } catch { }
      await HillionModelManager.removeModel()
      setModelStatus({ ready: false, sizeMB: 0 })
      setModelMessage('Stored model removed from HILLION.')
    } catch (error) {
      setModelMessage(error?.message || 'Could not remove the stored model.')
    } finally {
      setModelBusy(false)
    }
  }

  const modes = [
    {
      name: 'Topic',
      icon: '📖',
    },
    {
      name: 'Exam Prep',
      icon: '📝',
    },
    {
      name: 'Homework',
      icon: '✍️',
    },
  ]

  const instructions = {
    'Topic': {
      title: 'What topic would you like to learn?',
      placeholder:
        "e.g., 'Teach me about photosynthesis' or 'Explain quadratic equations'",
    },

    'Exam Prep': {
      title: 'What topics would you like to review for your exam?',
      placeholder:
        'You can upload notes, a study guide, or an exam outline.',
    },

    'Homework': {
      title: 'What homework problem would you like help with?',
      placeholder:
        'You can copy and paste it, or upload a photo or file.',
    },
  }

  function handleStart(event) {
    event.preventDefault()

    if (!input.trim() && selectedFiles.length === 0 && !link.trim()) {
      return
    }

    onStartLesson?.({
      mode,
      topic: input.trim() || 'Please examine my uploaded material.',
      files: selectedFiles,
      link: link.trim(),
      language,
      teachingStyle,
    })
  }

  function handleFiles(event) {
    const incoming = Array.from(event.target.files || [])
    setSelectedFiles(current => {
      const combined = [...current]
      for (const file of incoming) {
        const duplicate = combined.some(existing =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified
        )
        if (!duplicate) combined.push(file)
      }
      return combined
    })
    event.target.value = ''
  }

  function selectMode(name) {
    setMode(name)
  }

  return (
    <main className="home-dashboard">

      {recoveryLesson && (
        <div className="recovery-overlay">
          <div className="recovery-card">
            <div className="recovery-icon">↻</div>
            <p className="recovery-eyebrow">LESSON RECOVERY</p>
            <h2>Your previous lesson is waiting</h2>
            <p className="recovery-topic">
              {recoveryLesson.title || recoveryLesson.topic || 'Untitled lesson'}
            </p>
            <p className="recovery-description">
              Hillion found an unfinished lesson saved on this device.
              You can continue where you stopped.
            </p>
            <p className="recovery-progress">
              {recoveryLesson.sections?.length || 0} sections saved
            </p>
            <button className="recovery-resume" onClick={onResumeLesson}>
              Resume Lesson →
            </button>
            <button className="recovery-new" onClick={onStartFresh}>
              Start New Lesson
            </button>
            <button className="recovery-discard" onClick={onDiscardLesson}>
              Discard Saved Lesson
            </button>
          </div>
        </div>
      )}


      <aside className={`home-sidebar ${menuOpen ? 'sidebar-open' : ''}`}>

        <div className="home-brand">
          <div className="brand-symbol">H</div>
          <span>Hillion</span>
        </div>

        <button
          className="sidebar-new-board"
          onClick={() => {
            setMode('Topic')
            setInput('')
            setMenuOpen(false)
          }}
        >
          <span>＋</span>
          New Board
        </button>

        <div className="sidebar-section">

          <p className="sidebar-label">WORKSPACE</p>

          <button
            className="sidebar-link"
            onClick={() => {
              refreshHistory()
              setHistoryOpen(true)
              setMenuOpen(false)
              onOpenHistory?.()
            }}
          >
            <span>▤</span>
            All History
          </button>

          <p className="sidebar-label recent-label">
            RECENT BOARDS
          </p>

          {recentBoards.length > 0 ? (
            recentBoards.slice(0, 5).map((board, index) => (
              <button
                className="sidebar-link recent-board"
                key={index}
                onClick={() => {
                  onOpenHistory?.(board)
                  setMenuOpen(false)
                }}
              >
                <span>▧</span>
                {board.title || board.topic || 'Untitled lesson'}
              </button>
            ))
          ) : (
            <p className="empty-recent">
              Your recent lessons will appear here.
            </p>
          )}

        </div>

        <div className="sidebar-bottom">

          <button className="sidebar-link" onClick={() => { refreshModelStatus(); setSettingsOpen(true); setMenuOpen(false) }}>
            <span>⚙</span>
            Settings
          </button>

          <div className="sidebar-footer">
            <div className="footer-avatar">H</div>
            <div>
              <strong>Hillion AI</strong>
              <small>Your learning space</small>
            </div>
          </div>

        </div>

      </aside>

      <section className="home-main">

        <header className="home-topbar">

          <button
            className="home-menu-button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Open navigation"
          >
            ☰
          </button>

          <span className="workspace-name">
            Hillion AI Classroom
          </span>

          <span className="status-indicator">
            ● AI Tutor
          </span>

        </header>

        <div className="home-content">

          <section className="welcome-section">

            <span className="welcome-tag">
              YOUR PERSONAL AI CLASSROOM
            </span>

            <h1>
              What would you like to learn today?
            </h1>

          </section>

          <section className="mode-section">

            <div className="mode-cards">

              {modes.map((item) => (

                <button
                  key={item.name}
                  className={`mode-card ${
                    mode === item.name ? 'active' : ''
                  }`}
                  onClick={() => selectMode(item.name)}
                >

                  <span className="mode-icon">
                    {item.icon}
                  </span>

                  <strong>{item.name}</strong>

                  {mode === item.name && (
                    <span className="mode-check">✓</span>
                  )}

                </button>

              ))}

            </div>

          </section>

          <section className="teaching-style-section" aria-label="Teaching style">
            <div className="teaching-style-heading">
              <strong>Teaching Style</strong>
              <span>Choose how Hillion explains your lesson</span>
            </div>
            <div className="teaching-style-options">
              <button
                type="button"
                className={`teaching-style-card ${teachingStyle === 'Normal' ? 'active' : ''}`}
                aria-pressed={teachingStyle === 'Normal'}
                onClick={() => setTeachingStyle('Normal')}
              >
                <strong>Normal</strong>
                <span>Thorough and structured teaching</span>
                {teachingStyle === 'Normal' && <span className="teaching-style-check">✓</span>}
              </button>
              <button
                type="button"
                className={`teaching-style-card ${teachingStyle === 'Gossip' ? 'active' : ''}`}
                aria-pressed={teachingStyle === 'Gossip'}
                onClick={() => setTeachingStyle('Gossip')}
              >
                <strong>Gossip</strong>
                <span>Shorter, lively explanations and stories</span>
                {teachingStyle === 'Gossip' && <span className="teaching-style-check">✓</span>}
              </button>
            </div>
          </section>

          <form
            className="lesson-entry"
            onSubmit={handleStart}
          >

            <label htmlFor="lesson-input">
              {instructions[mode].title}
            </label>

            <div className="lesson-input-box">

              <textarea
                id="lesson-input"
                placeholder={instructions[mode].placeholder}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={4}
              />

              {selectedFiles.length > 0 && (
                <div className="selected-files">
                  {selectedFiles.map((file, index) => (
                    <span key={index} className="selected-file-chip">
                      📄 {file.name}
                      <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setSelectedFiles(current => current.filter((_, fileIndex) => fileIndex !== index))}>×</button>
                    </span>
                  ))}
                </div>
              )}

              {showLinkInput && (
                <input
                  className="lesson-link-input"
                  type="url"
                  placeholder="Paste a webpage or resource link"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                />
              )}

              <div className="lesson-input-footer">

                <div className="input-tools">

                  <button
                    type="button"
                    className="input-tool"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Upload document"
                  >
                    <svg className="input-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
                      <path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
                    </svg>
                    <span className="input-tool-label">Upload</span>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.txt"
                    onChange={handleFiles}
                  />

                  <button
                    type="button"
                    className="input-tool"
                    onClick={() => setShowLinkInput(!showLinkInput)}
                    aria-label="Add link"
                  >
                    <svg className="input-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M10 13.5l4-4" />
                      <path d="M8.5 15H7a4 4 0 0 1 0-8h4" />
                      <path d="M15.5 9H17a4 4 0 0 1 0 8h-4" />
                    </svg>
                    <span className="input-tool-label">Link</span>
                  </button>

                  <div className="language-selector">

                    <svg className="language-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
                    </svg>

                    <select
                      value={language}
                      onChange={(event) => setLanguage(event.target.value)}
                      aria-label="Select language"
                    >
                      <option value="EN">EN</option>
                      <option value="FR">FR</option>
                      <option value="ES">ES</option>
                    </select>

                    <span>⌄</span>

                  </div>

                </div>

                <button
                  type="submit"
                  className="start-button"
                  disabled={
                    !input.trim() &&
                    selectedFiles.length === 0 &&
                    !link.trim()
                  }
                >
                  Start
                  <span>→</span>
                </button>

              </div>

            </div>

          </form>

          <div className="home-bottom-note">
            <span>✦</span>
            Every subject. Every level. One learning space.
          </div>

        </div>

      </section>

      {historyOpen && (
        <div className="dashboard-modal-backdrop" role="presentation" onClick={() => setHistoryOpen(false)}>
          <section className="dashboard-modal" role="dialog" aria-modal="true" aria-label="Lesson history" onClick={event => event.stopPropagation()}>
            <div className="dashboard-modal-heading">
              <div><small>YOUR WORKSPACE</small><h2>Lesson history</h2></div>
              <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close history">×</button>
            </div>
            {historyLessons.length ? [...historyLessons].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))).map((board, index) => (
              <div className="history-item" key={board.id || index}>
                <button
                  type="button"
                  className="history-item-open"
                  onPointerDown={() => beginLongPress(board)}
                  onPointerUp={stopLongPress}
                  onPointerLeave={stopLongPress}
                  onPointerCancel={stopLongPress}
                  onContextMenu={event => { event.preventDefault(); stopLongPress(); setManagementLesson(board) }}
                  onClick={() => openLessonFromHistory(board)}
                >
                  <span className="history-item-icon">▤</span>
                  <span className="history-item-text">
                    <strong>{board.pinned ? '📌 ' : ''}{board.title || board.topic || 'Untitled lesson'}</strong>
                    <small>{board.subject || board.learningMode || 'Saved lesson'} · {board.status || 'saved'}</small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
                <button type="button" className="history-item-menu" aria-label="Manage lesson" onClick={() => setManagementLesson(board)}>⋯</button>
              </div>
            )) : <p className="modal-empty">Your saved lessons will appear here after you complete or pause a lesson.</p>}
          </section>
        </div>
      )}

      {managementLesson && (
        <div className="dashboard-modal-backdrop history-action-backdrop" onClick={() => setManagementLesson(null)}>
          <section className="dashboard-modal history-action-modal" role="dialog" aria-modal="true" aria-label="Lesson actions" onClick={event => event.stopPropagation()}>
            <h3>{managementLesson.title || managementLesson.topic || 'Untitled lesson'}</h3>
            <button type="button" onClick={() => togglePin(managementLesson)}>{managementLesson.pinned ? 'Unpin lesson' : '📌 Pin lesson'}</button>
            <button type="button" onClick={() => { renameTargetRef.current = managementLesson; beginRename(managementLesson) }}>Rename lesson</button>
            <button type="button" className="history-delete-action" onClick={() => { setDeleteTarget(managementLesson); setManagementLesson(null) }}>Delete lesson</button>
            <button type="button" className="history-cancel-action" onClick={() => setManagementLesson(null)}>Cancel</button>
          </section>
        </div>
      )}

      {renameOpen && (
        <div className="dashboard-modal-backdrop" onClick={() => { setRenameOpen(false); renameTargetRef.current = null }}>
          <section className="dashboard-modal history-confirm-modal" role="dialog" aria-modal="true" aria-label="Rename lesson" onClick={event => event.stopPropagation()}>
            <h3>Rename lesson</h3>
            <input autoFocus value={renameValue} onChange={event => setRenameValue(event.target.value)} aria-label="New lesson title" />
            <div className="history-confirm-buttons">
              <button type="button" onClick={() => { setRenameOpen(false); renameTargetRef.current = null }}>Cancel</button>
              <button type="button" onClick={saveRename} disabled={!renameValue.trim()}>Save</button>
            </div>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="dashboard-modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <section className="dashboard-modal history-confirm-modal" role="alertdialog" aria-modal="true" aria-label="Confirm lesson deletion" onClick={event => event.stopPropagation()}>
            <h3>Delete this lesson?</h3>
            <p>This will permanently remove “{deleteTarget.title || deleteTarget.topic || 'Untitled lesson'}” from your History.</p>
            <div className="history-confirm-buttons">
              <button type="button" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button type="button" className="history-delete-confirm" onClick={confirmDelete}>Yes, delete</button>
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="dashboard-modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section className="dashboard-modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={event => event.stopPropagation()}>
            <div className="dashboard-modal-heading">
              <div><small>HILLION PREFERENCES</small><h2>Settings</h2></div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button>
            </div>
            <label className="settings-label" htmlFor="settings-language">Default lesson language</label>
            <select id="settings-language" value={language} onChange={event => setLanguage(event.target.value)}>
              <option value="EN">English</option><option value="FR">French</option><option value="ES">Spanish</option>
            </select>
            <div className="model-setup-panel">
              <div className="model-setup-heading">
                <strong>On-device AI model</strong>
                <span className={modelStatus.ready ? 'model-ready' : 'model-missing'}>{modelStatus.ready ? 'MODEL STORED' : 'NOT IMPORTED'}</span>
              </div>
              <p>{modelStatus.ready ? `A GGUF model is stored privately on this device (${modelStatus.sizeMB} MB).` : 'Import a GGUF model for private, on-device AI inference.'}</p>
              <button type="button" className="model-import-button" onClick={importOnDeviceModel} disabled={modelBusy}>
                {modelBusy ? 'Please wait…' : modelStatus.ready ? 'Replace GGUF model' : 'Import GGUF model'}
              </button>
              {modelStatus.ready && <button type="button" className="model-remove-button" onClick={removeOnDeviceModel} disabled={modelBusy}>Remove stored model</button>}
              {modelMessage && <small className="model-setup-message" role="status">{modelMessage}</small>}
              <small className="model-setup-note">The first lesson after importing may take longer while HILLION loads the model into memory. After that, inference runs locally without Termux or a separate server.</small>
            </div>
            <div className="model-setup-panel recovery-backup-panel">
              <div className="model-setup-heading"><strong>HILLION portable recovery</strong><span>ENCRYPTED</span></div>
              <p>Export your lessons and app records into an encrypted file. Keep the recovery code and file safe. The code alone cannot retrieve a backup that was never uploaded.</p>
              <button type="button" className="model-import-button" onClick={exportRecoveryBackup} disabled={recoveryBusy}>{recoveryBusy ? 'Please wait…' : 'Create encrypted backup'}</button>
              {recoveryCode && <div className="recovery-code-display"><small>YOUR RECOVERY CODE — SAVE IT SECURELY</small><code>{recoveryCode}</code></div>}
              <label className="settings-label" htmlFor="recovery-code-input">Recovery code</label>
              <input id="recovery-code-input" className="recovery-code-input" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value.toUpperCase())} placeholder="H5LL10N-…" autoCapitalize="characters" />
              <label className="settings-label" htmlFor="recovery-file-input">Encrypted backup file</label>
              <input id="recovery-file-input" type="file" accept="application/json,.json" onChange={event => setRecoveryBackupFile(event.target.files?.[0] || null)} />
              <button type="button" className="model-import-button" onClick={importRecoveryBackup} disabled={recoveryBusy || !recoveryBackupFile || !recoveryCode.trim()}>Restore HILLION backup</button>
              {recoveryMessage && <small className="model-setup-message" role="status">{recoveryMessage}</small>}
            </div>
            <p className="modal-empty">This portable backup currently covers HILLION localStorage records. The GGUF model file and cloud-only recovery are not included.</p>
            <button type="button" className="modal-done" onClick={() => setSettingsOpen(false)}>Done</button>
          </section>
        </div>
      )}

    </main>
  )
}