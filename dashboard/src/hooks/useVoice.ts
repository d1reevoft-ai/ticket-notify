import { useState, useCallback, useRef, useEffect } from 'react';

// Extend window object for speech recognition
declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

interface UseVoiceReturn {
    isListening: boolean;
    isSpeaking: boolean;
    transcript: string;
    interimTranscript: string;
    startListening: () => void;
    stopListening: () => void;
    speak: (text: string) => void;
    stopSpeaking: () => void;
    supportAvailable: boolean;
}

export function useVoice(onSpeechEnd?: (finalTranscript: string) => void): UseVoiceReturn {
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [interimTranscript, setInterimTranscript] = useState('');
    
    const recognitionRef = useRef<any>(null);
    const [supportAvailable, setSupportAvailable] = useState(true);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setSupportAvailable(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'ru-RU'; // Default to Russian since your bot is in Russian

        recognition.onstart = () => {
            setIsListening(true);
            setTranscript('');
            setInterimTranscript('');
        };

        recognition.onresult = (event: any) => {
            let currentTranscript = '';
            let currentInterim = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    currentTranscript += event.results[i][0].transcript;
                } else {
                    currentInterim += event.results[i][0].transcript;
                }
            }

            if (currentTranscript) setTranscript(prev => prev + currentTranscript);
            setInterimTranscript(currentInterim);
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error', event.error);
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.abort();
            }
            window.speechSynthesis.cancel();
        };
    }, []);

    // Effect to detect when listening stops and we have a final transcript
    useEffect(() => {
        if (!isListening && transcript && onSpeechEnd) {
            onSpeechEnd(transcript);
            setTranscript(''); // Clear after sending
        }
    }, [isListening, transcript, onSpeechEnd]);

    const startListening = useCallback(() => {
        if (recognitionRef.current) {
            try {
                // Cancel any ongoing speech
                window.speechSynthesis.cancel();
                setIsSpeaking(false);
                
                recognitionRef.current.start();
            } catch (e) {
                console.error(e);
            }
        }
    }, []);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
    }, []);

    const speak = useCallback((text: string) => {
        if (!window.speechSynthesis) return;

        // Cancel previous speech
        window.speechSynthesis.cancel();

        // Strip some markdown or raw text blocks that sound weird when spoken
        const cleanText = text
            .replace(/```[\s\S]*?```/g, ' Код скрыт ')
            .replace(/[*_~`]/g, '')
            .substring(0, 300); // Limit to 300 chars so it doesn't ramble forever

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'ru-RU';
        utterance.rate = 1.05;
        utterance.pitch = 1.0;

        // Look for premium Russian voices (Google/Microsoft usually provide better ones)
        const voices = window.speechSynthesis.getVoices();
        const ruVoices = voices.filter(v => v.lang.includes('ru'));
        // Prefer a Microsoft or Google voice if available over the default choppy one
        const preferredVoice = ruVoices.find(v => v.name.includes('Microsoft') || v.name.includes('Google')) || ruVoices[0];
        
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        window.speechSynthesis.speak(utterance);
    }, []);

    const stopSpeaking = useCallback(() => {
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
        }
    }, []);

    // Pre-load voices (Chrome requires this quirk sometimes)
    useEffect(() => {
        if (window.speechSynthesis) {
            window.speechSynthesis.getVoices();
        }
    }, []);

    return {
        isListening,
        isSpeaking,
        transcript,
        interimTranscript,
        startListening,
        stopListening,
        speak,
        stopSpeaking,
        supportAvailable
    };
}
