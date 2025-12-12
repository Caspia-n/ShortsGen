import { GoogleGenAI, Modality } from "@google/genai";
import { decodeAudioData, audioBufferToWavBase64 } from "../utils/audio";
import { WordTiming } from "../types";

// Helper to get the client with the most current key
function getClient(providedKey?: string): GoogleGenAI {
  // 1. Provided key (from UI state)
  // 2. LocalStorage (persistence)
  // 3. Environment variable (server/build time)
  const key = providedKey || localStorage.getItem('gemini_api_key') || process.env.API_KEY;
  
  if (!key) {
    throw new Error("API Key is missing. Please set it in the settings.");
  }
  
  return new GoogleGenAI({ apiKey: key });
}

/**
 * Generates an image using the Nano Banana (Gemini Flash Image) model.
 */
export async function generateImage(prompt: string, apiKey?: string): Promise<string> {
  try {
    const ai = getClient(apiKey);
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        // Nano banana default config
      },
    });

    // Extract image
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No image data found in response");
  } catch (error) {
    console.error("Image generation error:", error);
    throw error;
  }
}

/**
 * Generates speech using the Gemini TTS model.
 */
export async function generateSpeech(text: string, voiceName: string = 'Kore', audioContext: AudioContext, apiKey?: string): Promise<AudioBuffer> {
  try {
    const ai = getClient(apiKey);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }, 
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!base64Audio) {
      throw new Error("No audio data found in response");
    }

    // Decode using our utility
    return await decodeAudioData(base64Audio, audioContext, 24000);

  } catch (error) {
    console.error("TTS generation error:", error);
    throw error;
  }
}

/**
 * Uses Gemini 2.5 Flash to align audio with text and extract precise word timestamps.
 */
export async function generatePreciseTimings(audioBuffer: AudioBuffer, transcript: string, apiKey?: string): Promise<WordTiming[]> {
  try {
    const ai = getClient(apiKey);
    
    // 1. Convert AudioBuffer to WAV Base64 so the model can hear it
    const wavBase64 = await audioBufferToWavBase64(audioBuffer);

    // 2. Call Gemini Flash (Multimodal)
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: wavBase64
            }
          },
          {
            text: `I have an audio file and its transcript. 
            Please analyze the audio to find the exact start and end timestamps for every word in the transcript.
            
            Transcript: "${transcript}"
            
            Return the result strictly as a JSON array of objects with the following schema:
            [
              { "word": "string", "startTime": number (seconds), "endTime": number (seconds) }
            ]
            
            Ensure the word list matches the transcript exactly. Do not include markdown formatting.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json"
      }
    });

    // 3. Parse Result
    const jsonText = response.text || "[]";
    const timings = JSON.parse(jsonText);
    
    if (!Array.isArray(timings)) throw new Error("Result is not an array");
    
    return timings as WordTiming[];

  } catch (error) {
    console.error("Alignment error:", error);
    throw error;
  }
}