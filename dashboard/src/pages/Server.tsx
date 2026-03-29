import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchServerChannels, fetchServerMessages, sendServerMessage, triggerServerTyping } from '../api/server';
import type { ServerChannel } from '../api/server';
import type { DiscordMessage } from '../api/tickets';
import { useSocket } from '../hooks/useSocket';
import { useTypingIndicator } from '../hooks/useTypingIndicator';
import ChatMessage from '../components/ChatMessage';
import { Hash, Send, ChevronDown, ChevronRight, Reply, X, Paperclip, Loader2, MessageSquare, ArrowLeft, ArrowDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Server() {
    const { channelId } = useParams<{ channelId?: string }>();
    const navigate = useNavigate();
    const socket = useSocket();

    // ── Channel list ──────────────────────────────────────
    const { data: channelData, isLoading: isChannelsLoading } = useQuery({
        queryKey: ['server', 'channels'],
        queryFn: fetchServerChannels,
        staleTime: 60_000,
    });

    const categories = channelData?.categories || [];
    const channels = channelData?.channels || [];

    // ── Messages ──────────────────────────────────────────
    const [messages, setMessages] = useState<DiscordMessage[]>([]);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [initialLoadDone, setInitialLoadDone] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const prevScrollHeight = useRef(0);

    // ── Input ─────────────────────────────────────────────
    const [content, setContent] = useState('');
    const [replyTo, setReplyTo] = useState<DiscordMessage | null>(null);
    const [attachments, setAttachments] = useState<{name: string; data: string; mime: string}[]>([]);
    const [isSending, setIsSending] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // ── Typing Indicator ──────────────────────────────────
    const typingIds = useTypingIndicator(channelId);
    const typingNames = typingIds.map(id => {
        const msg = messages.find(m => m.author.id === id);
        return msg?.author?.global_name || msg?.author?.username || 'Участник';
    });
    const lastTypingTrigger = useRef<number>(0);

    // ── Collapsed categories ──────────────────────────────
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const toggleCategory = (catId: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            next.has(catId) ? next.delete(catId) : next.add(catId);
            return next;
        });
    };

    // ── Load initial messages ─────────────────────────────
    useEffect(() => {
        if (!channelId) { setMessages([]); setHasMore(true); return; }
        setIsLoadingMessages(true);
        setInitialLoadDone(false);
        setMessages([]);
        setHasMore(true);
        setReplyTo(null);
        setContent('');
        setAttachments([]);
        fetchServerMessages(channelId).then(data => {
            setMessages(data.messages);
            setHasMore(data.messages.length >= 50);
            setIsLoadingMessages(false);
            
            requestAnimationFrame(() => {
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                setTimeout(() => {
                    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    setInitialLoadDone(true);
                }, 50);
            });
        }).catch(() => {
            setIsLoadingMessages(false);
            setInitialLoadDone(true);
        });
    }, [channelId]);

    // ── Scroll to bottom on new messages ──────────────────
    const scrollToBottom = useCallback(() => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        const nearBottom = scrollHeight - scrollTop - clientHeight < 200;
        if (nearBottom) {
            setTimeout(() => {
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }, 30);
        }
    }, []);

    // ── Load older messages ───────────────────────────────
    const loadOlder = useCallback(async () => {
        if (!channelId || loadingOlder || !hasMore || messages.length === 0) return;
        setLoadingOlder(true);
        prevScrollHeight.current = scrollRef.current?.scrollHeight || 0;
        try {
            const oldest = messages[0];
            const data = await fetchServerMessages(channelId, oldest.id);
            if (data.messages.length === 0) { setHasMore(false); return; }
            setMessages(prev => [...data.messages, ...prev]);
            setHasMore(data.messages.length >= 50);
            // Preserve scroll position
            requestAnimationFrame(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevScrollHeight.current;
                }
            });
        } finally {
            setLoadingOlder(false);
        }
    }, [channelId, loadingOlder, hasMore, messages]);

    // ── Scroll handler for infinite scroll ────────────────
    const handleScroll = useCallback(() => {
        if (!scrollRef.current || !initialLoadDone) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 300);

        if (scrollTop < 100 && hasMore && !loadingOlder) {
            loadOlder();
        }
    }, [hasMore, loadingOlder, loadOlder, initialLoadDone]);

    // ── Socket.io real-time ───────────────────────────────
    useEffect(() => {
        if (!socket || !channelId) return;
        const handleNew = (data: any) => {
            if (data.channelId !== channelId) return;
            if (!data.message) return;
            setMessages(prev => {
                if (prev.some(m => m.id === data.message.id)) return prev;
                return [...prev, data.message];
            });
            scrollToBottom();
        };
        const handleUpdate = (data: any) => {
            if (data.channelId !== channelId || !data.message) return;
            setMessages(prev => prev.map(m => m.id === data.message.id ? data.message : m));
        };
        const handleDelete = (data: any) => {
            if (data.channelId !== channelId) return;
            setMessages(prev => prev.filter(m => m.id !== data.messageId));
        };
        socket.on('server:message', handleNew);
        socket.on('server:message_update', handleUpdate);
        socket.on('server:message_delete', handleDelete);
        return () => {
            socket.off('server:message', handleNew);
            socket.off('server:message_update', handleUpdate);
            socket.off('server:message_delete', handleDelete);
        };
    }, [socket, channelId, scrollToBottom]);

    // ── Send message ──────────────────────────────────────
    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if ((!content.trim() && attachments.length === 0) || !channelId || isSending) return;
        setIsSending(true);
        try {
            await sendServerMessage(
                channelId,
                content,
                replyTo?.id,
                attachments.length > 0 ? attachments : undefined
            );
            setContent('');
            setReplyTo(null);
            setAttachments([]);
        } catch (err) {
            console.error('Send error', err);
        } finally {
            setIsSending(false);
        }
    };

    const handleReply = (msg: DiscordMessage) => {
        setReplyTo(msg);
        inputRef.current?.focus();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            if (file.size > 8 * 1024 * 1024) return;
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

    // ── Clipboard paste for images ────────────────────────
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

    // ── Group channels by category ────────────────────────
    const grouped = new Map<string | null, ServerChannel[]>();
    for (const ch of channels) {
        const key = ch.parentId;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(ch);
    }

    const activeChannel = channels.find(ch => ch.id === channelId);
    const [showChannels, setShowChannels] = useState(false);

    const renderChannelList = () => (
        <>
            <div className="px-3 py-3 border-b border-border bg-card/50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Link to="/tickets" className="p-1.5 hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-foreground shrink-0">
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <h3 className="font-rajdhani font-bold text-sm uppercase tracking-wider text-foreground">
                        Каналы сервера
                    </h3>
                </div>
                <button
                    onClick={() => setShowChannels(false)}
                    className="md:hidden p-1.5 hover:bg-secondary rounded-lg transition-colors text-muted-foreground"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                {isChannelsLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                ) : channels.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-8 italic">
                        Каналы не найдены
                    </div>
                ) : (
                    <>
                        {/* Uncategorized channels */}
                        {grouped.get(null)?.map(ch => (
                            <ChannelItem
                                key={ch.id}
                                channel={ch}
                                isActive={ch.id === channelId}
                                onClick={() => { navigate(`/server/${ch.id}`); setShowChannels(false); }}
                            />
                        ))}

                        {/* Categorized channels */}
                        {categories.map(cat => {
                            const catChannels = grouped.get(cat.id) || [];
                            if (catChannels.length === 0) return null;
                            const isCollapsed = collapsed.has(cat.id);
                            return (
                                <div key={cat.id} className="mt-2">
                                    <button
                                        onClick={() => toggleCategory(cat.id)}
                                        className="flex items-center gap-1 w-full px-1 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                        {cat.name}
                                    </button>
                                    <AnimatePresence>
                                        {!isCollapsed && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                            >
                                                {catChannels.map(ch => (
                                                    <ChannelItem
                                                        key={ch.id}
                                                        channel={ch}
                                                        isActive={ch.id === channelId}
                                                        onClick={() => { navigate(`/server/${ch.id}`); setShowChannels(false); }}
                                                    />
                                                ))}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            );
                        })}
                    </>
                )}
            </div>
        </>
    );

    return (
        <div className="h-full w-full flex gap-4 max-w-full mx-auto relative overflow-hidden">
            {/* ── Channel List Sidebar (Desktop) ── */}
            <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className="w-64 shrink-0 bg-card border border-border rounded-xl hidden md:flex flex-col h-full"
            >
                {renderChannelList()}
            </motion.div>

            {/* ── Channel List Drawer (Mobile) ── */}
            <AnimatePresence>
                {showChannels && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowChannels(false)}
                            className="md:hidden fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                            className="md:hidden fixed inset-y-0 left-0 w-[80vw] sm:w-64 max-w-sm bg-card z-[70] flex flex-col shadow-2xl border-r border-border"
                        >
                            {renderChannelList()}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* ── Chat Area ── */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden shadow-sm h-full"
            >
                {!channelId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
                        <div className="flex md:hidden absolute top-4 left-4">
                             <button
                                onClick={() => setShowChannels(true)}
                                className="p-2 bg-secondary rounded-xl hover:bg-secondary/80 hover:text-foreground text-foreground flex items-center gap-2 shadow-sm"
                            >
                                <Hash className="w-5 h-5 text-primary" />
                                <span className="font-semibold text-sm">Выбрать канал</span>
                            </button>
                        </div>
                        <div className="w-16 h-16 rounded-2xl bg-secondary/50 border border-border flex items-center justify-center">
                            <MessageSquare className="w-8 h-8 text-muted-foreground/50" />
                        </div>
                        <div className="text-center">
                            <h3 className="font-rajdhani font-bold text-lg text-foreground/70">Выберите канал</h3>
                            <p className="text-sm mt-1 text-muted-foreground">Нажмите на канал слева, чтобы начать чат</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Channel header */}
                        <div className="h-14 px-3 md:px-5 border-b border-border bg-card/50 backdrop-blur flex items-center gap-2 md:gap-3 shrink-0">
                            <button
                                onClick={() => setShowChannels(true)}
                                className="md:hidden p-2 min-h-[40px] min-w-[40px] flex items-center justify-center hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-foreground shrink-0"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                            </button>
                            <Hash className="w-5 h-5 text-muted-foreground shrink-0 hidden md:block" />
                            <div className="flex-1 min-w-0">
                                <h2 className="font-rajdhani font-bold text-base leading-tight truncate">
                                    {activeChannel?.name || 'Канал'}
                                </h2>
                                {activeChannel?.topic && (
                                    <p className="text-[10px] md:text-xs text-muted-foreground truncate max-w-[200px] md:max-w-md">{activeChannel.topic}</p>
                                )}
                            </div>
                        </div>

                        {/* Messages Wrapper */}
                        <div className="flex-1 min-h-0 relative">
                            {/* Scroll to bottom FAB */}
                            <AnimatePresence>
                                {showScrollBottom && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.9 }}
                                        className="absolute bottom-4 right-4 md:bottom-6 md:right-6 z-20"
                                    >
                                        <button
                                            onClick={() => {
                                                if (scrollRef.current) {
                                                    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
                                                }
                                            }}
                                            className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center bg-card border shadow-xl border-border/50 text-foreground rounded-full hover:bg-secondary transition-colors"
                                            title="Вниз"
                                        >
                                            <ArrowDown className="w-4 h-4 md:w-5 md:h-5 text-muted-foreground transition-colors hover:text-foreground" />
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <div
                                ref={scrollRef}
                                onScroll={handleScroll}
                                className={`absolute inset-0 overflow-y-auto custom-scrollbar p-3 md:p-6 transition-opacity duration-300 ${initialLoadDone ? 'opacity-100' : 'opacity-0'}`}
                            >
                            {/* Load older indicator */}
                            {loadingOlder && (
                                <div className="flex justify-center py-3">
                                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                </div>
                            )}
                            {!hasMore && messages.length > 0 && (
                                <div className="text-center text-xs text-muted-foreground/60 py-3 italic">
                                    Начало истории канала
                                </div>
                            )}

                            {isLoadingMessages ? (
                                <div className="h-full flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="h-full flex flex-col justify-center items-center text-muted-foreground italic">
                                    Нет сообщений
                                </div>
                            ) : (
                                messages.map(msg => (
                                    <ChatMessage
                                        key={msg.id}
                                        message={msg}
                                        isStaff={!!msg._isStaff || !!msg._isMine}
                                        mentionMap={{}}
                                        onReply={handleReply}
                                        canEdit={false}
                                    />
                                ))
                            )}
                        </div>
                        </div>

                        {/* Input area */}
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

                            {/* Reply indicator */}
                            <AnimatePresence>
                                {replyTo && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-secondary/50 border border-border/50 text-sm mx-1">
                                            <Reply className="w-4 h-4 text-primary shrink-0" />
                                            <span className="text-muted-foreground hidden sm:inline">Ответ</span>
                                            <span className="font-semibold text-foreground truncate max-w-[100px] md:max-w-xs">
                                                {replyTo.author.global_name || replyTo.author.username}
                                            </span>
                                            <span className="text-muted-foreground truncate flex-1 text-xs">
                                                {replyTo.content?.slice(0, 60) || '[embed]'}{replyTo.content && replyTo.content.length > 60 ? '…' : ''}
                                            </span>
                                            <button onClick={() => setReplyTo(null)} className="p-1 min-h-[40px] min-w-[40px] flex items-center justify-center hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors shrink-0">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Attachments preview */}
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
                                    onChange={e => {
                                        setContent(e.target.value);
                                        // Trigger typing state every 5 seconds
                                        if (channelId && Date.now() - lastTypingTrigger.current > 5000) {
                                            lastTypingTrigger.current = Date.now();
                                            triggerServerTyping(channelId).catch(() => {});
                                        }
                                    }}
                                    onPaste={handlePaste}
                                    placeholder={replyTo ? 'Напишите ответ...' : 'Напишите сообщение...'}
                                    className="w-full bg-secondary/50 border border-border rounded-xl pl-12 md:pl-14 pr-[3.5rem] md:pr-16 py-3 md:py-4 custom-scrollbar min-h-[48px] md:min-h-[56px] max-h-32 resize-none focus:outline-none focus:border-primary transition-colors text-sm md:text-base leading-snug"
                                    onKeyDown={e => {
                                        if (e.key === 'Escape') { e.preventDefault(); setReplyTo(null); return; }
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e as any); }
                                    }}
                                />
                                <div className="absolute left-1.5 md:left-2 top-1 md:top-2 flex items-center gap-0.5 text-muted-foreground">
                                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 min-h-[40px] md:min-h-[44px] min-w-[40px] md:min-w-[44px] flex items-center justify-center hover:bg-secondary rounded-lg transition-colors hover:text-foreground">
                                        <Paperclip className="w-4 h-4 md:w-5 md:h-5" />
                                    </button>
                                </div>
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple className="hidden" />
                                <div className="absolute right-1.5 md:right-2 top-1 md:top-2">
                                    <button type="submit" disabled={isSending || (!content.trim() && attachments.length === 0)} className="p-2 min-h-[40px] md:min-h-[44px] min-w-[40px] md:min-w-[44px] flex items-center justify-center shrink-0 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                                        {isSending ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <Send className="w-4 h-4 md:w-5 md:h-5" />}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </>
                )}
            </motion.div>
        </div>
    );
}

// ── Channel Item Component ────────────────────────────────
function ChannelItem({ channel, isActive, onClick }: { channel: ServerChannel; isActive: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-all duration-150 group ${
                isActive
                    ? 'bg-primary/15 text-foreground border border-primary/25'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50 border border-transparent'
            }`}
        >
            <Hash className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/60 group-hover:text-muted-foreground'}`} />
            <span className="truncate font-medium text-[13px]">{channel.name}</span>
        </button>
    );
}
