// FlyRec Content Script
// Detects meeting platforms and monitors meeting status

class MeetingDetector {
  constructor() {
    this.platform = this.detectPlatform();
    this.isMeetingActive = false;
    this.participants = [];
    
    if (this.platform) {
      this.init();
    }
  }
  
  detectPlatform() {
    const url = window.location.href;
    
    // Google Meet - only detect if on a meeting page (has meeting code)
    // Meeting codes can contain letters and numbers: xxx-xxxx-xxx
    if (url.includes('meet.google.com/')) {
      const meetPattern = /meet\.google\.com\/([a-z0-9]{3,4}-[a-z0-9]{4}-[a-z0-9]{3,4})/i;
      if (meetPattern.test(url)) {
        return {
          name: 'Google Meet',
          type: 'google-meet',
          selectors: {
            participants: '[data-participant-id]',
            speakerName: '[data-self-name]',
            meetingTitle: '[data-meeting-title]',
            muteButton: '[data-is-muted]',
            videoContainer: '[data-requested-participant-id]'
          }
        };
      }
    }
    
    if (url.includes('zoom.us')) {
      return {
        name: 'Zoom',
        type: 'zoom',
        selectors: {
          participants: '.participants-item',
          speakerName: '.participants-item__display-name',
          meetingTitle: '.meeting-title'
        }
      };
    }
    
    if (url.includes('webex.com')) {
      return {
        name: 'Webex',
        type: 'webex',
        selectors: {
          participants: '[data-test="participant-list-item"]',
          speakerName: '[data-test="participant-name"]'
        }
      };
    }
    
    if (url.includes('teams.microsoft.com')) {
      return {
        name: 'Microsoft Teams',
        type: 'teams',
        selectors: {
          participants: '[data-tid="roster-participant"]',
          speakerName: '[data-tid="participant-name"]'
        }
      };
    }
    
    if (url.includes('web.whatsapp.com')) {
      return {
        name: 'WhatsApp',
        type: 'whatsapp',
        selectors: {
          callActive: '[data-testid="call"]',
          participants: '[data-testid="group-participants"]'
        }
      };
    }
    
    return null;
  }
  
  init() {
    // Notify background that we're on a meeting platform
    this.notifyPlatformDetected();
    
    // Start monitoring for meeting activity
    this.startMonitoring();
    
    // Floating indicator removed - not needed
  }
  
  notifyPlatformDetected() {
    chrome.runtime.sendMessage({
      action: 'platformDetected',
      platform: this.platform
    });
  }
  
  startMonitoring() {
    // Use MutationObserver to watch for changes
    const observer = new MutationObserver((mutations) => {
      this.checkMeetingStatus();
      this.updateParticipants();
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });
    
    // Initial check
    this.checkMeetingStatus();
  }
  
  checkMeetingStatus() {
    let isActive = false;
    
    switch (this.platform.type) {
      case 'google-meet':
        // Check if we're in an active meeting:
        // 1. Must have meeting code in URL (xxx-xxxx-xxx format with letters and numbers)
        // 2. Must have video elements (people in the call)
        const hasVideoElements = document.querySelectorAll('video').length > 0;
        const meetPattern = /meet\.google\.com\/([a-z0-9]{3,4}-[a-z0-9]{4}-[a-z0-9]{3,4})/i;
        const hasMeetingCode = meetPattern.test(window.location.href);
        const hasCallControls = document.querySelector('[data-call-id]') !== null || 
                                document.querySelector('[aria-label*="Leave"]') !== null ||
                                document.querySelector('[aria-label*="leave"]') !== null ||
                                document.querySelector('[jsname="CQylAd"]') !== null;  // Leave button
        isActive = hasMeetingCode && (hasVideoElements || hasCallControls);
        break;
        
      case 'zoom':
        isActive = document.querySelector('.meeting-client') !== null || 
                   document.querySelector('.meeting-app') !== null;
        break;
        
      case 'webex':
        isActive = document.querySelector('[data-test="meeting-container"]') !== null;
        break;
        
      case 'teams':
        isActive = document.querySelector('[data-tid="calling-stage"]') !== null;
        break;
        
      case 'whatsapp':
        isActive = document.querySelector('[data-testid="call"]') !== null;
        break;
    }
    
    if (isActive !== this.isMeetingActive) {
      this.isMeetingActive = isActive;
      this.notifyMeetingStatus();
    }
  }
  
  updateParticipants() {
    if (!this.platform.selectors.participants) return;
    
    const participantElements = document.querySelectorAll(this.platform.selectors.participants);
    const participants = [];
    
    participantElements.forEach(el => {
      const nameEl = el.querySelector(this.platform.selectors.speakerName);
      if (nameEl) {
        participants.push(nameEl.textContent.trim());
      }
    });
    
    if (JSON.stringify(participants) !== JSON.stringify(this.participants)) {
      this.participants = participants;
      chrome.runtime.sendMessage({
        action: 'participantsUpdate',
        participants: this.participants
      });
    }
  }
  
  notifyMeetingStatus() {
    chrome.runtime.sendMessage({
      action: 'meetingStatus',
      isActive: this.isMeetingActive,
      platform: this.platform.name
    });
    
    // Notify bot about meeting status change
    if (this.isMeetingActive) {
      chrome.runtime.sendMessage({
        action: 'botMeetingActive',
        platform: this.platform.name,
        url: window.location.href,
        title: document.title
      });
    } else {
      // Meeting ended - notify bot
      chrome.runtime.sendMessage({
        action: 'botMeetingEnded',
        platform: this.platform.name,
        url: window.location.href
      });
    }
  }
  
  // Floating indicator removed
  
  // Extract speaker from active speaker indicators
  getActiveSpeaker() {
    switch (this.platform.type) {
      case 'google-meet':
        // Google Meet shows a border around the active speaker
        const activeSpeaker = document.querySelector('[data-requested-participant-id].speaking');
        if (activeSpeaker) {
          const nameEl = activeSpeaker.querySelector('[data-self-name]');
          return nameEl?.textContent;
        }
        break;
        
      case 'zoom':
        const speakingIndicator = document.querySelector('.participants-item.speaking');
        if (speakingIndicator) {
          return speakingIndicator.querySelector('.participants-item__display-name')?.textContent;
        }
        break;
    }
    
    return null;
  }
}

// Initialize detector when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new MeetingDetector());
} else {
  new MeetingDetector();
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getParticipants') {
    const detector = window.flyrecDetector;
    if (detector) {
      sendResponse({ participants: detector.participants });
    }
  }
  
  if (message.action === 'getActiveSpeaker') {
    const detector = window.flyrecDetector;
    if (detector) {
      sendResponse({ speaker: detector.getActiveSpeaker() });
    }
  }
});
