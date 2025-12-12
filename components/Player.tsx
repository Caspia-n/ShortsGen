import React, { useEffect, useRef, useState } from 'react';
import { GeneratedScene, GeneratorState, WordTiming } from '../types';
import { Play, Pause, Loader2, RefreshCw, Download } from 'lucide-react';

interface PlayerProps {
  scenes: GeneratedScene[];
  state: GeneratorState;
  onRestart: () => void;
  onExport: () => void;
  isExporting: boolean;
  showSubtitles: boolean;
}

/**
 * Subtitles Component
 * Handles the "Karaoke" style flowing text effect.
 * Uses calculated word timings for better synchronization.
 */
const Subtitles: React.FC<{
  timings: WordTiming[];
  isPlaying: boolean;
}> = ({ timings, isPlaying }) => {
  const [elapsed, setElapsed] = useState(0);
  const requestRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    // Reset or continue?
    // In this simple implementation, we assume mounting means start from 0
    startTimeRef.current = performance.now();
    
    const animate = () => {
      const now = performance.now();
      const time = (now - startTimeRef.current) / 1000; // seconds
      
      setElapsed(time);

      if (time < (timings[timings.length - 1]?.endTime || 0) + 1) {
        requestRef.current = requestAnimationFrame(animate);
      }
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(requestRef.current);
  }, [isPlaying, timings]);

  // Determine active word index based on time
  const activeIndex = timings.findIndex(t => elapsed >= t.startTime && elapsed < t.endTime);
  const passedIndex = timings.findIndex(t => elapsed < t.startTime) - 1;
  // If passedIndex is -2 (none found < startTime), it implies we are past the end, so all are passed
  const effectivePassedLimit = passedIndex === -2 ? timings.length : passedIndex;

  return (
    <div className="absolute bottom-0 left-0 right-0 p-8 pb-20 pt-12 bg-gradient-to-t from-black/90 via-black/60 to-transparent text-center z-10 pointer-events-none">
      <div className="inline-block px-4 py-2">
        <p className="text-xl md:text-2xl font-bold leading-relaxed drop-shadow-lg tracking-wide">
          {timings.map((t, i) => {
            const isActive = i === activeIndex;
            // It is past if it's before the active one, or if we are done with all
            const isPast = (activeIndex !== -1 && i < activeIndex) || (activeIndex === -1 && elapsed > t.endTime);
            
            return (
              <span 
                key={i}
                className={`inline-block mr-1.5 transition-all duration-100 ${
                  isActive 
                    ? 'text-yellow-400 scale-110' 
                    : isPast 
                      ? 'text-white/90' 
                      : 'text-white/50'
                }`}
                style={{
                  textShadow: isActive ? '0 0 10px rgba(250, 204, 21, 0.5)' : 'none'
                }}
              >
                {t.word}
              </span>
            );
          })}
        </p>
      </div>
    </div>
  );
};

export const Player: React.FC<PlayerProps> = ({ scenes, state, onRestart, onExport, isExporting, showSubtitles }) => {
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Refs for audio context and source management
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const timerRef = useRef<number | null>(null);

  // Initialize AudioContext lazily
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  const stopPlayback = () => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
      currentSourceRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPlaying(false);
  };

  const playScene = (index: number) => {
    if (index >= scenes.length) {
      setIsPlaying(false);
      setCurrentSceneIndex(0); // Reset to beginning for UI
      return;
    }

    const scene = scenes[index];
    if (!scene.audioBuffer) return;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Stop any previous
    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
    }

    const source = ctx.createBufferSource();
    source.buffer = scene.audioBuffer;
    source.connect(ctx.destination);
    
    // Play audio
    source.start(0);
    currentSourceRef.current = source;
    
    setCurrentSceneIndex(index);
    setIsPlaying(true);

    // Schedule next scene
    const durationMs = scene.audioBuffer.duration * 1000;
    
    // Add a tiny buffer to ensure audio finishes before switch
    timerRef.current = window.setTimeout(() => {
      playScene(index + 1);
    }, durationMs + 100); 
  };

  const togglePlay = () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      // If we are at the end (or idle), start from 0, else continue from current
      // Ideally we would resume, but for simplicity we restart the current scene
      playScene(currentSceneIndex);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPlayback();
  }, []);

  const completedCount = scenes.filter(s => s.status === 'completed').length;
  const progress = scenes.length > 0 ? (completedCount / scenes.length) * 100 : 0;
  
  // Transition Styles
  const getTransitionClass = (type: string) => {
    switch(type) {
      case 'slide': return 'animate-[slideIn_0.5s_ease-out_forwards]';
      case 'zoom': return 'animate-[zoomIn_10s_linear_forwards] scale-110';
      case 'fade': default: return 'animate-[fadeIn_1s_ease-out_forwards]';
    }
  };

  // Define custom keyframes in style tag for this component
  const styles = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes zoomIn {
      from { transform: scale(1); }
      to { transform: scale(1.15); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;

  return (
    <div className="h-full flex flex-col items-center justify-center p-4 bg-zinc-950/50">
      <style>{styles}</style>
      
      {/* Phone Frame */}
      <div className="relative w-[360px] h-[640px] bg-black rounded-[2.5rem] border-[8px] border-zinc-800 shadow-2xl overflow-hidden flex flex-col">
        
        {/* Status Bar */}
        <div className="absolute top-0 left-0 right-0 h-8 z-20 flex justify-between px-6 items-end pb-1 text-[10px] font-bold text-white/80">
          <span>9:41</span>
          <div className="flex gap-1">
             <div className="w-3 h-3 bg-white/80 rounded-sm"></div>
             <div className="w-3 h-3 bg-white/80 rounded-sm"></div>
          </div>
        </div>

        {/* Content Area */}
        <div className="relative flex-grow bg-zinc-900 flex items-center justify-center overflow-hidden">
          {state === GeneratorState.PROCESSING && (
            <div className="flex flex-col items-center gap-4 text-zinc-400 p-8 text-center z-10">
              <Loader2 className="animate-spin text-red-500" size={48} />
              <div>
                <p className="text-white font-semibold text-lg mb-1">Generating Scene {completedCount + 1}/{scenes.length}</p>
                <p className="text-sm">Creating visuals with Nano Banana & Audio with Gemini TTS...</p>
              </div>
              <div className="w-full bg-zinc-800 h-2 rounded-full mt-4 overflow-hidden">
                <div 
                  className="bg-red-600 h-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {(state === GeneratorState.READY || state === GeneratorState.PLAYING) && scenes.length > 0 && (
             <>
                {/* Image Layer with Transitions */}
                <div className="absolute inset-0 bg-black">
                  {scenes[currentSceneIndex]?.imageUrl ? (
                    // We key by index to force re-render and re-trigger animation on scene change
                    <img 
                      key={`img-${currentSceneIndex}`}
                      src={scenes[currentSceneIndex].imageUrl} 
                      alt="Generated Scene" 
                      className={`w-full h-full object-cover ${getTransitionClass(scenes[currentSceneIndex].transition)}`}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-600">
                      No Image Available
                    </div>
                  )}
                </div>

                {/* Dynamic Flowing Subtitles */}
                {showSubtitles && scenes[currentSceneIndex]?.wordTimings && (
                   <Subtitles 
                     key={`sub-${currentSceneIndex}`} // Reset for new scene
                     timings={scenes[currentSceneIndex].wordTimings!}
                     isPlaying={isPlaying}
                   />
                )}
             </>
          )}

          {state === GeneratorState.IDLE && (
            <div className="text-zinc-600 text-center p-8">
              <p className="mb-2 text-zinc-500">Preview Area</p>
              <p className="text-sm">Enter script and generate to watch video.</p>
            </div>
          )}
          
          {/* Export Overlay */}
          {isExporting && (
             <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                <Loader2 className="animate-spin text-red-500 mb-4" size={48} />
                <p className="font-bold text-lg">Rendering Video...</p>
                <p className="text-sm text-zinc-400 mt-1">This happens in real-time. Please wait.</p>
             </div>
          )}
        </div>

        {/* Controls */}
        {(state === GeneratorState.READY || state === GeneratorState.PLAYING) && !isExporting && (
          <div className="absolute bottom-0 left-0 right-0 p-6 z-30 flex justify-center gap-6 pointer-events-auto">
             <button 
                onClick={togglePlay}
                className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-black hover:scale-105 active:scale-95 transition-transform shadow-lg z-40"
             >
                {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
             </button>
             
             <button 
                onClick={() => { stopPlayback(); onRestart(); }}
                className="w-14 h-14 bg-zinc-800/80 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-zinc-700 hover:scale-105 active:scale-95 transition-all z-40"
                title="Restart"
             >
                <RefreshCw size={20} />
             </button>

             <button 
                onClick={() => { stopPlayback(); onExport(); }}
                className="w-14 h-14 bg-red-600/90 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-red-500 hover:scale-105 active:scale-95 transition-all z-40"
                title="Download Video"
             >
                <Download size={20} />
             </button>
          </div>
        )}
      </div>

      <div className="mt-6 text-zinc-500 text-xs font-mono">
        {state === GeneratorState.PLAYING 
          ? `Playing Scene ${currentSceneIndex + 1} of ${scenes.length}`
          : state === GeneratorState.READY 
            ? "Ready to Play" 
            : "ShortsGen v1.0"}
      </div>
    </div>
  );
};