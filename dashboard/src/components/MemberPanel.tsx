import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMembers, fetchMemberProfile } from '../api/stats';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, ChevronDown, ChevronRight, PanelRightClose, Copy, Check, Search } from 'lucide-react';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useSocket } from '../hooks/useSocket';

type Member = {
    id: string;
    username: string;
    displayName: string;
    avatar: string;
    status: string;
    customStatus?: string | null;
    activityText?: string | null;
    activityObj?: any;
    nameColor?: string | null;
};

type RoleGroup = {
    roleId: string;
    roleName: string;
    roleColor: string;
    position: number;
    members: Member[];
};

type MemberPanelProps = {
    onClose?: () => void;
};

const STATUS_ORDER: Record<string, number> = {
    online: 0,
    idle: 1,
    dnd: 2,
    offline: 3,
};

const STATUS_META: Record<string, { dotClass: string; label: string; }> = {
    online: { dotClass: 'bg-emerald-500', label: 'online' },
    idle: { dotClass: 'bg-amber-400', label: 'idle' },
    dnd: { dotClass: 'bg-red-500', label: 'dnd' },
    offline: { dotClass: 'bg-slate-500', label: 'offline' },
};

const normalizeStatus = (status: string | undefined) => {
    if (status === 'online' || status === 'idle' || status === 'dnd') return status;
    return 'offline';
};

const getMemberSubtitle = (member: Member) => {
    if (member.customStatus) return member.customStatus;
    if (member.activityText) return member.activityText;
    if (member.username) return `@${member.username}`;
    return member.id;
};

export default function MemberPanel({ onClose }: MemberPanelProps) {
    const queryClient = useQueryClient();
    const socket = useSocket();
    const { data: groups, isLoading } = useQuery<RoleGroup[]>({
        queryKey: ['members'],
        queryFn: fetchMembers,
        refetchInterval: 12000,
        refetchIntervalInBackground: true,
        staleTime: 5000,
        placeholderData: prev => prev,
    });
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [autoCollapsedApplied, setAutoCollapsedApplied] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; member: Member } | null>(null);
    const [copied, setCopied] = useState(false);

    // Popover State
    const [selectedProfile, setSelectedProfile] = useState<{ member: Member; y: number; groupName: string } | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Fetch dynamic profile (for bio / banner) when popover is open
    const { data: profileObj, isFetching: profileFetching } = useQuery({
        queryKey: ['profile', selectedProfile?.member.id],
        queryFn: () => fetchMemberProfile(selectedProfile!.member.id),
        enabled: !!selectedProfile?.member.id,
        staleTime: 60000, // cache 1 min
    });

    const preparedGroups = useMemo(() => {
        if (!groups || !Array.isArray(groups)) return [];
        const search = searchQuery.toLowerCase().trim();

        return groups.map(group => {
            const filteredMembers = Array.isArray(group.members) ? [...group.members].filter(m => {
                if (!search) return true;
                return (m.displayName || '').toLowerCase().includes(search) || 
                       (m.username || '').toLowerCase().includes(search);
            }).sort((a, b) => {
                const statusDiff = STATUS_ORDER[normalizeStatus(a.status)] - STATUS_ORDER[normalizeStatus(b.status)];
                if (statusDiff !== 0) return statusDiff;
                return (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', 'ru');
            }) : [];

            return {
                ...group,
                members: filteredMembers
            };
        }).filter(group => group.members.length > 0).sort((a, b) => b.position - a.position);
    }, [groups, searchQuery]);

    const toggle = (roleId: string) => {
        setCollapsed(prev => ({ ...prev, [roleId]: !prev[roleId] }));
    };

    useEffect(() => {
        if (!socket) return;
        const handleMembersUpdated = () => {
            queryClient.invalidateQueries({ queryKey: ['members'] });
        };
        socket.on('members:updated', handleMembersUpdated);
        return () => {
            socket.off('members:updated', handleMembersUpdated);
        };
    }, [socket, queryClient]);

    useEffect(() => {
        if (!preparedGroups.length || autoCollapsedApplied || Object.keys(collapsed).length > 0) return;
        const initialCollapsed: Record<string, boolean> = {};
        preparedGroups.forEach(group => {
            initialCollapsed[group.roleId] = group.members.length > 18;
        });
        setCollapsed(initialCollapsed);
        setAutoCollapsedApplied(true);
    }, [preparedGroups, autoCollapsedApplied, collapsed]);

    // Close overlays on outside click
    useEffect(() => {
        const handleOutsideClick = () => {
            setContextMenu(null);
            setSelectedProfile(null);
        };
        window.addEventListener('click', handleOutsideClick);
        return () => window.removeEventListener('click', handleOutsideClick);
    }, []);

    const handleContextMenu = (e: React.MouseEvent, member: Member) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, member });
        setSelectedProfile(null);
    };

    const handleProfileClick = (e: React.MouseEvent, member: Member, groupName: string) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setSelectedProfile({ member, y: rect.top, groupName });
        setContextMenu(null);
    };

    const copyId = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (contextMenu) {
            navigator.clipboard.writeText(contextMenu.member.id);
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
                setContextMenu(null);
            }, 1000);
        }
    };

    const totalMembers = useMemo(() => {
        if (!groups) return 0;
        return groups.reduce((sum, g) => sum + (g.members?.length || 0), 0);
    }, [groups]);

    const resolveAssetUrl = (key: string, appId?: string) => {
        if (!key) return null;
        if (key.startsWith('mp:')) {
            return `https://media.discordapp.net/${key.replace('mp:', '')}`;
        }
        if (key.startsWith('spotify:')) {
            return `https://i.scdn.co/image/${key.replace('spotify:', '')}`;
        }
        if (key.startsWith('external/')) {
            return `https://media.discordapp.net/external/${key.replace('external/', '')}`;
        }
        if (key.startsWith('http')) return key;
        if (appId) return `https://cdn.discordapp.com/app-assets/${appId}/${key}.png`;
        return null;
    };

    const renderActivityImage = (act: any) => {
        const largeUrl = resolveAssetUrl(act?.assets?.large_image, act?.application_id);
        const smallUrl = resolveAssetUrl(act?.assets?.small_image, act?.application_id);
        const url = largeUrl || smallUrl;
        if (!url) return null;
        
        return (
            <div className="relative shrink-0">
                <img 
                    src={url} 
                    alt="Activity" 
                    className="w-14 h-14 rounded-lg object-cover shadow-md bg-secondary/50"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                {largeUrl && smallUrl && largeUrl !== smallUrl && (
                    <img 
                        src={smallUrl} 
                        alt="" 
                        className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-card bg-secondary"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                )}
            </div>
        );
    };

    return (
        <div ref={panelRef} className="member-panel-shell relative w-72 shrink-0 bg-card border-l border-border h-full overflow-y-auto custom-scrollbar">
            <div className="sticky top-0 bg-card/95 backdrop-blur-sm z-10 px-4 py-3 border-b border-border space-y-3">
                <div className="flex items-center gap-2.5 text-sm font-rajdhani font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span>Участники</span>
                    {!isLoading && (
                        <span className="ml-auto text-xs bg-secondary px-2 py-0.5 rounded-full border border-border/70">{totalMembers}</span>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="ml-1 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
                            title="Скрыть панель участников"
                        >
                            <PanelRightClose className="w-4 h-4" />
                        </button>
                    )}
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input 
                        type="text" 
                        placeholder="Поиск участников..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full text-xs bg-secondary/50 border border-border/50 rounded-md pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-secondary/80 transition-all font-medium text-foreground placeholder:text-muted-foreground/50"
                    />
                </div>
            </div>

            {isLoading ? (
                <div className="p-3 space-y-2">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="flex items-center gap-2 animate-pulse">
                            <div className="w-9 h-9 bg-secondary rounded-full" />
                            <div className="space-y-1.5">
                                <div className="h-3 bg-secondary rounded w-28" />
                                <div className="h-2.5 bg-secondary/80 rounded w-20" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : preparedGroups.length === 0 ? (
                <div className="p-4 text-sm text-center text-muted-foreground">
                    {searchQuery ? "По вашему запросу ничего не найдено." : "Участники пока не загружены. Дашборд запрашивает данные с сервера Discord..."}
                </div>
            ) : (
                <div className="py-2">
                    {preparedGroups.map((group) => (
                        <div key={group.roleId} className="mb-1">
                            <button
                                onClick={() => toggle(group.roleId)}
                                className="w-full flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-rajdhani font-bold uppercase tracking-[0.08em] hover:bg-secondary/40 transition-colors"
                                style={{ color: group.roleColor }}
                            >
                                {collapsed[group.roleId] ? (
                                    <ChevronRight className="w-3 h-3 shrink-0" />
                                ) : (
                                    <ChevronDown className="w-3 h-3 shrink-0" />
                                )}
                                <span className="truncate">{group.roleName}</span>
                                <span className="ml-auto opacity-70">{group.members.length}</span>
                            </button>

                            <AnimatePresence initial={false}>
                                {!collapsed[group.roleId] && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.22, ease: 'easeInOut' }}
                                        className="overflow-hidden"
                                    >
                                        <div className="space-y-0.5 pb-1">
                                            {group.members.map(member => {
                                                const status = normalizeStatus(member.status);
                                                const meta = STATUS_META[status] || STATUS_META.offline;
                                                const subtitle = getMemberSubtitle(member);
                                                const isActive = selectedProfile?.member.id === member.id;

                                                return (
                                                    <motion.div
                                                        key={`${group.roleId}-${member.id}`}
                                                        layout
                                                        initial={{ opacity: 0, x: -6 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        exit={{ opacity: 0, x: -6 }}
                                                        transition={{ duration: 0.16 }}
                                                        onClick={(e) => handleProfileClick(e, member, group.roleName)}
                                                        onContextMenu={(e) => handleContextMenu(e, member)}
                                                        className={`mx-2 rounded-xl px-2.5 py-1.5 transition-colors cursor-pointer min-w-0 ${isActive ? 'bg-secondary/60' : 'hover:bg-secondary/45'}`}
                                                    >
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <div className="relative shrink-0">
                                                                <img
                                                                    src={member.avatar}
                                                                    alt={member.displayName}
                                                                    className="w-9 h-9 rounded-full object-cover bg-secondary"
                                                                    loading="lazy"
                                                                    onError={(e) => {
                                                                        (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png';
                                                                    }}
                                                                />
                                                                <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-card ${meta.dotClass}`} />
                                                            </div>

                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <span
                                                                        className="text-sm leading-tight truncate font-medium"
                                                                        style={member.nameColor ? { color: member.nameColor } : undefined}
                                                                    >
                                                                        {member.displayName || member.username || member.id}
                                                                    </span>
                                                                    {status === 'offline' && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 shrink-0">offline</span>}
                                                                </div>
                                                                <div className="text-[11px] leading-tight text-muted-foreground/80 truncate">
                                                                    {subtitle}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                );
                                            })}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ))}
                </div>
            )}

            {/* Profile Popover */}
            <AnimatePresence>
                {selectedProfile && (
                    <motion.div
                        initial={{ opacity: 0, x: 10, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        onClick={(e) => e.stopPropagation()}
                        className="fixed right-[290px] w-80 bg-popover/95 backdrop-blur-xl border border-border shadow-2xl rounded-2xl overflow-hidden z-50 flex flex-col max-h-[85vh]"
                        style={{
                            top: Math.min(Math.max(20, selectedProfile.y - 120), window.innerHeight - 450)
                        }}
                    >
                        {/* Banner */}
                        <div 
                            className="h-[60px] w-full shrink-0 relative"
                            style={{ 
                                backgroundColor: profileObj?.user?.banner_color || selectedProfile.member.nameColor || '#5865F2',
                            }} 
                        >
                            {profileObj?.user?.banner && (
                                <img 
                                    src={`https://cdn.discordapp.com/banners/${selectedProfile.member.id}/${profileObj.user.banner}${profileObj.user.banner.startsWith('a_') ? '.gif' : '.png'}?size=480`} 
                                    alt="Banner" 
                                    className="absolute inset-0 w-full h-full object-cover" 
                                />
                            )}
                        </div>
                        
                        <div className="px-5 pb-5 relative bg-card flex-1 overflow-y-auto custom-scrollbar">
                            {/* Avatar Float */}
                            <div className="absolute -top-[40px] left-4 p-[3px] bg-card rounded-full z-20">
                                <div className="relative">
                                    <img 
                                        src={selectedProfile.member.avatar} 
                                        alt={selectedProfile.member.displayName}
                                        className="w-[76px] h-[76px] rounded-full object-cover bg-secondary"
                                    />
                                    <span 
                                        className={`absolute bottom-0 right-0 w-[20px] h-[20px] rounded-full border-[3px] border-card ${STATUS_META[normalizeStatus(selectedProfile.member.status)].dotClass}`} 
                                    />
                                </div>
                            </div>
                            
                            {/* Info */}
                            <div className="pt-11">
                                <h3 className="text-[20px] font-bold leading-tight flex items-center gap-2 break-words">
                                    {selectedProfile.member.displayName}
                                </h3>
                                <p className="text-sm font-medium text-muted-foreground mt-0.5 mb-4 break-words">
                                    {selectedProfile.member.username !== selectedProfile.member.displayName ? String(selectedProfile.member.username) : String(selectedProfile.member.id)}
                                </p>
                                
                                <div className="space-y-4">
                                    {/* Highest Role Badge */}
                                    <div>
                                        <div className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground/80 mb-1.5 border-b border-border/50 pb-1 w-max">Высшая Роль</div>
                                        <div 
                                            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[6px] text-[11px] font-bold uppercase tracking-wide border border-border bg-secondary/20 shadow-sm"
                                            style={{ color: selectedProfile.member.nameColor || '#fff' }}
                                        >
                                            <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: selectedProfile.member.nameColor || '#fff' }}/>
                                            {selectedProfile.groupName}
                                        </div>
                                    </div>

                                    {/* Custom Status */}
                                    {selectedProfile.member.customStatus && (
                                        <div>
                                            <div className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground/80 mb-1.5 border-b border-border/50 pb-1 w-max">Пользовательский Статус</div>
                                            <p className="text-[13px] leading-relaxed text-foreground font-medium flex items-start gap-1">
                                                <span>{selectedProfile.member.customStatus}</span>
                                            </p>
                                        </div>
                                    )}

                                    {/* Rich Presence Activity */}
                                    {selectedProfile.member.activityObj && (
                                        <div>
                                            <div className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground/80 mb-2 border-b border-border/50 pb-1 w-max">
                                                {selectedProfile.member.activityObj.name === 'Spotify' ? 'Слушает Spotify' : 'Активность'}
                                            </div>
                                            <div className="flex items-center gap-3 bg-secondary/30 p-2.5 rounded-xl border border-border/30">
                                                {renderActivityImage(selectedProfile.member.activityObj)}
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[13px] font-bold text-foreground leading-tight truncate">
                                                        {selectedProfile.member.activityObj.name}
                                                    </div>
                                                    {selectedProfile.member.activityObj.details && (
                                                        <div className="text-[12px] text-muted-foreground truncate mt-0.5">
                                                            {selectedProfile.member.activityObj.details}
                                                        </div>
                                                    )}
                                                    {selectedProfile.member.activityObj.state && (
                                                        <div className="text-[12px] text-muted-foreground truncate">
                                                            {selectedProfile.member.activityObj.state}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Profile Bio */}
                                    {profileFetching ? (
                                        <div className="pt-2">
                                            <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground/80 mb-1.5 border-b border-border/50 pb-1 w-max">
                                                Обо мне
                                                <div className="w-2.5 h-2.5 border-[1.5px] border-t-transparent border-muted-foreground rounded-full animate-spin" />
                                            </div>
                                            <div className="space-y-1.5 opacity-50">
                                                <div className="h-2 bg-secondary rounded w-full"></div>
                                                <div className="h-2 bg-secondary rounded w-3/4"></div>
                                                <div className="h-2 bg-secondary rounded w-1/2"></div>
                                            </div>
                                        </div>
                                    ) : (profileObj?.user?.bio || profileObj?.user_profile?.bio) ? (
                                        <div className="pt-2">
                                            <div className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground/80 mb-1.5 border-b border-border/50 pb-1 w-max">
                                                Обо мне
                                            </div>
                                            <p className="text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                                                {profileObj?.user?.bio || profileObj?.user_profile?.bio}
                                            </p>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Context Menu */}
            <AnimatePresence>
                {contextMenu && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.1 }}
                        onClick={(e) => e.stopPropagation()}
                        className="fixed z-50 min-w-[180px] bg-popover/95 backdrop-blur-xl border border-border shadow-xl rounded-lg p-1.5"
                        style={{
                            left: Math.min(contextMenu.x, window.innerWidth - 200),
                            top: Math.min(contextMenu.y, window.innerHeight - 60)
                        }}
                    >
                        <button
                            onClick={copyId}
                            className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
                        >
                            <span>Скопировать ID</span>
                            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 opacity-70" />}
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
