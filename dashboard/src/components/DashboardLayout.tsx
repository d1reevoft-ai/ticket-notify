import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MemberPanel from './MemberPanel';

export default function DashboardLayout() {
    const location = useLocation();
    const isServerPage = location.pathname.startsWith('/server');

    const [membersVisible, setMembersVisible] = useState(() => {
        return localStorage.getItem('dashboard_members_panel') !== 'hidden';
    });

    useEffect(() => {
        localStorage.setItem('dashboard_members_panel', membersVisible ? 'visible' : 'hidden');
    }, [membersVisible]);

    return (
        <div className="dashboard-shell h-screen bg-background text-foreground flex overflow-hidden">
            {!isServerPage && <Sidebar />}
            <div className={`flex-1 flex flex-col h-screen overflow-hidden ${isServerPage ? '' : 'md:ml-64'}`}>
                {!isServerPage && (
                    <Topbar
                        membersVisible={membersVisible}
                        onToggleMembers={() => setMembersVisible(v => !v)}
                    />
                )}
                <div className="flex-1 flex overflow-hidden">
                    <main className={`dashboard-main flex-1 z-0 overflow-y-auto custom-scrollbar ${isServerPage ? 'p-3 md:p-4' : 'p-4 md:p-6'}`}>
                        <Outlet />
                    </main>
                    {!isServerPage && membersVisible && (
                        <div className="hidden lg:block">
                            <MemberPanel onClose={() => setMembersVisible(false)} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
