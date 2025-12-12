import React, { useState, useEffect } from 'react';
import { ScriptInput } from './components/ScriptInput';
import { Player } from './components/Player';
import { SceneScript, GeneratedScene, GeneratorState, TransitionType } from './types';
import { generateImage, generateSpeech } from './services/geminiService';
import { exportVideo } from './utils/videoExporter';
import { generateWordTimings } from './utils/subtitleSync';
import { Zap, Share2, Server } from 'lucide-react';

// --- Unicode Safe Base64 Helpers ---
function utf8_to_b64(str: string) {
  return window.btoa(unescape(encodeURIComponent(str)));
}

function b64_to_utf8(str: string) {
  return decodeURIComponent(escape(window.atob(str)));
}

export default function App() {
  const [scenes, setScenes] = useState<GeneratedScene[]>([]);
  const [appState, setAppState] = useState<GeneratorState>(GeneratorState.IDLE);
  const [isExporting, setIsExporting] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);

  // --- Headless Automation Hook ---
  useEffect(() => {
    // Expose a global function for Puppeteer/Server to call
    (window as any).startHeadlessJob = async (config: { script: SceneScript[], voice: string, showSubtitles: boolean }) => {
      try {
        console.log("Headless Job Started", config);
        // 1. Generate Assets
        const generatedScenes = await handleGenerate(config.script, config.voice || 'Kore', config.showSubtitles);
        
        // 2. Export Video
        // We pass the scenes directly to ensure we use the latest data
        await handleExport(generatedScenes, config.showSubtitles, true);
        
        return { status: 'success' };
      } catch (e: any) {
        console.error("Headless Job Error", e);
        // Report error to window for Puppeteer to pick up
        (window as any).JOB_ERROR = e.message;
        return { status: 'error', message: e.message };
      }
    };
  }, []);

  // Auto-generation logic for URL params (Legacy/Client-side usage)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const scriptBase64 = params.get('script');
    const autoPlay = params.get('autoplay') === 'true';

    if (scriptBase64 && appState === GeneratorState.IDLE) {
      try {
        let jsonString = "";
        try {
          jsonString = b64_to_utf8(scriptBase64);
        } catch (e) {
          jsonString = atob(scriptBase64);
        }

        const script = JSON.parse(jsonString) as SceneScript[];
        window.history.replaceState({}, '', window.location.pathname);
        
        handleGenerate(script, 'Kore', true).then(() => {
          if (autoPlay) {
            console.log("Auto-generation complete.");
          }
        });
      } catch (e) {
        console.error("Failed to parse script from URL", e);
      }
    }
  }, []);

  // Modified to return the scenes for the headless chain
  const handleGenerate = async (script: SceneScript[], voice: string, enableSubtitles: boolean): Promise<GeneratedScene[]> => {
    setAppState(GeneratorState.PROCESSING);
    setShowSubtitles(enableSubtitles);
    
    const transitions: TransitionType[] = ['zoom', 'slide', 'fade'];

    const initialScenes: GeneratedScene[] = script.map((s, index) => ({
      script: s,
      imageUrl: '',
      audioBuffer: null,
      status: 'pending',
      transition: transitions[index % transitions.length]
    }));
    setScenes(initialScenes);

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const processedScenes = [...initialScenes];

    try {
      for (let i = 0; i < script.length; i++) {
        processedScenes[i] = { ...processedScenes[i], status: 'generating' };
        setScenes([...processedScenes]);

        const visualPrompt = `Vertical video, 9:16 aspect ratio. ${script[i].imagePrompt}`;
        
        const [imageUrl, audioBuffer] = await Promise.all([
          generateImage(visualPrompt),
          generateSpeech(script[i].voiceOverText, voice, audioCtx)
        ]);

        const wordTimings = generateWordTimings(script[i].voiceOverText, audioBuffer.duration);

        processedScenes[i] = {
          ...processedScenes[i],
          imageUrl,
          audioBuffer,
          wordTimings,
          status: 'completed'
        };
        setScenes([...processedScenes]);
      }
      setAppState(GeneratorState.READY);
      return processedScenes; // Return for automation
      
    } catch (error) {
      console.error("Workflow failed", error);
      setAppState(GeneratorState.IDLE);
      alert("Generation failed. Please check your API Key and try again.");
      throw error;
    }
  };

  const handleRestart = () => {
     // Player handles logic
  };

  // Modified handleExport to support Headless return
  const handleExport = async (scenesToExport: GeneratedScene[] = scenes, subtitlesEnabled: boolean = showSubtitles, isHeadless: boolean = false) => {
    if (scenesToExport.length === 0) return;
    setIsExporting(true);
    
    try {
      const blob = await exportVideo(scenesToExport, subtitlesEnabled, (progress) => {
        console.log(`Export progress: ${progress.toFixed(0)}%`);
      });
      
      if (isHeadless) {
        // --- Headless Mode: Convert to Base64 and assign to window ---
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
           // This global variable is what Puppeteer waits for
           (window as any).RENDERED_VIDEO_DATA = reader.result; 
        };
      } else {
        // --- Normal Mode: Download ---
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `shortsgen-export-${Date.now()}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

    } catch (e) {
      console.error("Export failed", e);
      if (!isHeadless) alert("Failed to export video. Please try again.");
      throw e;
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyApiUrl = () => {
    const exampleScript = scenes.length > 0 
      ? scenes.map(s => s.script) 
      : JSON.parse((document.querySelector('textarea')?.value || "[]"));

    const base64 = utf8_to_b64(JSON.stringify(exampleScript));
    const url = `${window.location.origin}${window.location.pathname}?autoplay=true&script=${base64}`;
    
    navigator.clipboard.writeText(url).then(() => {
      alert("API URL copied!");
    });
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center px-6 md:px-12 bg-zinc-950 sticky top-0 z-50">
        <div className="flex items-center gap-2 text-red-600">
          <Zap size={28} fill="currentColor" />
          <h1 className="text-xl font-bold tracking-tighter text-white">ShortsGen <span className="text-zinc-500 font-normal">AI</span></h1>
        </div>
        <div className="ml-auto flex items-center gap-4">
           {/* Visual indicator for Server Mode usage */}
           <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 text-xs">
              <Server size={12} />
              <span>API Ready</span>
           </div>

           <button 
             onClick={handleCopyApiUrl}
             className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5 px-3 rounded-md flex items-center gap-2 transition-colors font-mono"
           >
             <Share2 size={14} />
             Copy Link
           </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col md:flex-row overflow-hidden">
        
        {/* Left Panel: Input */}
        <div className="w-full md:w-1/2 p-4 md:p-8 flex flex-col h-[50vh] md:h-auto border-b md:border-b-0 md:border-r border-zinc-800">
           <div className="max-w-2xl w-full mx-auto h-full">
              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-2">Create Viral Shorts</h2>
                <p className="text-zinc-400">
                  Select a voice, paste your script JSON, and generate instantly.
                </p>
              </div>
              <div className="h-[calc(100%-120px)]">
                <ScriptInput 
                  onGenerate={(s, v, sub) => handleGenerate(s, v, sub)} 
                  disabled={appState === GeneratorState.PROCESSING} 
                />
              </div>
           </div>
        </div>

        {/* Right Panel: Preview */}
        <div className="w-full md:w-1/2 bg-zinc-950 relative">
           <Player 
              scenes={scenes} 
              state={appState} 
              onRestart={handleRestart}
              onExport={() => handleExport(scenes, showSubtitles, false)}
              isExporting={isExporting}
              showSubtitles={showSubtitles}
           />
        </div>

      </main>
    </div>
  );
}