import { motion } from 'framer-motion';

interface FunAiButtonProps {
    insightCount: number;
    onClick: () => void;
    isOpen: boolean;
}

export default function FunAiButton({ insightCount, onClick, isOpen }: FunAiButtonProps) {
    if (isOpen) return null;

    return (
        <motion.button
            className="funai-button"
            onClick={onClick}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.92 }}
            title="Открыть FunAI"
        >
            <span className="funai-button__icon">🧠</span>
            {insightCount > 0 && (
                <motion.span
                    className="funai-badge"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                    {insightCount > 9 ? '9+' : insightCount}
                </motion.span>
            )}
            {insightCount > 0 && (
                <span className="funai-button__pulse" />
            )}
        </motion.button>
    );
}
