import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Trash2, Sparkles, MessageSquare, ChevronDown, Plus, Mic } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import FunAiMessage from './FunAiMessage';
import type { ChatMessage } from '../hooks/useFunAi';
import type { FunAiSuggestion, FunAiSession } from '../api/funai';
import { useVoice } from '../hooks/useVoice';

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
    const [isVoiceMode, setIsVoiceMode] = useState(false);
    const lastSpokenMessageId = useRef<string | null>(null);

    const handleSpeechEnd = useCallback((text: string) => {
        if (text.trim() && !isThinking) {
            onSend(text.trim());
        }
    }, [isThinking, onSend]);

    const {
        isListening,
        isSpeaking,
        transcript,
        interimTranscript,
        startListening,
        stopListening,
        speak,
        stopSpeaking,
        supportAvailable
    } = useVoice(handleSpeechEnd);

    // Speak AI messages automatically if Voice Mode is active
    useEffect(() => {
        if (!isVoiceMode || !supportAvailable) return;
        
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id !== lastSpokenMessageId.current && !isThinking) {
            lastSpokenMessageId.current = lastMsg.id;
            speak(lastMsg.content);
        }
    }, [messages, isThinking, isVoiceMode, speak, supportAvailable]);

    const toggleVoiceMode = () => {
        if (isVoiceMode) {
            stopListening();
            stopSpeaking();
            setIsVoiceMode(false);
        } else {
            setIsVoiceMode(true);
            startListening();
        }
    };

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

                        {/* Voice Mode Overlay */}
                        <AnimatePresence>
                            {isVoiceMode && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="funai-voice-overlay absolute inset-0 z-[25] flex flex-col items-center justify-center overflow-hidden"
                                >
                                    <div className="absolute top-4 right-4 z-30">
                                        <button
                                            onClick={toggleVoiceMode}
                                            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                    
                                    <div className="flex-1 flex flex-col items-center justify-center w-full max-w-[80%] mx-auto relative z-20">
                                        <div className="text-center mb-12 min-h-[60px]">
                                            <p className="text-sm text-purple-200/60 font-medium mb-1 uppercase tracking-widest">
                                                {isListening ? 'Слушаю вас...' : isThinking ? 'Думаю...' : isSpeaking ? 'Отвечаю...' : 'Голосовой режим'}
                                            </p>
                                            <p className="text-xl text-white font-medium drop-shadow-md">
                                                {interimTranscript || transcript || (isSpeaking ? 'Говорит FunAI' : (isListening ? '...' : ''))}
                                            </p>
                                        </div>

                                        <div 
                                            className={`funai-voice-orb-container ${isListening ? 'listening' : isSpeaking ? 'speaking' : isThinking ? 'thinking' : ''}`}
                                            onClick={() => {
                                                if (isSpeaking) stopSpeaking();
                                                else if (isListening) stopListening();
                                                else startListening();
                                            }}
                                        >
                                            <div className="funai-voice-orb">
                                                <div className="funai-voice-orb-glow"></div>
                                                <div className="funai-voice-orb-core"></div>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Messages */}
                        <div className={`funai-panel__messages custom-scrollbar ${isVoiceMode ? 'opacity-0 pointer-events-none' : ''}`}>
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
                        <div className={`funai-panel__input-area ${isVoiceMode ? 'opacity-0 pointer-events-none' : ''}`}>
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
                                {supportAvailable && (
                                    <button
                                        className="funai-panel__mic-btn text-purple-400 hover:text-purple-300 transition-colors p-2"
                                        onClick={toggleVoiceMode}
                                        title="Голосовой режим"
                                    >
                                        <Mic className="w-4 h-4" />
                                    </button>
                                )}
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
