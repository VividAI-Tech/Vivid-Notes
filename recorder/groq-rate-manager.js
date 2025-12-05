/**
 * Groq Whisper Rate Limit Manager
 * 
 * Smart strategy for 6-hour daily meetings within free tier limits:
 * - Free Tier: ~7,200 audio seconds/hour (ASH), ~28,800 audio seconds/day (ASD)
 * - 10-second minimum charge per request
 * - 25MB file size limit
 * 
 * Strategy:
 * 1. Usage tracking (hourly/daily limits)
 * 2. Rate-limited queue (spread requests to avoid ASH limit)
 * 3. Automatic limit reset detection
 */

class GroqRateManager {
  constructor() {
    // Groq free tier limits
    this.AUDIO_SECONDS_PER_HOUR = 7200;  // 2 hours of audio per hour
    this.AUDIO_SECONDS_PER_DAY = 28800;  // 8 hours of audio per day
    this.MIN_CHARGE_SECONDS = 10;         // Minimum 10 seconds per request
    this.MAX_FILE_SIZE_MB = 25;
    
    // Safety margins (80% of limits to avoid hitting exact limits)
    this.SAFETY_MARGIN = 0.80;
    
    // Request spacing (minimum ms between requests to spread load)
    this.MIN_REQUEST_SPACING_MS = 2000;
    
    // Usage tracking (persisted to storage)
    this.usageData = {
      audioSecondsThisHour: 0,
      audioSecondsToday: 0,
      hourStartTime: Date.now(),
      dayStartTime: this.getStartOfDay(),
      requestCount: 0,
      lastRequestTime: 0
    };
    
    // Queue for rate-limited requests
    this.requestQueue = [];
    this.isProcessingQueue = false;
    
    // Load persisted usage data
    this.loadUsageData();
  }
  
  getStartOfDay() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  
  async loadUsageData() {
    try {
      const stored = await chrome.storage.local.get(['groq_usage_data']);
      
      if (stored.groq_usage_data) {
        this.usageData = { ...this.usageData, ...stored.groq_usage_data };
        this.resetIfNeeded();
      }
    } catch (e) {
      console.error('Failed to load usage data:', e);
    }
  }
  
  async saveUsageData() {
    try {
      await chrome.storage.local.set({ groq_usage_data: this.usageData });
    } catch (e) {
      console.error('Failed to save usage data:', e);
    }
  }
  
  resetIfNeeded() {
    const now = Date.now();
    
    // Reset hourly counter if hour has passed
    if (now - this.usageData.hourStartTime >= 3600000) {
      this.usageData.audioSecondsThisHour = 0;
      this.usageData.hourStartTime = now;
    }
    
    // Reset daily counter if day has changed
    const startOfToday = this.getStartOfDay();
    if (this.usageData.dayStartTime < startOfToday) {
      this.usageData.audioSecondsToday = 0;
      this.usageData.dayStartTime = startOfToday;
      this.usageData.requestCount = 0;
    }
    
    this.saveUsageData();
  }
  
  /**
   * Get current rate limit status
   */
  getStatus() {
    this.resetIfNeeded();
    
    const hourlyLimit = this.AUDIO_SECONDS_PER_HOUR * this.SAFETY_MARGIN;
    const dailyLimit = this.AUDIO_SECONDS_PER_DAY * this.SAFETY_MARGIN;
    
    return {
      hourlyUsed: this.usageData.audioSecondsThisHour,
      hourlyRemaining: Math.max(0, hourlyLimit - this.usageData.audioSecondsThisHour),
      hourlyLimit: hourlyLimit,
      hourlyPercentUsed: (this.usageData.audioSecondsThisHour / hourlyLimit) * 100,
      
      dailyUsed: this.usageData.audioSecondsToday,
      dailyRemaining: Math.max(0, dailyLimit - this.usageData.audioSecondsToday),
      dailyLimit: dailyLimit,
      dailyPercentUsed: (this.usageData.audioSecondsToday / dailyLimit) * 100,
      
      canProcessNow: this.canProcessNow(),
      queueLength: this.requestQueue.length,
      
      estimatedWaitTime: this.getEstimatedWaitTime(),
      
      // Time until limits reset
      hourResetIn: Math.max(0, 3600000 - (Date.now() - this.usageData.hourStartTime)),
      dayResetIn: Math.max(0, this.getStartOfDay() + 86400000 - Date.now())
    };
  }
  
  /**
   * Check if we can process a request now
   */
  canProcessNow(audioSeconds = 120) {
    this.resetIfNeeded();
    
    const effectiveSeconds = Math.max(audioSeconds, this.MIN_CHARGE_SECONDS);
    const hourlyLimit = this.AUDIO_SECONDS_PER_HOUR * this.SAFETY_MARGIN;
    const dailyLimit = this.AUDIO_SECONDS_PER_DAY * this.SAFETY_MARGIN;
    
    // Check spacing
    const timeSinceLastRequest = Date.now() - this.usageData.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_SPACING_MS) {
      return false;
    }
    
    // Check hourly limit
    if (this.usageData.audioSecondsThisHour + effectiveSeconds > hourlyLimit) {
      return false;
    }
    
    // Check daily limit
    if (this.usageData.audioSecondsToday + effectiveSeconds > dailyLimit) {
      return false;
    }
    
    return true;
  }
  
  getEstimatedWaitTime() {
    if (this.canProcessNow()) return 0;
    
    const hourlyLimit = this.AUDIO_SECONDS_PER_HOUR * this.SAFETY_MARGIN;
    
    // If over hourly limit, wait until next hour
    if (this.usageData.audioSecondsThisHour >= hourlyLimit) {
      return Math.max(0, 3600000 - (Date.now() - this.usageData.hourStartTime));
    }
    
    // If just need spacing
    const timeSinceLastRequest = Date.now() - this.usageData.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_SPACING_MS) {
      return this.MIN_REQUEST_SPACING_MS - timeSinceLastRequest;
    }
    
    return 0;
  }
  
  /**
   * Record usage after a successful transcription
   */
  recordUsage(audioSeconds) {
    const effectiveSeconds = Math.max(audioSeconds, this.MIN_CHARGE_SECONDS);
    
    this.usageData.audioSecondsThisHour += effectiveSeconds;
    this.usageData.audioSecondsToday += effectiveSeconds;
    this.usageData.requestCount++;
    this.usageData.lastRequestTime = Date.now();
    
    this.saveUsageData();
    
    console.log(`[GroqRateManager] Recorded ${effectiveSeconds}s usage. Hourly: ${this.usageData.audioSecondsThisHour}s, Daily: ${this.usageData.audioSecondsToday}s`);
  }
  
  /**
   * Transcribe with compression, chunking, and retry logic
   * Flow: Record → Compress → Chunk (23MB) → Transcribe each → Combine
   */
  async transcribeWithRateLimit(audioBlob, options = {}) {
    const { apiKey, model = 'whisper-large-v3-turbo' } = options;
    
    if (!apiKey) {
      throw new Error('No API key configured for Groq transcription');
    }
    
    const originalSizeMB = audioBlob.size / (1024 * 1024);
    console.log(`[GroqRateManager] Original audio: ${originalSizeMB.toFixed(2)}MB`);
    
    // Reset counters if needed
    this.resetIfNeeded();
    
    // Step 1: Decode and normalize audio to 16kHz mono (optimal for speech)
    console.log('[GroqRateManager] Step 1: Decoding and normalizing audio...');
    let audioBuffer;
    try {
      audioBuffer = await this.decodeAudioToBuffer(audioBlob);
      console.log(`[GroqRateManager] Decoded: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch`);
    } catch (error) {
      console.error('[GroqRateManager] Failed to decode audio:', error);
      throw new Error('Failed to decode audio file');
    }
    
    // Step 2: Split into chunks of ~23MB (WAV at 16kHz mono 16-bit = 32KB/sec)
    // 23MB / 32KB = ~720 seconds per chunk (~12 minutes)
    const CHUNK_SIZE_MB = 23;
    const BYTES_PER_SECOND = 16000 * 2; // 16kHz * 16-bit = 32KB/s
    const MAX_CHUNK_SECONDS = (CHUNK_SIZE_MB * 1024 * 1024 - 44) / BYTES_PER_SECOND; // -44 for WAV header
    
    const totalDuration = audioBuffer.duration;
    const numChunks = Math.ceil(totalDuration / MAX_CHUNK_SECONDS);
    
    console.log(`[GroqRateManager] Step 2: Splitting into ${numChunks} chunks (max ${Math.floor(MAX_CHUNK_SECONDS/60)}min each)`);
    
    // Step 3: Transcribe each chunk
    // First chunk detects language - if non-English, use translation for all chunks
    const allSegments = [];
    let totalTranscribedDuration = 0;
    let detectedLanguage = null;
    let useTranslation = false;
    let wasTranslated = false;
    
    for (let i = 0; i < numChunks; i++) {
      const startTime = i * MAX_CHUNK_SECONDS;
      const endTime = Math.min((i + 1) * MAX_CHUNK_SECONDS, totalDuration);
      const chunkDuration = endTime - startTime;
      
      console.log(`[GroqRateManager] Step 3.${i + 1}: Processing chunk ${i + 1}/${numChunks} (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s)`);
      
      // Extract chunk from audio buffer
      const chunkBuffer = this.extractAudioChunk(audioBuffer, startTime, endTime);
      const chunkWav = this.audioBufferToWav(chunkBuffer);
      
      const chunkSizeMB = chunkWav.size / (1024 * 1024);
      console.log(`[GroqRateManager] Chunk ${i + 1} size: ${chunkSizeMB.toFixed(2)}MB`);
      
      // For first chunk, detect language
      if (i === 0) {
        const firstResult = await this.transcribeChunkWithRetry(chunkWav, apiKey, model, 1, numChunks, false);
        detectedLanguage = firstResult.language || 'en';
        
        // If non-English, re-do with translation endpoint for English output
        if (detectedLanguage !== 'en') {
          console.log(`[GroqRateManager] Detected ${detectedLanguage}, switching to translation endpoint for English output`);
          useTranslation = true;
          wasTranslated = true;
          
          // Re-process first chunk with translation
          const translatedResult = await this.transcribeChunkWithRetry(chunkWav, apiKey, model, 1, numChunks, true);
          
          if (translatedResult.duration) {
            this.recordUsage(translatedResult.duration);
            totalTranscribedDuration += translatedResult.duration;
          }
          
          if (translatedResult.segments) {
            for (const segment of translatedResult.segments) {
              allSegments.push({
                ...segment,
                start: (segment.start || 0) + startTime,
                end: (segment.end || 0) + startTime
              });
            }
          } else if (translatedResult.text) {
            allSegments.push({ text: translatedResult.text, start: startTime, end: endTime });
          }
          
          if (numChunks > 1) await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        
        // English - use transcription result
        if (firstResult.duration) {
          this.recordUsage(firstResult.duration);
          totalTranscribedDuration += firstResult.duration;
        }
        
        if (firstResult.segments) {
          for (const segment of firstResult.segments) {
            allSegments.push({
              ...segment,
              start: (segment.start || 0) + startTime,
              end: (segment.end || 0) + startTime
            });
          }
        } else if (firstResult.text) {
          allSegments.push({ text: firstResult.text, start: startTime, end: endTime });
        }
        
        if (numChunks > 1) await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      
      // Subsequent chunks - use detected mode
      const result = await this.transcribeChunkWithRetry(chunkWav, apiKey, model, i + 1, numChunks, useTranslation);
      
      // Record usage
      if (result.duration) {
        this.recordUsage(result.duration);
        totalTranscribedDuration += result.duration;
      }
      
      // Adjust segment timestamps and add to results
      if (result.segments) {
        for (const segment of result.segments) {
          allSegments.push({
            ...segment,
            start: (segment.start || 0) + startTime,
            end: (segment.end || 0) + startTime
          });
        }
      } else if (result.text) {
        allSegments.push({
          text: result.text,
          start: startTime,
          end: endTime
        });
      }
      
      // Small delay between chunks to be nice to the API
      if (i < numChunks - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    // Combine all text
    const fullText = allSegments.map(s => s.text).join(' ');
    
    console.log(`[GroqRateManager] Transcription complete: ${allSegments.length} segments, ${totalTranscribedDuration.toFixed(1)}s total${wasTranslated ? ' (translated from ' + detectedLanguage + ')' : ''}`);
    
    return {
      text: fullText,
      segments: allSegments,
      duration: totalTranscribedDuration,
      language: wasTranslated ? 'en' : detectedLanguage,
      originalLanguage: detectedLanguage,
      wasTranslated: wasTranslated
    };
  }
  
  /**
   * Decode audio blob to AudioBuffer at 16kHz mono
   */
  async decodeAudioToBuffer(audioBlob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Resample to 16kHz mono
    const offlineContext = new OfflineAudioContext(
      1, // Mono
      Math.ceil(decodedBuffer.duration * 16000),
      16000 // 16kHz
    );
    
    const source = offlineContext.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(offlineContext.destination);
    source.start();
    
    const renderedBuffer = await offlineContext.startRendering();
    audioContext.close();
    
    return renderedBuffer;
  }
  
  /**
   * Extract a time-based chunk from an AudioBuffer
   */
  extractAudioChunk(audioBuffer, startTime, endTime) {
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.min(Math.floor(endTime * sampleRate), audioBuffer.length);
    const length = endSample - startSample;
    
    // Create new buffer for chunk
    const offlineContext = new OfflineAudioContext(1, length, sampleRate);
    const chunkBuffer = offlineContext.createBuffer(1, length, sampleRate);
    
    // Copy samples
    const sourceData = audioBuffer.getChannelData(0);
    const destData = chunkBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      destData[i] = sourceData[startSample + i];
    }
    
    return chunkBuffer;
  }
  
  /**
   * Transcribe a single chunk with retry logic
   * @param {boolean} useTranslation - If true, use translation endpoint instead of transcription
   */
  async transcribeChunkWithRetry(wavBlob, apiKey, model, chunkNum, totalChunks, useTranslation = false) {
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const endpoint = useTranslation ? 'translation' : 'transcription';
        console.log(`[GroqRateManager] Chunk ${chunkNum}/${totalChunks} - ${endpoint} attempt ${attempt}/${maxRetries}`);
        return await this.transcribeOrTranslate(wavBlob, apiKey, model, useTranslation);
      } catch (error) {
        lastError = error;
        console.error(`[GroqRateManager] Chunk ${chunkNum} attempt ${attempt} failed:`, error.message);
        
        // Handle rate limit - wait longer
        if (error.message.includes('429') || error.message.includes('rate limit')) {
          console.log('[GroqRateManager] Rate limited, waiting 60s...');
          this.usageData.audioSecondsThisHour = this.AUDIO_SECONDS_PER_HOUR;
          this.saveUsageData();
          await new Promise(r => setTimeout(r, 60000));
          continue;
        }
        
        // Retry on server errors
        if (error.message.includes('500') || error.message.includes('Internal Server Error') ||
            error.message.includes('502') || error.message.includes('503')) {
          if (attempt < maxRetries) {
            const waitTime = attempt * 5000;
            console.log(`[GroqRateManager] Server error, waiting ${waitTime/1000}s...`);
            await new Promise(r => setTimeout(r, waitTime));
            continue;
          }
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }
  
  /**
   * Legacy: Compress audio for speech (kept for compatibility)
   */
  async compressAudioForSpeech(audioBlob) {
    return new Promise(async (resolve, reject) => {
      try {
        const audioBuffer = await this.decodeAudioToBuffer(audioBlob);
        const wavBlob = this.audioBufferToWav(audioBuffer);
        resolve(wavBlob);
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Convert AudioBuffer to WAV blob
   */
  audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const samples = buffer.getChannelData(0);
    const dataLength = samples.length * bytesPerSample;
    const bufferLength = 44 + dataLength;
    
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, bufferLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Write audio data
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }
  
  /**
   * Transcribe or translate audio using Groq API
   * @param {Blob} audioBlob - Audio blob to process
   * @param {string} apiKey - Groq API key
   * @param {string} model - Whisper model to use
   * @param {boolean} translate - If true, use translation endpoint (converts any language to English)
   */
  async transcribeOrTranslate(audioBlob, apiKey, model = 'whisper-large-v3-turbo', translate = false) {
    // Determine file extension based on blob type
    const extension = audioBlob.type.includes('wav') ? 'wav' : 
                      audioBlob.type.includes('mp3') ? 'mp3' : 
                      audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
    
    // IMPORTANT: Only whisper-large-v3 supports translation, NOT whisper-large-v3-turbo
    // Force model switch when translation is needed
    const effectiveModel = translate ? 'whisper-large-v3' : model;
    
    if (translate && model !== 'whisper-large-v3') {
      console.log(`[GroqRateManager] Switching from ${model} to whisper-large-v3 for translation (turbo doesn't support translate)`);
    }
    
    const endpoint = translate 
      ? 'https://api.groq.com/openai/v1/audio/translations'
      : 'https://api.groq.com/openai/v1/audio/transcriptions';
    
    const formData = new FormData();
    formData.append('file', audioBlob, `audio.${extension}`);
    formData.append('model', effectiveModel);
    formData.append('response_format', 'verbose_json');
    
    // Only transcription supports timestamp granularities
    if (!translate) {
      formData.append('timestamp_granularities[]', 'segment');
    }
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      const errorType = translate ? 'Translation' : 'Transcription';
      throw new Error(`Groq ${errorType} API error: ${error.error?.message || response.status}`);
    }
    
    const result = await response.json();
    
    if (translate) {
      result.wasTranslated = true;
      result.language = 'en';
    }
    
    return result;
  }
  
  /**
   * Estimate if a meeting duration can fit in remaining limits
   */
  canFitMeeting(durationSeconds) {
    const status = this.getStatus();
    
    // Check daily limit first (harder constraint)
    if (durationSeconds > status.dailyRemaining) {
      return {
        canFit: false,
        reason: 'daily_limit',
        available: status.dailyRemaining,
        needed: durationSeconds,
        suggestion: `Meeting exceeds daily limit by ${Math.ceil((durationSeconds - status.dailyRemaining)/60)} minutes`
      };
    }
    
    // Check hourly limit - calculate how many hours needed
    const hoursNeeded = Math.ceil(durationSeconds / (this.AUDIO_SECONDS_PER_HOUR * this.SAFETY_MARGIN));
    
    return {
      canFit: true,
      hoursNeeded,
      strategy: hoursNeeded > 1 
        ? `Transcription will need to be spread over ${hoursNeeded} hours`
        : 'Transcription can complete within current hour'
    };
  }
}

// Export singleton instance
const groqRateManager = new GroqRateManager();

// Also export class for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GroqRateManager, groqRateManager };
}
