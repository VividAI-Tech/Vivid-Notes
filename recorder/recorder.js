// VividAI Recorder Window Script
// Handles persistent recording in a separate window

// Default API endpoints
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// Pricing (approximate, for cost estimation)
const PRICING = {
  'whisper-1': 0.006, // per minute of audio
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 }, // per 1K tokens
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'default': { input: 0.001, output: 0.002 }
};

let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let isRecording = false;
let startTime = null;
let timerInterval = null;
let audioContext = null;
let analyser = null;
let audioMonitorInterval = null;
let audioPlaybackElement = null;

// Live transcription state
let liveTranscript = [];          // Accumulated transcript entries
let pendingChunks = [];           // Audio chunks waiting to be transcribed
let transcriptionInterval = null; // Interval for periodic transcription
let isTranscribing = false;       // Flag to prevent concurrent transcriptions
let chunkStartTime = 0;           // Track when the current chunk started
let lastTranscribedTime = 0;      // Track last transcribed audio time (seconds)
const TRANSCRIPTION_INTERVAL_MS = 5000; // Transcribe every 5 seconds for faster live transcription
let totalTranscriptionCost = 0;   // Track transcription cost

// Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const timer = document.getElementById('timer');
const status = document.getElementById('status');
const recordingIndicator = document.getElementById('recordingIndicator');
const audioLevelContainer = document.getElementById('audioLevelContainer');
const audioMeterBar = document.getElementById('audioMeterBar');
const audioStatus = document.getElementById('audioStatus');
const micFallbackBtn = document.getElementById('micFallbackBtn');
const recordScreenToggle = document.getElementById('recordScreenToggle');

// Live transcript UI elements
const liveTranscriptContainer = document.getElementById('liveTranscriptContainer');
const transcriptContent = document.getElementById('transcriptContent');
const transcriptCount = document.getElementById('transcriptCount');
const transcriptProcessing = document.getElementById('transcriptProcessing');
const emptyTranscript = document.getElementById('emptyTranscript');

// Screen recording state
let recordScreenEnabled = false;
let screenStream = null;

// Event Listeners
startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
micFallbackBtn.addEventListener('click', switchToMicrophone);
recordScreenToggle.addEventListener('change', () => {
  recordScreenEnabled = recordScreenToggle.checked;
});

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getRecorderStatus':
      sendResponse({
        isRecording,
        elapsedSeconds: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0
      });
      break;
    case 'stopFromPopup':
    case 'stopFromBot':
      // Stop recording when meeting ends or user requests
      if (isRecording) {
        stopRecording();
      }
      sendResponse({ success: true });
      break;
  }
  return true;
});

async function startRecording() {
  try {
    status.textContent = 'Starting microphone...';
    status.style.color = '';
    
    // Remove any existing help text
    const existingHelp = document.querySelector('.help-text');
    if (existingHelp) existingHelp.remove();
    
    // Use microphone directly - simpler and more reliable
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true
        },
        video: false
      });
      console.log('Microphone capture successful!');
      
      // If screen recording is enabled, also capture screen
      if (recordScreenEnabled) {
        try {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: 'monitor',
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30 }
            },
            audio: false  // We already have mic audio
          });
          
          // Combine mic audio with screen video
          const videoTrack = screenStream.getVideoTracks()[0];
          const audioTrack = mediaStream.getAudioTracks()[0];
          mediaStream = new MediaStream([videoTrack, audioTrack]);
          
          status.textContent = 'Recording screen + microphone...';
        } catch (screenError) {
          console.error('Screen capture failed:', screenError);
          // Continue with just audio
          status.textContent = 'Recording microphone only...';
        }
      }
    } catch (micError) {
      console.error('Microphone capture failed:', micError);
      if (micError.name === 'NotAllowedError') {
        status.textContent = 'Microphone access denied';
        status.style.color = '#EF4444';
        return;
      }
      throw micError;
    }
    
    // Check for audio tracks
    const audioTracks = mediaStream.getAudioTracks();
    console.log('Audio tracks:', audioTracks.length);
    
    if (audioTracks.length === 0) {
      status.textContent = 'No audio track available';
      status.style.color = '#EF4444';
      return;
    }
    
    // Log audio track settings for debugging
    const settings = audioTracks[0].getSettings();
    console.log('Audio track settings:', settings);
    
    audioChunks = [];
    
    // Setup audio level monitoring
    setupAudioMonitoring(mediaStream);
    
    // Setup MediaRecorder with appropriate settings
    const mimeType = recordScreenEnabled ? getVideoMimeType() : getSupportedMimeType();
    const recorderOptions = recordScreenEnabled ? {
      mimeType: mimeType,
      audioBitsPerSecond: 128000,
      videoBitsPerSecond: 2500000  // 2.5 Mbps for decent quality
    } : {
      mimeType: mimeType,
      audioBitsPerSecond: 256000
    };
    
    mediaRecorder = new MediaRecorder(mediaStream, recorderOptions);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
        pendingChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      await processRecording();
    };
    
    // Handle track ending
    audioTracks.forEach(track => {
      track.onended = () => {
        console.log('Audio track ended');
        if (isRecording) {
          stopRecording();
        }
      };
    });
    
    // Reset live transcription state
    liveTranscript = [];
    pendingChunks = [];
    totalTranscriptionCost = 0;
    chunkStartTime = 0;
    lastTranscribedTime = 0;
    
    // Show live transcript container
    console.log('Setting up live transcript container:', liveTranscriptContainer);
    if (liveTranscriptContainer) {
      liveTranscriptContainer.style.display = 'block';
      transcriptContent.innerHTML = '<div class="empty-transcript" id="emptyTranscript">Listening for speech...</div>';
      transcriptCount.textContent = '0 segments';
    } else {
      console.error('Live transcript container not found!');
    }
    
    // Start periodic live transcription (every 30 seconds)
    console.log('Starting live transcription interval:', TRANSCRIPTION_INTERVAL_MS, 'ms');
    transcriptionInterval = setInterval(async () => {
      console.log('Transcription interval triggered, pending chunks:', pendingChunks.length);
      await transcribePendingChunks();
    }, TRANSCRIPTION_INTERVAL_MS);
    
    // Start recording
    mediaRecorder.start(1000);
    isRecording = true;
    startTime = Date.now();
    
    // Update UI
    startBtn.disabled = true;
    startBtn.style.display = 'none';
    stopBtn.disabled = false;
    status.textContent = recordScreenEnabled ? 'Recording screen + audio...' : 'Recording audio...';
    status.classList.add('recording');
    timer.classList.add('recording');
    recordingIndicator.classList.add('active');
    
    // Start timer
    startTimer();
    
    // Save state
    await saveRecordingState(true);
    
    // Notify popup
    chrome.runtime.sendMessage({
      action: 'recordingStarted',
      startTime: startTime
    });
    
  } catch (error) {
    console.error('Error starting recording:', error);
    status.textContent = 'Failed to start recording';
    
    if (error.name === 'NotAllowedError') {
      alert('Screen sharing was cancelled or denied.');
    }
  }
}

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    return;
  }
  
  status.textContent = 'Stopping...';
  stopBtn.disabled = true;
  
  // Stop timer
  clearInterval(timerInterval);
  
  // Stop live transcription interval
  if (transcriptionInterval) {
    clearInterval(transcriptionInterval);
    transcriptionInterval = null;
  }
  
  // Process any remaining pending chunks before final processing
  if (pendingChunks.length > 0 && !isTranscribing) {
    status.textContent = 'Transcribing final segment...';
    await transcribePendingChunks();
  }
  
  // Stop audio monitoring and playback
  stopAudioMonitoring();
  stopAudioPlayback();
  
  // Stop recorder - triggers onstop
  mediaRecorder.stop();
  
  // Stop all tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }
  
  // Stop screen stream if active
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  
  isRecording = false;
  await saveRecordingState(false);
}

async function processRecording() {
  try {
    if (audioChunks.length === 0 && liveTranscript.length === 0) {
      status.textContent = 'No audio recorded';
      resetUI();
      return;
    }
    
    // If screen recording was enabled, offer to download video
    if (recordScreenEnabled && audioChunks.length > 0) {
      status.textContent = 'Processing video...';
      const mimeType = getVideoMimeType();
      const videoBlob = new Blob(audioChunks, { type: mimeType });
      
      // Create download link for video
      const videoUrl = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `meeting-recording-${new Date().toISOString().slice(0,19).replace(/[:-]/g, '')}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(videoUrl);
      
      status.textContent = 'Video saved! Now processing...';
    }
    
    const elapsedSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    
    // Use accumulated live transcript instead of re-transcribing
    // This avoids the long audio file issue and provides immediate results
    const transcriptData = liveTranscript;
    const transcriptCost = totalTranscriptionCost;
    
    console.log('Using live transcript:', transcriptData.length, 'segments');
    
    // Check if transcript is empty
    if (transcriptData.length === 0) {
      status.textContent = 'No speech detected in audio';
      await chrome.storage.session.set({
        isRecording: false,
        startTime: null,
        isPaused: false
      });
      resetUI();
      return;
    }
    
    // Convert array to text for summary generation
    const finalTranscript = transcriptData.map(t => 
      t.speaker ? `${t.speaker}: ${t.text}` : t.text
    ).join('\n');
    
    status.textContent = 'Generating summary...';
    
    // Generate summary directly from recorder page
    const summaryResponse = await generateSummaryDirectly(finalTranscript);
    
    console.log('Summary received:', summaryResponse);
    
    // Calculate total cost
    const summaryCost = summaryResponse.cost || 0;
    const totalCost = transcriptCost + summaryCost;
    
    // Get the generated title, category, and tags
    const meetingTitle = summaryResponse.success ? summaryResponse.title : 'Meeting Recording';
    const category = summaryResponse.success ? summaryResponse.category : 'Other';
    const tags = summaryResponse.success ? summaryResponse.tags : [];
    
    // Save to history (save the full transcript data array)
    await chrome.runtime.sendMessage({
      action: 'saveRecording',
      recording: {
        platform: 'Meeting',
        duration: elapsedSeconds,
        transcript: transcriptData,  // Save array for proper display
        transcriptText: finalTranscript,  // Also save text version
        summary: summaryResponse.success ? summaryResponse.summary : null,
        generatedTitle: meetingTitle,
        category: category,
        tags: tags,
        totalCost: totalCost,
        language: 'auto'
      }
    });
    
    // Save to session for popup to display
    await chrome.storage.session.set({
      transcript: transcriptData,  // Save array for proper display
      summary: summaryResponse.success ? summaryResponse.summary : null,
      totalCost: totalCost,
      elapsedSeconds: elapsedSeconds,
      isRecording: false,
      startTime: null,
      isPaused: false
    });
    
    status.textContent = `Done! Cost: $${totalCost.toFixed(4)}`;
    
    // Notify background to update badge
    try {
      await chrome.runtime.sendMessage({
        action: 'setRecordingState',
        state: { isRecording: false, isPaused: false }
      });
    } catch (e) {
      console.log('Could not update badge');
    }
    
  } catch (error) {
    console.error('Error processing recording:', error);
    status.textContent = 'Processing failed: ' + error.message;
    // Clear recording state on error
    await chrome.storage.session.set({
      isRecording: false,
      startTime: null,
      isPaused: false
    });
  }
  
  // Update badge to show not recording
  try {
    await chrome.runtime.sendMessage({
      action: 'setRecordingState',
      state: { isRecording: false, isPaused: false }
    });
  } catch (e) {
    console.log('Could not update badge');
  }
  
  // Cleanup
  stopAudioMonitoring();
  audioChunks = [];
  mediaRecorder = null;
  mediaStream = null;
  startTime = null;
  
  resetUI();
}

function resetUI() {
  startBtn.disabled = false;
  startBtn.style.display = 'flex';
  stopBtn.disabled = true;
  status.classList.remove('recording');
  status.style.color = '';  // Reset color
  status.textContent = 'Ready to record';
  timer.classList.remove('recording');
  recordingIndicator.classList.remove('active');
  
  // Reset screen recording state
  screenStream = null;
  
  // Hide live transcript container after a delay to show final state
  setTimeout(() => {
    if (!isRecording && liveTranscriptContainer) {
      liveTranscriptContainer.style.display = 'none';
    }
  }, 5000);
}

// Transcribe pending audio chunks for live transcription
async function transcribePendingChunks() {
  if (isTranscribing || pendingChunks.length === 0) {
    return;
  }
  
  isTranscribing = true;
  
  // Show processing indicator
  if (transcriptProcessing) {
    transcriptProcessing.style.display = 'flex';
  }
  
  try {
    const config = await getTranscriptionConfig();
    console.log('Transcription config:', { provider: config.provider, hasKey: !!config.apiKey, baseUrl: config.baseUrl, model: config.model });
    
    // Local provider doesn't need API key
    if (!config.apiKey && config.provider !== 'local') {
      console.error('API key not configured for transcription');
      if (transcriptContent) {
        transcriptContent.innerHTML = '<div class="empty-transcript" style="color: #F97316;">Please configure your API key in Settings</div>';
      }
      isTranscribing = false;
      if (transcriptProcessing) transcriptProcessing.style.display = 'none';
      return;
    }
    
    // Use ALL audioChunks to create a complete WebM file with proper headers
    // This is necessary because WebM container format needs the header from the first chunk
    const mimeType = mediaRecorder?.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunks, { type: mimeType });
    
    // Clear pending chunks (we use audioChunks for the complete file)
    pendingChunks = [];
    
    console.log('Total audio chunks:', audioChunks.length, 'Total size:', audioBlob.size);
    
    // Only process if blob has meaningful size (at least 1KB)
    if (audioBlob.size < 1000) {
      console.log('Audio too small:', audioBlob.size, 'bytes, skipping');
      isTranscribing = false;
      if (transcriptProcessing) transcriptProcessing.style.display = 'none';
      return;
    }
    
    console.log('Transcribing complete audio:', audioBlob.size, 'bytes, mimeType:', mimeType, 'provider:', config.provider, 'lastTranscribedTime:', lastTranscribedTime);
    
    let response;
    
    if (config.provider === 'local') {
      // Local faster-whisper server uses different API format
      const formData = new FormData();
      formData.append('audio', audioBlob, 'chunk.webm');
      if (config.model) {
        formData.append('model', config.model);
      }
      
      response = await fetch(`${config.baseUrl}/transcribe`, {
        method: 'POST',
        body: formData
      });
    } else {
      // OpenAI/Groq API format
      const formData = new FormData();
      formData.append('file', audioBlob, 'chunk.webm');
      formData.append('model', config.model);
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'segment');
      
      const headers = {
        'Authorization': `Bearer ${config.apiKey}`
      };
      
      response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: headers,
        body: formData
      });
    }
    
    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const error = await response.json();
        errorMsg = error.error?.message || JSON.stringify(error);
        console.error('Transcription error:', errorMsg, error);
      } catch (e) {
        const text = await response.text();
        errorMsg = text || response.statusText;
        console.error('Transcription error:', errorMsg);
      }
      // Show error in UI
      if (transcriptContent) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'transcript-entry';
        errorDiv.innerHTML = `<div class="transcript-text" style="color: #EF4444;">Transcription error: ${errorMsg}</div>`;
        transcriptContent.appendChild(errorDiv);
      }
      isTranscribing = false;
      if (transcriptProcessing) transcriptProcessing.style.display = 'none';
      return;
    }
    
    const result = await response.json();
    
    // Calculate cost for this chunk (local is free)
    if (config.provider !== 'local') {
      const durationMinutes = (result.duration || 30) / 60;
      const chunkCost = durationMinutes * PRICING['whisper-1'];
      totalTranscriptionCost += chunkCost;
    }
    
    // Process segments and add to live transcript
    // Since we transcribe complete audio each time, replace liveTranscript with all segments
    const segments = result.segments || [];
    
    // Clear existing transcript and rebuild from complete transcription
    liveTranscript = [];
    
    if (segments.length === 0 && result.text) {
      // No segments but has text - create a single entry
      const entry = {
        text: result.text.trim(),
        timestamp: formatTimestamp(0),
        startTime: 0,
        endTime: result.duration || 0,
        language: result.language || 'en'
      };
      if (entry.text) {
        liveTranscript.push(entry);
      }
    } else {
      // Process each segment
      for (const segment of segments) {
        const segmentStart = segment.start || 0;
        const segmentEnd = segment.end || segmentStart;
        const entry = {
          text: segment.text.trim(),
          timestamp: formatTimestamp(segmentStart),
          startTime: segmentStart,
          endTime: segmentEnd,
          language: result.language || 'en'
        };
        if (entry.text) {
          liveTranscript.push(entry);
        }
      }
    }
    
    // Update last transcribed time
    lastTranscribedTime = result.duration || 0;
    
    // Update UI with new transcript entries
    renderLiveTranscript();
    
  } catch (error) {
    console.error('Error transcribing chunk:', error);
    // Show error in transcript UI
    if (transcriptContent && liveTranscript.length === 0) {
      transcriptContent.innerHTML = `<div class="empty-transcript" style="color: #EF4444;">Error: ${error.message || 'Unknown error'}</div>`;
    }
  } finally {
    isTranscribing = false;
    if (transcriptProcessing) {
      transcriptProcessing.style.display = 'none';
    }
  }
}

// Render live transcript entries to UI
function renderLiveTranscript() {
  if (!transcriptContent) return;
  
  if (liveTranscript.length === 0) {
    transcriptContent.innerHTML = '<div class="empty-transcript">Listening for speech...</div>';
    transcriptCount.textContent = '0 segments';
    return;
  }
  
  // Update count
  transcriptCount.textContent = `${liveTranscript.length} segment${liveTranscript.length !== 1 ? 's' : ''}`;
  
  // Render entries
  let html = '';
  for (const entry of liveTranscript) {
    html += `
      <div class="transcript-entry">
        <div class="transcript-timestamp">${entry.timestamp}</div>
        <div class="transcript-text">${escapeHtml(entry.text)}</div>
      </div>
    `;
  }
  
  transcriptContent.innerHTML = html;
  
  // Auto-scroll to bottom
  transcriptContent.scrollTop = transcriptContent.scrollHeight;
  
  // Sync to storage so popup can display live transcript
  chrome.storage.session.set({ 
    liveTranscript: liveTranscript,
    liveTranscriptCount: liveTranscript.length
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function startTimer() {
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    updateTimerDisplay(elapsed);
  }, 1000);
}

function updateTimerDisplay(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  timer.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function saveRecordingState(recording) {
  await chrome.storage.session.set({
    isRecording: recording,
    startTime: recording ? startTime : null
  });
  
  // Update badge
  await chrome.runtime.sendMessage({
    action: 'setRecordingState',
    state: { isRecording: recording, isPaused: false }
  });
}

function getSupportedMimeType() {
  const mimeTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
  ];
  
  for (const mimeType of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return 'audio/webm';
}

function getVideoMimeType() {
  const mimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4'
  ];
  
  for (const mimeType of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return 'video/webm';
}

function setupAudioMonitoring(stream) {
  try {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    // Show audio level container
    audioLevelContainer.style.display = 'flex';
    
    // Monitor audio levels
    audioMonitorInterval = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate average level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      const level = Math.min(100, (average / 128) * 100);
      
      // Update meter
      audioMeterBar.style.width = `${level}%`;
      
      // Update status
      if (level > 20) {
        audioStatus.textContent = 'Good';
        audioStatus.className = 'audio-status good';
      } else if (level > 5) {
        audioStatus.textContent = 'Low';
        audioStatus.className = 'audio-status low';
      } else {
        audioStatus.textContent = 'No audio';
        audioStatus.className = 'audio-status none';
      }
    }, 100);
    
  } catch (error) {
    console.error('Error setting up audio monitoring:', error);
  }
}

function stopAudioMonitoring() {
  if (audioMonitorInterval) {
    clearInterval(audioMonitorInterval);
    audioMonitorInterval = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  analyser = null;
  audioLevelContainer.style.display = 'none';
}

// Play captured audio back to user so they can still hear the meeting
function playbackAudio(stream) {
  try {
    // Create an audio element to play the captured audio
    audioPlaybackElement = document.createElement('audio');
    audioPlaybackElement.srcObject = stream;
    audioPlaybackElement.autoplay = true;
    audioPlaybackElement.volume = 1.0;
    
    // Must be muted initially for autoplay policy, then unmute
    // Actually, since this is in an extension context triggered by user gesture, we should be fine
    audioPlaybackElement.play().catch(err => {
      console.warn('Audio playback autoplay blocked:', err);
      // If autoplay is blocked, try with user gesture
      status.textContent = 'Click to enable audio playback';
    });
    
    console.log('Audio playback enabled - user should hear meeting audio');
  } catch (error) {
    console.error('Error setting up audio playback:', error);
  }
}

function stopAudioPlayback() {
  if (audioPlaybackElement) {
    audioPlaybackElement.pause();
    audioPlaybackElement.srcObject = null;
    audioPlaybackElement = null;
  }
}

async function switchToMicrophone() {
  if (!isRecording) return;
  
  try {
    status.textContent = 'Switching to microphone...';
    
    // Get microphone stream
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true
      }
    });
    
    // Stop current audio monitoring
    stopAudioMonitoring();
    
    // Stop old tracks
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
    }
    
    // Remove onstop handler before stopping to prevent processing
    if (mediaRecorder) {
      mediaRecorder.onstop = null;
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    }
    
    // Create new recorder with microphone (keep existing audioChunks)
    mediaStream = micStream;
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: mimeType,
      audioBitsPerSecond: 256000
    });
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
        pendingChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      await processRecording();
    };
    
    // Start new recorder
    mediaRecorder.start(1000);
    
    // Setup audio monitoring for mic
    setupAudioMonitoring(mediaStream);
    
    // Update UI
    status.textContent = 'Recording (Microphone)...';
    micFallbackBtn.classList.add('active');
    micFallbackBtn.title = 'Using microphone';
    
  } catch (error) {
    console.error('Error switching to microphone:', error);
    alert('Could not access microphone. Please check permissions.');
    status.textContent = 'Recording...';
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Get API configuration from storage
async function getApiConfig() {
  const settings = await chrome.storage.local.get(['ai_provider', 'api_base_url', 'openai_api_key']);
  return {
    provider: settings.ai_provider || 'openai',
    baseUrl: settings.api_base_url || DEFAULT_BASE_URL,
    apiKey: settings.openai_api_key || ''
  };
}

// Get transcription-specific configuration
async function getTranscriptionConfig() {
  const settings = await chrome.storage.local.get([
    'transcription_provider', 
    'transcription_api_key', 
    'whisper_model',
    'ai_provider',
    'api_base_url',
    'openai_api_key'
  ]);
  
  const transcriptionProvider = settings.transcription_provider || 'openai';
  
  // Use transcription-specific API key if set, otherwise fall back to main key
  let apiKey = settings.transcription_api_key || settings.openai_api_key || '';
  
  // Determine base URL based on transcription provider
  let baseUrl;
  if (transcriptionProvider === 'groq') {
    baseUrl = 'https://api.groq.com/openai/v1';
  } else if (transcriptionProvider === 'local') {
    baseUrl = 'http://localhost:5001';
  } else {
    baseUrl = 'https://api.openai.com/v1';
  }
  
  // Default model based on provider
  let defaultModel;
  if (transcriptionProvider === 'groq') {
    defaultModel = 'whisper-large-v3-turbo';
  } else if (transcriptionProvider === 'local') {
    defaultModel = 'distil-large-v3';
  } else {
    defaultModel = 'whisper-1';
  }
  
  return {
    provider: transcriptionProvider,
    baseUrl: baseUrl,
    apiKey: apiKey,
    model: settings.whisper_model || defaultModel
  };
}

// Get summary-specific configuration  
async function getSummaryConfig() {
  const settings = await chrome.storage.local.get([
    'summary_provider',
    'summary_api_key',
    'summary_model',
    'ai_provider',
    'api_base_url',
    'openai_api_key'
  ]);
  
  const summaryProvider = settings.summary_provider || 'same';
  const mainProvider = settings.ai_provider || 'openai';
  
  // Determine effective provider
  const effectiveProvider = summaryProvider === 'same' ? mainProvider : summaryProvider;
  
  // Use summary-specific API key if set, otherwise fall back to main key
  let apiKey = settings.summary_api_key || settings.openai_api_key || '';
  
  // Determine base URL based on provider
  let baseUrl;
  switch (effectiveProvider) {
    case 'groq':
      baseUrl = 'https://api.groq.com/openai/v1';
      break;
    case 'gemini':
      baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
      break;
    case 'openrouter':
      baseUrl = 'https://openrouter.ai/api/v1';
      break;
    case 'ollama':
      // Use custom base URL if set, otherwise default
      baseUrl = settings.api_base_url || 'http://localhost:11434/v1';
      break;
    default:
      baseUrl = settings.api_base_url || 'https://api.openai.com/v1';
  }
  
  // Default model based on provider
  let defaultModel;
  switch (effectiveProvider) {
    case 'ollama':
      defaultModel = 'llama3.2';
      break;
    case 'groq':
      defaultModel = 'llama-3.3-70b-versatile';
      break;
    case 'gemini':
      defaultModel = 'gemini-2.0-flash-exp';
      break;
    default:
      defaultModel = 'gpt-4o-mini';
  }
  
  // Validate saved model against provider - if mismatch, use default
  let model = settings.summary_model || defaultModel;
  
  // If using Ollama but model looks like OpenAI model, use Ollama default
  if (effectiveProvider === 'ollama' && (model.startsWith('gpt-') || model === 'whisper-1')) {
    model = defaultModel;
  }
  
  return {
    provider: effectiveProvider,
    baseUrl: baseUrl,
    apiKey: apiKey,
    model: model
  };
}

// Transcribe audio directly without message passing (avoids size limits)
async function transcribeAudioDirectly(audioBlob, audioDuration = 0) {
  try {
    const config = await getApiConfig();
    if (!config.apiKey && config.provider !== 'ollama') {
      return { success: false, error: 'API key not configured. Please set it in Settings.' };
    }
    
    // Create form data for Whisper API
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    
    // Whisper API endpoint
    const whisperBaseUrl = config.provider === 'openai' || config.baseUrl.includes('openai.com') 
      ? config.baseUrl 
      : 'https://api.openai.com/v1';
    
    const headers = {};
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
    
    const response = await fetch(`${whisperBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: headers,
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Transcription failed');
    }
    
    const result = await response.json();
    
    // Calculate Whisper cost
    const durationMinutes = (result.duration || audioDuration) / 60;
    const whisperCost = durationMinutes * PRICING['whisper-1'];
    
    // Process transcription with speaker detection
    const { transcript, translationCost } = await processTranscription(result, config);
    
    return { 
      success: true, 
      transcript,
      cost: {
        whisper: whisperCost,
        translation: translationCost,
        total: whisperCost + translationCost
      },
      duration: result.duration || audioDuration,
      language: result.language
    };
  } catch (error) {
    console.error('Transcription error:', error);
    return { success: false, error: error.message };
  }
}

// Process transcription with speaker detection
async function processTranscription(whisperResult, config) {
  const segments = whisperResult.segments || [];
  const detectedLanguage = whisperResult.language || 'en';
  
  const transcript = [];
  let translationCost = 0;
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const entry = {
      text: segment.text.trim(),
      timestamp: formatTimestamp(segment.start),
      startTime: segment.start,
      endTime: segment.end,
      language: detectedLanguage,
      speaker: detectSpeaker(segment, i)
    };
    
    // Translate if not English
    if (detectedLanguage !== 'en') {
      const { translation, cost } = await translateText(segment.text, detectedLanguage, config);
      entry.translation = translation;
      translationCost += cost;
    }
    
    transcript.push(entry);
  }
  
  return { transcript, translationCost };
}

// Simple speaker detection (heuristic)
function detectSpeaker(segment, index) {
  const speakers = ['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4'];
  return speakers[index % speakers.length];
}

// Translate text if needed
async function translateText(text, sourceLanguage, config) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
    
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a translator. Translate the following text from ${sourceLanguage} to English. Only output the translation, nothing else.`
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      throw new Error('Translation failed');
    }
    
    const result = await response.json();
    const inputTokens = result.usage?.prompt_tokens || 0;
    const outputTokens = result.usage?.completion_tokens || 0;
    const pricing = PRICING['gpt-4o-mini'] || PRICING['default'];
    const cost = (inputTokens / 1000 * pricing.input) + (outputTokens / 1000 * pricing.output);
    
    return { 
      translation: result.choices[0].message.content.trim(),
      cost 
    };
  } catch (error) {
    console.error('Translation error:', error);
    return { translation: null, cost: 0 };
  }
}

// Format timestamp
function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Generate summary directly without message passing
async function generateSummaryDirectly(transcript) {
  try {
    const config = await getSummaryConfig();
    console.log('Summary config:', { provider: config.provider, hasKey: !!config.apiKey, model: config.model });
    
    if (!config.apiKey && config.provider !== 'ollama') {
      return { success: false, error: 'API key not configured. Please set it in Settings.' };
    }
    
    const model = config.model;
    
    // Prepare transcript text
    let transcriptText;
    if (typeof transcript === 'string') {
      transcriptText = transcript;
    } else if (Array.isArray(transcript)) {
      transcriptText = transcript.map(entry => 
        entry.speaker ? `${entry.speaker}: ${entry.text}` : entry.text
      ).join('\n');
    } else {
      transcriptText = String(transcript);
    }
    
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
    
    // Build request body - some providers don't support response_format
    const requestBody = {
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are a meeting assistant that analyzes meeting transcripts. 
          Provide a structured analysis in JSON format with the following fields:
          - title: A short, descriptive title for the meeting (max 6 words)
          - category: One of: "Work Meeting", "Interview", "Lecture", "Podcast", "Personal", "Call", "Presentation", "Brainstorm", "Other"
          - tags: An array of 2-5 relevant tags/keywords
          - overview: A brief 2-3 sentence summary
          - keyPoints: An array of key discussion points (max 5)
          - decisions: An array of decisions made
          - nextSteps: An array of agreed next steps
          
          Only include fields that have actual content. Be concise and actionable.
          IMPORTANT: Respond ONLY with valid JSON, no other text.`
        },
        {
          role: 'user',
          content: `Please analyze this meeting transcript:\n\n${transcriptText}`
        }
      ],
      temperature: 0.5
    };
    
    // Add response_format for providers that support it
    if (config.provider === 'openai' || config.provider === 'groq') {
      requestBody.response_format = { type: 'json_object' };
    }
    
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Summary generation failed');
    }
    
    const result = await response.json();
    const content = result.choices[0].message.content;
    
    // Parse JSON from response - handle cases where model includes extra text
    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch (parseError) {
      // Try to extract JSON from the response (model might have added extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          analysis = JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error('Could not parse JSON from response:', content);
          // Fallback: create a basic analysis from the text
          analysis = {
            title: 'Meeting Recording',
            category: 'Other',
            tags: [],
            overview: content.substring(0, 500),
            keyPoints: [],
            decisions: [],
            nextSteps: []
          };
        }
      } else {
        // No JSON found, use content as overview
        analysis = {
          title: 'Meeting Recording',
          category: 'Other',
          tags: [],
          overview: content.substring(0, 500),
          keyPoints: [],
          decisions: [],
          nextSteps: []
        };
      }
    }
    
    // Calculate cost
    const inputTokens = result.usage?.prompt_tokens || 0;
    const outputTokens = result.usage?.completion_tokens || 0;
    const pricing = PRICING[model] || PRICING['default'];
    const summaryCost = (inputTokens / 1000 * pricing.input) + (outputTokens / 1000 * pricing.output);
    
    return {
      success: true,
      title: analysis.title || 'Meeting Recording',
      category: analysis.category || 'Other',
      tags: analysis.tags || [],
      summary: {
        overview: analysis.overview,
        keyPoints: analysis.keyPoints || [],
        decisions: analysis.decisions || [],
        nextSteps: analysis.nextSteps || []
      },
      cost: summaryCost
    };
  } catch (error) {
    console.error('Summary generation error:', error);
    return { success: false, error: error.message };
  }
}

// Check if we should resume recording on page load
async function checkRecordingState() {
  const state = await chrome.storage.session.get(['isRecording', 'startTime']);
  if (state.isRecording && state.startTime) {
    // Recording was in progress - but we can't resume the stream
    // Just update the display to show it ended
    status.textContent = 'Previous recording was interrupted';
    await chrome.storage.session.set({ isRecording: false });
  }
}

// Check for bot auto-start parameters
async function checkAutoStart() {
  const urlParams = new URLSearchParams(window.location.search);
  const autoStart = urlParams.get('autoStart');
  const tabId = urlParams.get('tabId');
  const platform = urlParams.get('platform');
  
  if (autoStart === 'true') {
    console.log('Bot auto-start detected:', { tabId, platform });
    
    // Update status to show bot mode
    if (platform) {
      status.textContent = `Bot: Auto-recording ${decodeURIComponent(platform)}...`;
    }
    
    // Small delay to ensure page is fully loaded
    setTimeout(async () => {
      try {
        await startRecording();
        
        // Notify that bot recording started
        chrome.runtime.sendMessage({
          action: 'recordingStarted',
          platform: platform ? decodeURIComponent(platform) : 'Unknown'
        });
      } catch (error) {
        console.error('Bot auto-start failed:', error);
        status.textContent = 'Auto-start failed: ' + error.message;
      }
    }, 1000);
  }
}

// Initialize
checkRecordingState();
checkAutoStart();
