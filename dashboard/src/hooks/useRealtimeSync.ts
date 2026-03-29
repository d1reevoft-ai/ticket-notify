/**
 * useRealtimeSync — единый глобальный хук для всех socket.io событий.
 * 
 * Вместо дублирования socket-подписок в App.tsx, Tickets.tsx, TicketDetail.tsx
 * мы подписываемся на ВСЕ события один раз и обновляем queryCache напрямую.
 * Это даёт мгновенные обновления без HTTP-запросов.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from './useSocket';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Ticket, DiscordMessage, TicketMessagesResponse } from '../api/tickets';

export function useRealtimeSync() {
    const socket = useSocket();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const location = useLocation();
    const locationRef = useRef(location);
    locationRef.current = location;

    useEffect(() => {
        if (!socket) return;

        // ═══════════════════════════════════════════════════════
        //  TICKET LIST EVENTS
        // ═══════════════════════════════════════════════════════

        const handleTicketNew = (data: any) => {
            // Вставляем новый тикет прямо в кэш — без HTTP-запроса
            queryClient.setQueryData<Ticket[]>(['tickets'], (old) => {
                if (!old) return old;
                // Проверяем что тикет ещё не в списке
                if (old.some(t => t.channelId === data.channelId)) return old;
                const newTicket: Ticket = {
                    channelId: data.channelId,
                    channelName: data.channelName || '',
                    guildId: data.guildId || '',
                    guildName: data.guildName || '',
                    createdAt: Date.now(),
                    lastMessage: '',
                    lastMessageAt: Date.now(),
                    firstStaffReplyAt: null,
                    openerId: data.openerId || '',
                    openerUsername: data.openerUsername || '',
                    lastStaffMessageAt: null,
                    waitingForReply: false,
                    activityTimerType: null,
                    priority: data.priority || 'normal',
                };
                return [newTicket, ...old];
            });
        };

        const handleTicketClosed = (data: any) => {
            const closedId = data.channelId;

            // Удаляем тикет из кэша
            queryClient.setQueryData<Ticket[]>(['tickets'], (old) => {
                if (!old) return old;
                return old.filter(t => t.channelId !== closedId);
            });

            // Инвалидируем закрытые тикеты
            queryClient.invalidateQueries({ queryKey: ['closedTickets'] });
            queryClient.invalidateQueries({ queryKey: ['closed-tickets'] });

            // Если пользователь сейчас смотрит этот тикет — навигируем на список
            const currentPath = locationRef.current.pathname;
            if (currentPath === `/tickets/${closedId}`) {
                navigate('/tickets', { replace: true });
            }
        };

        const handleTicketUpdated = (data: any) => {
            if (!data.channelId) {
                // Если нет channelId — фоновое обновление, делаем soft refetch
                queryClient.invalidateQueries({ queryKey: ['tickets'] });
                return;
            }
            // Обновляем конкретный тикет в кэше
            queryClient.setQueryData<Ticket[]>(['tickets'], (old) => {
                if (!old) return old;
                return old.map(t => {
                    if (t.channelId !== data.channelId) return t;
                    return {
                        ...t,
                        ...(data.lastMessage !== undefined && { lastMessage: data.lastMessage }),
                        ...(data.lastMessageAt !== undefined && { lastMessageAt: data.lastMessageAt }),
                        ...(data.waitingForReply !== undefined && { waitingForReply: data.waitingForReply }),
                        ...(data.activityTimerType !== undefined && { activityTimerType: data.activityTimerType }),
                        ...(data.firstStaffReplyAt !== undefined && { firstStaffReplyAt: data.firstStaffReplyAt }),
                        ...(data.openerId !== undefined && { openerId: data.openerId }),
                        ...(data.openerUsername !== undefined && { openerUsername: data.openerUsername }),
                    };
                });
            });
        };

        // ═══════════════════════════════════════════════════════
        //  TICKET MESSAGES (для любого открытого тикета)
        // ═══════════════════════════════════════════════════════

        const handleTicketMessage = (data: any) => {
            const channelId = data.channelId;
            if (!channelId) return;

            // Обновляем сообщения в кэше этого тикета
            if (data.message) {
                queryClient.setQueryData<TicketMessagesResponse>(
                    ['tickets', channelId, 'messages'],
                    (old) => {
                        if (!old || !old.messages) return old;
                        // Дедупликация по id
                        if (old.messages.some((m: DiscordMessage) => m.id === data.message.id)) return old;
                        return { ...old, messages: [...old.messages, data.message] };
                    }
                );
            }

            // Обновляем метаданные тикета в списке
            queryClient.setQueryData<Ticket[]>(['tickets'], (old) => {
                if (!old) return old;
                return old.map(t => {
                    if (t.channelId !== channelId) return t;
                    const preview = data.message?.content?.slice(0, 200) || t.lastMessage;
                    return {
                        ...t,
                        lastMessage: preview,
                        lastMessageAt: Date.now(),
                    };
                });
            });
        };

        const handleTicketMessageUpdate = (data: any) => {
            if (!data.channelId || !data.message) return;
            queryClient.setQueryData<TicketMessagesResponse>(
                ['tickets', data.channelId, 'messages'],
                (old) => {
                    if (!old || !old.messages) return old;
                    return {
                        ...old,
                        messages: old.messages.map((m: DiscordMessage) =>
                            m.id === data.message.id ? data.message : m
                        ),
                    };
                }
            );
        };

        const handleTicketMessageDelete = (data: any) => {
            if (!data.channelId || !data.messageId) return;
            queryClient.setQueryData<TicketMessagesResponse>(
                ['tickets', data.channelId, 'messages'],
                (old) => {
                    if (!old || !old.messages) return old;
                    return {
                        ...old,
                        messages: old.messages.filter((m: DiscordMessage) => m.id !== data.messageId),
                    };
                }
            );
        };

        // ═══════════════════════════════════════════════════════
        //  REACTIONS
        // ═══════════════════════════════════════════════════════

        const handleReactionAdd = (data: any) => {
            if (!data.channelId || !data.messageId || !data.reaction) return;
            queryClient.setQueryData<TicketMessagesResponse>(
                ['tickets', data.channelId, 'messages'],
                (old) => {
                    if (!old || !old.messages) return old;
                    return {
                        ...old,
                        messages: old.messages.map((m: DiscordMessage) => {
                            if (m.id !== data.messageId) return m;
                            const emoji = data.reaction.emoji;
                            const emojiKey = emoji?.id ? `${emoji.name}:${emoji.id}` : emoji?.name;
                            const reactions = [...(m.reactions || [])];
                            const idx = reactions.findIndex(r =>
                                (r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name) === emojiKey
                            );
                            if (idx >= 0) {
                                reactions[idx] = { ...reactions[idx], count: reactions[idx].count + 1 };
                            } else {
                                reactions.push({
                                    count: 1,
                                    me: data.reaction.user_id === data.reaction.me_id,
                                    emoji: { id: emoji?.id || null, name: emoji?.name || '' },
                                });
                            }
                            return { ...m, reactions };
                        }),
                    };
                }
            );
        };

        const handleReactionRemove = (data: any) => {
            if (!data.channelId || !data.messageId || !data.reaction) return;
            queryClient.setQueryData<TicketMessagesResponse>(
                ['tickets', data.channelId, 'messages'],
                (old) => {
                    if (!old || !old.messages) return old;
                    return {
                        ...old,
                        messages: old.messages.map((m: DiscordMessage) => {
                            if (m.id !== data.messageId) return m;
                            const emoji = data.reaction.emoji;
                            const emojiKey = emoji?.id ? `${emoji.name}:${emoji.id}` : emoji?.name;
                            let reactions = [...(m.reactions || [])];
                            const idx = reactions.findIndex(r =>
                                (r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name) === emojiKey
                            );
                            if (idx >= 0) {
                                if (reactions[idx].count <= 1) {
                                    reactions.splice(idx, 1);
                                } else {
                                    reactions[idx] = { ...reactions[idx], count: reactions[idx].count - 1 };
                                }
                            }
                            return { ...m, reactions };
                        }),
                    };
                }
            );
        };

        // ═══════════════════════════════════════════════════════
        //  MEMBERS
        // ═══════════════════════════════════════════════════════

        const handleMembersUpdated = () => {
            queryClient.invalidateQueries({ queryKey: ['members'] });
        };

        // ── Subscribe ─────────────────────────────────────────
        socket.on('ticket:new', handleTicketNew);
        socket.on('ticket:closed', handleTicketClosed);
        socket.on('ticket:updated', handleTicketUpdated);
        socket.on('ticket:message', handleTicketMessage);
        socket.on('ticket:message_update', handleTicketMessageUpdate);
        socket.on('ticket:message_delete', handleTicketMessageDelete);
        socket.on('ticket:message_reaction_add', handleReactionAdd);
        socket.on('ticket:message_reaction_remove', handleReactionRemove);
        socket.on('members:updated', handleMembersUpdated);

        return () => {
            socket.off('ticket:new', handleTicketNew);
            socket.off('ticket:closed', handleTicketClosed);
            socket.off('ticket:updated', handleTicketUpdated);
            socket.off('ticket:message', handleTicketMessage);
            socket.off('ticket:message_update', handleTicketMessageUpdate);
            socket.off('ticket:message_delete', handleTicketMessageDelete);
            socket.off('ticket:message_reaction_add', handleReactionAdd);
            socket.off('ticket:message_reaction_remove', handleReactionRemove);
            socket.off('members:updated', handleMembersUpdated);
        };
    }, [socket, queryClient, navigate]);
}
