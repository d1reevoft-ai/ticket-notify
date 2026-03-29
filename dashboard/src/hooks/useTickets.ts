import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTickets, fetchTicketMessages, sendTicketMessage, editTicketMessage, deleteTicketMessage, fetchUserProfile, generateTicketSummary, generateSmartReply, closeTicket } from '../api/tickets';
import type { Ticket, TicketMessagesResponse, DiscordMessage } from '../api/tickets';

export const useTickets = () => {
    return useQuery({
        queryKey: ['tickets'],
        queryFn: fetchTickets,
        refetchInterval: 30000,
        refetchIntervalInBackground: true,
        staleTime: 5000,
        placeholderData: prev => prev ?? [],
    });
};

export const useUserProfile = (openerId: string | undefined) => {
    return useQuery({
        queryKey: ['userProfile', openerId],
        queryFn: () => fetchUserProfile(openerId!),
        enabled: !!openerId,
        staleTime: 30000,
    });
};

export const useTicketMessages = (id: string | undefined) => {
    return useQuery({
        queryKey: ['tickets', id, 'messages'],
        queryFn: () => fetchTicketMessages(id!),
        enabled: !!id,
        refetchInterval: 15000,
        staleTime: 3000,
    });
};

export const useSendTicketMessage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, content, replyTo, attachments }: { id: string; content: string; replyTo?: string; attachments?: any[] }) => sendTicketMessage(id, content, replyTo, attachments),
        onMutate: async (variables) => {
            // Cancel any outgoing refetches
            await queryClient.cancelQueries({ queryKey: ['tickets', variables.id, 'messages'] });

            const previousData = queryClient.getQueryData<TicketMessagesResponse>(['tickets', variables.id, 'messages']);

            // Optimistic: insert placeholder message immediately
            const optimisticMsg: DiscordMessage = {
                id: `optimistic-${Date.now()}`,
                type: 0,
                content: variables.content,
                channel_id: variables.id,
                _isMine: true,
                _isStaff: true,
                author: {
                    id: 'self',
                    username: 'Вы',
                    global_name: 'Вы',
                    avatar: '',
                    bot: false,
                },
                embeds: [],
                attachments: variables.attachments?.map((a, i) => ({
                    id: `att-${i}`,
                    filename: a.name,
                    url: a.data,
                    content_type: a.mime,
                })) || [],
                timestamp: new Date().toISOString(),
            };

            queryClient.setQueryData<TicketMessagesResponse>(
                ['tickets', variables.id, 'messages'],
                (old) => {
                    if (!old) return old;
                    return { ...old, messages: [...old.messages, optimisticMsg] };
                }
            );

            // Also update ticket list metadata
            queryClient.setQueryData<Ticket[]>(['tickets'], (old) => {
                if (!old) return old;
                return old.map(t => {
                    if (t.channelId !== variables.id) return t;
                    return { ...t, lastMessage: variables.content.slice(0, 200), lastMessageAt: Date.now() };
                });
            });

            return { previousData };
        },
        onError: (_err, variables, context) => {
            // Rollback on error
            if (context?.previousData) {
                queryClient.setQueryData(['tickets', variables.id, 'messages'], context.previousData);
            }
        },
        onSettled: (_data, _error, variables) => {
            // Background refetch to get the real message from Discord
            // Small delay to let Gateway event arrive first
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['tickets', variables.id, 'messages'] });
            }, 2000);
        },
    });
};

export const useEditTicketMessage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ ticketId, msgId, content }: { ticketId: string; msgId: string; content: string }) => editTicketMessage(ticketId, msgId, content),
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: ['tickets', variables.ticketId, 'messages'] });

            const previousData = queryClient.getQueryData<TicketMessagesResponse>(['tickets', variables.ticketId, 'messages']);

            // Optimistic: update the message content immediately
            queryClient.setQueryData<TicketMessagesResponse>(
                ['tickets', variables.ticketId, 'messages'],
                (old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        messages: old.messages.map((m) =>
                            m.id === variables.msgId ? { ...m, content: variables.content } : m
                        ),
                    };
                }
            );

            return { previousData };
        },
        onError: (_err, variables, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(['tickets', variables.ticketId, 'messages'], context.previousData);
            }
        },
        onSettled: (_data, _error, variables) => {
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['tickets', variables.ticketId, 'messages'] });
            }, 2000);
        },
    });
};

export const useDeleteTicketMessage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ ticketId, msgId }: { ticketId: string; msgId: string }) => deleteTicketMessage(ticketId, msgId),
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: ['tickets', variables.ticketId, 'messages'] });

            const previousData = queryClient.getQueryData<TicketMessagesResponse>(['tickets', variables.ticketId, 'messages']);

            // Optimistic: remove the message immediately
            queryClient.setQueryData<TicketMessagesResponse>(
                ['tickets', variables.ticketId, 'messages'],
                (old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        messages: old.messages.filter((m) => m.id !== variables.msgId),
                    };
                }
            );

            return { previousData };
        },
        onError: (_err, variables, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(['tickets', variables.ticketId, 'messages'], context.previousData);
            }
        },
    });
};

export const useTicketSummary = () => {
    return useMutation({
        mutationFn: ({ ticketId }: { ticketId: string }) => generateTicketSummary(ticketId),
    });
};

export const useSmartReply = () => {
    return useMutation({
        mutationFn: ({ ticketId }: { ticketId: string }) => generateSmartReply(ticketId),
    });
};

export const useCloseTicket = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ ticketId }: { ticketId: string }) => closeTicket(ticketId),
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: ['tickets'] });

            const previousData = queryClient.getQueryData<Ticket[]>(['tickets']);

            // Optimistic: remove the ticket from the list immediately
            queryClient.setQueryData<Ticket[]>(['tickets'], (old) => {
                if (!old) return old;
                return old.filter(t => t.channelId !== variables.ticketId);
            });

            return { previousData };
        },
        onError: (_err, _variables, context) => {
            // Rollback — put the ticket back
            if (context?.previousData) {
                queryClient.setQueryData(['tickets'], context.previousData);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['closedTickets'] });
            queryClient.invalidateQueries({ queryKey: ['closed-tickets'] });
        },
    });
};
