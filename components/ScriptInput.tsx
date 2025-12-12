import React, { useState } from 'react';
import { SceneScript } from '../types';
import { AlertCircle, Play, FileJson, Mic, Type } from 'lucide-react';

interface ScriptInputProps {
  onGenerate: (script: SceneScript[], voice: string, showSubtitles: boolean) => void;
  disabled: boolean;
}

const DEFAULT_SCRIPT = `[
  {
    "voiceOverText": "Is 5G really dangerous, or just misunderstood? 5G isn’t just faster Wi-Fi—it’s a new way to move data that could reshape everything from healthcare to smart cities. Think of it like a wider highway: more lanes mean more cars can flow at once, so your video calls and downloads get smoother and quicker.",
    "imagePrompt": "Vertical aspect ratio, 9:16. A detailed, photo realistic illustration of a modern highway with multiple lanes, showing cars flowing smoothly through an urban landscape under a bright blue sky, with stylized 5G network towers and signal waves in the background."
  },
  {
    "voiceOverText": "The real magic happens with millimeter waves—high-frequency signals that carry huge amounts of data but don’t travel far and get blocked by walls and trees. 5G networks use many small cells to fill in the gaps, so you get blazing speeds without dead zones. That’s why cities are installing more antennas than ever.",
    "imagePrompt": "Vertical aspect ratio, 9:16. A detailed, photo realistic depiction of a city street with small cell antennas mounted on lampposts and rooftops, showing beams of millimeter waves spreading between antennas and a smartphone, with city buildings and trees in the background."
  },
  {
    "voiceOverText": "Because these waves are so short, they’re absorbed by skin and objects instead of penetrating deeply, which actually helps keep exposure low. 5G isn’t a health hazard—it’s a clever engineering trick to squeeze more data into the air we share.",
    "imagePrompt": "Vertical aspect ratio, 9:16. A detailed, photo realistic close-up of a smartphone screen showing a 5G signal, with a person holding it outdoors, and stylized wave patterns being absorbed by the device and the user's hand, set against a natural park background."
  },
  {
    "voiceOverText": "Here’s a fun fact: 5G can cut latency to just one millisecond. That’s fast enough to make remote surgery and real-time AR feel instant. So the next time you’re streaming in crystal clarity, remember: it’s not magic—it’s physics.",
    "imagePrompt": "Vertical aspect ratio, 9:16. A detailed, photo realistic scene of a surgeon using a remote robotic arm in a high-tech operating room, with holographic displays showing a 5G signal indicator and a low-latency timer reading 1 ms, under bright surgical lights."
  }
]`;

const VOICES = ['Kore', 'Puck', 'Fenrir', 'Charon', 'Zephyr'];

export const ScriptInput: React.FC<ScriptInputProps> = ({ onGenerate, disabled }) => {
  const [jsonText, setJsonText] = useState(DEFAULT_SCRIPT);
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = () => {
    setError(null);
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        throw new Error("Input must be a JSON array.");
      }
      
      const isValid = parsed.every(item => 
        typeof item === 'object' && 
        item !== null &&
        typeof item.voiceOverText === 'string' &&
        typeof item.imagePrompt === 'string'
      );

      if (!isValid) {
        throw new Error("Each item must have 'voiceOverText' and 'imagePrompt' strings.");
      }

      onGenerate(parsed as SceneScript[], selectedVoice, showSubtitles);
    } catch (e: any) {
      setError(e.message || "Invalid JSON format");
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-xl overflow-hidden shadow-2xl border border-zinc-800">
      
      {/* Settings Header */}
      <div className="bg-zinc-950 p-4 border-b border-zinc-800 flex flex-col gap-4">
        <div className="flex items-center justify-between">
           <div className="flex items-center gap-2 text-red-500">
              <FileJson size={20} />
              <h2 className="font-bold tracking-tight text-white">Script & Settings</h2>
           </div>
        </div>

        <div className="flex flex-col gap-3">
          {/* Voice Selector */}
          <div className="flex items-center gap-3 bg-zinc-900 p-2 rounded-lg border border-zinc-800">
            <div className="flex items-center gap-2 text-zinc-400 px-2 min-w-[70px]">
              <Mic size={16} />
              <span className="text-xs font-bold uppercase tracking-wider">Voice</span>
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
               {VOICES.map(voice => (
                 <button
                   key={voice}
                   onClick={() => setSelectedVoice(voice)}
                   disabled={disabled}
                   className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap
                     ${selectedVoice === voice 
                       ? 'bg-red-600 text-white shadow-lg shadow-red-900/20' 
                       : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                     }
                   `}
                 >
                   {voice}
                 </button>
               ))}
            </div>
          </div>

          {/* Subtitle Toggle */}
          <div className="flex items-center justify-between bg-zinc-900 p-2 rounded-lg border border-zinc-800 px-4">
             <div className="flex items-center gap-2 text-zinc-400">
                <Type size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Subtitles</span>
             </div>
             <button
               onClick={() => setShowSubtitles(!showSubtitles)}
               disabled={disabled}
               className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                 showSubtitles ? 'bg-red-600' : 'bg-zinc-700'
               }`}
             >
               <span
                 className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                   showSubtitles ? 'translate-x-6' : 'translate-x-1'
                 }`}
               />
             </button>
          </div>
        </div>
      </div>
      
      <div className="relative flex-grow">
        <textarea
          className="w-full h-full bg-zinc-900 p-4 text-sm font-mono text-zinc-300 resize-none focus:outline-none focus:ring-2 focus:ring-red-500/20"
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          spellCheck={false}
          disabled={disabled}
        />
      </div>

      {error && (
        <div className="bg-red-900/20 p-3 flex items-center gap-2 text-red-400 text-sm border-t border-red-900/50">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="p-4 bg-zinc-950 border-t border-zinc-800">
        <button
          onClick={handleGenerate}
          disabled={disabled}
          className={`w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-bold transition-all
            ${disabled 
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
              : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/20 active:scale-[0.98]'
            }`}
        >
          {disabled ? (
            <span>Processing...</span>
          ) : (
            <>
              <Play size={18} fill="currentColor" />
              <span>Generate Short</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};