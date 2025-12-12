import { GoogleGenAI, Modality } from "@google/genai";
import { decodeAudioData, audioBufferToWavBase64 } from "../utils/audio";
import { WordTiming } from "../types";

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

/**
 * Uses Gemini 2.5 Flash to align audio with text and extract precise word timestamps.
 * This is "Pass 2" of the generation process to ensure actual syncing.
 */
export async function generatePreciseTimings(audioBuffer: AudioBuffer, transcript: string): Promise<WordTiming[]> {
  try {
    // 1. Convert AudioBuffer to WAV Base64 so the model can hear it
    const wavBase64 = await audioBufferToWavBase64(audioBuffer);

    // 2. Call Gemini Flash (Multimodal)
    // We ask it to analyze the audio and match it to the known text.
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