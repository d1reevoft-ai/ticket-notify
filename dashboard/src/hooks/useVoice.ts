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
    const audioRef = useRef<HTMLAudioElement | null>(null);
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
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.src = '';
            }
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
                if (audioRef.current) {
                    audioRef.current.pause();
                }
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

    const speak = useCallback(async (text: string) => {
        // Cancel previous speech
        if (audioRef.current) {
            audioRef.current.pause();
        }

        const cleanText = text
            .replace(/```[\s\S]*?```/g, ' Код скрыт ')
            .replace(/[*_~`]/g, '')
            .substring(0, 500);

        if (!cleanText.trim()) return;

        setIsSpeaking(true);

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/tts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ text: cleanText })
            });

            if (!res.ok) throw new Error('TTS fetch failed');

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            
            const audio = new Audio(url);
            audioRef.current = audio;

            audio.onended = () => {
                setIsSpeaking(false);
                URL.revokeObjectURL(url);
            };
            audio.onerror = () => {
                setIsSpeaking(false);
                URL.revokeObjectURL(url);
            };

            await audio.play();
        } catch (e) {
            console.error('Edge TTS error:', e);
            setIsSpeaking(false);
        }
    }, []);

    const stopSpeaking = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            setIsSpeaking(false);
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
