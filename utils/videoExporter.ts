import { GeneratedScene, TransitionType, WordTiming } from "../types";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const FPS = 30;

/**
 * Helper: Interleave planar audio data (LLLLRRRR) to interleaved (LRLRLRLR)
 * WebCodecs AudioEncoder often expects interleaved or specific planar formats.
 * Gemini TTS is Mono, so we just copy it.
 */
function createAudioDataFromBuffer(audioBuffer: AudioBuffer, timestampUs: number): AudioData {
  const channelData = audioBuffer.getChannelData(0); // Mono
  
  // We need to copy to a Float32Array that AudioData accepts
  // AudioData format 'f32-planar' implies non-interleaved, which for mono is just the data.
  
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
  const activeIndex = timings.findIndex(t => currentTime >= t.startTime && currentTime < t.endTime);
  
  ctx.font = "bold 48px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const lineHeight = 60;
  const maxWidth = CANVAS_WIDTH - 100;
  const bottomMargin = 200;
  
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

  let y = CANVAS_HEIGHT - bottomMargin - ((lines.length - 1) * lineHeight);

  const grad = ctx.createLinearGradient(0, CANVAS_HEIGHT - 400, 0, CANVAS_HEIGHT);
  grad.addColorStop(0, "transparent");
  grad.addColorStop(0.5, "rgba(0,0,0,0.8)");
  grad.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, CANVAS_HEIGHT - 500, CANVAS_WIDTH, 500);

  lines.forEach((line) => {
    const wordsInfo = line.map(w => ({ ...w, width: ctx.measureText(w.word + " ").width }));
    const totalLineWidth = wordsInfo.reduce((sum, w) => sum + w.width, 0);
    let startX = (CANVAS_WIDTH - totalLineWidth) / 2;

    wordsInfo.forEach((w) => {
      let isActive = (currentTime >= w.startTime && currentTime < w.endTime);
      let isPast = (currentTime >= w.endTime);

      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      if (isActive) {
        ctx.fillStyle = "#FACC15"; 
        ctx.font = "bold 52px Inter, sans-serif";
      } else if (isPast) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.font = "bold 48px Inter, sans-serif";
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = "bold 48px Inter, sans-serif";
      }

      ctx.fillText(w.word, startX + (w.width / 2), y);
      startX += w.width;
    });
    y += lineHeight;
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

  // 2. Setup Muxer
  let muxer = new window.Mp4Muxer.Muxer({
    target: new window.Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT
    },
    audio: {
      codec: 'aac',
      sampleRate: 24000, // Gemini TTS rate
      numberOfChannels: 1
    }
  });

  // 3. Setup Encoders
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("VideoEncoder error", e)
  });
  videoEncoder.configure({
    codec: 'avc1.42001f', // H.264 Baseline
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    bitrate: 5_000_000, // 5 Mbps
    framerate: FPS
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => console.error("AudioEncoder error", e)
  });
  audioEncoder.configure({
    codec: 'mp4a.40.2', // AAC LC
    sampleRate: 24000,
    numberOfChannels: 1,
    bitrate: 96000
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
  let totalDurationSec = scenes.reduce((acc, s) => acc + (s.audioBuffer?.duration || 0), 0);
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const img = images[i];
    const audioBuffer = scene.audioBuffer;
    
    if (!audioBuffer) continue;

    const durationSec = audioBuffer.duration;
    const frames = Math.ceil(durationSec * FPS);
    const durationUs = durationSec * 1_000_000;

    // A. Encode Audio for this scene
    // Create AudioData. AudioData usually expects Planar Float32.
    // NOTE: AudioEncoder requires us to be careful with timestamps.
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
      
      // Allow UI to breathe slightly (prevents total freeze on heavy renders)
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