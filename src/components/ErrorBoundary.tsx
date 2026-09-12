import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { CoachMark } from '@/components/ui/Primitives'

interface State {
  error?: Error
}

/** Human, actionable failure state. Never shows a stack trace to the user. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[sportly] render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 text-center">
        <div className="max-w-[320px]">
          <CoachMark size={40} className="mx-auto" />
          <h1 className="title text-[22px] mt-5">Something went wrong.</h1>
          <p className="text-[14px] text-text-2 mt-2 text-pretty">Let’s try that again. Your data is safe on this device.</p>
          <div className="mt-6 space-y-2">
            <Button variant="primary" full onClick={() => window.location.reload()}>
              Retry
            </Button>
            <Button
              variant="ghost"
              full
              onClick={() => {
                window.location.href = import.meta.env.BASE_URL
              }}
            >
              Back home
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
