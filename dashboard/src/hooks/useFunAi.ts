import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { funaiApi, type FunAiChatResponse, type FunAiInsight, type FunAiSuggestion, type FunAiSession } from '../api/funai';

// simple quick uuid
function generateId() {
    return Math.random().toString(36).substring(2, 15);
}

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
    const [chatSessions, setChatSessions] = useState<FunAiSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string>('default');
    
    // We use a ref so we only load a specific session ID once per switch
    const loadedSessionRef = useRef<string | null>(null);
    const insightTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Load sessions on open
    const loadSessions = useCallback(async () => {
        try {
            const data = await funaiApi.getSessions();
            if (data.sessions) {
                setChatSessions(data.sessions);
                // If we don't have an active session, or it's default, pick the latest one
                if (data.sessions.length > 0 && activeSessionId === 'default' && loadedSessionRef.current === null) {
                    setActiveSessionId(data.sessions[0].id);
                }
            }
        } catch (e) {}
    }, [activeSessionId]);

    useEffect(() => {
        if (isPanelOpen) {
            loadSessions();
        }
    }, [isPanelOpen, loadSessions]);

    // Load conversation history when activeSession changes
    useEffect(() => {
        if (isPanelOpen && loadedSessionRef.current !== activeSessionId) {
            loadedSessionRef.current = activeSessionId;
            setMessages([]); // clear current view
            funaiApi.getConversations(50, activeSessionId).then(data => {
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
    }, [isPanelOpen, activeSessionId]);

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
            const response: FunAiChatResponse = await funaiApi.chat(text.trim(), location.pathname, activeSessionId);
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
            loadSessions(); // refresh history topics list if new chat started
        }
    }, [isThinking, location.pathname, activeSessionId, loadSessions]);

    const clearHistory = useCallback(async () => {
        try {
            await funaiApi.clearConversations(activeSessionId);
            setMessages([]);
            loadSessions();
        } catch {}
    }, [activeSessionId, loadSessions]);

    const newSession = useCallback(() => {
        const id = generateId();
        setActiveSessionId(id);
        setMessages([]);
        loadedSessionRef.current = id;
    }, []);

    const switchSession = useCallback((id: string) => {
        if (id !== activeSessionId) {
            setActiveSessionId(id);
        }
    }, [activeSessionId]);

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
        chatSessions,
        activeSessionId,
        newSession,
        switchSession,
        clearHistory,
        isPanelOpen,
        togglePanel,
        openPanel,
        closePanel,
    };
}
