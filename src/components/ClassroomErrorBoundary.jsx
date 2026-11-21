import React from 'react'

class ClassroomErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[HILLION CLASSROOM RENDER ERROR]', error, errorInfo)
    this.setState({ errorInfo })
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999999,
          overflow: 'auto',
          padding: 20,
          background: '#fff8ed',
          color: '#252525',
          fontFamily: 'sans-serif'
        }}>
          <h2>Hillion classroom encountered an error</h2>
          <p>The diagnostic below will help us identify the cause. Your saved lesson has not been deleted.</p>
          <pre style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            padding: 14,
            background: '#fff',
            border: '1px solid #d8c8b5',
            borderRadius: 8
          }}>
            {String(this.state.error)}
            {'\n\n'}
            {this.state.errorInfo?.componentStack || this.state.error?.stack || ''}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '12px 18px', marginTop: 12 }}
          >
            Reload classroom
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ClassroomErrorBoundary
