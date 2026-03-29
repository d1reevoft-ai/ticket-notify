import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MemberPanel from './MemberPanel';
import ErrorBoundary from './ErrorBoundary';
import { motion } from 'framer-motion';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { useMediaQuery } from '../hooks/useMediaQuery';

export default function DashboardLayout() {
    const location = useLocation();
    const isServerPage = location.pathname.startsWith('/server');
    const isMobile = useMediaQuery('(max-width: 768px)');

    // Global real-time socket updates for tickets/messages
    useRealtimeSync();

    const [membersVisible, setMembersVisible] = useState(() => {
        return localStorage.getItem('dashboard_members_panel') !== 'hidden';
    });

    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
        return localStorage.getItem('dashboard_sidebar_collapsed') === 'true';
    });

    useEffect(() => {
        localStorage.setItem('dashboard_members_panel', membersVisible ? 'visible' : 'hidden');
    }, [membersVisible]);

    useEffect(() => {
        localStorage.setItem('dashboard_sidebar_collapsed', isSidebarCollapsed ? 'true' : 'false');
    }, [isSidebarCollapsed]);

    return (
        <div className="dashboard-shell h-screen bg-background text-foreground flex overflow-hidden">
            {!isServerPage && (
                <Sidebar 
                    isCollapsed={isSidebarCollapsed} 
                    onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)} 
                />
            )}
            <motion.div 
                animate={{ marginLeft: isServerPage || isMobile ? 0 : isSidebarCollapsed ? 80 : 256 }}
                transition={{ type: "tween", duration: 0.3 }}
                className="flex-1 flex flex-col h-screen overflow-hidden"
            >
                {!isServerPage && (
                    <Topbar
                        membersVisible={membersVisible}
                        onToggleMembers={() => setMembersVisible(v => !v)}
                    />
                )}
                <div className="flex-1 flex overflow-hidden relative">
                    <main className={`dashboard-main flex-1 z-0 overflow-y-auto custom-scrollbar overflow-x-hidden ${isServerPage ? 'p-3 md:p-4' : 'p-4 md:p-6'}`}>
                        <div key={isServerPage ? 'server' : location.pathname} className="h-full animate-fade-in">
                            <ErrorBoundary key={isServerPage ? 'server' : location.pathname}>
                                <Outlet />
                            </ErrorBoundary>
                        </div>
                    </main>
                    {membersVisible && (
                        <div className="hidden lg:block relative z-10 shrink-0">
                            <MemberPanel onClose={() => setMembersVisible(false)} />
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
