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

/**
 * Writes a string to a DataView.
 */
function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Converts an AudioBuffer to a WAV Blob.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // Write WAV Header
  writeString(view, pos, 'RIFF'); pos += 4;
  view.setUint32(pos, length - 8, true); pos += 4;
  writeString(view, pos, 'WAVE'); pos += 4;
  writeString(view, pos, 'fmt '); pos += 4;
  view.setUint32(pos, 16, true); pos += 4; // Subchunk1Size
  view.setUint16(pos, 1, true); pos += 2; // AudioFormat (1 = PCM)
  view.setUint16(pos, numOfChan, true); pos += 2;
  view.setUint32(pos, buffer.sampleRate, true); pos += 4;
  view.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4; // ByteRate
  view.setUint16(pos, numOfChan * 2, true); pos += 2; // BlockAlign
  view.setUint16(pos, 16, true); pos += 2; // BitsPerSample
  writeString(view, pos, 'data'); pos += 4;
  view.setUint32(pos, length - pos - 4, true); pos += 4;

  // Interleave channels
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // Clamp
      // Convert Float32 to Int16
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Converts AudioBuffer to Base64 WAV string for API usage.
 */
export async function audioBufferToWavBase64(buffer: AudioBuffer): Promise<string> {
  const blob = audioBufferToWav(buffer);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Remove "data:audio/wav;base64," prefix
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}