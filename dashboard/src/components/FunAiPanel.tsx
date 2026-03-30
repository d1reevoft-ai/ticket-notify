import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Trash2, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import FunAiMessage from './FunAiMessage';
import type { ChatMessage } from '../hooks/useFunAi';
import type { FunAiSuggestion } from '../api/funai';

interface FunAiPanelProps {
    isOpen: boolean;
    onClose: () => void;
    messages: ChatMessage[];
    isThinking: boolean;
    suggestions: FunAiSuggestion[];
    onSend: (text: string) => void;
    onClear: () => void;
}

export default function FunAiPanel({
    isOpen,
    onClose,
    messages,
    isThinking,
    suggestions,
    onSend,
    onClear,
}: FunAiPanelProps) {
    const [input, setInput] = useState('');
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
                        <div className="funai-panel__header">
                            <div className="funai-panel__title">
                                <span className="funai-panel__logo">🧠</span>
                                <div>
                                    <h3>FunAI</h3>
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
