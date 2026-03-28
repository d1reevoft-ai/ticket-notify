import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchFaqArticles, generateFaqArticle, createFaqArticle, updateFaqArticle, deleteFaqArticle } from '../api/faq';
import type { FaqArticle } from '../api/faq';
import { motion, AnimatePresence } from 'framer-motion';
import {
    BookOpen, Sparkles, Plus, Pencil, Trash2, X, Save,
    Search, ChevronDown, ChevronUp, Loader2, FileText
} from 'lucide-react';

export default function FAQ() {
    const queryClient = useQueryClient();
    const { data: articles, isLoading } = useQuery({
        queryKey: ['faq'],
        queryFn: fetchFaqArticles,
    });

    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');

    // Generate modal
    const [showGenerate, setShowGenerate] = useState(false);
    const [genTopic, setGenTopic] = useState('');
    const [genLimit, setGenLimit] = useState(10);

    // Create modal
    const [showCreate, setShowCreate] = useState(false);
    const [createTitle, setCreateTitle] = useState('');
    const [createContent, setCreateContent] = useState('');

    const [searchQuery, setSearchQuery] = useState('');

    const generateMutation = useMutation({
        mutationFn: ({ topic, limit }: { topic: string; limit: number }) => generateFaqArticle(topic, limit),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['faq'] });
            setShowGenerate(false);
            setGenTopic('');
        },
    });

    const createMutation = useMutation({
        mutationFn: ({ title, content }: { title: string; content: string }) => createFaqArticle(title, content),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['faq'] });
            setShowCreate(false);
            setCreateTitle('');
            setCreateContent('');
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, title, content }: { id: number; title: string; content: string }) => updateFaqArticle(id, title, content),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['faq'] });
            setEditingId(null);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => deleteFaqArticle(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['faq'] });
        },
    });

    const startEdit = (article: FaqArticle) => {
        setEditingId(article.id);
        setEditTitle(article.title);
        setEditContent(article.content);
    };

    const filteredArticles = (articles || []).filter(a => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q);
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/5 border border-amber-500/20 flex items-center justify-center">
                        <BookOpen className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                        <h1 className="text-xl md:text-2xl font-rajdhani font-bold text-foreground">База Знаний</h1>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {articles?.length || 0} статей
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative group">
                        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-primary transition-colors" />
                        <input
                            type="text"
                            placeholder="Поиск статей..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-9 pr-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-52 transition-all"
                        />
                    </div>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-secondary hover:bg-secondary/80 border border-border rounded-lg text-sm font-medium transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        <span className="hidden sm:inline">Создать</span>
                    </button>
                    <button
                        onClick={() => setShowGenerate(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-500/10 to-fuchsia-500/10 hover:from-purple-500/20 hover:to-fuchsia-500/20 border border-purple-500/20 rounded-lg text-sm font-medium text-purple-300 transition-all"
                    >
                        <Sparkles className="w-4 h-4" />
                        <span className="hidden sm:inline">AI Генерация</span>
                    </button>
                </div>
            </div>

            {/* Articles list */}
            <div className="space-y-3">
                <AnimatePresence initial={false}>
                    {filteredArticles.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="h-64 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-border rounded-xl"
                        >
                            <BookOpen className="w-12 h-12 mb-4 opacity-30" />
                            <p className="font-medium text-lg">
                                {searchQuery ? 'Ничего не найдено' : 'База знаний пуста'}
                            </p>
                            <p className="text-sm mt-1">
                                {searchQuery
                                    ? 'Попробуйте изменить поисковый запрос'
                                    : 'Создайте статью вручную или сгенерируйте с помощью AI'}
                            </p>
                        </motion.div>
                    ) : (
                        filteredArticles.map(article => {
                            const isExpanded = expandedId === article.id;
                            const isEditing = editingId === article.id;

                            return (
                                <motion.div
                                    key={article.id}
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className="bg-card border border-border rounded-xl overflow-hidden shadow-sm"
                                >
                                    {/* Article header */}
                                    <div
                                        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-secondary/30 transition-colors"
                                        onClick={() => {
                                            if (!isEditing) setExpandedId(isExpanded ? null : article.id);
                                        }}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                                                <FileText className="w-4 h-4 text-amber-400" />
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="font-semibold text-foreground truncate">{article.title}</h3>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {new Date(article.created_at).toLocaleDateString('ru-RU', {
                                                        day: '2-digit',
                                                        month: 'long',
                                                        year: 'numeric',
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    startEdit(article);
                                                    setExpandedId(article.id);
                                                }}
                                                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                                                title="Редактировать"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    if (confirm('Удалить статью?')) deleteMutation.mutate(article.id);
                                                }}
                                                className="p-2 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                                title="Удалить"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                            {isExpanded ? (
                                                <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                            )}
                                        </div>
                                    </div>

                                    {/* Expanded content */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="px-5 pb-5 border-t border-border/50">
                                                    {isEditing ? (
                                                        <div className="space-y-3 pt-4">
                                                            <input
                                                                type="text"
                                                                value={editTitle}
                                                                onChange={e => setEditTitle(e.target.value)}
                                                                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                                                placeholder="Заголовок"
                                                            />
                                                            <textarea
                                                                value={editContent}
                                                                onChange={e => setEditContent(e.target.value)}
                                                                rows={12}
                                                                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono resize-y"
                                                                placeholder="Содержание (Markdown)"
                                                            />
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    onClick={() =>
                                                                        updateMutation.mutate({
                                                                            id: article.id,
                                                                            title: editTitle,
                                                                            content: editContent,
                                                                        })
                                                                    }
                                                                    disabled={updateMutation.isPending}
                                                                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 transition-colors hover:bg-primary/90"
                                                                >
                                                                    {updateMutation.isPending ? (
                                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                                    ) : (
                                                                        <Save className="w-4 h-4" />
                                                                    )}
                                                                    Сохранить
                                                                </button>
                                                                <button
                                                                    onClick={() => setEditingId(null)}
                                                                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-secondary hover:bg-secondary/80 border border-border rounded-lg text-sm font-medium transition-colors"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                    Отмена
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="pt-4 prose prose-sm prose-invert max-w-none text-foreground/90 leading-relaxed whitespace-pre-wrap">
                                                            {article.content}
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })
                    )}
                </AnimatePresence>
            </div>

            {/* AI Generate Modal */}
            <AnimatePresence>
                {showGenerate && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => !generateMutation.isPending && setShowGenerate(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            onClick={e => e.stopPropagation()}
                            className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
                        >
                            <div className="px-6 py-5 border-b border-border flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-fuchsia-500/10 border border-purple-500/20 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-purple-400" />
                                </div>
                                <div>
                                    <h3 className="font-rajdhani font-bold text-lg">AI Генератор FAQ</h3>
                                    <p className="text-xs text-muted-foreground">ИИ проанализирует закрытые тикеты и напишет статью</p>
                                </div>
                            </div>
                            <div className="px-6 py-5 space-y-4">
                                <div>
                                    <label className="text-sm font-medium text-foreground block mb-1.5">Тема / Ключевое слово</label>
                                    <input
                                        type="text"
                                        value={genTopic}
                                        onChange={e => setGenTopic(e.target.value)}
                                        placeholder="Например: оплата, донат, привилегии..."
                                        className="w-full px-3 py-2.5 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-foreground block mb-1.5">Кол-во тикетов для анализа</label>
                                    <input
                                        type="number"
                                        value={genLimit}
                                        onChange={e => setGenLimit(Number(e.target.value))}
                                        min={1}
                                        max={50}
                                        className="w-24 px-3 py-2.5 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                                {generateMutation.isError && (
                                    <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                                        {(generateMutation.error as any)?.response?.data?.error || 'Ошибка генерации'}
                                    </div>
                                )}
                            </div>
                            <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
                                <button
                                    onClick={() => setShowGenerate(false)}
                                    disabled={generateMutation.isPending}
                                    className="px-4 py-2 bg-secondary hover:bg-secondary/80 border border-border rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                >
                                    Отмена
                                </button>
                                <button
                                    onClick={() => generateMutation.mutate({ topic: genTopic, limit: genLimit })}
                                    disabled={!genTopic.trim() || generateMutation.isPending}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-all shadow-lg shadow-purple-500/20"
                                >
                                    {generateMutation.isPending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            AI анализирует...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-4 h-4" />
                                            Сгенерировать
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Manual Create Modal */}
            <AnimatePresence>
                {showCreate && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => !createMutation.isPending && setShowCreate(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            onClick={e => e.stopPropagation()}
                            className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
                        >
                            <div className="px-6 py-5 border-b border-border flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 border border-emerald-500/20 flex items-center justify-center">
                                    <Plus className="w-5 h-5 text-emerald-400" />
                                </div>
                                <div>
                                    <h3 className="font-rajdhani font-bold text-lg">Новая статья</h3>
                                    <p className="text-xs text-muted-foreground">Создайте статью для базы знаний вручную</p>
                                </div>
                            </div>
                            <div className="px-6 py-5 space-y-4">
                                <div>
                                    <label className="text-sm font-medium text-foreground block mb-1.5">Заголовок</label>
                                    <input
                                        type="text"
                                        value={createTitle}
                                        onChange={e => setCreateTitle(e.target.value)}
                                        placeholder="Как оплатить привилегию?"
                                        className="w-full px-3 py-2.5 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-foreground block mb-1.5">Содержание (Markdown)</label>
                                    <textarea
                                        value={createContent}
                                        onChange={e => setCreateContent(e.target.value)}
                                        rows={10}
                                        placeholder="Подробный ответ или инструкция..."
                                        className="w-full px-3 py-2.5 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono resize-y"
                                    />
                                </div>
                            </div>
                            <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
                                <button
                                    onClick={() => setShowCreate(false)}
                                    disabled={createMutation.isPending}
                                    className="px-4 py-2 bg-secondary hover:bg-secondary/80 border border-border rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                >
                                    Отмена
                                </button>
                                <button
                                    onClick={() => createMutation.mutate({ title: createTitle, content: createContent })}
                                    disabled={!createTitle.trim() || !createContent.trim() || createMutation.isPending}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                                >
                                    {createMutation.isPending ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Save className="w-4 h-4" />
                                    )}
                                    Создать
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
