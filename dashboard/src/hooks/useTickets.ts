import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTickets, fetchTicketMessages, sendTicketMessage, editTicketMessage, fetchUserProfile, generateTicketSummary, generateSmartReply, closeTicket } from '../api/tickets';

export const useTickets = () => {
    return useQuery({
        queryKey: ['tickets'],
        queryFn: fetchTickets,
        refetchInterval: 60000,
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
    });
};

export const useSendTicketMessage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, content, replyTo, attachments }: { id: string; content: string; replyTo?: string; attachments?: any[] }) => sendTicketMessage(id, content, replyTo, attachments),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['tickets', variables.id, 'messages'] });
        },
    });
};

export const useEditTicketMessage = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ ticketId, msgId, content }: { ticketId: string; msgId: string; content: string }) => editTicketMessage(ticketId, msgId, content),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['tickets', variables.ticketId, 'messages'] });
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
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tickets'] });
        },
    });
};
