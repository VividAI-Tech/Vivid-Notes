// VividAI Background Service Worker
// Handles recording, transcription, AI processing, and Bot functionality

let offscreenDocumentCreated = false;

// Bot state
let botEnabled = false;
let botSettings = {
  autoRecord: false,
  notifications: true,
  autoTranscribe: true,
  autoSummarize: true
};
let monitoringInterval = null;
let detectedMeetings = new Set();
let activeMeetingTabId = null;

// Default API endpoints
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// Pricing (approximate, for cost estimation)
const PRICING = {
  'whisper-1': 0.006, // per minute of audio
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 }, // per 1K tokens
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  // Default pricing for unknown models
  'default': { input: 0.001, output: 0.002 }
};

// Get API configuration
async function getApiConfig() {
  const settings = await chrome.storage.local.get(['ai_provider', 'api_base_url', 'openai_api_key']);
  return {
    provider: settings.ai_provider || 'openai',
    baseUrl: settings.api_base_url || DEFAULT_BASE_URL,
    apiKey: settings.openai_api_key || ''
  };
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    });
  return true; // Keep the message channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'getRecordingState':
      return await getRecordingState();
    case 'setRecordingState':
      return await setRecordingState(message.state);
    case 'transcribeAudio':
      return await transcribeAudio(message.audioData, message.audioDuration);
    case 'generateSummary':
      return await generateSummary(message.transcript);
    case 'saveRecording':
      return await saveRecording(message.recording);
    case 'getHistory':
      return await getHistory();
    case 'getRecordingById':
      return await getRecordingById(message.id);
    case 'deleteRecording':
      return await deleteRecording(message.id);
    case 'updateRecordingTitle':
      return await updateRecordingTitle(message.id, message.title);
    case 'clearHistory':
      return await clearHistory();
    case 'recordingStarted':
      // Recorder window started recording
      updateBadge(true, false);
      return { success: true };
    case 'recordingComplete':
      // Recorder window finished
      updateBadge(false, false);
      return { success: true };
    case 'getMeetingTabStreamId':
      return await getMeetingTabStreamId();
    case 'getStreamIdForTab':
      return await getStreamIdForTab(message.tabId);
    // Bot actions
    case 'setBotEnabled':
      return await setBotEnabled(message.enabled);
    case 'updateBotSettings':
      return await updateBotSettings(message.settings);
    case 'getBotStatus':
      return await getBotStatus();
    case 'checkScheduledMeetings':
      return await checkScheduledMeetings();
    case 'triggerBotRecording':
      return await triggerBotRecording(message.tabId, message.platform);
    case 'botMeetingActive':
      // Handle active meeting notification from content script
      if (botEnabled && sender.tab) {
        handleMeetingDetected(sender.tab.id, sender.tab, message.platform);
      }
      return { success: true };
    case 'botMeetingEnded':
      // Handle meeting ended notification from content script
      if (sender.tab && activeMeetingTabId === sender.tab.id) {
        await handleMeetingExit(sender.tab.id, 'Meeting ended');
      }
      return { success: true };
    default:
      return { success: false, error: 'Unknown action' };
  }
}

// Check if URL is an ACTIVE meeting (not just the platform homepage)
function isActiveMeetingUrl(url) {
  if (!url) return false;
  
  // Google Meet - must have meeting code (xxx-xxxx-xxx format)
  // Meeting codes can have letters and numbers
  if (url.includes('meet.google.com/')) {
    // Match patterns like: ouo-kyzv-axr, abc-defg-hij
    const meetPattern = /meet\.google\.com\/([a-z0-9]{3,4}-[a-z0-9]{4}-[a-z0-9]{3,4})/i;
    if (meetPattern.test(url)) {
      return true;
    }
  }
  
  // Zoom - must be in a meeting room (/j/ or /wc/)
  if (url.includes('zoom.us/j/') || url.includes('zoom.us/wc/')) {
    return true;
  }
  
  // Webex - must be in a meeting
  if (url.includes('webex.com') && url.includes('/meet')) {
    return true;
  }
  
  // Teams - must be in a meeting
  if (url.includes('teams.microsoft.com') && (url.includes('/meeting') || url.includes('/l/meetup'))) {
    return true;
  }
  
  // WhatsApp - only during calls (can't detect from URL alone, skip)
  
  return false;
}

// Get stream ID for a meeting tab
async function getMeetingTabStreamId() {
  try {
    // Find tabs with active meetings
    const tabs = await chrome.tabs.query({});
    const meetingTabs = tabs.filter(tab => isActiveMeetingUrl(tab.url));
    
    if (meetingTabs.length === 0) {
      return { 
        success: false, 
        error: 'No active meeting found. Please join a Google Meet, Zoom, or other meeting first (not just the homepage).' 
      };
    }
    
    // Use the first meeting tab found
    const meetingTab = meetingTabs[0];
    
    // Get stream ID for this tab
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: meetingTab.id
    });
    
    return { 
      success: true, 
      streamId,
      tabId: meetingTab.id,
      tabTitle: meetingTab.title,
      tabUrl: meetingTab.url
    };
  } catch (error) {
    // Don't spam console for expected permission errors
    if (!error.message?.includes('activeTab')) {
      console.error('Error getting meeting tab stream:', error);
    }
    return { success: false, error: error.message };
  }
}

// Get stream ID for a specific tab
async function getStreamIdForTab(tabId) {
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });
    
    return { success: true, streamId };
  } catch (error) {
    console.error('Error getting stream ID for tab:', error);
    return { success: false, error: error.message };
  }
}

// Recording state management (persisted in storage)
async function getRecordingState() {
  const state = await chrome.storage.session.get([
    'isRecording', 'isPaused', 'startTime', 'elapsedSeconds', 'audioData'
  ]);
  return {
    success: true,
    isRecording: state.isRecording || false,
    isPaused: state.isPaused || false,
    startTime: state.startTime || null,
    elapsedSeconds: state.elapsedSeconds || 0
  };
}

async function setRecordingState(state) {
  await chrome.storage.session.set(state);
  updateBadge(state.isRecording, state.isPaused);
  return { success: true };
}

// Create offscreen document for recording
async function setupOffscreenDocument() {
  if (offscreenDocumentCreated) return;
  
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  
  if (existingContexts.length > 0) {
    offscreenDocumentCreated = true;
    return;
  }
  
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['DISPLAY_MEDIA', 'USER_MEDIA'],
    justification: 'Recording meeting audio for transcription using screen capture'
  });
  
  offscreenDocumentCreated = true;
}

async function startRecording() {
  try {
    // Setup offscreen document
    await setupOffscreenDocument();
    
    // Send message to offscreen document to start recording using display media
    const response = await chrome.runtime.sendMessage({
      action: 'offscreen-start-recording',
      target: 'offscreen'
    });
    
    if (response.success) {
      isRecording = true;
      isPaused = false;
      audioChunks = [];
    }
    
    return response;
  } catch (error) {
    console.error('Error starting recording:', error);
    return { success: false, error: error.message };
  }
}

function pauseRecording() {
  if (!isRecording) {
    return { success: false, error: 'Not recording' };
  }
  
  isPaused = true;
  
  chrome.runtime.sendMessage({
    action: 'offscreen-pause-recording',
    target: 'offscreen'
  });
  
  return { success: true };
}

function resumeRecording() {
  if (!isRecording) {
    return { success: false, error: 'Not recording' };
  }
  
  isPaused = false;
  
  chrome.runtime.sendMessage({
    action: 'offscreen-resume-recording',
    target: 'offscreen'
  });
  
  return { success: true };
}

async function stopRecording() {
  if (!isRecording) {
    return { success: false, error: 'Not recording' };
  }
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'offscreen-stop-recording',
      target: 'offscreen'
    });
    
    isRecording = false;
    isPaused = false;
    
    return response;
  } catch (error) {
    console.error('Error stopping recording:', error);
    return { success: false, error: error.message };
  }
}

async function transcribeAudio(audioData, audioDuration = 0) {
  try {
    const config = await getApiConfig();
    if (!config.apiKey && config.provider !== 'ollama') {
      return { success: false, error: 'API key not configured. Please set it in Settings.' };
    }
    
    // Convert base64 to blob
    const audioBlob = base64ToBlob(audioData, 'audio/webm');
    
    // Create form data for Whisper API
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    
    // Note: Whisper API endpoint - use OpenAI for transcription if provider doesn't support it
    // Most providers don't have Whisper, so we use OpenAI's endpoint
    const whisperBaseUrl = config.provider === 'openai' || config.baseUrl.includes('openai.com') 
      ? config.baseUrl 
      : 'https://api.openai.com/v1';
    
    // Build headers
    const headers = {};
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
    
    // Call Whisper API
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
    
    // Calculate Whisper cost (duration in seconds -> minutes)
    const durationMinutes = (result.duration || audioDuration) / 60;
    const whisperCost = durationMinutes * PRICING['whisper-1'];
    
    // Process transcription with speaker detection and translation
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

async function processTranscription(whisperResult, config) {
  const segments = whisperResult.segments || [];
  const detectedLanguage = whisperResult.language || 'en';
  
  // Process segments with speaker diarization simulation and translation
  const transcript = [];
  let translationCost = 0;
  
  for (const segment of segments) {
    const entry = {
      text: segment.text.trim(),
      timestamp: formatTimestamp(segment.start),
      startTime: segment.start,
      endTime: segment.end,
      language: detectedLanguage,
      speaker: await detectSpeaker(segment, segments.indexOf(segment))
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

async function detectSpeaker(segment, index) {
  // In a real implementation, you would use speaker diarization
  // For now, we'll use a simple heuristic based on audio characteristics
  // This could be enhanced with a speaker diarization model
  
  // Alternate speakers for demo - in production, use pyannote or similar
  const speakers = ['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4'];
  return speakers[index % speakers.length];
}

async function translateText(text, sourceLanguage, config) {
  try {
    // Build headers
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
    
    // Calculate cost
    const inputTokens = result.usage?.prompt_tokens || 0;
    const outputTokens = result.usage?.completion_tokens || 0;
    const pricing = PRICING['gpt-4o-mini'] || PRICING['default'];
    const cost = (inputTokens / 1000 * pricing.input) + 
                 (outputTokens / 1000 * pricing.output);
    
    return { 
      translation: result.choices[0].message.content.trim(),
      cost 
    };
  } catch (error) {
    console.error('Translation error:', error);
    return { translation: null, cost: 0 };
  }
}

async function generateSummary(transcript) {
  try {
    const config = await getApiConfig();
    if (!config.apiKey && config.provider !== 'ollama') {
      return { success: false, error: 'API key not configured. Please set it in Settings.' };
    }
    
    // Get model from settings
    const settings = await chrome.storage.local.get('summary_model');
    const model = settings.summary_model || 'gpt-4o-mini';
    
    // Prepare transcript text for summarization
    // Handle both string and array formats
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
    
    // Build headers
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
    
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are a meeting assistant that analyzes meeting transcripts. 
            Provide a structured analysis in JSON format with the following fields:
            - title: A short, descriptive title for the meeting (max 6 words, e.g., "Q4 Budget Review", "Product Launch Planning", "Weekly Team Sync")
            - category: One of these categories that best fits the content: "Work Meeting", "Interview", "Lecture", "Podcast", "Personal", "Call", "Presentation", "Brainstorm", "Other"
            - tags: An array of 2-5 relevant tags/keywords that describe the content (e.g., ["budget", "Q4", "finance"], ["product", "launch", "marketing"])
            - overview: A brief 2-3 sentence summary of the meeting
            - keyPoints: An array of key discussion points (max 5)
            - decisions: An array of decisions made during the meeting
            - nextSteps: An array of agreed next steps
            
            Only include fields that have actual content from the meeting.
            Be concise and actionable. The title should capture the main topic.
            Tags should be lowercase single words or short phrases.`
          },
          {
            role: 'user',
            content: `Please analyze this meeting transcript:\n\n${transcriptText}`
          }
        ],
        temperature: 0.5,
        response_format: { type: 'json_object' }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Summary generation failed');
    }
    
    const result = await response.json();
    const analysis = JSON.parse(result.choices[0].message.content);
    
    // Calculate cost (approximate for non-OpenAI providers)
    const inputTokens = result.usage?.prompt_tokens || 0;
    const outputTokens = result.usage?.completion_tokens || 0;
    const pricing = PRICING[model] || PRICING['default'];
    const summaryCost = (inputTokens / 1000 * pricing.input) + 
                        (outputTokens / 1000 * pricing.output);
    
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

// History Management
async function saveRecording(recording) {
  try {
    const { recordings = [] } = await chrome.storage.local.get('recordings');
    
    // Add new recording with ID and timestamp
    const newRecording = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      ...recording
    };
    
    // Keep only last 50 recordings to avoid storage limits
    recordings.unshift(newRecording);
    if (recordings.length > 50) {
      recordings.pop();
    }
    
    await chrome.storage.local.set({ recordings });
    
    return { success: true, id: newRecording.id };
  } catch (error) {
    console.error('Error saving recording:', error);
    return { success: false, error: error.message };
  }
}

async function getHistory() {
  try {
    const { recordings = [] } = await chrome.storage.local.get('recordings');
    
    // Return summary info with searchable text for filtering
    const history = recordings.map(r => {
      // Build searchable text from transcript and summary
      let searchText = '';
      
      // Add transcript text
      if (r.transcript) {
        if (Array.isArray(r.transcript)) {
          searchText += r.transcript.map(t => t.text || '').join(' ');
        } else if (typeof r.transcript === 'string') {
          searchText += r.transcript;
        }
      }
      
      // Add summary text
      if (r.summary) {
        if (r.summary.overview) searchText += ' ' + r.summary.overview;
        if (r.summary.keyPoints) searchText += ' ' + r.summary.keyPoints.join(' ');
        if (r.summary.decisions) searchText += ' ' + r.summary.decisions.join(' ');
        if (r.summary.nextSteps) searchText += ' ' + r.summary.nextSteps.join(' ');
      }
      
      return {
        id: r.id,
        date: r.date,
        platform: r.platform,
        duration: r.duration,
        title: r.customTitle || r.generatedTitle || 'Meeting Recording',
        category: r.category || 'Other',
        tags: r.tags || [],
        cost: r.totalCost,
        hasCustomTitle: !!r.customTitle,
        searchText: searchText.toLowerCase()
      };
    });
    
    return { success: true, history };
  } catch (error) {
    console.error('Error getting history:', error);
    return { success: false, error: error.message };
  }
}

async function getRecordingById(id) {
  try {
    const { recordings = [] } = await chrome.storage.local.get('recordings');
    const recording = recordings.find(r => r.id === id);
    
    if (!recording) {
      return { success: false, error: 'Recording not found' };
    }
    
    return { success: true, recording };
  } catch (error) {
    console.error('Error getting recording:', error);
    return { success: false, error: error.message };
  }
}

async function deleteRecording(id) {
  try {
    const { recordings = [] } = await chrome.storage.local.get('recordings');
    const filtered = recordings.filter(r => r.id !== id);
    await chrome.storage.local.set({ recordings: filtered });
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting recording:', error);
    return { success: false, error: error.message };
  }
}

async function updateRecordingTitle(id, title) {
  try {
    const { recordings = [] } = await chrome.storage.local.get('recordings');
    const index = recordings.findIndex(r => r.id === id);
    
    if (index === -1) {
      return { success: false, error: 'Recording not found' };
    }
    
    recordings[index].customTitle = title;
    await chrome.storage.local.set({ recordings });
    
    return { success: true };
  } catch (error) {
    console.error('Error updating recording title:', error);
    return { success: false, error: error.message };
  }
}

async function clearHistory() {
  try {
    await chrome.storage.local.set({ recordings: [] });
    return { success: true };
  } catch (error) {
    console.error('Error clearing history:', error);
    return { success: false, error: error.message };
  }
}

async function getApiKey() {
  const result = await chrome.storage.local.get('openai_api_key');
  return result.openai_api_key;
}

function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open options page on first install
    chrome.runtime.openOptionsPage();
  }
});

// Badge update for recording status
function updateBadge(isRecording, isPaused) {
  if (isRecording) {
    chrome.action.setBadgeText({ text: isPaused ? '⏸' : '●' });
    chrome.action.setBadgeBackgroundColor({ color: isPaused ? '#EAB308' : '#EF4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Restore badge state on startup
chrome.runtime.onStartup.addListener(async () => {
  const state = await chrome.storage.session.get(['isRecording', 'isPaused']);
  updateBadge(state.isRecording, state.isPaused);
  
  // Restore bot state
  await initializeBot();
});

// ============================================
// BOT FUNCTIONALITY
// ============================================

// Initialize bot on extension load
async function initializeBot() {
  try {
    const settings = await chrome.storage.local.get(['botEnabled', 'botSettings']);
    botEnabled = settings.botEnabled || false;
    botSettings = settings.botSettings || botSettings;
    
    if (botEnabled) {
      startMeetingMonitoring();
    }
    
    console.log('VividAI Bot initialized:', { botEnabled, botSettings });
  } catch (error) {
    console.error('Error initializing bot:', error);
  }
}

// Enable/disable bot
async function setBotEnabled(enabled) {
  try {
    botEnabled = enabled;
    await chrome.storage.local.set({ botEnabled });
    
    if (enabled) {
      startMeetingMonitoring();
      logBotActivity('Bot enabled', 'VividAI bot is now monitoring for meetings', 'join');
      
      if (botSettings.notifications) {
        showNotification('VividAI Bot Enabled', 'Now monitoring for meetings automatically');
      }
    } else {
      stopMeetingMonitoring();
      logBotActivity('Bot disabled', 'VividAI bot stopped monitoring', 'join');
    }
    
    // Notify all extension pages
    broadcastMessage({ action: 'botStatusUpdate', status: enabled ? 'active' : 'idle' });
    
    return { success: true, enabled };
  } catch (error) {
    console.error('Error setting bot enabled:', error);
    return { success: false, error: error.message };
  }
}

// Update bot settings
async function updateBotSettings(newSettings) {
  try {
    botSettings = { ...botSettings, ...newSettings };
    await chrome.storage.local.set({ botSettings });
    
    return { success: true, settings: botSettings };
  } catch (error) {
    console.error('Error updating bot settings:', error);
    return { success: false, error: error.message };
  }
}

// Get current bot status
async function getBotStatus() {
  const state = await chrome.storage.session.get(['isRecording', 'currentMeeting']);
  
  return {
    success: true,
    enabled: botEnabled,
    settings: botSettings,
    isRecording: state.isRecording || false,
    currentMeeting: state.currentMeeting || null
  };
}

// Start monitoring for meetings
function startMeetingMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  
  // Check for meetings every 5 seconds
  monitoringInterval = setInterval(checkForMeetings, 5000);
  
  // Also listen for tab updates
  chrome.tabs.onUpdated.addListener(onTabUpdated);
  chrome.tabs.onActivated.addListener(onTabActivated);
  
  console.log('Bot: Started meeting monitoring');
}

// Stop monitoring
function stopMeetingMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  chrome.tabs.onUpdated.removeListener(onTabUpdated);
  chrome.tabs.onActivated.removeListener(onTabActivated);
  
  detectedMeetings.clear();
  console.log('Bot: Stopped meeting monitoring');
}

// Tab update listener for bot
function onTabUpdated(tabId, changeInfo, tab) {
  if (!botEnabled) return;
  
  if (changeInfo.status === 'complete' && tab.url) {
    const platform = detectMeetingPlatform(tab.url);
    if (platform && !detectedMeetings.has(tabId)) {
      handleMeetingDetected(tabId, tab, platform);
    }
  }
}

// Tab activated listener
async function onTabActivated(activeInfo) {
  if (!botEnabled) return;
  
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      const platform = detectMeetingPlatform(tab.url);
      if (platform && !detectedMeetings.has(activeInfo.tabId)) {
        handleMeetingDetected(activeInfo.tabId, tab, platform);
      }
    }
  } catch (error) {
    // Tab might not exist
  }
}

// Check for meeting tabs
async function checkForMeetings() {
  if (!botEnabled) return;
  
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (!tab.url) continue;
      
      const platform = detectMeetingPlatform(tab.url);
      if (platform && !detectedMeetings.has(tab.id)) {
        handleMeetingDetected(tab.id, tab, platform);
      }
    }
    
    // Also check scheduled meetings
    await checkScheduledMeetings();
  } catch (error) {
    console.error('Error checking for meetings:', error);
  }
}

// Detect meeting platform from URL - only returns platform if ACTUALLY in a meeting
function detectMeetingPlatform(url) {
  if (!url) return null;
  
  // Google Meet - must have a meeting code (not just meet.google.com homepage)
  // Meeting codes can have letters and numbers: xxx-xxxx-xxx
  if (url.includes('meet.google.com/')) {
    const meetPattern = /meet\.google\.com\/([a-z0-9]{3,4}-[a-z0-9]{4}-[a-z0-9]{3,4})/i;
    if (meetPattern.test(url)) {
      return 'Google Meet';
    }
  }
  
  // Zoom - must be in a meeting room
  if (url.includes('zoom.us/j/') || url.includes('zoom.us/wc/')) return 'Zoom';
  
  // Teams - must be in a meeting
  if (url.includes('teams.microsoft.com') && (url.includes('/meeting') || url.includes('/l/meetup'))) return 'MS Teams';
  
  // Webex - must be in a meeting
  if (url.includes('webex.com') && url.includes('/meet')) return 'Webex';
  
  // WhatsApp - only when in a call (handled by content script)
  // Don't auto-detect WhatsApp from URL alone
  
  return null;
}

// Handle detected meeting
async function handleMeetingDetected(tabId, tab, platform) {
  detectedMeetings.add(tabId);
  
  console.log('Bot: Meeting detected -', platform, tab.title);
  
  // Log activity
  logBotActivity(`Meeting detected: ${platform}`, tab.title || 'Untitled meeting', 'join');
  
  // Notify extension pages
  broadcastMessage({
    action: 'meetingDetected',
    tabId,
    platform,
    title: tab.title,
    url: tab.url
  });
  
  // Show notification if enabled
  if (botSettings.notifications) {
    showNotification(
      `${platform} Meeting Detected`,
      tab.title || 'Click to start recording'
    );
  }
  
  // Auto-record if enabled
  if (botSettings.autoRecord) {
    // Wait a few seconds for the meeting to fully load
    setTimeout(() => {
      triggerBotRecording(tabId, platform);
    }, 3000);
  }
}

// Trigger bot recording
async function triggerBotRecording(tabId, platform) {
  try {
    // Check if already recording
    const state = await chrome.storage.session.get('isRecording');
    if (state.isRecording) {
      console.log('Bot: Already recording, skipping');
      return { success: false, error: 'Already recording' };
    }
    
    // Set active meeting tab
    activeMeetingTabId = tabId;
    
    // Get the tab info
    const tab = await chrome.tabs.get(tabId);
    
    // Store current meeting info
    await chrome.storage.session.set({
      currentMeeting: {
        tabId,
        platform,
        title: tab.title,
        url: tab.url,
        startedAt: new Date().toISOString()
      }
    });
    
    // Check if recorder window is already open
    const recorderBaseUrl = chrome.runtime.getURL('recorder/recorder.html');
    const windows = await chrome.windows.getAll({ populate: true });
    
    for (const win of windows) {
      for (const tab of win.tabs || []) {
        if (tab.url && tab.url.startsWith(recorderBaseUrl)) {
          // Recorder already open, focus it instead
          console.log('Recorder window already open, focusing it');
          await chrome.windows.update(win.id, { focused: true });
          return { success: true, message: 'Recorder already open' };
        }
      }
    }
    
    // Open recorder window
    const recorderUrl = recorderBaseUrl + 
      `?tabId=${tabId}&autoStart=true&platform=${encodeURIComponent(platform)}`;
    
    await chrome.windows.create({
      url: recorderUrl,
      type: 'popup',
      width: 450,
      height: 700,
      left: 100,
      top: 100
    });
    
    // Log activity
    logBotActivity('Recording started', `${platform} - ${tab.title || 'Untitled'}`, 'record');
    
    // Notify
    broadcastMessage({
      action: 'recordingStarted',
      tabId,
      platform,
      meeting: tab.title
    });
    
    if (botSettings.notifications) {
      showNotification('Recording Started', `Recording ${platform} meeting`);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error triggering bot recording:', error);
    return { success: false, error: error.message };
  }
}

// Check scheduled meetings - only for notifications, no auto-join
async function checkScheduledMeetings() {
  try {
    const result = await chrome.storage.local.get('scheduledMeetings');
    const meetings = result.scheduledMeetings || [];
    
    const now = new Date();
    
    for (const meeting of meetings) {
      if (!meeting.date || !meeting.time) continue;
      
      const meetingTime = new Date(`${meeting.date}T${meeting.time}`);
      const timeDiff = (meetingTime - now) / 1000 / 60; // difference in minutes
      
      // If meeting is starting within 2 minutes, notify
      if (timeDiff > 0 && timeDiff <= 2 && botSettings.notifications) {
        // Check if we haven't already notified for this meeting
        const notifiedKey = `notified_${meeting.id}_${meeting.date}`;
        const notified = await chrome.storage.session.get(notifiedKey);
        
        if (!notified[notifiedKey]) {
          await chrome.storage.session.set({ [notifiedKey]: true });
          showNotification(
            'Meeting Starting Soon',
            `${meeting.title} starts in ${Math.ceil(timeDiff)} minute(s)`
          );
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error checking scheduled meetings:', error);
    return { success: false, error: error.message };
  }
}

// Log bot activity
async function logBotActivity(title, description, type = 'join') {
  try {
    const result = await chrome.storage.local.get('botActivity');
    const activity = result.botActivity || [];
    
    activity.unshift({
      id: Date.now().toString(),
      title,
      description,
      type,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 50 activities
    if (activity.length > 50) {
      activity.length = 50;
    }
    
    await chrome.storage.local.set({ botActivity: activity });
  } catch (error) {
    console.error('Error logging bot activity:', error);
  }
}

// Show notification
function showNotification(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `VividAI: ${title}`,
      message: message,
      priority: 2
    });
  } catch (error) {
    console.error('Error showing notification:', error);
  }
}

// Broadcast message to all extension pages
async function broadcastMessage(message) {
  try {
    // Send to all extension pages (popup, bot page, options)
    const views = chrome.extension.getViews ? chrome.extension.getViews() : [];
    views.forEach(view => {
      try {
        view.postMessage(message, '*');
      } catch (e) {}
    });
    
    // Also try runtime messaging
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (error) {
    // Ignore errors when no listeners
  }
}

// Clean up detected meetings when tabs close
chrome.tabs.onRemoved.addListener(async (tabId) => {
  detectedMeetings.delete(tabId);
  
  // If this was the active meeting tab, handle meeting exit
  if (activeMeetingTabId === tabId) {
    await handleMeetingExit(tabId, 'Tab closed');
  }
});

// Handle when a tab navigates away from a meeting
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // If URL changed and this was a meeting tab
  if (changeInfo.url && detectedMeetings.has(tabId)) {
    const platform = detectMeetingPlatform(changeInfo.url);
    if (!platform) {
      // No longer in a meeting
      detectedMeetings.delete(tabId);
      if (activeMeetingTabId === tabId) {
        await handleMeetingExit(tabId, 'Left meeting');
      }
    }
  }
});

// Handle meeting exit - stop recording and update bot status
async function handleMeetingExit(tabId, reason) {
  console.log('Bot: Meeting exited -', reason);
  activeMeetingTabId = null;
  
  // Check if recording is in progress
  const state = await chrome.storage.session.get(['isRecording', 'currentMeeting']);
  
  if (state.isRecording) {
    // Find and close the recorder window to stop recording
    try {
      const recorderUrl = chrome.runtime.getURL('recorder/recorder.html');
      const windows = await chrome.windows.getAll({ populate: true });
      
      for (const win of windows) {
        for (const recorderTab of win.tabs || []) {
          if (recorderTab.url && recorderTab.url.startsWith(recorderUrl)) {
            // Send stop message to recorder
            try {
              await chrome.tabs.sendMessage(recorderTab.id, { action: 'stopFromBot' });
            } catch (e) {
              // If can't send message, close the window
              await chrome.windows.remove(win.id);
            }
            break;
          }
        }
      }
    } catch (error) {
      console.error('Error stopping recording on meeting exit:', error);
    }
  }
  
  // Clear recording state
  await chrome.storage.session.set({ 
    isRecording: false, 
    currentMeeting: null 
  });
  
  // Update badge
  updateBadge(false, false);
  
  // Log activity
  logBotActivity('Meeting ended', reason, 'join');
  
  // Notify
  broadcastMessage({
    action: 'meetingEnded',
    reason
  });
  
  if (botSettings.notifications) {
    showNotification('Meeting Ended', 'Recording stopped');
  }
}

// Initialize bot on service worker start
initializeBot();
