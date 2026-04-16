import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Trash2, Sparkles, MessageSquare, ChevronDown, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import FunAiMessage from './FunAiMessage';
import type { ChatMessage } from '../hooks/useFunAi';
import type { FunAiSuggestion, FunAiSession } from '../api/funai';

interface FunAiPanelProps {
    isOpen: boolean;
    onClose: () => void;
    messages: ChatMessage[];
    isThinking: boolean;
    suggestions: FunAiSuggestion[];
    chatSessions: FunAiSession[];
    activeSessionId: string;
    newSession: () => void;
    switchSession: (id: string) => void;
    onSend: (text: string) => void;
    onClear: () => void;
}

export default function FunAiPanel({
    isOpen,
    onClose,
    messages,
    isThinking,
    suggestions,
    chatSessions,
    activeSessionId,
    newSession,
    switchSession,
    onSend,
    onClear,
}: FunAiPanelProps) {
    const [input, setInput] = useState('');
    const [showSessions, setShowSessions] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const navigate = useNavigate();

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isThinking]);

    // Focus input when panel opens
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen]);

    const handleSend = useCallback(() => {
        if (!input.trim() || isThinking) return;
        onSend(input.trim());
        setInput('');
    }, [input, isThinking, onSend]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleAction = (action: { type: string; params: string | null }) => {
        if (action.type === 'navigate' || action.type.startsWith('navigate:')) {
            const page = action.params || '/';
            navigate(page);
        }
    };

    const handleSuggestionClick = (text: string) => {
        onSend(text);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop removed so the user can interact with the dashboard while panel is open */}
                    {/* Panel */}
                    <motion.div
                        className="funai-panel"
                        initial={{ x: 400, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: 400, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                        {/* Header */}
                        <div className="funai-panel__header relative z-20">
                            <div 
                                className="funai-panel__title cursor-pointer select-none group"
                                onClick={() => setShowSessions(prev => !prev)}
                            >
                                <span className="funai-panel__logo group-hover:scale-110 transition-transform">🧠</span>
                                <div>
                                    <h3 className="flex items-center gap-1.5 transition-colors group-hover:text-white">
                                        FunAI 
                                        <ChevronDown className={`w-3.5 h-3.5 text-white/50 transition-transform duration-300 ${showSessions ? 'rotate-180' : ''}`} />
                                    </h3>
                                    <span className="funai-panel__status">
                                        <span className="funai-panel__status-dot" />
                                        Активен
                                    </span>
                                </div>
                            </div>
                            <div className="funai-panel__header-actions">
                                <button
                                    className="funai-panel__header-btn"
                                    onClick={onClear}
                                    title="Очистить историю"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                                <button
                                    className="funai-panel__header-btn"
                                    onClick={onClose}
                                    title="Закрыть"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Sessions Dropdown */}
                            <AnimatePresence>
                                {showSessions && (
                                    <>
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="fixed inset-0 z-10"
                                            onClick={() => setShowSessions(false)}
                                        />
                                        <motion.div
                                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                            transition={{ duration: 0.2 }}
                                            className="absolute top-[60px] left-4 w-[280px] z-30 funai-panel__sessions-dropdown"
                                        >
                                            <div className="flex justify-between items-center mb-2 px-1">
                                                <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">История чатов</span>
                                                <button 
                                                    onClick={() => { newSession(); setShowSessions(false); }} 
                                                    className="flex items-center gap-1.5 text-[11px] font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-1 rounded-md transition-all"
                                                >
                                                    <Plus className="w-3.5 h-3.5" /> Новый
                                                </button>
                                            </div>
                                            <div className="max-h-[260px] overflow-y-auto custom-scrollbar flex flex-col gap-1.5 pr-1">
                                                {chatSessions.length === 0 && (
                                                    <div className="text-center text-white/40 text-xs py-5">Нет истории чатов</div>
                                                )}
                                                {chatSessions.map(session => (
                                                    <button
                                                        key={session.id}
                                                        onClick={() => { switchSession(session.id); setShowSessions(false); }}
                                                        className={`text-left px-3 py-2.5 rounded-lg text-sm truncate transition-all flex items-center gap-2.5 group
                                                            ${session.id === activeSessionId 
                                                                ? 'bg-purple-500/20 text-purple-200 border border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.1)]' 
                                                                : 'text-white/70 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10'
                                                            }`}
                                                    >
                                                        <MessageSquare className={`w-4 h-4 shrink-0 transition-colors ${session.id === activeSessionId ? 'text-purple-400' : 'text-white/40 group-hover:text-white/60'}`} />
                                                        <span className="truncate">{session.title}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </motion.div>
                                    </>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Messages */}
                        <div className="funai-panel__messages custom-scrollbar">
                            {messages.length === 0 && !isThinking && (
                                <div className="funai-panel__empty">
                                    <Sparkles className="w-10 h-10 text-purple-400 mb-3" />
                                    <p className="funai-panel__empty-title">Привет! Я FunAI 🧠</p>
                                    <p className="funai-panel__empty-text">
                                        Твой умный помощник. Спроси меня о чём угодно — тикеты, настройки, статистика.
                                    </p>
                                    {suggestions.length > 0 && (
                                        <div className="funai-panel__suggestions">
                                            {suggestions.map((s, i) => (
                                                <button
                                                    key={i}
                                                    className="funai-suggestion-btn"
                                                    onClick={() => handleSuggestionClick(s.text)}
                                                >
                                                    <span>{s.icon}</span>
                                                    <span>{s.text}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {messages.map(msg => (
                                <FunAiMessage
                                    key={msg.id}
                                    message={msg}
                                    onAction={handleAction}
                                />
                            ))}

                            {isThinking && (
                                <motion.div
                                    className="funai-thinking"
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                >
                                    <div className="funai-message__avatar">
                                        <span>🧠</span>
                                    </div>
                                    <div className="funai-thinking__dots">
                                        <span />
                                        <span />
                                        <span />
                                    </div>
                                </motion.div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div className="funai-panel__input-area">
                            <div className="funai-panel__input-wrap">
                                <textarea
                                    ref={inputRef}
                                    className="funai-panel__input"
                                    value={input}
                                    onChange={e => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Спроси FunAI..."
                                    rows={1}
                                    disabled={isThinking}
                                />
                                <button
                                    className="funai-panel__send-btn"
                                    onClick={handleSend}
                                    disabled={!input.trim() || isThinking}
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
