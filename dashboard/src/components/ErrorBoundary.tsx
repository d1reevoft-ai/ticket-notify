import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallbackMessage?: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 max-w-md text-center">
                        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
                        <h3 className="font-rajdhani font-bold text-lg text-foreground mb-2">
                            Произошла ошибка
                        </h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            {this.props.fallbackMessage || 'Что-то пошло не так при отображении этой страницы.'}
                        </p>
                        {this.state.error && (
                            <pre className="text-xs text-red-400 bg-black/20 rounded-lg p-3 mb-4 text-left overflow-auto max-h-24 custom-scrollbar">
                                {this.state.error.message}
                            </pre>
                        )}
                        <button
                            onClick={this.handleReset}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-semibold"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Попробовать снова
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
