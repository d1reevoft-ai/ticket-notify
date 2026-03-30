import client from './client';

export interface FunAiMessage {
    role: 'user' | 'assistant';
    content: string;
    actions?: string;
    context_page?: string;
    created_at: number;
}

export interface FunAiMemoryEntry {
    id: number;
    type: string;
    category: string;
    question: string | null;
    content: string;
    source: string;
    confidence: number;
    usage_count: number;
    created_at: number;
    updated_at: number;
    expires_at: number | null;
}

export interface FunAiChatResponse {
    answer: string;
    level: string;
    source: string;
    actions: Array<{ type: string; params: string | null; raw: string }>;
    tokensUsed: number;
    durationMs: number;
}

export interface FunAiInsight {
    type: string;
    title: string;
    text: string;
    icon: string;
}

export interface FunAiSuggestion {
    text: string;
    icon: string;
}

export const funaiApi = {
    chat: async (message: string, currentPage: string = '') => {
        const { data } = await client.post<FunAiChatResponse>('/funai/chat', { message, currentPage });
        return data;
    },

    getConversations: async (limit = 50) => {
        const { data } = await client.get<{ conversations: FunAiMessage[] }>(`/funai/conversations?limit=${limit}`);
        return data;
    },

    clearConversations: async () => {
        const { data } = await client.delete('/funai/conversations');
        return data;
    },

    getMemory: async (params: { type?: string; category?: string; search?: string; limit?: number; offset?: number } = {}) => {
        const query = new URLSearchParams();
        if (params.type) query.set('type', params.type);
        if (params.category) query.set('category', params.category);
        if (params.search) query.set('search', params.search);
        if (params.limit) query.set('limit', String(params.limit));
        if (params.offset) query.set('offset', String(params.offset));
        const { data } = await client.get(`/funai/memory?${query.toString()}`);
        return data;
    },

    addMemory: async (entry: { type?: string; category?: string; question?: string; content: string; source?: string }) => {
        const { data } = await client.post('/funai/memory', entry);
        return data;
    },

    updateMemory: async (id: number, updates: { content?: string; question?: string; category?: string; confidence?: number }) => {
        const { data } = await client.put(`/funai/memory/${id}`, updates);
        return data;
    },

    deleteMemory: async (id: number) => {
        const { data } = await client.delete(`/funai/memory/${id}`);
        return data;
    },

    getStats: async () => {
        const { data } = await client.get('/funai/stats');
        return data;
    },

    resetStats: async () => {
        const { data } = await client.post('/funai/stats/reset');
        return data;
    },

    getInsights: async () => {
        const { data } = await client.get<{ insights: FunAiInsight[] }>('/funai/insights');
        return data;
    },

    getSuggestions: async (page: string = '/') => {
        const { data } = await client.get<{ suggestions: FunAiSuggestion[] }>(`/funai/suggestions?page=${encodeURIComponent(page)}`);
        return data;
    },

    getProviders: async () => {
        const { data } = await client.get('/funai/providers');
        return data;
    },

    learn: async () => {
        const { data } = await client.post('/funai/learn');
        return data;
    },

    execute: async (action: string, params: any = null) => {
        const { data } = await client.post('/funai/execute', { action, params });
        return data;
    },
};
