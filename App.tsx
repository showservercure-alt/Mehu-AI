
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Theme, Message, ScienceMetric } from './types';
import { APP_TITLE, OWNER_NAME, SYSTEM_INSTRUCTION, VOICE_NAME } from './constants';
import { decode, decodeAudioData, createBlob } from './services/audio-utils';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

// Helper components defined outside to avoid re-renders
const ThemeToggle: React.FC<{ theme: Theme; onToggle: () => void }> = ({ theme, onToggle }) => (
  <button
    onClick={onToggle}
    className="p-3 rounded-xl glass-morphism hover:scale-105 active:scale-95 transition-all duration-300"
    aria-label="Toggle Theme"
  >
    {theme === Theme.LIGHT ? (
      <svg className="w-6 h-6 text-amber-500 fill-amber-500" viewBox="0 0 24 24">
        <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 000-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06a.996.996 0 000-1.41zM7.05 18.36a.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06a.996.996 0 000-1.41z" />
      </svg>
    ) : (
      <svg className="w-6 h-6 text-indigo-400 fill-indigo-400" viewBox="0 0 24 24">
        <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" />
      </svg>
    )}
  </button>
);

const App: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(() => {
    // Check local storage or system preference
    const saved = localStorage.getItem('mehu-theme');
    if (saved === 'light' || saved === 'dark') return saved as Theme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? Theme.DARK : Theme.LIGHT;
  });
  
  const [isLive, setIsLive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [scienceData, setScienceData] = useState<ScienceMetric[]>([]);
  const [mehuStatus, setMehuStatus] = useState<'idle' | 'listening' | 'speaking'>('idle');

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Sync theme with document and persist
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === Theme.DARK);
    localStorage.setItem('mehu-theme', theme);
  }, [theme]);

  // Handle messages scroll
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Generate fake "science data" for visuals
  useEffect(() => {
    const interval = setInterval(() => {
      setScienceData(prev => {
        const newData = [...prev, { name: Date.now().toString(), value: 40 + Math.random() * 20 }];
        return newData.slice(-20);
      });
    }, 800);
    return () => clearInterval(interval);
  }, []);

  const toggleTheme = () => setTheme(prev => prev === Theme.LIGHT ? Theme.DARK : Theme.LIGHT);

  const startLiveSession = async () => {
    if (isLive) return;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsLive(true);
            setMehuStatus('listening');
            
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setMehuStatus('speaking');
              const ctx = outputAudioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setMehuStatus('idle');
              });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setMehuStatus('idle');
            }

            if (message.serverContent?.inputTranscription) {
               addMessage('user', message.serverContent.inputTranscription.text);
            }
            if (message.serverContent?.outputTranscription) {
               addMessage('mehu', message.serverContent.outputTranscription.text);
            }
          },
          onclose: () => setIsLive(false),
          onerror: () => setIsLive(false),
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (error) {
      console.error("Live session failed:", error);
      setIsLive(false);
    }
  };

  const stopLiveSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsLive(false);
    setMehuStatus('idle');
  };

  const addMessage = (role: 'user' | 'mehu', text: string) => {
    setMessages(prev => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.role === role && text.includes(lastMsg.text)) {
        return [...prev.slice(0, -1), { ...lastMsg, text, timestamp: new Date() }];
      }
      return [...prev, { id: Math.random().toString(), role, text, timestamp: new Date() }];
    });
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const userMsg = inputText;
    setInputText('');
    addMessage('user', userMsg);

    if (isLive && sessionRef.current) {
      sessionRef.current.send({ parts: [{ text: userMsg }] });
    } else {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: userMsg,
          config: { systemInstruction: SYSTEM_INSTRUCTION }
        });
        addMessage('mehu', response.text || '...');
      } catch (err) {
        addMessage('mehu', 'I had a little brain freeze. Can you say that again, bestie?');
      }
    }
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 glass-morphism sticky top-0 z-50">
        <div className="flex flex-col">
          <h1 className="text-[10px] font-bold opacity-40 tracking-widest font-masumu uppercase">BEST FRIEND OF</h1>
          <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-pink-500 to-cyan-500 bg-clip-text text-transparent font-masumu leading-tight">
            {OWNER_NAME}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex gap-1">
             <span className="px-2 py-1 rounded-md text-[10px] bg-white/40 dark:bg-slate-800 font-black shadow-sm border border-black/5 dark:border-white/5 uppercase">EN</span>
             <span className="px-2 py-1 rounded-md text-[10px] bg-pink-500 text-white font-black shadow-sm uppercase">BN</span>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <div className="px-3 py-1 rounded-full text-[10px] font-black bg-pink-500 text-white uppercase shadow-lg shadow-pink-500/20">
            {APP_TITLE}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:flex-row p-4 gap-4 overflow-hidden relative">
        
        {/* Decorative background effects */}
        <div className="absolute top-1/2 left-1/4 w-[40vw] h-[40vw] bg-pink-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />

        {/* Assistant Visualization */}
        <div className="flex-1 flex flex-col items-center justify-center space-y-8 relative z-10 py-8">
          <div className={`relative w-48 h-48 md:w-72 md:h-72 rounded-full flex items-center justify-center transition-all duration-1000 animate-float
            ${mehuStatus === 'idle' ? 'glow-cyan' : mehuStatus === 'listening' ? 'glow-pink scale-105' : 'glow-cyan scale-110'}
          `}>
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-pink-400 to-cyan-400 opacity-20 blur-2xl animate-pulse" />
            <div className="relative w-full h-full rounded-full border border-white/40 dark:border-white/10 glass-morphism flex items-center justify-center overflow-hidden shadow-2xl">
              <div className={`w-[85%] h-[85%] rounded-full bg-gradient-to-br from-pink-100 via-white to-cyan-100 dark:from-pink-900/40 dark:via-slate-900 dark:to-cyan-900/40 shadow-inner flex items-center justify-center transition-transform duration-500 
                ${mehuStatus !== 'idle' ? 'scale-110 rotate-12' : 'scale-100'}
              `}>
                <span className="text-5xl md:text-7xl drop-shadow-2xl grayscale-[0.2]">🌸</span>
              </div>
            </div>
            {/* Thinking / Talking rings */}
            <div className={`absolute -inset-4 border-2 border-dashed border-cyan-500/30 rounded-full animate-[spin_20s_linear_infinite] ${mehuStatus === 'speaking' ? 'opacity-100' : 'opacity-0 scale-95 transition-all duration-1000'}`} />
            <div className={`absolute -inset-8 border border-pink-500/20 rounded-full animate-[spin_30s_linear_infinite_reverse] ${mehuStatus === 'listening' ? 'opacity-100' : 'opacity-0 scale-95 transition-all duration-1000'}`} />
          </div>

          <div className="text-center">
            <h2 className="text-4xl font-black tracking-tight mb-2 drop-shadow-sm">Mehu Assistant</h2>
            <div className="flex items-center justify-center gap-2">
               <span className={`w-2 h-2 rounded-full ${mehuStatus === 'idle' ? 'bg-slate-300' : mehuStatus === 'listening' ? 'bg-pink-500 animate-ping' : 'bg-cyan-500 animate-pulse'}`} />
               <p className="text-xs font-black text-pink-500 dark:text-pink-400 uppercase tracking-[0.3em]">
                 {mehuStatus === 'idle' ? 'Online & Ready' : mehuStatus === 'listening' ? 'Hearing you...' : 'Processing...'}
               </p>
            </div>
          </div>

          {/* Science Metrics Chart */}
          <div className="w-full max-w-sm h-16 opacity-40 px-6">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={scienceData}>
                <Line type="step" dataKey="value" stroke={theme === Theme.LIGHT ? '#ec4899' : '#06b6d4'} strokeWidth={2} dot={false} isAnimationActive={false} />
                <YAxis hide domain={[0, 100]} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[9px] text-center uppercase tracking-[0.4em] font-bold opacity-50 mt-4">Synced: Multilingual Context</p>
          </div>
        </div>

        {/* Chat Sidebar */}
        <div className="w-full md:w-[420px] flex flex-col glass-morphism rounded-[2.5rem] overflow-hidden shadow-2xl relative z-20 border border-black/5 dark:border-white/5">
          <div className="px-6 py-5 border-b border-black/5 dark:border-white/5 flex items-center justify-between bg-white/20 dark:bg-black/10">
            <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Logs
            </h3>
            <button 
              onClick={() => setMessages([])}
              className="text-[10px] hover:text-pink-600 transition-colors uppercase font-black opacity-40 hover:opacity-100"
            >
              Flush Memory
            </button>
          </div>

          <div 
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth bg-transparent"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center opacity-30 select-none">
                <div className="w-12 h-12 rounded-2xl border-2 border-dashed border-current flex items-center justify-center mb-4">
                  <span className="text-xl">💬</span>
                </div>
                <p className="text-xs font-black uppercase tracking-widest">Start a new thread</p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-3xl px-5 py-3 shadow-md ${
                  msg.role === 'user' 
                    ? 'bg-gradient-to-br from-pink-500 to-pink-600 text-white rounded-tr-sm' 
                    : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-tl-sm border border-black/5 dark:border-white/5'
                }`}>
                  <p className="text-sm leading-relaxed font-medium">{msg.text}</p>
                  <span className="text-[9px] font-black uppercase tracking-tighter opacity-40 mt-2 block text-right">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Input Area */}
          <div className="p-6 bg-white/30 dark:bg-black/20 border-t border-black/5 dark:border-white/5 space-y-4">
            <form onSubmit={handleSendText} className="relative flex items-center gap-3">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type here..."
                className="flex-1 bg-white/60 dark:bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 transition-all placeholder:text-slate-400 font-medium"
              />
              <button
                type="submit"
                className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white p-4 rounded-2xl shadow-xl hover:scale-105 active:scale-95 flex items-center justify-center transition-all"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>

            <button
              onClick={isLive ? stopLiveSession : startLiveSession}
              className={`w-full flex items-center justify-center gap-3 py-5 rounded-3xl font-black uppercase tracking-widest text-xs transition-all duration-500 shadow-2xl
                ${isLive 
                  ? 'bg-red-500 text-white shadow-red-500/20' 
                  : 'bg-gradient-to-r from-pink-500 to-cyan-500 text-white hover:brightness-110 active:scale-[0.98]'
                }
              `}
            >
              {isLive ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-white animate-ping" />
                  Terminate Session
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4z" />
                    <path d="M5.5 13a3.5 3.5 0 017 0v1h1.5a.5.5 0 010 1h-11a.5.5 0 010-1H5.5v-1z" />
                  </svg>
                  Connect Voice
                </>
              )}
            </button>
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="px-6 py-3 text-[9px] text-center opacity-30 font-black uppercase tracking-[0.4em] border-t border-black/5 dark:border-white/5 bg-white/10 dark:bg-black/5">
        Mehu AI • Experimental Scientific Friend • {OWNER_NAME}'s Digital Companion
      </footer>
    </div>
  );
};

export default App;
