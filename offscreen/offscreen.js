// FlyRec Offscreen Document
// Handles media recording since service workers can't access MediaRecorder

let mediaRecorder = null;
let audioChunks = [];
let mediaStream = null;
let audioContext = null;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') {
    return;
  }
  
  switch (message.action) {
    case 'offscreen-start-recording':
      startRecording()
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'offscreen-pause-recording':
      pauseRecording();
      sendResponse({ success: true });
      break;
      
    case 'offscreen-resume-recording':
      resumeRecording();
      sendResponse({ success: true });
      break;
      
    case 'offscreen-stop-recording':
      stopRecording()
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
  }
});

async function startRecording() {
  try {
    // Use getDisplayMedia to capture tab/screen audio
    // This shows a picker where user can select "Chrome Tab" and check "Share tab audio"
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser'  // Prefer browser tab
      },
      audio: true,  // Request audio capture
      preferCurrentTab: true,  // Prefer current tab
      selfBrowserSurface: 'include',  // Include current tab as option
      systemAudio: 'include'  // Include system audio
    });
    
    // Check if we got audio
    const audioTracks = displayStream.getAudioTracks();
    const videoTracks = displayStream.getVideoTracks();
    
    if (audioTracks.length === 0) {
      // Try to get microphone as fallback
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioTracks.push(...micStream.getAudioTracks());
      } catch (e) {
        console.warn('No microphone available:', e);
      }
    }
    
    // Stop video tracks - we only need audio for transcription
    videoTracks.forEach(track => track.stop());
    
    if (audioTracks.length === 0) {
      throw new Error('No audio track available. Please make sure to check "Share tab audio" when sharing.');
    }
    
    // Create a new stream with just audio
    mediaStream = new MediaStream(audioTracks);
    
    // Setup MediaRecorder
    audioChunks = [];
    
    const mimeType = getSupportedMimeType();
    
    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: mimeType,
      audioBitsPerSecond: 128000
    });
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onerror = (error) => {
      console.error('MediaRecorder error:', error);
    };
    
    // Handle track ending (user stops sharing)
    audioTracks.forEach(track => {
      track.onended = () => {
        console.log('Audio track ended');
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      };
    });
    
    // Start recording with 1 second chunks for real-time processing capability
    mediaRecorder.start(1000);
    
    return { success: true };
  } catch (error) {
    console.error('Error starting recording:', error);
    throw error;
  }
}

function pauseRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
  }
}

function resumeRecording() {
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
  }
}

async function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error('No active recording'));
      return;
    }
    
    mediaRecorder.onstop = async () => {
      try {
        // Combine all chunks into a single blob
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        
        // Convert to base64
        const base64 = await blobToBase64(audioBlob);
        
        // Stop all tracks
        if (mediaStream) {
          mediaStream.getTracks().forEach(track => track.stop());
        }
        
        // Clean up
        mediaRecorder = null;
        audioChunks = [];
        mediaStream = null;
        
        resolve({ success: true, audioData: base64 });
      } catch (error) {
        reject(error);
      }
    };
    
    mediaRecorder.stop();
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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Remove the data URL prefix to get just the base64 string
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
