import React, { useState, useEffect } from 'react';
import { ScriptInput } from './components/ScriptInput';
import { Player } from './components/Player';
import { ApiKeyModal } from './components/ApiKeyModal';
import { SceneScript, GeneratedScene, GeneratorState, TransitionType } from './types';
import { generateImage, generateSpeech, generatePreciseTimings } from './services/geminiService';
import { exportVideo } from './utils/videoExporter';
import { generateWordTimings } from './utils/subtitleSync';
import { Zap, Share2, Server, Key, Settings } from 'lucide-react';

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
  
  // API Key State
  const [apiKey, setApiKey] = useState<string>('');
  const [showKeyModal, setShowKeyModal] = useState(false);

  useEffect(() => {
    // Check local storage on load
    const storedKey = localStorage.getItem('gemini_api_key');
    // If no stored key and no env key (in typical client usage), prompt user
    const envKey = process.env.API_KEY; 
    
    if (storedKey) {
      setApiKey(storedKey);
    } else if (!envKey) {
      // Small delay to allow hydration
      setTimeout(() => setShowKeyModal(true), 1000);
    }
  }, []);

  // --- Headless Automation Hook ---
  useEffect(() => {
    // Expose a global function for Puppeteer/Server to call
    (window as any).startHeadlessJob = async (config: { script: SceneScript[], voice: string, showSubtitles: boolean, apiKey?: string }) => {
      try {
        console.log("Headless Job Started", config);
        
        // If the server passes an API key (e.g., from its env), use it.
        // Otherwise, handleGenerate will try to fall back to the App's state or localStorage/Env
        const effectiveKey = config.apiKey || apiKey;

        // 1. Generate Assets
        const generatedScenes = await handleGenerate(config.script, config.voice || 'Kore', config.showSubtitles, effectiveKey);
        
        // 2. Export Video
        await handleExport(generatedScenes, config.showSubtitles, true);
        
        return { status: 'success' };
      } catch (e: any) {
        console.error("Headless Job Error", e);
        (window as any).JOB_ERROR = e.message;
        return { status: 'error', message: e.message };
      }
    };
  }, [apiKey]); // Depend on apiKey to ensure latest state is available if needed

  // Auto-generation logic for URL params
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
        
        // Wait for key to load effectively, or use what we have
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

  const handleGenerate = async (script: SceneScript[], voice: string, enableSubtitles: boolean, overrideKey?: string): Promise<GeneratedScene[]> => {
    // Use override key (from headless), or state key
    const currentKey = overrideKey || apiKey;
    
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
        
        // Step 1: Generate Visuals and Audio
        // Pass the key to the services
        const [imageUrl, audioBuffer] = await Promise.all([
          generateImage(visualPrompt, currentKey),
          generateSpeech(script[i].voiceOverText, voice, audioCtx, currentKey)
        ]);

        // Step 2: Generate Subtitle Timings
        let wordTimings;
        try {
          console.log("Attempting precise audio alignment...");
          wordTimings = await generatePreciseTimings(audioBuffer, script[i].voiceOverText, currentKey);
        } catch (e) {
          console.warn("Precise alignment failed, falling back to heuristics.", e);
          wordTimings = generateWordTimings(script[i].voiceOverText, audioBuffer.duration);
        }

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
      return processedScenes;
      
    } catch (error: any) {
      console.error("Workflow failed", error);
      setAppState(GeneratorState.IDLE);
      
      // If unauthorized, prompt for key
      if (error.message && (error.message.includes('API key') || error.message.includes('401') || error.message.includes('403'))) {
         setShowKeyModal(true);
         alert("API Key missing or invalid. Please check your settings.");
      } else {
         alert("Generation failed: " + error.message);
      }
      throw error;
    }
  };

  const handleRestart = () => {
     // Player handles logic
  };

  const handleExport = async (scenesToExport: GeneratedScene[] = scenes, subtitlesEnabled: boolean = showSubtitles, isHeadless: boolean = false) => {
    if (scenesToExport.length === 0) return;
    setIsExporting(true);
    
    try {
      const blob = await exportVideo(scenesToExport, subtitlesEnabled, (progress) => {
        console.log(`Export progress: ${progress.toFixed(0)}%`);
      });
      
      if (isHeadless) {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
           (window as any).RENDERED_VIDEO_DATA = reader.result; 
        };
      } else {
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
      <ApiKeyModal 
        isOpen={showKeyModal} 
        onClose={() => setShowKeyModal(false)}
        onSave={(key) => setApiKey(key)}
      />

      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center px-6 md:px-12 bg-zinc-950 sticky top-0 z-50">
        <div className="flex items-center gap-2 text-red-600">
          <Zap size={28} fill="currentColor" />
          <h1 className="text-xl font-bold tracking-tighter text-white">ShortsGen <span className="text-zinc-500 font-normal">AI</span></h1>
        </div>
        <div className="ml-auto flex items-center gap-4">
           
           {/* API Key Button */}
           <button
             onClick={() => setShowKeyModal(true)}
             className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-mono transition-colors
               ${apiKey ? 'border-zinc-800 bg-zinc-900 text-green-500 hover:bg-zinc-800' : 'border-red-900/50 bg-red-900/10 text-red-400 hover:bg-red-900/20'}
             `}
             title="Manage API Key"
           >
             <Key size={12} />
             <span>{apiKey ? 'API Key Set' : 'Set API Key'}</span>
           </button>

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