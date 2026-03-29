import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import client from '../api/client';

type AuthContextType = {
    token: string | null;
    user: any;
    login: (username: string, password: string) => Promise<{ success: boolean; pending?: boolean; error?: string }>;
    register: (username: string, password: string) => Promise<{ success: boolean; pending?: boolean; error?: string }>;
    loginWithGoogle: (credential: string) => Promise<{ success: boolean; pending?: boolean; error?: string }>;
    sendOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
    verifyOtp: (email: string, code: string) => Promise<{ success: boolean; pending?: boolean; error?: string }>;
    resetPassword: (username: string, newPassword: string) => Promise<{ success: boolean; message?: string; error?: string }>;
    changePassword: (current: string, newPass: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    loading: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [token, setToken] = useState<string | null>(localStorage.getItem('dashboard_token'));
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (token) {
            client.get('/auth/me')
                .then(res => setUser(res.data.user))
                .catch(() => {
                    localStorage.removeItem('dashboard_token');
                    setToken(null);
                    setUser(null);
                })
                .finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, [token]);

    const login = async (username: string, password: string) => {
        try {
            const { data } = await client.post('/auth/login', { username, password });
            if (data.pending) {
                return { success: false, pending: true };
            }
            localStorage.setItem('dashboard_token', data.token);
            setToken(data.token);
            setUser(data.user);
            return { success: true };
        } catch (err: any) {
            const message = err.response?.data?.error || 'Login failed';
            const isPending = message.includes('ожидает') || message.includes('pending');
            return { success: false, pending: isPending, error: message };
        }
    };

    const register = async (username: string, password: string) => {
        try {
            const { data } = await client.post('/auth/register', { username, password });
            if (data.pending) {
                return { success: true, pending: true };
            }
            // Legacy fallback if token is returned
            if (data.token) {
                localStorage.setItem('dashboard_token', data.token);
                setToken(data.token);
                setUser(data.user);
            }
            return { success: true };
        } catch (err: any) {
            const message = err.response?.data?.error || 'Registration failed';
            return { success: false, error: message };
        }
    };

    const loginWithGoogle = async (credential: string) => {
        try {
            const { data } = await client.post('/auth/google', { credential });
            if (data.pending) return { success: false, pending: true };
            localStorage.setItem('dashboard_token', data.token);
            setToken(data.token);
            setUser(data.user);
            return { success: true };
        } catch (err: any) {
            const message = err.response?.data?.error || 'Google login failed';
            const isPending = message.includes('ожидает') || message.includes('pending');
            return { success: false, pending: isPending, error: message };
        }
    };

    const sendOtp = async (email: string) => {
        try {
            await client.post('/auth/otp/send', { email });
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.response?.data?.error || 'Failed to send OTP' };
        }
    };

    const verifyOtp = async (email: string, code: string) => {
        try {
            const { data } = await client.post('/auth/otp/verify', { email, code });
            if (data.pending) return { success: false, pending: true };
            localStorage.setItem('dashboard_token', data.token);
            setToken(data.token);
            setUser(data.user);
            return { success: true };
        } catch (err: any) {
            const message = err.response?.data?.error || 'OTP verification failed';
            const isPending = message.includes('ожидает') || message.includes('pending');
            return { success: false, pending: isPending, error: message };
        }
    };

    const logout = () => {
        localStorage.removeItem('dashboard_token');
        setToken(null);
        setUser(null);
    };

    const resetPassword = async (username: string, newPassword: string) => {
        try {
            const { data } = await client.post('/auth/reset-password', { username, newPassword });
            return { success: true, message: data.message };
        } catch (err: any) {
            return { success: false, error: err.response?.data?.error || 'Failed to reset password' };
        }
    };

    const changePassword = async (currentPassword: string, newPassword: string) => {
        try {
            await client.put('/auth/password', { currentPassword, newPassword });
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.response?.data?.error || 'Failed to change password' };
        }
    };

    return (
        <AuthContext.Provider value={{ token, user, login, register, loginWithGoogle, sendOtp, verifyOtp, resetPassword, changePassword, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
};
