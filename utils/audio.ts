/**
 * Decodes a base64 string into a Uint8Array of bytes.
 */
function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes raw PCM data into an AudioBuffer.
 * Gemini TTS typically returns 24kHz mono PCM.
 */
export async function decodeAudioData(
  base64Data: string,
  ctx: AudioContext,
  sampleRate: number = 24000
): Promise<AudioBuffer> {
  const bytes = decodeBase64(base64Data);
  const dataInt16 = new Int16Array(bytes.buffer);
  
  // Create a buffer: 1 channel (mono), length matches sample count, at specified sample rate
  const buffer = ctx.createBuffer(1, dataInt16.length, sampleRate);
  const channelData = buffer.getChannelData(0);

  // Convert Int16 PCM to Float32 [-1.0, 1.0]
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }

  return buffer;
}