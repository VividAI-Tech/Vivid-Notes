// VividAI Recorder Window Script
// Handles persistent recording in a separate window

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
    if (audioChunks.length === 0) {
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
      
      status.textContent = 'Video saved! Now processing audio...';
    }
    
    status.textContent = 'Transcribing with AI...';
    
    const elapsedSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    
    const mimeType = mediaRecorder?.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunks, { type: mimeType });
    const base64Audio = await blobToBase64(audioBlob);
    
    const transcriptResponse = await chrome.runtime.sendMessage({
      action: 'transcribeAudio',
      audioData: base64Audio,
      audioDuration: elapsedSeconds
    });
    
    if (!transcriptResponse.success) {
      status.textContent = 'Transcription failed: ' + transcriptResponse.error;
      resetUI();
      return;
    }
    
    const transcriptData = transcriptResponse.transcript;
    const transcriptCost = transcriptResponse.cost?.total || 0;
    
    console.log('Final transcript:', transcriptData);
    
    // Check if transcript is empty (handle both array and string formats)
    const isEmpty = Array.isArray(transcriptData) 
      ? transcriptData.length === 0 
      : (!transcriptData || transcriptData.trim().length === 0);
    
    if (isEmpty) {
      status.textContent = 'No speech detected in audio';
      await chrome.storage.session.set({
        isRecording: false,
        startTime: null,
        isPaused: false
      });
      resetUI();
      return;
    }
    
    // Convert array to text for summary generation if needed
    const finalTranscript = Array.isArray(transcriptData) 
      ? transcriptData.map(t => t.text).join(' ')
      : transcriptData;
    
    status.textContent = 'Generating summary...';
    
    const summaryResponse = await chrome.runtime.sendMessage({
      action: 'generateSummary',
      transcript: finalTranscript
    });
    
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
        language: transcriptResponse.language || 'auto'
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
