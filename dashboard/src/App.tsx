import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useSocket } from './hooks/useSocket';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import DashboardLayout from './components/DashboardLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import Tickets from './pages/Tickets';
import TicketDetail from './pages/TicketDetail';
import Analytics from './pages/Analytics';
import Binds from './pages/Binds';
import Shifts from './pages/Shifts';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import AutoReplies from './pages/AutoReplies';
import ClosedTickets from './pages/ClosedTickets';
import ConversationLog from './pages/ConversationLog';
import AdminPanel from './pages/AdminPanel';
import Prompt from './pages/Prompt';
import Server from './pages/Server';
import FAQ from './pages/FAQ';

export default function App() {
    const { token, loading } = useAuth();
    const socket = useSocket();
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!socket || !token) return;
        const invalidateTickets = () => queryClient.invalidateQueries({ queryKey: ['tickets'] });
        const invalidateClosed = () => queryClient.invalidateQueries({ queryKey: ['closedTickets'] });
        
        socket.on('ticket:new', invalidateTickets);
        socket.on('ticket:closed', () => { invalidateTickets(); invalidateClosed(); });
        socket.on('ticket:updated', invalidateTickets);
        
        // Also listen to member updates globally
        socket.on('members:updated', () => {
            queryClient.invalidateQueries({ queryKey: ['members'] });
        });

        return () => {
            socket.off('ticket:new', invalidateTickets);
            socket.off('ticket:closed'); 
            socket.off('ticket:updated', invalidateTickets);
            socket.off('members:updated');
        };
    }, [socket, token, queryClient]);

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    return (
        <Routes>
            {!token ? (
                <>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </>
            ) : (
                <Route element={<DashboardLayout />}>
                    <Route path="/" element={<Navigate to="/tickets" replace />} />
                    <Route path="/tickets" element={<Tickets />} />
                    <Route path="/tickets/:id" element={<TicketDetail />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/binds" element={<Binds />} />
                    <Route path="/shifts" element={<Shifts />} />
                    <Route path="/logs" element={<Logs />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/autoreplies" element={<AutoReplies />} />
                    <Route path="/closed-tickets" element={<ClosedTickets />} />
                    <Route path="/ai-learning" element={<ConversationLog />} />
                    <Route path="/prompt" element={<Prompt />} />
                    <Route path="/server" element={<Server />} />
                    <Route path="/server/:channelId" element={<Server />} />
                    <Route path="/admin" element={<AdminPanel />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/faq" element={<FAQ />} />
                    <Route path="*" element={<Navigate to="/tickets" replace />} />
                </Route>
            )}
        </Routes>
    );
}
