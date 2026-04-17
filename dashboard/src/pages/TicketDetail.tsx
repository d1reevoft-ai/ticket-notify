import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useTicketMessages, useSendTicketMessage, useTickets, useEditTicketMessage, useDeleteTicketMessage, useUserProfile, useTicketSummary, useCloseTicket, useSmartReply } from '../hooks/useTickets';
import { addReaction, removeReaction, triggerTicketTyping } from '../api/tickets';
import { fetchBinds, fetchSettings } from '../api/stats';
import { useSocket } from '../hooks/useSocket';
import { useTypingIndicator } from '../hooks/useTypingIndicator';
import ChatMessage from '../components/ChatMessage';
import Skeleton from '../components/Skeleton';
import type { DiscordMessage } from '../api/tickets';
import { ArrowLeft, Send, AlertCircle, X, Reply, Pencil, Sparkles, Lock, Paperclip, Loader2, Search, PanelRight, Star, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export default function TicketDetail() {
    const { id } = useParams<{ id: string }>();
    const { data: msgData, isLoading } = useTicketMessages(id);
    const messages = msgData?.messages;
    const mentionMap = msgData?.mentionMap || {};
    const { data: tickets } = useTickets();
    const { mutateAsync: sendMessage, isPending } = useSendTicketMessage();
    const { mutateAsync: editMessage, isPending: isEditing } = useEditTicketMessage();
    const { mutateAsync: deleteMessage } = useDeleteTicketMessage();
    const { mutateAsync: getSummary, isPending: isSummarizing } = useTicketSummary();
    const { mutateAsync: doCloseTicket, isPending: isClosing } = useCloseTicket();
    const { mutateAsync: doSmartReply, isPending: isSmartReplying } = useSmartReply();
    const navigate = useNavigate();
    const socket = useSocket();
    const queryClient = useQueryClient();
    const scrollRef = useRef<HTMLDivElement>(null);

    const [content, setContent] = useState('');
    const [attachments, setAttachments] = useState<{name: string; data: string; mime: string}[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [binds, setBinds] = useState<Record<string, { name: string; message: string }>>({});
    const [showBinds, setShowBinds] = useState(false);
    const [slashQuery, setSlashQuery] = useState('');
    const [slashIndex, setSlashIndex] = useState(0);

    // Reply & Edit state
    const [replyTo, setReplyTo] = useState<DiscordMessage | null>(null);
    const [editingMsg, setEditingMsg] = useState<DiscordMessage | null>(null);

    const [summary, setSummary] = useState<string | null>(null);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    const [closeError, setCloseError] = useState<string | null>(null);

    // Binds modal & info panel toggle
    const [showBindsModal, setShowBindsModal] = useState(false);
    const [bindsSearch, setBindsSearch] = useState('');
    const [bindsModalIndex, setBindsModalIndex] = useState(0);
    const bindsSearchRef = useRef<HTMLInputElement>(null);
    const [showInfoPanel, setShowInfoPanel] = useState(() => {
        return localStorage.getItem('ticket_info_panel') !== 'hidden';
    });

    const ticket = tickets?.find(t => t.channelId === id);

    const bindList = Object.values(binds);
    const filteredBinds = slashQuery
        ? bindList.filter(b => b.name.toLowerCase().startsWith(slashQuery.toLowerCase()))
        : bindList;

    const inputRef = useRef<HTMLTextAreaElement>(null);

    // ── Typing Indicator ──────────────────────────────────
    const typingIds = useTypingIndicator(id);
    const typingNames = typingIds.map(userId => {
        const msg = messages?.find(m => m.author.id === userId);
        return msg?.author?.global_name || msg?.author?.username || 'Участник';
    });
    const lastTypingTrigger = useRef<number>(0);

    useEffect(() => { fetchBinds().then(setBinds).catch(console.error); }, []);

    // Persist info panel state
    useEffect(() => {
        localStorage.setItem('ticket_info_panel', showInfoPanel ? 'visible' : 'hidden');
    }, [showInfoPanel]);

    // Alt+W global listener for binds modal
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // e.code === 'KeyW' работает независимо от раскладки
            if ((e.altKey || e.ctrlKey || e.metaKey) && e.code === 'KeyW') {
                e.preventDefault(); 
                e.stopPropagation();
                setShowBindsModal(prev => {
                    if (!prev) {
                        setBindsSearch('');
                        setBindsModalIndex(0);
                        setTimeout(() => bindsSearchRef.current?.focus(), 50);
                    }
                    return !prev;
                });
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown, true);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
    }, []);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages]);

    useEffect(() => {
        if (!socket || !id) return;

        // Scroll to bottom when new messages arrive for THIS ticket
        const handleNewMessage = (data: any) => {
            if (data.channelId === id && data.message) {
                // Replace optimistic messages with real ones from Gateway
                queryClient.setQueryData(['tickets', id, 'messages'], (old: any) => {
                    if (!old || !old.messages) return old;
                    // Remove optimistic messages if a real one arrived with same content
                    const hasOptimistic = old.messages.some((m: any) => String(m.id).startsWith('optimistic-'));
                    if (hasOptimistic) {
                        const cleaned = old.messages.filter((m: any) => !String(m.id).startsWith('optimistic-'));
                        if (!cleaned.some((m: any) => m.id === data.message.id)) {
                            return { ...old, messages: [...cleaned, data.message] };
                        }
                        return { ...old, messages: cleaned };
                    }
                    return old;
                });
                // Auto-scroll
                setTimeout(() => {
                    if (scrollRef.current) {
                        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
                        if (scrollHeight - scrollTop - clientHeight < 200) {
                            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                        }
                    }
                }, 50);
            }
        };

        // Navigate away if THIS ticket gets closed
        const handleTicketClosed = (data: any) => {
            if (data.channelId === id) {
                navigate('/tickets', { replace: true });
            }
        };

        socket.on('ticket:message', handleNewMessage);
        socket.on('ticket:closed', handleTicketClosed);
        return () => {
            socket.off('ticket:message', handleNewMessage);
            socket.off('ticket:closed', handleTicketClosed);
        };
    }, [socket, id, queryClient, navigate]);

    const selectBind = async (bind: { name: string; message: string }) => {
        setContent(''); setShowBinds(false); setSlashQuery(''); setSlashIndex(0);
        if (!id) return;
        try { await sendMessage({ id, content: bind.message, replyTo: replyTo?.id }); setReplyTo(null); } catch (_e) { }
    };

    const handleContentChange = (val: string) => {
        setContent(val);
        // Trigger typing state every 5 seconds
        if (id && Date.now() - lastTypingTrigger.current > 5000) {
            lastTypingTrigger.current = Date.now();
            triggerTicketTyping(id).catch(() => {});
        }

        if (val.startsWith('/') && !editingMsg) {
            const q = val.slice(1);
            setSlashQuery(q); setShowBinds(true); setSlashIndex(0);
            if (q.length > 0) {
                const exact = bindList.filter(b => b.name.toLowerCase() === q.toLowerCase());
                if (exact.length === 1) { selectBind(exact[0]); return; }
            }
        } else { setShowBinds(false); setSlashQuery(''); }
    };

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if ((!content.trim() && attachments.length === 0) || !id) return;

        if (editingMsg) {
            try {
                await editMessage({ ticketId: id, msgId: editingMsg.id, content });
                setContent('');
                setEditingMsg(null);
            } catch (_e) { }
        } else {
            try {
                await sendMessage({ id, content, replyTo: replyTo?.id, attachments: attachments.length > 0 ? attachments : undefined });
                setContent('');
                setReplyTo(null);
                setAttachments([]);
            } catch (_e) { }
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        
        files.forEach(file => {
            if (file.size > 8 * 1024 * 1024) {
                alert(`Файл ${file.name} слишком большой (макс. 8MB)`);
                return;
            }
            if (attachments.length >= 10) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (typeof ev.target?.result === 'string') {
                    setAttachments(prev => {
                        const filtered = prev.filter(a => a.name !== file.name);
                        return [...filtered, { name: file.name, data: ev.target!.result as string, mime: file.type || 'application/octet-stream' }];
                    });
                }
            };
            reader.readAsDataURL(file);
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = Array.from(e.clipboardData?.items || []);
        for (const item of items) {
            if (!item.type.startsWith('image/')) continue;
            const file = item.getAsFile();
            if (!file || file.size > 8 * 1024 * 1024) continue;
            if (attachments.length >= 10) break;
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (typeof ev.target?.result === 'string') {
                    const name = `paste-${Date.now()}.${file.type.split('/')[1] || 'png'}`;
                    setAttachments(prev => [...prev, { name, data: ev.target!.result as string, mime: file.type }]);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleGenerateSmartReply = async () => {
        if (!id) return;
        try {
            const data = await doSmartReply({ ticketId: id });
            if (data.reply) {
                setContent(v => v + (v ? '\n\n' : '') + data.reply);
                inputRef.current?.focus();
            }
        } catch (e) {
            console.error('Failed to generate smart reply', e);
        }
    };

    const handleReply = (msg: DiscordMessage) => {
        setEditingMsg(null);
        setReplyTo(msg);
        setContent('');
        inputRef.current?.focus();
    };

    const handleEdit = (msg: DiscordMessage) => {
        setReplyTo(null);
        setEditingMsg(msg);
        setContent(msg.content);
        inputRef.current?.focus();
    };

    const handleDelete = async (msg: DiscordMessage) => {
        if (!id) return;
        try {
            await deleteMessage({ ticketId: id, msgId: msg.id });
        } catch (e) {
            console.error('Failed to delete message', e);
        }
    };

    const cancelAction = () => {
        setReplyTo(null);
        setEditingMsg(null);
        setContent('');
    };

    const handleGenerateSummary = async () => {
        if (!id) return;
        try {
            const data = await getSummary({ ticketId: id });
            setSummary(data.summary);
        } catch (e) {
            console.error('Failed to generate summary', e);
        }
    };

    const handleToggleReaction = async (msg: DiscordMessage, emoji: string, add: boolean) => {
        if (!id) return;
        try {
            if (add) {
                await addReaction(id, msg.id, emoji);
            } else {
                await removeReaction(id, msg.id, emoji);
            }
        } catch (_e) { }
    };

    const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
    const useSkeletons = settings?.useSkeletons ?? true;

    if (isLoading) {
        return useSkeletons ? (
            <div className="h-[calc(100vh-8rem)] flex flex-col md:flex-row gap-4 md:gap-6 max-w-7xl mx-auto">
                <div className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden p-6 gap-6">
                    <div className="flex items-center gap-4 border-b border-border pb-4">
                        <Skeleton className="w-10 h-10 rounded-lg" />
                        <div>
                            <Skeleton className="w-32 h-6" />
                            <Skeleton className="w-20 h-4 mt-2" />
                        </div>
                    </div>
                    <div className="flex-1 flex flex-col gap-6">
                        <div className="flex gap-4">
                            <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                            <div className="flex-1">
                                <Skeleton className="w-24 h-4 mb-2" />
                                <Skeleton className="w-[80%] h-24 rounded-2xl rounded-tl-sm" />
                            </div>
                        </div>
                        <div className="flex gap-4 flex-row-reverse">
                            <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                            <div className="flex-1 flex flex-col items-end">
                                <Skeleton className="w-24 h-4 mb-2" />
                                <Skeleton className="w-[60%] h-16 rounded-2xl rounded-tr-sm bg-primary/20" />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="hidden lg:flex w-80 shrink-0 flex-col gap-6">
                    <Skeleton className="w-full h-64 rounded-xl" />
                    <Skeleton className="w-full h-48 rounded-xl" />
                </div>
            </div>
        ) : (
            <div className="h-full flex items-center justify-center"><span className="animate-pulse">Загрузка истории...</span></div>
        );
    }

    const modalFilteredBinds = bindsSearch
        ? bindList.filter(b => b.name.toLowerCase().includes(bindsSearch.toLowerCase()) || b.message.toLowerCase().includes(bindsSearch.toLowerCase()))
        : bindList;

    const selectBindFromModal = (bind: { name: string; message: string }) => {
        setShowBindsModal(false);
        setBindsSearch('');
        if (!id) return;
        sendMessage({ id, content: bind.message, replyTo: replyTo?.id }).then(() => setReplyTo(null)).catch(() => {});
    };

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col md:flex-row gap-4 md:gap-6 max-w-[90rem] mx-auto">
            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden shadow-sm relative">
                <div className="h-14 md:h-16 px-4 md:px-6 border-b border-border bg-card/50 backdrop-blur flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 md:gap-4">
                        <Link to="/tickets" className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-foreground">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h2 className="font-rajdhani font-bold text-base md:text-lg leading-tight flex items-center gap-2">
                                <span className="truncate max-w-[120px] sm:max-w-[200px] md:max-w-[300px]">#{ticket?.channelName || 'Ticket'}</span>
                                {ticket?.priority === 'high' && (
                                    <span className="px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded text-[10px] font-semibold flex items-center gap-1 shrink-0">
                                        <AlertCircle className="w-3 h-3" /> ПРИОРИТЕТ
                                    </span>
                                )}
                            </h2>
                            <p className="text-xs text-muted-foreground truncate max-w-[150px] md:max-w-xs">{ticket?.openerUsername}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => setShowInfoPanel(v => !v)}
                            className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors text-muted-foreground hover:text-foreground ${showInfoPanel ? 'bg-secondary/50 hover:bg-secondary' : 'hover:bg-secondary/50'}`}
                            title={showInfoPanel ? 'Скрыть информацию' : 'Показать информацию'}
                        >
                            <PanelRight className="w-4 h-4 md:w-5 md:h-5" />
                        </button>
                        <button
                            onClick={handleGenerateSummary}
                            disabled={isSummarizing || !messages || messages.length < 2}
                            className="hidden sm:flex bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 border border-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold px-3 min-h-[44px] items-center justify-center rounded-lg gap-1.5 transition-colors"
                        >
                            {isSummarizing ? (
                                <span className="animate-pulse">Анализ...</span>
                            ) : (
                                <>
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>AI Саммари</span>
                                </>
                            )}
                        </button>
                        {!showCloseConfirm ? (
                            <button
                                onClick={() => { setShowCloseConfirm(true); setCloseError(null); }}
                                disabled={isClosing}
                                className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-50 text-xs font-semibold px-3 min-h-[44px] flex items-center justify-center rounded-lg gap-1.5 transition-colors"
                            >
                                <Lock className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Закрыть</span>
                            </button>
                        ) : (
                            <div className="flex items-center gap-1.5 pr-1">
                                <button
                                    onClick={async () => {
                                        if (!id) return;
                                        try {
                                            await doCloseTicket({ ticketId: id });
                                            navigate('/tickets');
                                        } catch (e: any) {
                                            setCloseError(e?.response?.data?.error || 'Ошибка');
                                            setShowCloseConfirm(false);
                                        }
                                    }}
                                    disabled={isClosing}
                                    className="bg-red-500 text-white hover:bg-red-600 text-xs font-semibold px-3 min-h-[44px] flex items-center justify-center rounded-lg gap-1.5 transition-colors disabled:opacity-50"
                                >
                                    {isClosing ? <span className="animate-pulse">Закрытие...</span> : 'Да, закрыть'}
                                </button>
                                <button
                                    onClick={() => setShowCloseConfirm(false)}
                                    className="bg-secondary/50 text-muted-foreground hover:text-foreground text-xs font-semibold px-3 min-h-[44px] flex items-center justify-center rounded-lg transition-colors"
                                >
                                    Отмена
                                </button>
                            </div>
                        )}
                    </div>
                    {closeError && (
                        <div className="absolute top-full right-0 mt-1 bg-red-500/10 border border-red-500/20 text-red-500 text-xs px-3 py-2 rounded-lg z-[60] whitespace-nowrap shadow-lg">
                            {closeError}
                        </div>
                    )}
                </div>

                <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 md:p-6 custom-scrollbar scroll-smooth relative">
                    <AnimatePresence>
                        {summary && (
                            <motion.div
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="mb-4 bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 relative mx-1"
                            >
                                <button
                                    onClick={() => setSummary(null)}
                                    className="absolute top-2 right-2 p-1 min-h-[40px] min-w-[40px] flex items-center justify-center text-purple-500/70 hover:text-purple-500 hover:bg-purple-500/10 rounded-md transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                                <h4 className="flex items-center gap-2 text-purple-500 font-bold mb-2 text-sm uppercase string-wide">
                                    <Sparkles className="w-4 h-4 shrink-0" />
                                    Краткое содержание от AI
                                </h4>
                                <p className="text-sm text-foreground/90 leading-relaxed">
                                    {summary}
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {(!messages || messages.length === 0) ? (
                        <div className="h-full flex flex-col justify-center items-center text-muted-foreground italic">Нет сообщений</div>
                    ) : messages.map((msg) => {
                        const isBotProxy = !!msg.author.bot && (msg.content || '').includes('[Саппорт]');
                        const taggedMine = typeof msg._isMine === 'boolean' ? msg._isMine : null;
                        const taggedStaff = typeof msg._isStaff === 'boolean' ? msg._isStaff : null;
                        const isOpenerMessage = !!ticket?.openerId && msg.author?.id === ticket.openerId;
                        const baseMine = taggedMine !== null
                            ? taggedMine
                            : (taggedStaff !== null
                                ? taggedStaff
                                : (!!ticket?.openerId && !isOpenerMessage));
                        const isMine = baseMine || isBotProxy;
                        return (
                            <ChatMessage
                                key={msg.id}
                                message={msg}
                                isStaff={isMine}
                                mentionMap={mentionMap}
                                onReply={handleReply}
                                onEdit={handleEdit}
                                canEdit={isMine || isBotProxy}
                                onDelete={handleDelete}
                                canDelete={isMine || isBotProxy}
                                onToggleReaction={handleToggleReaction}
                            />
                        );
                    })}
                </div>

                <div className="p-2 md:p-4 bg-background border-t border-border shrink-0 relative">
                    {/* Typing indicator */}
                    <AnimatePresence>
                        {typingNames.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                className="absolute -top-6 left-4 text-[11px] font-medium text-foreground/80 flex items-center gap-1.5 z-10"
                            >
                                <div className="flex bg-secondary/80 px-2 py-0.5 rounded-full items-center gap-1.5 shadow-sm border border-border/50">
                                    <span className="flex gap-0.5 mt-0.5">
                                        <span className="w-1 h-1 bg-foreground/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                        <span className="w-1 h-1 bg-foreground/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                        <span className="w-1 h-1 bg-foreground/60 rounded-full animate-bounce" />
                                    </span>
                                    <span className="truncate max-w-[200px]">
                                        {typingNames.length > 3 
                                            ? `${typingNames.length} участников печатают...` 
                                            : `${typingNames.join(', ')} видят вас... ээ, печатают...`}     
                                    </span>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Reply/Edit indicator */}
                    <AnimatePresence>
                        {(replyTo || editingMsg) && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-secondary/50 border border-border/50 text-sm mx-1">
                                    {replyTo ? (
                                        <>
                                            <Reply className="w-4 h-4 text-primary shrink-0" />
                                            <span className="text-muted-foreground hidden sm:inline">Ответ</span>
                                            <span className="font-semibold text-foreground truncate max-w-[100px] md:max-w-[150px]">
                                                {replyTo.author.global_name || replyTo.author.username}
                                            </span>
                                            <span className="text-muted-foreground truncate flex-1 text-xs sm:text-sm">
                                                {replyTo.content?.slice(0, 60) || '[embed]'}{replyTo.content && replyTo.content.length > 60 ? '…' : ''}
                                            </span>
                                        </>
                                    ) : editingMsg ? (
                                        <>
                                            <Pencil className="w-4 h-4 text-yellow-500 shrink-0" />
                                            <span className="text-muted-foreground hidden sm:inline">Редактирование</span>
                                            <span className="text-muted-foreground truncate flex-1 text-xs sm:text-sm">
                                                {editingMsg.content?.slice(0, 60) || ''}{editingMsg.content && editingMsg.content.length > 60 ? '…' : ''}
                                            </span>
                                        </>
                                    ) : null}
                                    <button onClick={cancelAction} className="p-1 min-h-[40px] min-w-[40px] flex items-center justify-center hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors shrink-0">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <AnimatePresence>
                        {showBinds && content.startsWith('/') && filteredBinds.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                                className="absolute bottom-full left-2 right-2 md:left-4 md:right-4 mb-2 max-h-[40vh] md:max-h-52 overflow-y-auto custom-scrollbar bg-card border border-border rounded-xl shadow-2xl z-[60]">
                                <div className="p-1.5">
                                    {filteredBinds.map((b, idx) => (
                                        <button key={b.name} type="button" onClick={() => selectBind(b)}
                                            className={`w-full text-left px-3 min-h-[44px] flex items-center gap-3 group rounded-lg transition-colors ${idx === slashIndex ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary/70 text-muted-foreground hover:text-foreground'}`}>
                                            <span className="font-mono text-primary text-sm font-bold shrink-0">/{b.name}</span>
                                            <span className="text-xs truncate opacity-60 group-hover:opacity-90">{b.message.slice(0, 80)}{b.message.length > 80 ? '…' : ''}</span>
                                        </button>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2 px-1">
                            {attachments.map((att, idx) => (
                                <div key={idx} className="relative group rounded-lg overflow-hidden border border-border h-16 w-16 md:h-20 md:w-20 bg-secondary flex items-center justify-center shrink-0">
                                    {att.mime.startsWith('image/') ? (
                                        <img src={att.data} alt={att.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="text-[10px] text-muted-foreground text-center px-1 break-all line-clamp-3 leading-tight">{att.name}</div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                                        className="absolute top-1 right-1 bg-black/50 hover:bg-black/80 text-white rounded-full p-1 transition-colors opacity-100 backdrop-blur-sm"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <form onSubmit={handleSend} className="relative mx-1">
                        <textarea
                            ref={inputRef}
                            value={content}
                            onChange={e => handleContentChange(e.target.value)}
                            onPaste={handlePaste}
                            placeholder={editingMsg ? 'Укажите новый текст...' : replyTo ? 'Напишите ответ...' : 'Напишите сообщение...'}
                            className="w-full bg-secondary/50 border border-border rounded-xl pl-[5.5rem] md:pl-[6.5rem] pr-[3.5rem] md:pr-16 py-3 md:py-4 custom-scrollbar min-h-[48px] md:min-h-[56px] max-h-32 resize-none focus:outline-none focus:border-primary transition-colors text-sm md:text-base leading-snug"
                            onKeyDown={e => {
                                if (showBinds && content.startsWith('/') && filteredBinds.length > 0) {
                                    if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(prev => Math.min(prev + 1, filteredBinds.length - 1)); return; }
                                    if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(prev => Math.max(prev - 1, 0)); return; }
                                    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); selectBind(filteredBinds[slashIndex]); return; }
                                    if (e.key === 'Escape') { e.preventDefault(); setShowBinds(false); setContent(''); return; }
                                }
                                if (e.key === 'Escape') { e.preventDefault(); cancelAction(); return; }
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e as any); }
                            }} />
                        <div className="absolute left-1.5 md:left-2 top-1 md:top-2 flex items-center gap-0.5 text-muted-foreground">
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 min-h-[40px] md:min-h-[44px] min-w-[40px] md:min-w-[44px] flex items-center justify-center hover:bg-secondary rounded-lg transition-colors hover:text-foreground">
                                <Paperclip className="w-4 h-4 md:w-5 md:h-5" />
                            </button>
                            {!editingMsg && (
                                <button type="button" onClick={handleGenerateSmartReply} disabled={isSmartReplying} className="p-2 min-h-[40px] md:min-h-[44px] min-w-[40px] md:min-w-[44px] flex items-center justify-center hover:bg-secondary rounded-lg transition-colors hover:text-purple-500 disabled:opacity-50">
                                    {isSmartReplying ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <Sparkles className="w-4 h-4 md:w-5 md:h-5" />}
                                </button>
                            )}
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple className="hidden" />
                        <div className="absolute right-1.5 md:right-2 top-1 md:top-2">
                            <button type="submit" disabled={(isPending || isEditing) || (!content.trim() && attachments.length === 0)} className="p-2 min-h-[40px] md:min-h-[44px] min-w-[40px] md:min-w-[44px] flex items-center justify-center shrink-0 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                                {editingMsg ? <Pencil className="w-4 h-4 md:w-5 md:h-5" /> : <Send className="w-4 h-4 md:w-5 md:h-5" />}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Info Sidebar — collapsible on mobile */}
            <AnimatePresence>
                {showInfoPanel && (
                    <>
                        {/* Mobile Overlay */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowInfoPanel(false)}
                            className="lg:hidden fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
                        />
                        {/* Panel */}
                        <motion.div
                            initial={{ x: '100%', opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: '100%', opacity: 0 }}
                            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                            className="fixed lg:static inset-y-0 right-0 w-[85vw] sm:w-80 shrink-0 bg-card lg:bg-transparent z-[70] lg:z-auto p-4 lg:p-0 flex flex-col gap-4 overflow-y-auto custom-scrollbar shadow-2xl lg:shadow-none border-l lg:border-l-0 border-border"
                        >
                            <div className="flex items-center justify-between lg:hidden mb-2">
                                <h3 className="font-rajdhani font-bold text-lg text-foreground uppercase tracking-wide">Информация</h3>
                                <button
                                    onClick={() => setShowInfoPanel(false)}
                                    className="p-2 bg-secondary/50 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <TicketInfoSidebar ticket={ticket} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Binds Modal (Ctrl+W) */}
            <AnimatePresence>
                {showBindsModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                        onClick={(e) => { if (e.target === e.currentTarget) setShowBindsModal(false); }}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            transition={{ duration: 0.2, type: 'spring', damping: 25 }}
                            className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                                <div className="flex items-center gap-3">
                                    <div className="p-1.5 bg-primary/10 rounded-lg">
                                        <Zap className="w-5 h-5 text-primary" />
                                    </div>
                                    <h3 className="font-rajdhani font-bold text-lg uppercase tracking-wide">Быстрые теги</h3>
                                </div>
                                <button
                                    onClick={() => setShowBindsModal(false)}
                                    className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 rounded-lg hover:bg-primary/20"
                                >
                                    <Send className="w-3.5 h-3.5" />
                                    Отправка
                                </button>
                            </div>

                            {/* Search */}
                            <div className="px-5 py-3">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <input
                                        ref={bindsSearchRef}
                                        type="text"
                                        value={bindsSearch}
                                        onChange={(e) => { setBindsSearch(e.target.value); setBindsModalIndex(0); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') { setShowBindsModal(false); return; }
                                            if (e.key === 'ArrowDown') { e.preventDefault(); setBindsModalIndex(i => Math.min(i + 1, modalFilteredBinds.length - 1)); return; }
                                            if (e.key === 'ArrowUp') { e.preventDefault(); setBindsModalIndex(i => Math.max(i - 1, 0)); return; }
                                            if (e.key === 'Enter' && modalFilteredBinds.length > 0) { e.preventDefault(); selectBindFromModal(modalFilteredBinds[bindsModalIndex]); return; }
                                        }}
                                        placeholder="Поиск по имени или тексту..."
                                        className="w-full bg-secondary/50 border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground"
                                    />
                                </div>
                            </div>

                            {/* Counter */}
                            <div className="px-5 pb-2 flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="font-semibold">{bindList.length} ТЕГОВ</span>
                                {bindsSearch && <span className="text-primary">найдено: {modalFilteredBinds.length}</span>}
                            </div>

                            {/* Binds List */}
                            <div className="px-3 pb-3 max-h-[50vh] overflow-y-auto custom-scrollbar">
                                <div className="flex flex-col gap-1.5">
                                    {modalFilteredBinds.map((b, idx) => (
                                        <button
                                            key={b.name}
                                            onClick={() => selectBindFromModal(b)}
                                            className={`text-left px-4 py-3 rounded-xl border transition-all duration-150 group ${
                                                idx === bindsModalIndex
                                                    ? 'bg-primary/10 border-primary/30 shadow-sm shadow-primary/10'
                                                    : 'bg-secondary/30 border-border/50 hover:bg-secondary/60 hover:border-border'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-2">
                                                    <Star className={`w-4 h-4 ${idx === bindsModalIndex ? 'text-yellow-500 fill-yellow-500' : 'text-yellow-500/50'}`} />
                                                    <span className="font-bold text-sm text-foreground">{b.name}</span>
                                                </div>
                                            </div>
                                            <p className="text-xs text-muted-foreground line-clamp-1 pl-6">
                                                {b.message.slice(0, 100)}{b.message.length > 100 ? '…' : ''}
                                            </p>
                                        </button>
                                    ))}
                                    {modalFilteredBinds.length === 0 && (
                                        <div className="text-center py-8 text-muted-foreground text-sm italic">
                                            Ничего не найдено
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
                                <div className="flex gap-4">
                                    <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-secondary rounded text-[10px] font-mono">↑↓</kbd> навигация</span>
                                    <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-secondary rounded text-[10px] font-mono">↵</kbd> выбрать</span>
                                    <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-secondary rounded text-[10px] font-mono">Esc</kbd> закрыть</span>
                                </div>
                                <div>
                                    <span>Вызов: <kbd className="px-1 py-0.5 bg-secondary rounded font-mono">Alt+W</kbd></span>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function TicketInfoSidebar({ ticket }: { ticket: any }) {
    const [now, setNow] = useState(Date.now());
    const { data: userProfile, isLoading: isProfileLoading } = useUserProfile(ticket?.openerId);
    const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
    const useSkeletons = settings?.useSkeletons ?? true;

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);

    const formatAge = (ms: number) => {
        const s = Math.floor(ms / 1000);
        if (s < 60) return `${s}с назад`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}м назад`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}ч ${m % 60}м назад`;
        const d = Math.floor(h / 24);
        return `${d}д ${h % 24}ч назад`;
    };

    const lastMsgAge = ticket?.lastMessageAt ? now - ticket.lastMessageAt : null;
    const ticketAge = ticket?.createdAt ? now - ticket.createdAt : null;
    const slaMs = ticket?.firstStaffReplyAt && ticket?.createdAt ? ticket.firstStaffReplyAt - ticket.createdAt : null;

    const getSlaColor = () => {
        if (ticket?.firstStaffReplyAt) return 'text-emerald-500';
        if (!ticketAge) return 'text-muted-foreground';
        if (ticketAge < 30 * 60 * 1000) return 'text-emerald-500'; // < 30m
        if (ticketAge < 2 * 60 * 60 * 1000) return 'text-yellow-500'; // < 2h
        return 'text-red-500';
    };

    return (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <h3 className="font-rajdhani font-bold text-lg mb-4 text-foreground uppercase tracking-wide">Информация</h3>
            <div className="space-y-4">
                <div>
                    <div className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Автор тикета</div>
                    <div className="flex justify-between items-center text-sm font-medium">
                        {(() => {
                            let name = ticket?.openerUsername || '';
                            if (!name && ticket?.channelName) {
                                const m = ticket.channelName.match(/(?:тикет|ticket|тикeт)-(?:от|from)-(.+)/i);
                                if (m) name = m[1];
                            }
                            return name || '—';
                        })()}
                        {ticket?.openerId && <span className="text-xs text-muted-foreground bg-secondary px-2 rounded">{ticket.openerId}</span>}
                    </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                    <div className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Последнее сообщение</div>
                    {lastMsgAge !== null ? (
                        <div className="space-y-1">
                            <div className={`text-sm font-medium ${lastMsgAge > 30 * 60 * 1000 ? 'text-yellow-500' : lastMsgAge > 2 * 60 * 60 * 1000 ? 'text-red-500' : 'text-foreground'}`}>
                                {formatAge(lastMsgAge)}
                            </div>
                            {ticket?.lastMessage && (
                                <p className="text-xs text-muted-foreground truncate">{ticket.lastMessage}</p>
                            )}
                        </div>
                    ) : (
                        <div className="text-sm text-muted-foreground italic">Нет данных</div>
                    )}
                </div>

                <div className="pt-4 border-t border-border/50">
                    <div className="text-xs text-muted-foreground mb-1 uppercase font-semibold">SLA • Первый ответ</div>
                    <div className={`text-sm font-medium ${getSlaColor()}`}>
                        {ticket?.firstStaffReplyAt ? (
                            <>✅ {formatAge(slaMs!).replace(' назад', '')}</>
                        ) : (
                            <>⏳ Ожидание {ticketAge ? formatAge(ticketAge).replace(' назад', '') : ''}</>
                        )}
                    </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                    <div className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Таймер активности</div>
                    <div className="text-sm">
                        {ticket?.activityTimerType === 'user' ? <span className="text-yellow-500 font-medium">⏳ Ожидается ответ юзера</span>
                            : ticket?.activityTimerType === 'closing' ? <span className="text-red-500 font-medium animate-pulse">🔒 Готовится к закрытию</span>
                                : ticket?.waitingForReply ? <span className="text-orange-400 font-medium">💬 Ожидает ответа</span>
                                    : <span className="text-muted-foreground italic">Таймеров нет</span>}
                    </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                    <div className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Создан</div>
                    <div className="text-sm font-medium">
                        {ticket?.createdAt ? format(new Date(ticket.createdAt), 'dd.MM.yyyy HH:mm', { locale: ru }) : '-'}
                    </div>
                    {ticketAge && (
                        <div className="text-xs text-muted-foreground mt-0.5">{formatAge(ticketAge)}</div>
                    )}
                </div>
            </div>

            {/* CRM Profile Section */}
            {ticket?.openerId && (
                <div className="mt-6 pt-6 border-t border-border">
                    <h3 className="font-rajdhani font-bold text-lg mb-4 text-foreground uppercase tracking-wide flex items-center gap-2">
                        <span className="bg-primary/10 text-primary p-1 rounded"><AlertCircle className="w-4 h-4" /></span>
                        Профиль Клиента
                    </h3>

                    {isProfileLoading ? (
                        useSkeletons ? (
                            <div className="space-y-4">
                                <Skeleton className="w-full h-8" />
                                <div className="grid grid-cols-2 gap-2">
                                    <Skeleton className="h-16 w-full" />
                                    <Skeleton className="h-16 w-full" />
                                </div>
                                <Skeleton className="w-full h-24" />
                            </div>
                        ) : (
                            <div className="space-y-3 animate-pulse">
                                <div className="h-4 bg-secondary/50 rounded w-3/4"></div>
                                <div className="h-4 bg-secondary/50 rounded w-1/2"></div>
                                <div className="h-4 bg-secondary/50 rounded w-full"></div>
                            </div>
                        )
                    ) : userProfile ? (
                        <div className="space-y-4">
                            {userProfile.isBanned && (
                                <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-xs px-3 py-2 rounded-lg font-medium flex items-center justify-center">
                                    Пользователь ЗАБЛОКИРОВАН
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2 text-center">
                                <div className="bg-secondary/30 rounded-lg p-2 border border-border/50">
                                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Всего тикетов</div>
                                    <div className="text-lg font-rajdhani font-bold text-foreground">{userProfile.stats.totalCreated}</div>
                                </div>
                                <div className="bg-secondary/30 rounded-lg p-2 border border-border/50">
                                    <div className="text-[10px] text-muted-foreground uppercase font-bold">Закрытых</div>
                                    <div className="text-lg font-rajdhani font-bold text-foreground">{userProfile.stats.closed}</div>
                                </div>
                            </div>

                            {userProfile.stats.highPriority > 0 && (
                                <div className="text-xs text-muted-foreground flex items-center gap-1.5 bg-yellow-500/10 text-yellow-500/90 rounded px-2 py-1">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Использовал высокий приоритет: {userProfile.stats.highPriority} раз
                                </div>
                            )}

                            {userProfile.historyTickets && userProfile.historyTickets.length > 0 && (
                                <div className="pt-2">
                                    <div className="text-xs text-muted-foreground mb-2 uppercase font-semibold">История обращений</div>
                                    <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                                        {userProfile.historyTickets.map((t: any) => (
                                            <div key={t.id} className="text-xs bg-secondary/20 border border-border/50 rounded p-2 flex justify-between items-center group hover:bg-secondary/40 transition-colors">
                                                <div className="truncate pr-2 text-muted-foreground group-hover:text-foreground transition-colors">#{t.name}</div>
                                                <div className="shrink-0 opacity-60 text-[10px]">{format(new Date(t.createdAt), 'dd.MM.yy', { locale: ru })}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-sm text-muted-foreground italic">Профиль не найден</div>
                    )}
                </div>
            )}
        </div>
    );
}
