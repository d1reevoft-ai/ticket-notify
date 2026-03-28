import client from './client';

export interface FaqArticle {
    id: number;
    title: string;
    content: string;
    created_at: number;
}

export const fetchFaqArticles = async (): Promise<FaqArticle[]> => {
    const { data } = await client.get('/faq');
    return data;
};

export const generateFaqArticle = async (topic: string, limit?: number): Promise<FaqArticle> => {
    const { data } = await client.post('/faq/generate', { topic, limit });
    return data;
};

export const createFaqArticle = async (title: string, content: string): Promise<FaqArticle> => {
    const { data } = await client.post('/faq', { title, content });
    return data;
};

export const updateFaqArticle = async (id: number, title: string, content: string): Promise<void> => {
    await client.patch(`/faq/${id}`, { title, content });
};

export const deleteFaqArticle = async (id: number): Promise<void> => {
    await client.delete(`/faq/${id}`);
};

export const semanticSearchLogs = async (query: string): Promise<any[]> => {
    const { data } = await client.post('/logs/semantic-search', { query });
    return data;
};
