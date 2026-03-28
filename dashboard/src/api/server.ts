import client from './client';
import type { DiscordMessage } from './tickets';

export type ServerChannel = {
    id: string;
    name: string;
    position: number;
    parentId: string | null;
    parentName: string | null;
    topic: string | null;
};

export type ServerCategory = {
    id: string;
    name: string;
    position: number;
};

export type ServerChannelsResponse = {
    categories: ServerCategory[];
    channels: ServerChannel[];
};

export type ServerMessagesResponse = {
    messages: DiscordMessage[];
};

export const fetchServerChannels = async (): Promise<ServerChannelsResponse> => {
    const { data } = await client.get('/server/channels');
    return data;
};

export const fetchServerMessages = async (
    channelId: string,
    before?: string
): Promise<ServerMessagesResponse> => {
    const params: Record<string, string> = { limit: '50' };
    if (before) params.before = before;
    const { data } = await client.get(`/server/channels/${channelId}/messages`, { params });
    return data;
};

export const sendServerMessage = async (
    channelId: string,
    content: string,
    replyTo?: string,
    attachments?: { name: string; data: string; mime: string }[]
): Promise<void> => {
    await client.post(`/server/channels/${channelId}/send`, { content, replyTo, attachments });
};
