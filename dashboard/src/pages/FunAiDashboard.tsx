import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Brain, Zap, Database, TrendingUp, Trash2, Plus, Search, RefreshCw, BookOpen } from 'lucide-react';
import { funaiApi, type FunAiMemoryEntry } from '../api/funai';

interface StatsData {
    today: {
        totalRequests: number;
        l0Hits: number;
        l1Hits: number;
        l2Hits: number;
        corrections: number;
        tokensUsed: number;
        accuracy: number;
    };
    totals: {
        memoryEntries: number;
        conversations: number;
    };
    history: Array<{
        date: string;
        totalRequests: number;
        l0Hits: number;
        l1Hits: number;
        l2Hits: number;
    }>;
}

interface ProvidersData {
    [key: string]: {
        name: string;
        status: string;
        keyCount: number;
    };
}

export default function FunAiDashboard() {
    const [stats, setStats] = useState<StatsData | null>(null);
    const [memory, setMemory] = useState<FunAiMemoryEntry[]>([]);
    const [memoryStats, setMemoryStats] = useState<any>(null);
    const [providers, setProviders] = useState<ProvidersData>({});
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState('');
    const [loading, setLoading] = useState(true);
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [newEntry, setNewEntry] = useState({ type: 'fact', category: '', question: '', content: '' });
    const [activeTab, setActiveTab] = useState<'overview' | 'memory' | 'providers'>('overview');

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [statsRes, memRes, provRes] = await Promise.all([
                funaiApi.getStats(),
                funaiApi.getMemory({ search: searchQuery, type: filterType || undefined, limit: 100 }),
                funaiApi.getProviders(),
            ]);
            setStats(statsRes);
            setMemory(memRes.entries || []);
            setMemoryStats(memRes.stats || null);
            setProviders(provRes.providers || {});
        } catch {}
        setLoading(false);
    }, [searchQuery, filterType]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const handleDeleteMemory = async (id: number) => {
        await funaiApi.deleteMemory(id);
        fetchAll();
    };

    const handleAddMemory = async () => {
        if (!newEntry.content.trim()) return;
        await funaiApi.addMemory(newEntry);
        setNewEntry({ type: 'fact', category: '', question: '', content: '' });
        setAddModalOpen(false);
        fetchAll();
    };

    const handleLearn = async () => {
        const result = await funaiApi.learn();
        if (result.imported > 0) fetchAll();
    };

    const today = stats?.today;
    const l0Pct = today && today.totalRequests > 0 ? Math.round((today.l0Hits / today.totalRequests) * 100) : 0;
    const l1Pct = today && today.totalRequests > 0 ? Math.round((today.l1Hits / today.totalRequests) * 100) : 0;
    const l2Pct = today && today.totalRequests > 0 ? Math.round((today.l2Hits / today.totalRequests) * 100) : 0;

    const providerEntries = Object.values(providers);

    return (
        <div className="funai-dashboard">
            <div className="funai-dashboard__header">
                <div className="flex items-center gap-3">
                    <div className="funai-dashboard__logo">
                        <Brain className="w-7 h-7" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">FunAI</h1>
                        <p className="text-sm text-muted-foreground">Единый AI-мозг системы</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="funai-dashboard__status-badge">
                        <span className="funai-dashboard__status-pulse" />
                        Активен
                    </span>
                    <button onClick={fetchAll} className="funai-dashboard__refresh-btn" title="Обновить">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="funai-dashboard__tabs">
                {(['overview', 'memory', 'providers'] as const).map((tab) => (
                    <button
                        key={tab}
                        className={`funai-dashboard__tab ${activeTab === tab ? 'funai-dashboard__tab--active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab === 'overview' && <TrendingUp className="w-4 h-4" />}
                        {tab === 'memory' && <Database className="w-4 h-4" />}
                        {tab === 'providers' && <Zap className="w-4 h-4" />}
                        <span>{tab === 'overview' ? 'Обзор' : tab === 'memory' ? 'Память' : 'Провайдеры'}</span>
                    </button>
                ))}
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="funai-dashboard__content">
                    <div className="funai-dashboard__cards">
                        <div className="funai-stat-card funai-stat-card--purple">
                            <div className="funai-stat-card__icon"><Zap className="w-5 h-5" /></div>
                            <div className="funai-stat-card__value">{today?.totalRequests || 0}</div>
                            <div className="funai-stat-card__label">Запросов сегодня</div>
                        </div>
                        <div className="funai-stat-card funai-stat-card--green">
                            <div className="funai-stat-card__icon"><TrendingUp className="w-5 h-5" /></div>
                            <div className="funai-stat-card__value">{today?.accuracy ?? 100}%</div>
                            <div className="funai-stat-card__label">Точность</div>
                        </div>
                        <div className="funai-stat-card funai-stat-card--blue">
                            <div className="funai-stat-card__icon"><Brain className="w-5 h-5" /></div>
                            <div className="funai-stat-card__value">{today?.tokensUsed?.toLocaleString() || 0}</div>
                            <div className="funai-stat-card__label">Токенов потрачено</div>
                        </div>
                        <div className="funai-stat-card funai-stat-card--amber">
                            <div className="funai-stat-card__icon"><Database className="w-5 h-5" /></div>
                            <div className="funai-stat-card__value">{stats?.totals?.memoryEntries || 0}</div>
                            <div className="funai-stat-card__label">Записей в памяти</div>
                        </div>
                    </div>

                    {/* Distribution bar */}
                    <div className="funai-dashboard__distribution">
                        <h3 className="text-base font-semibold mb-3">Распределение ответов</h3>
                        <div className="funai-distribution-bar">
                            {l0Pct > 0 && <div className="funai-dist-segment funai-dist--l0" style={{ width: `${l0Pct}%` }} title={`L0 Память: ${l0Pct}%`} />}
                            {l1Pct > 0 && <div className="funai-dist-segment funai-dist--l1" style={{ width: `${l1Pct}%` }} title={`L1 Правила: ${l1Pct}%`} />}
                            {l2Pct > 0 && <div className="funai-dist-segment funai-dist--l2" style={{ width: `${l2Pct}%` }} title={`L2 AI: ${l2Pct}%`} />}
                            {(today?.totalRequests || 0) === 0 && <div className="funai-dist-segment funai-dist--empty" style={{ width: '100%' }} />}
                        </div>
                        <div className="funai-distribution-legend">
                            <span><span className="funai-legend-dot funai-legend--l0" /> L0 Память ({today?.l0Hits || 0})</span>
                            <span><span className="funai-legend-dot funai-legend--l1" /> L1 Правила ({today?.l1Hits || 0})</span>
                            <span><span className="funai-legend-dot funai-legend--l2" /> L2 AI ({today?.l2Hits || 0})</span>
                        </div>
                    </div>

                    {/* Activity History */}
                    {stats?.history && stats.history.length > 1 && (
                        <div className="funai-dashboard__history">
                            <h3 className="text-base font-semibold mb-3">Активность за неделю</h3>
                            <div className="funai-history-bars">
                                {stats.history.slice(0, 7).reverse().map((day) => {
                                    const max = Math.max(...stats.history.slice(0, 7).map(d => d.totalRequests), 1);
                                    const height = Math.max(4, (day.totalRequests / max) * 80);
                                    return (
                                        <div key={day.date} className="funai-history-bar-wrap" title={`${day.date}: ${day.totalRequests} запросов`}>
                                            <div className="funai-history-bar" style={{ height: `${height}px` }} />
                                            <span className="funai-history-date">{day.date.slice(5)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </motion.div>
            )}

            {/* Memory Tab */}
            {activeTab === 'memory' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="funai-dashboard__content">
                    <div className="funai-memory__toolbar">
                        <div className="funai-memory__search">
                            <Search className="w-4 h-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Поиск по памяти..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="funai-memory__search-input"
                            />
                        </div>
                        <select
                            className="funai-memory__filter"
                            value={filterType}
                            onChange={e => setFilterType(e.target.value)}
                        >
                            <option value="">Все типы</option>
                            <option value="fact">Факты</option>
                            <option value="qa">Q&A</option>
                            <option value="correction">Исправления</option>
                            <option value="rule">Правила</option>
                        </select>
                        <button className="funai-memory__add-btn" onClick={() => setAddModalOpen(true)}>
                            <Plus className="w-4 h-4" />
                            <span>Добавить</span>
                        </button>
                        <button className="funai-memory__learn-btn" onClick={handleLearn} title="Загрузить из FAQ">
                            <BookOpen className="w-4 h-4" />
                        </button>
                    </div>

                    {memoryStats && (
                        <div className="funai-memory__stats-bar">
                            <span>Всего: <strong>{memoryStats.total}</strong></span>
                            {Object.entries(memoryStats.byType || {}).map(([type, count]) => (
                                <span key={type} className="funai-memory__type-badge">{type}: {count as number}</span>
                            ))}
                        </div>
                    )}

                    <div className="funai-memory__list">
                        {memory.map(entry => (
                            <div key={entry.id} className="funai-memory__item">
                                <div className="funai-memory__item-header">
                                    <span className={`funai-memory__type-tag funai-memory__type--${entry.type}`}>
                                        {entry.type === 'qa' ? '❓ Q&A' : entry.type === 'correction' ? '✏️ Исправление' : entry.type === 'fact' ? '📌 Факт' : `📋 ${entry.type}`}
                                    </span>
                                    {entry.category && <span className="funai-memory__category">{entry.category}</span>}
                                    <span className="funai-memory__source">{entry.source}</span>
                                    <span className="funai-memory__usage">×{entry.usage_count}</span>
                                    <button className="funai-memory__delete" onClick={() => handleDeleteMemory(entry.id)}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                {entry.question && <div className="funai-memory__question">Q: {entry.question}</div>}
                                <div className="funai-memory__content">{entry.content}</div>
                                <div className="funai-memory__meta">
                                    <span>Уверенность: {(entry.confidence * 100).toFixed(0)}%</span>
                                    <span>{new Date(entry.created_at).toLocaleDateString('ru-RU')}</span>
                                </div>
                            </div>
                        ))}
                        {memory.length === 0 && (
                            <div className="funai-memory__empty">
                                <Database className="w-8 h-8 text-muted-foreground mb-2" />
                                <p>Память пуста. Начните добавлять записи!</p>
                            </div>
                        )}
                    </div>

                    {/* Add Modal */}
                    {addModalOpen && (
                        <div className="funai-modal-overlay" onClick={() => setAddModalOpen(false)}>
                            <div className="funai-modal" onClick={e => e.stopPropagation()}>
                                <h3 className="text-lg font-semibold mb-4">Добавить запись в память</h3>
                                <div className="funai-modal__field">
                                    <label>Тип</label>
                                    <select value={newEntry.type} onChange={e => setNewEntry({ ...newEntry, type: e.target.value })}>
                                        <option value="fact">Факт</option>
                                        <option value="qa">Вопрос-Ответ</option>
                                        <option value="rule">Правило</option>
                                    </select>
                                </div>
                                <div className="funai-modal__field">
                                    <label>Категория</label>
                                    <input type="text" placeholder="general, server, tickets..." value={newEntry.category} onChange={e => setNewEntry({ ...newEntry, category: e.target.value })} />
                                </div>
                                {newEntry.type === 'qa' && (
                                    <div className="funai-modal__field">
                                        <label>Вопрос</label>
                                        <input type="text" placeholder="Вопрос пользователя" value={newEntry.question} onChange={e => setNewEntry({ ...newEntry, question: e.target.value })} />
                                    </div>
                                )}
                                <div className="funai-modal__field">
                                    <label>Содержание</label>
                                    <textarea placeholder="Текст записи..." value={newEntry.content} onChange={e => setNewEntry({ ...newEntry, content: e.target.value })} rows={3} />
                                </div>
                                <div className="funai-modal__actions">
                                    <button className="funai-modal__cancel" onClick={() => setAddModalOpen(false)}>Отмена</button>
                                    <button className="funai-modal__save" onClick={handleAddMemory}>Сохранить</button>
                                </div>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}

            {/* Providers Tab */}
            {activeTab === 'providers' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="funai-dashboard__content">
                    <div className="funai-providers-grid">
                        {providerEntries.length > 0 ? providerEntries.map(p => (
                            <div key={p.name} className="funai-provider-card">
                                <div className="funai-provider-card__header">
                                    <span className="funai-provider-card__name">
                                        {p.name === 'gemini' ? '✨ Gemini' : p.name === 'groq' ? '⚡ Groq' : p.name === 'openrouter' ? '🌐 OpenRouter' : p.name}
                                    </span>
                                    <span className={`funai-provider-card__status funai-provider-card__status--${p.status}`}>
                                        {p.status === 'active' ? '✅' : '⚠️'} {p.status === 'active' ? 'Активен' : 'Ошибка'}
                                    </span>
                                </div>
                                <div className="funai-provider-card__details">
                                    <span>Ключей: {p.keyCount}</span>
                                </div>
                            </div>
                        )) : (
                            <div className="funai-providers-empty">
                                <Zap className="w-8 h-8 text-muted-foreground mb-2" />
                                <p>Нет настроенных AI провайдеров.</p>
                                <p className="text-sm text-muted-foreground">Добавьте API ключи в настройках.</p>
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </div>
    );
}
