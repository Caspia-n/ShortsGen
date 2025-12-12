import { WordTiming } from "../types";

/**
 * Generates word timings based on text length and punctuation heuristics.
 * This simulates natural speech patterns where punctuation introduces pauses.
 */
export function generateWordTimings(text: string, duration: number): WordTiming[] {
  const words = text.trim().split(/\s+/);
  const timings: WordTiming[] = [];
  
  // 1. Calculate weights
  // Longer words take longer to say.
  // Punctuation adds significant "pause weight" to the word preceding it.
  const weights = words.map(word => {
    let weight = word.length;
    const isNumber = /\d/.test(word);
    
    // Numbers usually take longer to say than their char count (e.g. "5" = "five" (4), "100" = "one hundred" (11))
    if (isNumber) weight += 2; 

    // Punctuation Pauses
    if (word.endsWith('.') || word.endsWith('!') || word.endsWith('?')) {
      weight += 6; // Strong pause (~300-400ms relative)
    } else if (word.endsWith(',') || word.endsWith(':') || word.endsWith(';')) {
      weight += 3; // Medium pause (~150-200ms relative)
    }
    
    return Math.max(1, weight);
  });

  // 2. Distribute duration
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const durationPerWeight = duration / totalWeight;

  let currentTime = 0;
  words.forEach((word, i) => {
    const wordDuration = weights[i] * durationPerWeight;
    
    // We adjust the visual "end" of the word to not necessarily include the full pause 
    // for better visual snapping, but for simplicity, contiguous blocks work best for karaoke.
    timings.push({
      word,
      startTime: currentTime,
      endTime: currentTime + wordDuration
    });
    
    currentTime += wordDuration;
  });

  return timings;
}