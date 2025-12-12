import { GoogleGenAI, Modality } from "@google/genai";
import { decodeAudioData } from "../utils/audio";

const API_KEY = process.env.API_KEY || '';

// Initialize client
// Note: In a real production app, we should handle the missing API key more gracefully UI-side
const ai = new GoogleGenAI({ apiKey: API_KEY });

/**
 * Generates an image using the Nano Banana (Gemini Flash Image) model.
 */
export async function generateImage(prompt: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        // Nano banana doesn't strictly support aspectRatio config in all envs yet, 
        // but we pass it for best effort if supported or fallback to square/default.
        // We prompt heavily for vertical composition in the text if needed, 
        // but the model defaults are usually square.
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
export async function generateSpeech(text: string, voiceName: string = 'Kore', audioContext: AudioContext): Promise<AudioBuffer> {
  try {
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