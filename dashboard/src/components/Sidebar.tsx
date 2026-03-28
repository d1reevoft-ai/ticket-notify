import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Ticket, Keyboard, Clock, ScrollText, LogOut, Settings, Bot, TicketX, X, User, Brain, ShieldCheck, FileText, Server, BookOpen } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelRightClose } from 'lucide-react';

type NavAccent = 'primary' | 'admin';
type NavItem = {
    to: string;
    label: string;
    icon: ComponentType<{ className?: string; }>;
    accent: NavAccent;
};

const BASE_NAV_ITEMS: NavItem[] = [
    { to: '/tickets', icon: Ticket, label: 'Тикеты', accent: 'primary' },
    { to: '/analytics', icon: LayoutDashboard, label: 'Аналитика', accent: 'primary' },
    { to: '/binds', icon: Keyboard, label: 'Биндлы', accent: 'primary' },
    { to: '/shifts', icon: Clock, label: 'Смены', accent: 'primary' },
    { to: '/logs', icon: ScrollText, label: 'Логи', accent: 'primary' },
    { to: '/closed-tickets', icon: TicketX, label: 'Архив', accent: 'primary' },
    { to: '/autoreplies', icon: Bot, label: 'Авто-ответы', accent: 'primary' },
    { to: '/ai-learning', icon: Brain, label: 'Обучение ИИ', accent: 'primary' },
    { to: '/faq', icon: BookOpen, label: 'База Знаний', accent: 'primary' },
    { to: '/prompt', icon: FileText, label: 'Промпт', accent: 'primary' },
    { to: '/server', icon: Server, label: 'Сервер', accent: 'primary' },
    { to: '/profile', icon: User, label: 'Профиль', accent: 'primary' },
    { to: '/settings', icon: Settings, label: 'Настройки', accent: 'primary' },
];

const ADMIN_NAV_ITEM: NavItem = { to: '/admin', icon: ShieldCheck, label: 'Администрирование', accent: 'admin' };
const ADMIN_ALIASES = new Set(['d1reevo', 'd1reevof']);
const ACTIVE_PILL_TRANSITION = { type: 'tween', duration: 0.32, ease: [0.22, 1, 0.36, 1] as const };
const MOBILE_SIDEBAR_TRANSITION = { type: 'spring', stiffness: 220, damping: 28, mass: 0.8 };

type SidebarProps = {
    isCollapsed: boolean;
    onToggleCollapse: () => void;
};

export default function Sidebar({ isCollapsed, onToggleCollapse }: SidebarProps) {
    const { logout, user } = useAuth();
    const location = useLocation();
    const normalizedUsername = String(user?.username || '').trim().toLowerCase();
    const isAdmin = user?.role === 'admin' || user?.id === 1 || ADMIN_ALIASES.has(normalizedUsername);
    const [mobileOpen, setMobileOpen] = useState(false);

    const allNavItems = useMemo(
        () => (isAdmin ? [...BASE_NAV_ITEMS, ADMIN_NAV_ITEM] : BASE_NAV_ITEMS),
        [isAdmin]
    );

    useEffect(() => {
        const handler = () => setMobileOpen(prev => !prev);
        window.addEventListener('toggle-sidebar', handler);
        return () => window.removeEventListener('toggle-sidebar', handler);
    }, []);

    useEffect(() => {
        setMobileOpen(false);
    }, [location.pathname]);

    const renderNav = (isMobile: boolean) => (
        <nav className="flex-1 space-y-1 relative">
            {allNavItems.map((item) => {
                const isAdminItem = item.accent === 'admin';
                return (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                            cn(
                                'sidebar-link flex items-center gap-3 px-3 py-3 rounded-md transition-colors relative overflow-hidden group font-medium',
                                isActive
                                    ? isMobile
                                        ? isAdminItem
                                            ? 'text-foreground bg-purple-500/10 border-l-2 border-purple-500 rounded-r-md'
                                            : 'text-foreground bg-primary/10 border-l-2 border-primary rounded-r-md'
                                        : 'text-foreground'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                            )
                        }
                    >
                        {({ isActive }) => (
                            <>
                                {!isMobile && isActive && (
                                    <motion.span
                                        layoutId="sidebar-active-pill"
                                        transition={ACTIVE_PILL_TRANSITION}
                                        className={cn(
                                            'sidebar-active-pill pointer-events-none absolute inset-0 rounded-md border-l-2',
                                            isAdminItem
                                                ? 'bg-purple-500/10 border-purple-500'
                                                : 'bg-primary/10 border-primary'
                                        )}
                                    />
                                )}
                                <item.icon
                                    className={cn(
                                        'w-5 h-5 relative z-10 shrink-0',
                                        isActive && (isAdminItem ? 'text-purple-400' : 'text-primary')
                                    )}
                                />
                                <AnimatePresence>
                                    {(!isCollapsed || isMobile) && (
                                        <motion.span 
                                            initial={{ opacity: 0, width: 0 }}
                                            animate={{ opacity: 1, width: 'auto' }}
                                            exit={{ opacity: 0, width: 0 }}
                                            className="relative z-10 overflow-hidden whitespace-nowrap"
                                        >
                                            {item.label}
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                            </>
                        )}
                    </NavLink>
                );
            })}
        </nav>
    );

    const renderSidebarContent = (isMobile: boolean) => (
        <>
            <div className={cn("flex items-center justify-between px-2 mb-8 mt-2", isCollapsed && !isMobile ? "justify-center" : "")}>
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-8 h-8 rounded bg-primary flex items-center justify-center shrink-0 text-primary-foreground font-bold text-xl">T</div>
                    <AnimatePresence>
                        {(!isCollapsed || isMobile) && (
                            <motion.h1 
                                initial={{ opacity: 0, width: 0 }}
                                animate={{ opacity: 1, width: 'auto' }}
                                exit={{ opacity: 0, width: 0 }}
                                className="text-2xl font-rajdhani font-bold tracking-wider uppercase text-foreground whitespace-nowrap"
                            >
                                Notifier
                            </motion.h1>
                        )}
                    </AnimatePresence>
                </div>
                <button onClick={() => setMobileOpen(false)} className="md:hidden p-1.5 hover:bg-secondary rounded-lg transition-colors text-muted-foreground">
                    <X className="w-5 h-5" />
                </button>
            </div>

            {renderNav(isMobile)}

            <div className="mt-auto flex flex-col gap-2">
                {!isMobile && (
                    <button
                        onClick={onToggleCollapse}
                        className="flex items-center justify-center p-3 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors"
                        title={isCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
                    >
                        <motion.div animate={{ rotate: isCollapsed ? 180 : 0 }}>
                            <PanelRightClose className="w-5 h-5" />
                        </motion.div>
                    </button>
                )}
                <button
                    onClick={logout}
                    className="sidebar-logout flex items-center gap-3 px-3 py-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors font-medium"
                    title="Выйти"
                >
                    <LogOut className="w-5 h-5 shrink-0" />
                    <AnimatePresence>
                        {(!isCollapsed || isMobile) && (
                            <motion.span
                                initial={{ opacity: 0, width: 0 }}
                                animate={{ opacity: 1, width: 'auto' }}
                                exit={{ opacity: 0, width: 0 }}
                                className="overflow-hidden whitespace-nowrap"
                            >
                                Выйти
                            </motion.span>
                        )}
                    </AnimatePresence>
                </button>
            </div>
        </>
    );

    return (
        <>
            <motion.aside 
                initial={false}
                animate={{ width: isCollapsed ? 80 : 256 }}
                className="sidebar-shell hidden md:flex h-screen bg-card border-r border-border flex-col p-4 fixed left-0 top-0 z-50 overflow-hidden"
            >
                {renderSidebarContent(false)}
            </motion.aside>

            <AnimatePresence>
                {mobileOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setMobileOpen(false)}
                            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
                        />
                        <motion.aside
                            initial={{ x: -280 }}
                            animate={{ x: 0 }}
                            exit={{ x: -280 }}
                            transition={MOBILE_SIDEBAR_TRANSITION}
                            className="sidebar-shell md:hidden fixed left-0 top-0 w-72 h-screen bg-card border-r border-border flex flex-col p-4 z-[70]"
                        >
                            {renderSidebarContent(true)}
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
