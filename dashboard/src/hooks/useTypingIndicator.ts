import { useState, useEffect } from 'react';
import { useSocket } from './useSocket';

type TypingEvent = {
    channelId: string;
    guildId: string;
    userId: string;
    timestamp: number;
    member?: any;
};

export function useTypingIndicator(channelId?: string) {
    const socket = useSocket();
    const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!socket || !channelId) {
            setTypingUsers(new Set());
            return;
        }

        const handleTyping = (data: TypingEvent) => {
            if (data.channelId !== channelId) return;

            setTypingUsers(prev => {
                const copy = new Set(prev);
                copy.add(data.userId);
                return copy;
            });

            // Automatically remove user from typing list after 8 seconds
            setTimeout(() => {
                setTypingUsers(prev => {
                    const copy = new Set(prev);
                    copy.delete(data.userId);
                    return copy;
                });
            }, 8000);
        };

        const handleMessage = (data: any) => {
            // If the user sends a message, they are no longer typing
            const msgChannelId = data.channelId || data.message?.channel_id;
            if (msgChannelId !== channelId) return;
            const authorId = data.message?.author?.id;
            if (authorId) {
                setTypingUsers(prev => {
                    if (!prev.has(authorId)) return prev;
                    const copy = new Set(prev);
                    copy.delete(authorId);
                    return copy;
                });
            }
        };

        socket.on('server:typing', handleTyping);
        socket.on('server:message', handleMessage);
        socket.on('ticket:message', handleMessage); // For tickets

        return () => {
            socket.off('server:typing', handleTyping);
            socket.off('server:message', handleMessage);
            socket.off('ticket:message', handleMessage);
        };
    }, [socket, channelId]);

    // Format typing user names. Uses custom mapped resolution in components, 
    // so here we just return the raw IDs for the component to render using its mentionMap or similar.
    return Array.from(typingUsers);
}
