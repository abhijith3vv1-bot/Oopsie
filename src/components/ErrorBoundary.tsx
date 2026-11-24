import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AssistantOrb } from './AssistantOrb';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Unexpected application error.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Oopsie ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let friendly = 'Oopsie bumped into an unexpected snag while syncing your reminders.';
    if (this.state.message.includes('permission-denied') || this.state.message.includes('Missing or insufficient permissions')) {
      friendly = 'Your account session needs to refresh permissions to sync safely with the cloud.';
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFBF4] dark:bg-[#0E1525] p-6 text-[#16213E] dark:text-slate-100">
        <div className="max-w-md w-full rounded-3xl bg-white dark:bg-[#162038] border border-amber-200/80 dark:border-[#243252] p-7 text-center space-y-4 shadow-sm">
          <div className="flex justify-center">
            <AssistantOrb mood="oops" size="lg" />
          </div>
          <h1 className="text-xl font-semibold font-display">Oops, let&apos;s steady that!</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{friendly}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#E2554E] hover:bg-[#cf443d] text-white text-sm font-medium transition-colors"
          >
            Reload Oopsie
          </button>
        </div>
      </div>
    );
  }
}
