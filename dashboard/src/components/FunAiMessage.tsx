import { motion } from 'framer-motion';
import type { ChatMessage } from '../hooks/useFunAi';

interface FunAiMessageProps {
    message: ChatMessage;
    onAction?: (action: { type: string; params: string | null }) => void;
}

export default function FunAiMessage({ message, onAction }: FunAiMessageProps) {
    const isUser = message.role === 'user';

    // Simple markdown-like formatting
    const formatContent = (text: string) => {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code class="funai-inline-code">$1</code>')
            .replace(/\n/g, '<br/>');
    };

    // Extract action buttons from content
    const extractActions = (text: string) => {
        const actionRegex = /\[ACTION:([^\]]+)\]/g;
        const actions: Array<{ type: string; params: string | null; label: string }> = [];
        let match;
        while ((match = actionRegex.exec(text)) !== null) {
            const parts = match[1].split(':');
            const type = parts.slice(0, 2).join(':');
            const params = parts.slice(2).join(':') || null;
            const labels: Record<string, string> = {
                'ticket:list': '📬 Тикеты',
                'ticket:close': '❌ Закрыть',
                'navigate:page': '🔗 Перейти',
                'memory:add': '🧠 Запомнить',
                'stats:summary': '📊 Статистика',
            };
            actions.push({ type, params, label: labels[type] || `⚡ ${type}` });
        }
        return actions;
    };

    const cleanContent = message.content.replace(/\[ACTION:[^\]]+\]/g, '').trim();
    const actions = !isUser ? extractActions(message.content) : [];
    const timeStr = new Date(message.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    return (
        <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={`funai-message ${isUser ? 'funai-message--user' : 'funai-message--ai'}`}
        >
            {!isUser && (
                <div className="funai-message__avatar">
                    <span>🧠</span>
                </div>
            )}
            <div className="funai-message__bubble">
                <div
                    className="funai-message__text"
                    dangerouslySetInnerHTML={{ __html: formatContent(cleanContent) }}
                />
                {actions.length > 0 && (
                    <div className="funai-message__actions">
                        {actions.map((action, i) => (
                            <button
                                key={i}
                                className="funai-action-btn"
                                onClick={() => onAction?.({ type: action.type, params: action.params })}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}
                <div className="funai-message__meta">
                    <span className="funai-message__time">{timeStr}</span>
                    {message.level && !isUser && (
                        <span className={`funai-message__level funai-message__level--${message.level}`}>
                            {message.level === 'l0' ? '💾' : message.level === 'l1' ? '📚' : message.level === 'l2' ? '🤖' : ''}
                        </span>
                    )}
                    {message.durationMs != null && !isUser && (
                        <span className="funai-message__duration">{message.durationMs}ms</span>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
