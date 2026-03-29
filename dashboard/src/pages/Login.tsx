import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'framer-motion';
import { Lock, ArrowRight, User, Clock } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';

export default function Login() {
    // Shared state
    const [error, setError] = useState('');
    const [isPending, setIsPending] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    
    // Auth Hooks
    const { login, loginWithGoogle, resetPassword } = useAuth();
    const navigate = useNavigate();

    // Password Form State
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

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

    const [isForgot, setIsForgot] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [forgotMessage, setForgotMessage] = useState('');

    const handleResetSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        const result = await resetPassword(username, newPassword);
        if (result.success) {
            setIsForgot(false);
            setNewPassword('');
            setPassword('');
            setForgotMessage('Пароль успешно изменен! Выполните вход.');
        } else {
            setError(result.error || 'Ошибка при сбросе пароля');
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
                    <p className="text-muted-foreground mt-2">{isForgot ? 'Восстановление пароля' : 'Войти в панель управления'}</p>
                </div>

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
                ) : isForgot ? (
                    <motion.div
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="space-y-4"
                    >
                        {forgotMessage && <p className="text-green-500 text-sm font-medium text-center">{forgotMessage}</p>}
                        {error && <p className="text-destructive text-sm font-medium text-center">{error}</p>}

                        <form onSubmit={handleResetSubmit} className="space-y-4">
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Ваш логин"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-secondary/50 border border-border text-foreground pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                />
                            </div>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <input
                                    type="password"
                                    placeholder="Новый пароль"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full bg-secondary/50 border border-border text-foreground pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={isLoading || !username || !newPassword}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                            >
                                {isLoading ? 'Сброс...' : 'Изменить пароль'}
                            </button>
                        </form>
                        <div className="text-center mt-4">
                            <button
                                onClick={() => { setIsForgot(false); setError(''); setForgotMessage(''); }}
                                className="text-primary text-sm hover:underline"
                            >
                                ← Вернуться ко входу
                            </button>
                        </div>
                    </motion.div>
                ) : (
                    <motion.form 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        onSubmit={handlePasswordSubmit} 
                        className="space-y-4"
                    >
                        {forgotMessage && <p className="text-green-500 text-sm font-medium text-center">{forgotMessage}</p>}
                        {error && <p className="text-destructive text-sm font-medium">{error}</p>}
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

                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => { setIsForgot(true); setError(''); setForgotMessage(''); }}
                                className="text-primary text-xs hover:underline"
                            >
                                Забыли пароль?
                            </button>
                        </div>

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

                {!isPending && !isForgot && (
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

                {!isPending && !isForgot && (
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
