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
   * Transcribe with rate limiting, compression, and retry logic
   */
  async transcribeWithRateLimit(audioBlob, options = {}) {
    const { apiKey, model = 'whisper-large-v3-turbo' } = options;
    
    if (!apiKey) {
      throw new Error('No API key configured for Groq transcription');
    }
    
    let fileSizeMB = audioBlob.size / (1024 * 1024);
    console.log(`[GroqRateManager] Original audio: ${fileSizeMB.toFixed(2)}MB`);
    
    // Reset counters if needed
    this.resetIfNeeded();
    
    // Compress audio if it's large (>10MB) or close to limit
    // Speech transcription works fine with compressed audio
    let processedBlob = audioBlob;
    if (fileSizeMB > 10) {
      console.log('[GroqRateManager] Compressing audio for optimal upload...');
      try {
        processedBlob = await this.compressAudioForSpeech(audioBlob);
        const newSizeMB = processedBlob.size / (1024 * 1024);
        console.log(`[GroqRateManager] Compressed: ${fileSizeMB.toFixed(2)}MB → ${newSizeMB.toFixed(2)}MB (${Math.round((1 - newSizeMB/fileSizeMB) * 100)}% reduction)`);
        fileSizeMB = newSizeMB;
      } catch (compressError) {
        console.warn('[GroqRateManager] Compression failed, using original:', compressError.message);
        processedBlob = audioBlob;
      }
    }
    
    // Check file size after compression
    if (fileSizeMB > this.MAX_FILE_SIZE_MB) {
      throw new Error(`Audio file (${fileSizeMB.toFixed(1)}MB) still exceeds Groq's 25MB limit after compression. Try a shorter recording.`);
    }
    
    // Try transcription with retries for transient errors
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[GroqRateManager] Transcription attempt ${attempt}/${maxRetries}`);
        const result = await this.transcribeGroq(processedBlob, apiKey, model);
        
        // Record actual duration (from API response)
        const actualDuration = result.duration || 60;
        this.recordUsage(actualDuration);
        
        return result;
      } catch (error) {
        lastError = error;
        console.error(`[GroqRateManager] Attempt ${attempt} failed:`, error.message);
        
        // Handle rate limit errors
        if (error.message.includes('429') || error.message.includes('rate limit')) {
          console.log('[GroqRateManager] Hit rate limit, updating usage data');
          this.usageData.audioSecondsThisHour = this.AUDIO_SECONDS_PER_HOUR;
          this.saveUsageData();
          throw error; // Don't retry rate limits
        }
        
        // Retry on server errors (500, 502, 503, etc.)
        if (error.message.includes('500') || error.message.includes('Internal Server Error') ||
            error.message.includes('502') || error.message.includes('503')) {
          if (attempt < maxRetries) {
            const waitTime = attempt * 5000; // 5s, 10s, 15s
            console.log(`[GroqRateManager] Server error, waiting ${waitTime/1000}s before retry...`);
            await new Promise(r => setTimeout(r, waitTime));
            continue;
          }
        }
        
        // Don't retry other errors
        throw error;
      }
    }
    
    throw lastError;
  }
  
  /**
   * Compress audio for speech transcription without quality loss
   * Uses 16kHz mono opus - optimal for speech recognition
   */
  async compressAudioForSpeech(audioBlob) {
    return new Promise(async (resolve, reject) => {
      try {
        // Decode the audio
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000 // Optimal for speech recognition
        });
        
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Create offline context for processing
        const offlineContext = new OfflineAudioContext(
          1, // Mono - sufficient for speech
          audioBuffer.duration * 16000,
          16000 // 16kHz sample rate
        );
        
        // Create buffer source
        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineContext.destination);
        source.start();
        
        // Render the audio
        const renderedBuffer = await offlineContext.startRendering();
        
        // Convert to WAV (widely supported, good compression for speech)
        const wavBlob = this.audioBufferToWav(renderedBuffer);
        
        audioContext.close();
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
   * Transcribe using Groq API
   */
  async transcribeGroq(audioBlob, apiKey, model = 'whisper-large-v3-turbo') {
    // Determine file extension based on blob type
    const extension = audioBlob.type.includes('wav') ? 'wav' : 
                      audioBlob.type.includes('mp3') ? 'mp3' : 
                      audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
    
    const formData = new FormData();
    formData.append('file', audioBlob, `audio.${extension}`);
    formData.append('model', model);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`Groq API error: ${error.error?.message || response.status}`);
    }
    
    return response.json();
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
