export interface SceneScript {
  voiceOverText: string;
  imagePrompt: string;
}

export type TransitionType = 'fade' | 'slide' | 'zoom' | 'none';

export interface WordTiming {
  word: string;
  startTime: number;
  endTime: number;
}

export interface GeneratedScene {
  script: SceneScript;
  imageUrl: string;
  audioBuffer: AudioBuffer | null;
  status: 'pending' | 'generating' | 'completed' | 'error';
  transition: TransitionType;
  wordTimings?: WordTiming[];
  error?: string;
}

export enum GeneratorState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  PLAYING = 'PLAYING'
}

// Define BufferSource explicitly to avoid Node.js Buffer confusion
type WebBufferSource = ArrayBuffer | ArrayBufferView;

declare global {
  var Mp4Muxer: {
    Muxer: new (options: any) => any;
    FileSystemWritableFileStreamTarget: new (stream: any) => any;
    ArrayBufferTarget: new () => any;
  };

  // WebCodecs Type Definitions
  // We keep Audio definitions here as they weren't reported as duplicates (possibly missing in some environments),
  // but we remove Video definitions which are causing "Duplicate identifier" errors.
  
  class AudioData {
    constructor(init: AudioDataInit);
    readonly format: string;
    readonly sampleRate: number;
    readonly numberOfFrames: number;
    readonly numberOfChannels: number;
    readonly duration: number;
    readonly timestamp: number;
    close(): void;
    clone(): AudioData;
    allocationSize(options: AudioDataCopyToOptions): number;
    copyTo(destination: WebBufferSource, options: AudioDataCopyToOptions): void;
  }

  interface AudioDataInit {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: WebBufferSource;
    transfer?: Transferable[];
  }

  interface AudioDataCopyToOptions {
    planeIndex: number;
    frameOffset?: number;
    frameCount?: number;
  }

  class AudioEncoder {
    constructor(init: AudioEncoderInit);
    readonly state: string;
    readonly encodeQueueSize: number;
    configure(config: AudioEncoderConfig): void;
    encode(data: AudioData): void;
    flush(): Promise<void>;
    reset(): void;
    close(): void;
  }

  interface AudioEncoderInit {
    output: (chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata) => void;
    error: (error: DOMException) => void;
  }

  interface AudioEncoderConfig {
    codec: string;
    sampleRate?: number;
    numberOfChannels?: number;
    bitrate?: number;
  }

  interface EncodedAudioChunk {
    readonly type: 'key' | 'delta';
    readonly timestamp: number;
    readonly duration: number;
    readonly byteLength: number;
    copyTo(destination: WebBufferSource): void;
  }

  interface EncodedAudioChunkMetadata {
    decoderConfig?: {
      codec: string;
      sampleRate: number;
      numberOfChannels: number;
      description?: WebBufferSource;
    };
  }
}