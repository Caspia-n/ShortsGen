import React, { useState, useEffect } from 'react';
import { Key, Check, X } from 'lucide-react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSave }) => {
  const [keyInput, setKeyInput] = useState('');

  useEffect(() => {
    if (isOpen) {
      setKeyInput(localStorage.getItem('gemini_api_key') || '');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (keyInput.trim()) {
      localStorage.setItem('gemini_api_key', keyInput.trim());
      onSave(keyInput.trim());
      onClose();
    }
  };

  const handleClear = () => {
    localStorage.removeItem('gemini_api_key');
    setKeyInput('');
    onSave('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-zinc-950 p-6 border-b border-zinc-800 flex items-center gap-3">
          <div className="p-2 bg-red-500/10 rounded-lg text-red-500">
            <Key size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">API Key Required</h2>
            <p className="text-sm text-zinc-400">Enter your Google Gemini API Key</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-zinc-300 leading-relaxed">
            To generate AI videos, this app needs a Gemini API key. The key is stored locally in your browser and is never sent to our servers.
          </p>
          
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">API Key</label>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full bg-black border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors font-mono text-sm"
            />
          </div>

          <div className="pt-2">
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noreferrer"
              className="text-xs text-red-400 hover:text-red-300 underline"
            >
              Get a free API key from Google AI Studio
            </a>
          </div>
        </div>

        <div className="p-4 bg-zinc-950 border-t border-zinc-800 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          {keyInput && (
             <button
             onClick={handleClear}
             className="px-4 py-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-900/20 transition-colors text-sm font-medium"
           >
             Clear Key
           </button>
          )}
          <button
            onClick={handleSave}
            disabled={!keyInput.trim()}
            className="px-6 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Check size={16} />
            Save Key
          </button>
        </div>
      </div>
    </div>
  );
};