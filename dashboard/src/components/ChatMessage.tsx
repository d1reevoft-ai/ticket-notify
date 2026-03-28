import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DiscordMessage } from '../api/tickets';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Reply, Pencil, CornerDownRight, X, Maximize2 } from 'lucide-react';
import { useState } from 'react';

const IMAGE_URL_RE = /(https?:\/\/[^\s]+\.(?:gif|png|jpg|jpeg|webp)(?:\?[^\s]*)?)/gi;
const URL_RE = /(https?:\/\/[^\s]+)/gi;
const MENTION_RE = /<@[!&]?(\d+)>/g;

function renderContent(text: string, mentionMap: Record<string, string> | undefined, onImageClick: (url: string) => void) {
    let resolved = text;
    if (mentionMap) {
        resolved = text.replace(MENTION_RE, (match, id) => {
            const isRole = match.includes('&');
            const key = isRole ? `role:${id}` : `user:${id}`;
            const name = mentionMap[key];
            if (name) return `@@MENTION:${isRole ? 'role' : 'user'}:${name}@@`;
            return match;
        });
    }

    const parts = resolved.split(IMAGE_URL_RE);
    return parts.map((part, i) => {
        if (IMAGE_URL_RE.test(part)) {
            IMAGE_URL_RE.lastIndex = 0;
            return <img key={i} src={part} alt="" className="rounded-lg max-h-64 mt-1 mb-1 object-contain cursor-pointer hover:opacity-90 transition-opacity" onClick={(e) => { e.preventDefault(); onImageClick(part); }} />;
        }
        const fragments = part.split(/(@@MENTION:(?:role|user):[^@]+@@)/g);
        return fragments.map((frag, fi) => {
            const mentionMatch = frag.match(/^@@MENTION:(role|user):(.+)@@$/);
            if (mentionMatch) {
                const [, , name] = mentionMatch;
                return (
                    <span key={`${i}-${fi}`} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-[#5865F2]/20 text-[#99AAF5]">@{name}</span>
                );
            }
            const subParts = frag.split(URL_RE);
            return subParts.map((sub, j) => {
                if (URL_RE.test(sub)) {
                    URL_RE.lastIndex = 0;
                    return (
                        <a key={`${i}-${fi}-${j}`} href={sub} target="_blank" rel="noreferrer"
                            className="underline opacity-80 hover:opacity-100 break-all">{sub}</a>
                    );
                }
                return sub;
            });
        });
    });
}

type ChatMessageProps = {
    message: DiscordMessage;
    isStaff: boolean;
    mentionMap?: Record<string, string>;
    onReply?: (msg: DiscordMessage) => void;
    onEdit?: (msg: DiscordMessage) => void;
    canEdit?: boolean;
};

export default function ChatMessage({ message, isStaff, mentionMap, onReply, onEdit, canEdit }: ChatMessageProps) {
    const isBot = message.author.bot;
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    const contentIsImageOnly = message.content && IMAGE_URL_RE.test(message.content) && message.content.trim().match(IMAGE_URL_RE)?.join('').length === message.content.trim().length;
    IMAGE_URL_RE.lastIndex = 0;

    return (
        <>
        <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={cn("flex w-full mb-6 group/msg", isStaff ? "justify-end" : "justify-start")}
        >
            <div className={cn("flex max-w-[80%] gap-4", isStaff && "flex-row-reverse")}>
                <div className="shrink-0 mt-1">
                    {message.author.avatar ? (
                        <img
                            src={`https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png`}
                            className="w-10 h-10 rounded-full bg-secondary object-cover ring-2 ring-background"
                            alt="avatar"
                        />
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center font-bold text-muted-foreground ring-2 ring-background">
                            {message.author.username[0].toUpperCase()}
                        </div>
                    )}
                </div>

                <div className={cn("flex flex-col relative", isStaff ? "items-end" : "items-start")}>
                    <div className="flex items-baseline gap-2 mb-1.5 px-1">
                        <span className={cn("text-sm font-semibold", isStaff ? "text-primary" : "text-foreground")}>
                            {message.author.global_name || message.author.username}
                        </span>
                        {isBot && (
                            <span className="text-[10px] bg-[#5865F2] text-white px-1.5 py-0.5 rounded font-medium tracking-wide uppercase">
                                Bot
                            </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                            {format(new Date(message.timestamp), 'HH:mm • d MMM', { locale: ru })}
                        </span>

                        {/* Action buttons */}
                        <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity flex items-center gap-0.5 ml-1">
                            {onReply && (
                                <button
                                    onClick={() => onReply(message)}
                                    className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                    title="Ответить"
                                >
                                    <Reply className="w-3.5 h-3.5" />
                                </button>
                            )}
                            {canEdit && onEdit && (
                                <button
                                    onClick={() => onEdit(message)}
                                    className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                    title="Редактировать"
                                >
                                    <Pencil className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Reply reference */}
                    {message.referenced_message && (
                        <div className={cn(
                            "flex items-center gap-1.5 text-xs text-muted-foreground mb-1 px-1",
                            isStaff ? "flex-row-reverse" : ""
                        )}>
                            <CornerDownRight className="w-3 h-3 shrink-0" />
                            <span className="font-medium text-foreground/70">
                                {message.referenced_message.author.global_name || message.referenced_message.author.username}
                            </span>
                            <span className="truncate max-w-[200px] opacity-60">
                                {message.referenced_message.content || '[embed]'}
                            </span>
                        </div>
                    )}

                    {message.content ? (
                        contentIsImageOnly ? (
                            <div className="rounded-2xl overflow-hidden shadow-sm inline-block">
                                {renderContent(message.content, mentionMap, setPreviewImage)}
                            </div>
                        ) : (
                            <div className={cn(
                                "p-3.5 rounded-2xl relative shadow-sm text-sm whitespace-pre-wrap leading-relaxed",
                                isStaff
                                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                                    : "bg-secondary text-foreground rounded-tl-sm border border-border/50"
                            )}>
                                {renderContent(message.content, mentionMap, setPreviewImage)}
                            </div>
                        )
                    ) : null}

                    {message.embeds && message.embeds.length > 0 && message.embeds.map((embed, ei) => {
                        const borderColor = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : 'hsl(var(--border))';
                        return (
                            <div key={ei} className="mt-1 rounded-lg bg-secondary/80 border border-border/50 overflow-hidden max-w-md"
                                style={{ borderLeftWidth: '3px', borderLeftColor: borderColor }}>
                                <div className="p-3 space-y-1.5">
                                    {embed.author && <p className="text-xs font-semibold text-muted-foreground">{embed.author.name}</p>}
                                    {embed.title && <p className="text-sm font-bold text-foreground">{embed.title}</p>}
                                    {embed.description && <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{embed.description}</p>}
                                    {embed.fields && embed.fields.length > 0 && (
                                        <div className="grid grid-cols-1 gap-1.5 mt-2">
                                            {embed.fields.map((f, fi) => (
                                                <div key={fi}>
                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">{f.name}</p>
                                                    <p className="text-xs text-foreground/80 whitespace-pre-wrap">{f.value}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {embed.image && (
                                        <img 
                                            src={embed.image.url} 
                                            alt="" 
                                            className="rounded mt-2 max-h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity" 
                                            onClick={(e) => { e.preventDefault(); setPreviewImage(embed.image!.url); }}
                                        />
                                    )}
                                    {embed.thumbnail && (
                                        <img 
                                            src={embed.thumbnail.url} 
                                            alt="" 
                                            className="rounded mt-1 max-h-16 object-cover cursor-pointer hover:opacity-90 transition-opacity" 
                                            onClick={(e) => { e.preventDefault(); setPreviewImage(embed.thumbnail!.url); }}
                                        />
                                    )}
                                    {embed.footer && <p className="text-[10px] text-muted-foreground mt-2">{embed.footer.text}</p>}
                                </div>
                            </div>
                        );
                    })}

                    {!message.content && (!message.embeds || message.embeds.length === 0) && (
                        <div className="p-3.5 rounded-2xl bg-secondary border border-border/50 rounded-tl-sm">
                            <span className="italic text-muted-foreground text-xs">[без текста]</span>
                        </div>
                    )}

                    {message.attachments && message.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {message.attachments.map(att => (
                                <a
                                    key={att.id}
                                    href={att.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => {
                                        if (att.content_type?.startsWith('image/')) {
                                            e.preventDefault();
                                            setPreviewImage(att.url);
                                        }
                                    }}
                                    className="block rounded-lg overflow-hidden border border-border/50 bg-secondary/30 relative group cursor-pointer"
                                >
                                    {att.content_type?.startsWith('image/') ? (
                                        <div className="relative isolate">
                                            <img src={att.url} alt="attachment" className="max-h-48 object-cover group-hover:opacity-90 transition-opacity" />
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                                <Maximize2 className="text-white opacity-0 group-hover:opacity-100 w-6 h-6 drop-shadow-md" />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-3 italic text-sm underline group-hover:bg-secondary/60 transition-colors">
                                            Вложение: {att.filename}
                                        </div>
                                    )}
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </motion.div>

        <AnimatePresence>
            {previewImage && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setPreviewImage(null)}
                    className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-md flex items-center justify-center p-4 cursor-zoom-out"
                >
                    <button
                        onClick={() => setPreviewImage(null)}
                        className="absolute top-6 right-6 p-3 bg-secondary/80 hover:bg-secondary rounded-full text-foreground/80 hover:text-foreground transition-colors z-[101]"
                    >
                        <X className="w-6 h-6" />
                    </button>
                    <motion.img
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        src={previewImage}
                        alt="Preview"
                        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                    />
                </motion.div>
            )}
        </AnimatePresence>
        </>
    );
}
