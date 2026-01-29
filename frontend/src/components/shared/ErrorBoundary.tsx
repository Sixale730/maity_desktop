'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw, Bug, Copy, Check, FileDown } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  copied: boolean
  exporting: boolean
  exported: boolean
}

/**
 * ErrorBoundary - Catches JavaScript errors in child components
 *
 * Features:
 * - Catches and displays errors gracefully
 * - Provides error details for debugging
 * - Allows copying error info for bug reports
 * - Provides recovery options (reload, retry)
 * - Reports errors to analytics/Sentry when available
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
      exporting: false,
      exported: false
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })

    // Log to console
    console.error('[ErrorBoundary] Caught error:', error)
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo)

    // Report to analytics if PostHog is available
    try {
      // @ts-ignore - PostHog may be available globally
      if (typeof window !== 'undefined' && window.posthog) {
        // @ts-ignore
        window.posthog.capture('react_error_boundary', {
          error_message: error.message,
          error_name: error.name,
          error_stack: error.stack?.substring(0, 1000), // Limit stack size
          component_stack: errorInfo.componentStack?.substring(0, 1000),
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
      }
    } catch (e) {
      console.error('[ErrorBoundary] Failed to report to analytics:', e)
    }
  }

  handleReload = () => {
    window.location.reload()
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false
    })
  }

  handleExportLogs = async () => {
    this.setState({ exporting: true })
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<string>('export_logs')
      this.setState({ exported: true })
      setTimeout(() => this.setState({ exported: false }), 3000)
      console.log('[ErrorBoundary] Logs exported:', result)
    } catch (e) {
      console.error('[ErrorBoundary] Failed to export logs:', e)
    } finally {
      this.setState({ exporting: false })
    }
  }

  handleCopyError = async () => {
    const { error, errorInfo } = this.state
    const errorReport = `
=== Maity Error Report ===
Time: ${new Date().toISOString()}
URL: ${window.location.href}

Error: ${error?.name || 'Unknown'}
Message: ${error?.message || 'No message'}

Stack Trace:
${error?.stack || 'No stack trace'}

Component Stack:
${errorInfo?.componentStack || 'No component stack'}
=========================
`.trim()

    try {
      await navigator.clipboard.writeText(errorReport)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch (e) {
      console.error('[ErrorBoundary] Failed to copy error:', e)
    }
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      const { error, errorInfo, copied, exporting, exported } = this.state

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="max-w-lg w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3 text-red-600">
              <AlertTriangle className="h-8 w-8" />
              <h1 className="text-xl font-semibold">Algo salió mal</h1>
            </div>

            {/* Description */}
            <p className="text-gray-600">
              Ha ocurrido un error inesperado. Puedes intentar recargar la aplicación
              o copiar los detalles del error para reportarlo.
            </p>

            {/* Error details (collapsible) */}
            <details className="bg-gray-50 rounded-md p-3 text-sm">
              <summary className="cursor-pointer text-gray-700 font-medium flex items-center gap-2">
                <Bug className="h-4 w-4" />
                Detalles del error
              </summary>
              <div className="mt-2 space-y-2">
                <div>
                  <span className="font-medium text-gray-700">Error: </span>
                  <span className="text-red-600">{error?.name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Mensaje: </span>
                  <span className="text-gray-600">{error?.message || 'Sin mensaje'}</span>
                </div>
                {errorInfo?.componentStack && (
                  <div>
                    <span className="font-medium text-gray-700">Componente: </span>
                    <pre className="mt-1 text-xs bg-gray-100 p-2 rounded overflow-x-auto max-h-32">
                      {errorInfo.componentStack.split('\n').slice(0, 5).join('\n')}
                    </pre>
                  </div>
                )}
              </div>
            </details>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                onClick={this.handleReload}
                variant="default"
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Recargar aplicación
              </Button>

              <Button
                onClick={this.handleRetry}
                variant="outline"
                className="flex items-center gap-2"
              >
                Intentar de nuevo
              </Button>

              <Button
                onClick={this.handleCopyError}
                variant="ghost"
                className="flex items-center gap-2"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copiar error
                  </>
                )}
              </Button>

              <Button
                onClick={this.handleExportLogs}
                variant="ghost"
                className="flex items-center gap-2"
                disabled={exporting}
              >
                {exported ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    Reporte exportado
                  </>
                ) : (
                  <>
                    <FileDown className="h-4 w-4" />
                    {exporting ? 'Exportando...' : 'Exportar reporte'}
                  </>
                )}
              </Button>
            </div>

            {/* Help text */}
            <p className="text-xs text-gray-400 pt-2">
              Si el problema persiste, por favor contacta al equipo de soporte
              con los detalles del error.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Higher-order component to wrap any component with error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode
) {
  return function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    )
  }
}

export default ErrorBoundary
