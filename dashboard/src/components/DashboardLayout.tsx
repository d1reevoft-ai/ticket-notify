import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MemberPanel from './MemberPanel';
import { motion, AnimatePresence } from 'framer-motion';

export default function DashboardLayout() {
    const location = useLocation();
    const isServerPage = location.pathname.startsWith('/server');

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
                animate={{ marginLeft: isServerPage ? 0 : isSidebarCollapsed ? 80 : 256 }}
                transition={{ type: "tween", duration: 0.3 }}
                className={`flex-1 flex flex-col h-screen overflow-hidden ${isServerPage ? '' : 'md:ml-0'}`}
            >
                {!isServerPage && (
                    <Topbar
                        membersVisible={membersVisible}
                        onToggleMembers={() => setMembersVisible(v => !v)}
                    />
                )}
                <div className="flex-1 flex overflow-hidden relative">
                    <main className={`dashboard-main flex-1 z-0 overflow-y-auto custom-scrollbar overflow-x-hidden ${isServerPage ? 'p-3 md:p-4' : 'p-4 md:p-6'}`}>
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={location.pathname}
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -15 }}
                                transition={{ duration: 0.2 }}
                                className="h-full"
                            >
                                <Outlet />
                            </motion.div>
                        </AnimatePresence>
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
