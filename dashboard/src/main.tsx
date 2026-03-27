import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: false,
        },
    },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <GoogleOAuthProvider clientId="12114264509-3cfs2ulijm663e5psk6btq83k15ib37g.apps.googleusercontent.com">
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <ThemeProvider>
                        <AuthProvider>
                            <App />
                        </AuthProvider>
                    </ThemeProvider>
                </BrowserRouter>
            </QueryClientProvider>
        </GoogleOAuthProvider>
    </React.StrictMode>
);
