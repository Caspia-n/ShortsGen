import { GeneratedScene, TransitionType, WordTiming } from "../types";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const FPS = 30;

/**
 * Helper: Resample audio to 48kHz for WebCodecs compatibility.
 * Many browsers only support 44.1kHz or 48kHz in AudioEncoder.
 */
async function resampleTo48k(audioBuffer: AudioBuffer): Promise<AudioBuffer> {
  if (audioBuffer.sampleRate === 48000) return audioBuffer;
  
  // Create offline context at target rate
  const offlineCtx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    Math.ceil(audioBuffer.duration * 48000),
    48000
  );
  
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  
  return await offlineCtx.startRendering();
}

/**
 * Helper: Interleave planar audio data (LLLLRRRR) to interleaved (LRLRLRLR)
 * WebCodecs AudioEncoder often expects interleaved or specific planar formats.
 * Gemini TTS is Mono, so we just copy it.
 */
function createAudioDataFromBuffer(audioBuffer: AudioBuffer, timestampUs: number): AudioData {
  const channelData = audioBuffer.getChannelData(0); // Mono
  
  return new AudioData({
    format: 'f32-planar',
    sampleRate: audioBuffer.sampleRate,
    numberOfFrames: audioBuffer.length,
    numberOfChannels: 1,
    timestamp: timestampUs, // Microseconds
    data: channelData
  });
}

function drawSubtitle(
  ctx: CanvasRenderingContext2D, 
  timings: WordTiming[],
  currentTime: number 
) {
  if (!timings || timings.length === 0) return;
  
  // Font Config
  ctx.font = "bold 48px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const lineHeight = 70;
  const maxWidth = CANVAS_WIDTH - 150;
  const bottomPosition = CANVAS_HEIGHT - 250; // Fixed baseline for the bottom-most line
  
  // 1. Break all text into lines first
  let lines: WordTiming[][] = [];
  let currentLine: WordTiming[] = [];
  let currentLineWidth = 0;

  timings.forEach((t) => {
    const wordWidth = ctx.measureText(t.word + " ").width;
    if (currentLineWidth + wordWidth > maxWidth) {
      lines.push(currentLine);
      currentLine = [];
      currentLineWidth = 0;
    }
    currentLine.push(t);
    currentLineWidth += wordWidth;
  });
  if (currentLine.length > 0) lines.push(currentLine);

  // 2. Identify the active line based on currentTime
  let activeLineIndex = 0;
  
  // Check if we are currently playing a word
  const activeWord = timings.find(t => currentTime >= t.startTime && currentTime < t.endTime);
  if (activeWord) {
     activeLineIndex = lines.findIndex(line => line.includes(activeWord));
  } else {
     // If in a silence gap, stick to the line of the last spoken word
     const pastWords = timings.filter(t => t.endTime <= currentTime);
     if (pastWords.length > 0) {
        const lastWord = pastWords[pastWords.length - 1];
        activeLineIndex = lines.findIndex(line => line.includes(lastWord));
     }
  }
  
  if (activeLineIndex === -1) activeLineIndex = 0;

  // 3. Pagination Logic: Show blocks of 2 lines
  // Page 0: Lines 0,1; Page 1: Lines 2,3; etc.
  const pageIndex = Math.floor(activeLineIndex / 2);
  const startLineIndex = pageIndex * 2;
  const visibleLines = lines.slice(startLineIndex, startLineIndex + 2);

  // 4. Draw Background for the text area
  // Calculate height based on actual visible lines (could be 1 or 2)
  const blockHeight = (visibleLines.length * lineHeight) + 20; 
  const bgBottom = bottomPosition + 20; 
  const bgTop = bgBottom - blockHeight - 20; // Extra padding

  const grad = ctx.createLinearGradient(0, bgTop, 0, bgBottom);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.2, "rgba(0,0,0,0.6)");
  grad.addColorStop(0.8, "rgba(0,0,0,0.8)");
  grad.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, bgTop, CANVAS_WIDTH, blockHeight + 60);

  // 5. Render Visible Lines
  visibleLines.forEach((line, index) => {
    let y = bottomPosition;
    if (visibleLines.length === 2 && index === 0) {
        y = bottomPosition - lineHeight;
    }

    const wordsInfo = line.map(w => ({ ...w, width: ctx.measureText(w.word + " ").width }));
    const totalLineWidth = wordsInfo.reduce((sum, w) => sum + w.width, 0);
    let startX = (CANVAS_WIDTH - totalLineWidth) / 2;

    wordsInfo.forEach((w) => {
      const isActive = (currentTime >= w.startTime && currentTime < w.endTime);
      const isPast = (currentTime >= w.endTime);

      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      if (isActive) {
        ctx.fillStyle = "#FACC15"; // Yellow for active
        ctx.font = "bold 52px Inter, sans-serif";
      } else if (isPast) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)"; // White for spoken
        ctx.font = "bold 48px Inter, sans-serif";
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)"; // Dim for upcoming
        ctx.font = "bold 48px Inter, sans-serif";
      }

      ctx.fillText(w.word, startX + (w.width / 2), y);
      startX += w.width;
    });
  });
}

function drawImage(
  ctx: CanvasRenderingContext2D, 
  img: HTMLImageElement, 
  transition: TransitionType, 
  progress: number
) {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  let scale = 1;
  let opacity = 1;
  let translateX = 0;

  const imgRatio = img.width / img.height;
  const canvasRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
  let renderW, renderH, renderX, renderY;

  if (imgRatio > canvasRatio) {
    renderH = CANVAS_HEIGHT;
    renderW = img.width * (CANVAS_HEIGHT / img.height);
    renderX = (CANVAS_WIDTH - renderW) / 2;
    renderY = 0;
  } else {
    renderW = CANVAS_WIDTH;
    renderH = img.height * (CANVAS_WIDTH / img.width);
    renderX = 0;
    renderY = (CANVAS_HEIGHT - renderH) / 2;
  }

  const easedProgress = Math.min(progress * 2, 1);
  if (transition === 'zoom') scale = 1 + (progress * 0.15);
  else if (transition === 'slide') {
    const t = 1 - Math.pow(1 - easedProgress, 3);
    translateX = (1 - t) * CANVAS_WIDTH;
  } else if (transition === 'fade') opacity = easedProgress;

  ctx.globalAlpha = opacity;
  ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  ctx.scale(scale, scale);
  ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
  ctx.translate(translateX, 0);
  ctx.drawImage(img, renderX, renderY, renderW, renderH);
  ctx.restore();
}

/**
 * Fast export using WebCodecs + Mp4Muxer.
 * Renders significantly faster than real-time.
 */
export async function exportVideo(
  scenes: GeneratedScene[], 
  showSubtitles: boolean,
  onProgress: (percent: number) => void
): Promise<Blob> {
  // Check support
  if (typeof window.VideoEncoder === 'undefined') {
    throw new Error("Your browser does not support WebCodecs (VideoEncoder). Please use Chrome, Edge, or Firefox.");
  }

  // 1. Setup Canvas
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error("No Canvas Context");

  // 2. Setup Muxer with 48kHz audio
  let muxer = new window.Mp4Muxer.Muxer({
    target: new window.Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT
    },
    audio: {
      codec: 'aac',
      sampleRate: 48000, 
      numberOfChannels: 1
    },
    fastStart: 'in-memory'
  });

  // 3. Setup Encoders
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("VideoEncoder error", e)
  });
  
  // Use Level 4.2 (0x2a) or higher to support 1080x1920
  videoEncoder.configure({
    codec: 'avc1.4d002a', // Main Profile, Level 4.2
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    bitrate: 5_000_000, // 5 Mbps
    framerate: FPS
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => console.error("AudioEncoder error", e)
  });
  
  // Use 48kHz which is standard for WebCodecs implementations
  audioEncoder.configure({
    codec: 'mp4a.40.2', // AAC LC
    sampleRate: 48000,
    numberOfChannels: 1,
    bitrate: 128000
  });

  // 4. Load Images
  const images: HTMLImageElement[] = await Promise.all(
    scenes.map(s => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.crossOrigin = "anonymous";
      img.src = s.imageUrl;
    }))
  );

  // 5. Render Loop
  let globalTimestamp = 0; // Microseconds
  let totalDurationSec = 0;
  
  // Calculate total duration roughly first for progress bar (assuming 24k source)
  scenes.forEach(s => {
    if(s.audioBuffer) totalDurationSec += s.audioBuffer.duration;
  });

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const img = images[i];
    let audioBuffer = scene.audioBuffer;
    
    if (!audioBuffer) continue;

    // Resample to 48kHz for encoding
    try {
        audioBuffer = await resampleTo48k(audioBuffer);
    } catch (e) {
        console.error("Resampling failed", e);
        // Fallback to original if offline context fails, though encoder might error
    }

    const durationSec = audioBuffer.duration;
    const frames = Math.ceil(durationSec * FPS);
    const durationUs = durationSec * 1_000_000;

    // A. Encode Audio for this scene
    const audioData = createAudioDataFromBuffer(audioBuffer, globalTimestamp);
    audioEncoder.encode(audioData);
    audioData.close();

    // B. Render Video Frames
    for (let f = 0; f < frames; f++) {
      const progress = f / frames;
      const sceneTime = progress * durationSec;
      
      // Draw
      drawImage(ctx, img, scene.transition, progress);
      if (showSubtitles && scene.wordTimings) {
        drawSubtitle(ctx, scene.wordTimings, sceneTime);
      }

      // Create Frame
      // Timestamp must be in microseconds
      const frameTimestamp = globalTimestamp + (f * (1_000_000 / FPS));
      
      const videoFrame = new VideoFrame(canvas, {
        timestamp: frameTimestamp,
        duration: 1_000_000 / FPS
      });

      videoEncoder.encode(videoFrame, { keyFrame: f % 60 === 0 });
      videoFrame.close();

      // UI Progress
      const overallProgress = (globalTimestamp + (sceneTime * 1_000_000)) / (totalDurationSec * 1_000_000);
      onProgress(overallProgress * 100);
      
      // Allow UI to breathe slightly
      if (f % 15 === 0) await new Promise(r => setTimeout(r, 0));
    }

    globalTimestamp += durationUs;
  }

  // 6. Flush
  await videoEncoder.flush();
  await audioEncoder.flush();
  muxer.finalize();

  const { buffer } = muxer.target;
  return new Blob([buffer], { type: 'video/mp4' });
}