import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, ArrowRight, User, Clock, Mail, Key } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';

export default function Login() {
    // Shared state
    const [error, setError] = useState('');
    const [isPending, setIsPending] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    
    // Auth Hooks
    const { login, loginWithGoogle, sendOtp, verifyOtp } = useAuth();
    const navigate = useNavigate();

    // Mode state
    type LoginMethod = 'password' | 'email';
    const [method, setMethod] = useState<LoginMethod>('password');

    // Password Form State
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    // Email OTP Form State
    const [email, setEmail] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [otpStep, setOtpStep] = useState<'email' | 'code'>('email');

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsPending(false);
        setIsLoading(true);
        const result = await login(username, password);
        if (result.success) {
            navigate('/tickets');
        } else if (result.pending) {
            setIsPending(true);
        } else {
            setError(result.error || 'Неверный логин или пароль');
        }
        setIsLoading(false);
    };

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        setError('');
        setIsLoading(true);
        const result = await sendOtp(email);
        if (result.success) {
            setOtpStep('code');
        } else {
            setError(result.error || 'Не удалось отправить код');
        }
        setIsLoading(false);
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!otpCode) return;
        setError('');
        setIsPending(false);
        setIsLoading(true);
        const result = await verifyOtp(email, otpCode);
        if (result.success) {
            navigate('/tickets');
        } else if (result.pending) {
            setIsPending(true);
        } else {
            setError(result.error || 'Неверный код');
        }
        setIsLoading(false);
    };

    const handleGoogleSuccess = async (credentialResponse: any) => {
        setError('');
        setIsLoading(true);
        const result = await loginWithGoogle(credentialResponse.credential);
        if (result.success) {
            navigate('/tickets');
        } else if (result.pending) {
            setIsPending(true);
        } else {
            setError(result.error || 'Ошибка входа через Google');
        }
        setIsLoading(false);
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute inset-0 z-0 opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/40 via-background to-background"></div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-8 relative z-10 shadow-2xl"
            >
                <div className="flex flex-col items-center mb-6">
                    <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-4 text-primary">
                        <Lock className="w-8 h-8" />
                    </div>
                    <h1 className="text-3xl font-rajdhani font-bold text-foreground tracking-wide uppercase">Notifier</h1>
                    <p className="text-muted-foreground mt-2">Войти в панель управления</p>
                </div>

                {/* Tabs */}
                {!isPending && (
                    <div className="flex rounded-lg bg-secondary/50 p-1 mb-6">
                        <button
                            onClick={() => { setMethod('password'); setError(''); }}
                            className={\`flex-1 py-2 text-sm font-medium rounded-md transition-all \${method === 'password' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}\`}
                        >
                            Пароль
                        </button>
                        <button
                            onClick={() => { setMethod('email'); setError(''); }}
                            className={\`flex-1 py-2 text-sm font-medium rounded-md transition-all \${method === 'email' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}\`}
                        >
                            Код на Email
                        </button>
                    </div>
                )}

                {isPending ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center gap-4 py-6 text-center"
                    >
                        <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center border border-yellow-500/30">
                            <Clock className="w-8 h-8 text-yellow-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-foreground">Ожидайте подтверждения</h2>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                            Ваш аккаунт ожидает одобрения администратора.
                            Вы получите доступ после подтверждения.
                        </p>
                        <button
                            onClick={() => { setIsPending(false); setError(''); }}
                            className="text-primary text-sm hover:underline"
                        >
                            ← Назад
                        </button>
                    </motion.div>
                ) : (
                    <AnimatePresence mode="wait">
                        {method === 'password' && (
                            <motion.form 
                                key="password-form"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 10 }}
                                onSubmit={handlePasswordSubmit} 
                                className="space-y-4"
                            >
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <input
                                        type="text"
                                        placeholder="Имя пользователя"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="w-full bg-secondary/50 border border-border text-foreground pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                    />
                                </div>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <input
                                        type="password"
                                        placeholder="Пароль"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-secondary/50 border border-border text-foreground pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                    />
                                </div>
                                {error && <p className="text-destructive text-sm font-medium">{error}</p>}

                                <button
                                    type="submit"
                                    disabled={isLoading || !username || !password}
                                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                                >
                                    {isLoading ? 'Вход...' : 'Войти'}
                                    {!isLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                                </button>
                            </motion.form>
                        )}

                        {method === 'email' && (
                            <motion.div 
                                key="email-form"
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                            >
                                {otpStep === 'email' ? (
                                    <form onSubmit={handleSendOtp} className="space-y-4">
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                            <input
                                                type="email"
                                                placeholder="Введите ваш Email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full bg-secondary/50 border border-border text-foreground pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                                required
                                            />
                                        </div>
                                        {error && <p className="text-destructive text-sm font-medium">{error}</p>}
                                        <button
                                            type="submit"
                                            disabled={isLoading || !email}
                                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                                        >
                                            {isLoading ? 'Отправка...' : 'Получить код'}
                                            {!isLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                                        </button>
                                    </form>
                                ) : (
                                    <form onSubmit={handleVerifyOtp} className="space-y-4">
                                        <p className="text-sm text-muted-foreground text-center mb-2">
                                            Код отправлен на <b>{email}</b>.{' '}
                                            <button type="button" onClick={() => setOtpStep('email')} className="text-primary hover:underline">Изменить</button>
                                        </p>
                                        <div className="relative">
                                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                            <input
                                                type="text"
                                                maxLength={6}
                                                placeholder="6-значный код"
                                                value={otpCode}
                                                onChange={(e) => setOtpCode(e.target.value.replace(/\\D/g, ''))}
                                                className="w-full bg-secondary/50 border border-border text-foreground pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-center tracking-[0.5em] font-mono"
                                                required
                                            />
                                        </div>
                                        {error && <p className="text-destructive text-sm font-medium text-center">{error}</p>}
                                        <button
                                            type="submit"
                                            disabled={isLoading || otpCode.length < 6}
                                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                                        >
                                            {isLoading ? 'Проверка...' : 'Войти'}
                                            {!isLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                                        </button>
                                    </form>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                )}

                {!isPending && (
                    <>
                        <div className="mt-6 mb-6 flex items-center justify-center space-x-4">
                            <div className="h-px bg-border flex-1"></div>
                            <span className="text-muted-foreground text-xs uppercase tracking-wider">или</span>
                            <div className="h-px bg-border flex-1"></div>
                        </div>

                        <div className="flex justify-center">
                            <GoogleLogin
                                onSuccess={handleGoogleSuccess}
                                onError={() => setError('Google OAuth окно закрыто или произошла ошибка')}
                                theme="filled_black"
                                shape="circle"
                                text="continue_with"
                            />
                        </div>
                    </>
                )}

                {!isPending && method === 'password' && (
                    <div className="mt-6 text-center">
                        <p className="text-muted-foreground text-sm">
                            Нет аккаунта?{' '}
                            <Link to="/register" className="text-primary hover:text-primary/80 font-medium transition-colors">
                                Зарегистрироваться
                            </Link>
                        </p>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
