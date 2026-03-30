import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { funaiApi, type FunAiChatResponse, type FunAiInsight, type FunAiSuggestion } from '../api/funai';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    level?: string;
    source?: string;
    actions?: Array<{ type: string; params: string | null; raw: string }>;
    tokensUsed?: number;
    durationMs?: number;
    timestamp: number;
}

export function useFunAi() {
    const location = useLocation();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [insights, setInsights] = useState<FunAiInsight[]>([]);
    const [insightCount, setInsightCount] = useState(0);
    const [suggestions, setSuggestions] = useState<FunAiSuggestion[]>([]);
    const loadedRef = useRef(false);
    const insightTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Load conversation history on first open
    useEffect(() => {
        if (isPanelOpen && !loadedRef.current) {
            loadedRef.current = true;
            funaiApi.getConversations(50).then(data => {
                if (data.conversations && data.conversations.length > 0) {
                    setMessages(data.conversations.map((msg, i) => ({
                        id: `hist-${i}`,
                        role: msg.role as 'user' | 'assistant',
                        content: msg.content,
                        timestamp: msg.created_at,
                    })));
                }
            }).catch(() => {});
        }
    }, [isPanelOpen]);

    // Fetch suggestions when page changes
    useEffect(() => {
        funaiApi.getSuggestions(location.pathname).then(data => {
            setSuggestions(data.suggestions || []);
        }).catch(() => {});
    }, [location.pathname]);

    // Poll insights periodically
    useEffect(() => {
        const fetchInsights = () => {
            funaiApi.getInsights().then(data => {
                setInsights(data.insights || []);
                setInsightCount(data.insights?.length || 0);
            }).catch(() => {});
        };
        fetchInsights();
        insightTimerRef.current = setInterval(fetchInsights, 60000);
        return () => {
            if (insightTimerRef.current) clearInterval(insightTimerRef.current);
        };
    }, []);

    const sendMessage = useCallback(async (text: string) => {
        if (!text.trim() || isThinking) return;

        const userMsg: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: text.trim(),
            timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMsg]);
        setIsThinking(true);

        try {
            const response: FunAiChatResponse = await funaiApi.chat(text.trim(), location.pathname);
            const aiMsg: ChatMessage = {
                id: `ai-${Date.now()}`,
                role: 'assistant',
                content: response.answer,
                level: response.level,
                source: response.source,
                actions: response.actions,
                tokensUsed: response.tokensUsed,
                durationMs: response.durationMs,
                timestamp: Date.now(),
            };
            setMessages(prev => [...prev, aiMsg]);
        } catch (err: any) {
            const errorMsg: ChatMessage = {
                id: `err-${Date.now()}`,
                role: 'assistant',
                content: `⚠️ Ошибка: ${err?.response?.data?.error || err?.message || 'Не удалось получить ответ'}`,
                level: 'error',
                timestamp: Date.now(),
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsThinking(false);
        }
    }, [isThinking, location.pathname]);

    const clearHistory = useCallback(async () => {
        try {
            await funaiApi.clearConversations();
            setMessages([]);
        } catch {}
    }, []);

    const togglePanel = useCallback(() => {
        setIsPanelOpen(prev => !prev);
    }, []);

    const openPanel = useCallback(() => setIsPanelOpen(true), []);
    const closePanel = useCallback(() => setIsPanelOpen(false), []);

    return {
        messages,
        sendMessage,
        isThinking,
        insights,
        insightCount,
        suggestions,
        clearHistory,
        isPanelOpen,
        togglePanel,
        openPanel,
        closePanel,
    };
}
