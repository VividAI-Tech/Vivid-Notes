// VividAI Bot - Intelligent Meeting Assistant
class VividBot {
  constructor() {
    this.botEnabled = false;
    this.settings = {
      autoRecord: false,
      notifications: true,
      autoTranscribe: true,
      autoSummarize: true
    };
    this.scheduledMeetings = [];
    this.activityLog = [];
    
    this.initElements();
    this.initEventListeners();
    this.loadSettings();
    this.loadMeetings();
    this.loadActivity();
    this.checkBotStatus();
  }

  initElements() {
    // Status elements
    this.statusCard = document.getElementById('statusCard');
    this.statusIndicator = document.getElementById('statusIndicator');
    this.statusDetails = document.getElementById('statusDetails');
    
    // Buttons
    this.toggleBotBtn = document.getElementById('toggleBotBtn');
    this.addMeetingBtn = document.getElementById('addMeetingBtn');
    this.settingsBtn = document.getElementById('settingsBtn');
    
    // Toggles
    this.autoRecordToggle = document.getElementById('autoRecordToggle');
    this.notificationsToggle = document.getElementById('notificationsToggle');
    this.autoTranscribeToggle = document.getElementById('autoTranscribeToggle');
    this.autoSummarizeToggle = document.getElementById('autoSummarizeToggle');
    
    // Lists
    this.meetingsList = document.getElementById('meetingsList');
    this.activityList = document.getElementById('activityList');
    
    // Modal
    this.modal = document.getElementById('addMeetingModal');
    this.closeModalBtn = document.getElementById('closeModalBtn');
    this.cancelMeetingBtn = document.getElementById('cancelMeetingBtn');
    this.saveMeetingBtn = document.getElementById('saveMeetingBtn');
    
    // Form inputs
    this.meetingTitle = document.getElementById('meetingTitle');
    this.meetingUrl = document.getElementById('meetingUrl');
    this.meetingDate = document.getElementById('meetingDate');
    this.meetingTime = document.getElementById('meetingTime');
    this.meetingRecurring = document.getElementById('meetingRecurring');
    this.recurringOptions = document.getElementById('recurringOptions');
    this.recurringFrequency = document.getElementById('recurringFrequency');
    
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    this.meetingDate.value = today;
    this.meetingDate.min = today;
  }

  initEventListeners() {
    // Toggle bot
    this.toggleBotBtn.addEventListener('click', () => this.toggleBot());
    
    // Settings button
    this.settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    
    // Add meeting
    this.addMeetingBtn.addEventListener('click', () => this.openModal());
    
    // Modal controls
    this.closeModalBtn.addEventListener('click', () => this.closeModal());
    this.cancelMeetingBtn.addEventListener('click', () => this.closeModal());
    this.saveMeetingBtn.addEventListener('click', () => this.saveMeeting());
    this.modal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeModal());
    
    // Recurring toggle
    this.meetingRecurring.addEventListener('change', () => {
      this.recurringOptions.style.display = this.meetingRecurring.checked ? 'block' : 'none';
    });
    
    // Settings toggles
    this.autoRecordToggle.addEventListener('change', () => this.updateSetting('autoRecord', this.autoRecordToggle.checked));
    this.notificationsToggle.addEventListener('change', () => this.updateSetting('notifications', this.notificationsToggle.checked));
    this.autoTranscribeToggle.addEventListener('change', () => this.updateSetting('autoTranscribe', this.autoTranscribeToggle.checked));
    this.autoSummarizeToggle.addEventListener('change', () => this.updateSetting('autoSummarize', this.autoSummarizeToggle.checked));
    
    // Listen for bot status updates
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message);
    });
    
    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes.botEnabled) {
          this.botEnabled = changes.botEnabled.newValue;
          this.updateBotUI();
        }
        if (changes.botActivity) {
          this.activityLog = changes.botActivity.newValue || [];
          this.renderActivity();
        }
      }
    });
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get([
        'botEnabled',
        'botSettings'
      ]);
      
      this.botEnabled = result.botEnabled || false;
      this.settings = result.botSettings || this.settings;
      
      // Update toggles
      this.autoRecordToggle.checked = this.settings.autoRecord;
      this.notificationsToggle.checked = this.settings.notifications;
      this.autoTranscribeToggle.checked = this.settings.autoTranscribe;
      this.autoSummarizeToggle.checked = this.settings.autoSummarize;
      
      this.updateBotUI();
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async loadMeetings() {
    try {
      const result = await chrome.storage.local.get('scheduledMeetings');
      this.scheduledMeetings = result.scheduledMeetings || [];
      this.renderMeetings();
    } catch (error) {
      console.error('Error loading meetings:', error);
    }
  }

  async loadActivity() {
    try {
      const result = await chrome.storage.local.get('botActivity');
      this.activityLog = result.botActivity || [];
      this.renderActivity();
    } catch (error) {
      console.error('Error loading activity:', error);
    }
  }

  async checkBotStatus() {
    try {
      // Check if any recording is in progress
      const state = await chrome.storage.session.get(['isRecording', 'currentMeeting']);
      
      if (state.isRecording) {
        this.updateStatus('recording', 'Recording in progress', state.currentMeeting || 'Active meeting');
      } else if (this.botEnabled) {
        this.updateStatus('active', 'Bot Active', 'Monitoring for meetings...');
      } else {
        this.updateStatus('idle', 'Bot Idle', 'Ready to join meetings automatically');
      }
    } catch (error) {
      console.error('Error checking bot status:', error);
    }
  }

  async toggleBot() {
    this.botEnabled = !this.botEnabled;
    await chrome.storage.local.set({ botEnabled: this.botEnabled });
    
    // Send message to background
    chrome.runtime.sendMessage({
      action: 'setBotEnabled',
      enabled: this.botEnabled
    });
    
    if (this.botEnabled && this.settings.notifications) {
      this.logActivity('Bot enabled', 'VividAI bot is now monitoring for meetings', 'join');
    }
    
    this.updateBotUI();
  }

  updateBotUI() {
    if (this.botEnabled) {
      this.toggleBotBtn.classList.add('active');
      this.toggleBotBtn.querySelector('span').textContent = 'Disable Bot';
      this.toggleBotBtn.querySelector('svg polygon')?.setAttribute('points', '6 4 6 20');
      this.updateStatus('active', 'Bot Active', 'Monitoring for meetings...');
    } else {
      this.toggleBotBtn.classList.remove('active');
      this.toggleBotBtn.querySelector('span').textContent = 'Enable Bot';
      this.updateStatus('idle', 'Bot Idle', 'Ready to join meetings automatically');
    }
  }

  updateStatus(status, text, details) {
    const statusDot = this.statusIndicator.querySelector('.status-dot');
    const statusText = this.statusIndicator.querySelector('.status-text');
    
    statusDot.className = 'status-dot ' + status;
    statusText.textContent = text;
    this.statusDetails.querySelector('p').textContent = details;
    
    this.statusCard.className = 'status-card ' + status;
  }

  async updateSetting(key, value) {
    this.settings[key] = value;
    await chrome.storage.local.set({ botSettings: this.settings });
    
    // Notify background script
    chrome.runtime.sendMessage({
      action: 'updateBotSettings',
      settings: this.settings
    });
  }

  openModal() {
    this.modal.classList.add('active');
    this.meetingTitle.focus();
  }

  closeModal() {
    this.modal.classList.remove('active');
    this.clearForm();
  }

  clearForm() {
    this.meetingTitle.value = '';
    this.meetingUrl.value = '';
    this.meetingDate.value = new Date().toISOString().split('T')[0];
    this.meetingTime.value = '';
    this.meetingRecurring.checked = false;
    this.recurringOptions.style.display = 'none';
  }

  async saveMeeting() {
    const title = this.meetingTitle.value.trim();
    const url = this.meetingUrl.value.trim();
    const date = this.meetingDate.value;
    const time = this.meetingTime.value;
    
    if (!title || !url) {
      alert('Please enter a meeting title and URL');
      return;
    }
    
    // Validate URL
    const platform = this.detectPlatform(url);
    if (!platform) {
      alert('Please enter a valid Google Meet, Zoom, Teams, Webex, or WhatsApp meeting URL');
      return;
    }
    
    const meeting = {
      id: Date.now().toString(),
      title,
      url,
      platform,
      date: date || null,
      time: time || null,
      recurring: this.meetingRecurring.checked,
      frequency: this.meetingRecurring.checked ? this.recurringFrequency.value : null,
      createdAt: new Date().toISOString()
    };
    
    this.scheduledMeetings.unshift(meeting);
    await chrome.storage.local.set({ scheduledMeetings: this.scheduledMeetings });
    
    this.logActivity(`Meeting scheduled: ${title}`, `${platform} - ${date || 'Any time'}`, 'join');
    
    this.renderMeetings();
    this.closeModal();
  }

  detectPlatform(url) {
    if (url.includes('meet.google.com')) return 'Google Meet';
    if (url.includes('zoom.us')) return 'Zoom';
    if (url.includes('teams.microsoft.com')) return 'MS Teams';
    if (url.includes('webex.com')) return 'Webex';
    if (url.includes('web.whatsapp.com')) return 'WhatsApp';
    return null;
  }

  renderMeetings() {
    if (this.scheduledMeetings.length === 0) {
      this.meetingsList.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <p>No scheduled meetings</p>
          <span>Add a meeting link to have the bot auto-record</span>
        </div>
      `;
      return;
    }
    
    const html = this.scheduledMeetings.map(meeting => {
      const dateStr = meeting.date 
        ? new Date(meeting.date + 'T' + (meeting.time || '00:00')).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : 'Any time';
      
      const recurringBadge = meeting.recurring 
        ? `<span class="meeting-platform">${meeting.frequency}</span>` 
        : '';
      
      return `
        <div class="meeting-item" data-id="${meeting.id}">
          <div class="meeting-info">
            <div class="meeting-title">${this.escapeHtml(meeting.title)}</div>
            <div class="meeting-meta">
              <span class="meeting-platform">${meeting.platform}</span>
              <span>${dateStr}</span>
              ${recurringBadge}
            </div>
          </div>
          <div class="meeting-actions">
            <button class="join-btn" title="Join Now" data-url="${this.escapeHtml(meeting.url)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
            <button class="delete" title="Delete" data-id="${meeting.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    this.meetingsList.innerHTML = html;
    
    // Add event listeners
    this.meetingsList.querySelectorAll('.join-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        chrome.tabs.create({ url });
      });
    });
    
    this.meetingsList.querySelectorAll('.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteMeeting(btn.dataset.id);
      });
    });
  }

  async deleteMeeting(id) {
    this.scheduledMeetings = this.scheduledMeetings.filter(m => m.id !== id);
    await chrome.storage.local.set({ scheduledMeetings: this.scheduledMeetings });
    this.renderMeetings();
  }

  async logActivity(title, description, type = 'join') {
    const activity = {
      id: Date.now().toString(),
      title,
      description,
      type,
      timestamp: new Date().toISOString()
    };
    
    this.activityLog.unshift(activity);
    
    // Keep only last 50 activities
    if (this.activityLog.length > 50) {
      this.activityLog = this.activityLog.slice(0, 50);
    }
    
    await chrome.storage.local.set({ botActivity: this.activityLog });
    this.renderActivity();
  }

  renderActivity() {
    if (this.activityLog.length === 0) {
      this.activityList.innerHTML = `
        <div class="empty-state small">
          <p>No recent activity</p>
        </div>
      `;
      return;
    }
    
    const html = this.activityLog.slice(0, 10).map(activity => {
      const time = new Date(activity.timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      return `
        <div class="activity-item">
          <div class="activity-icon ${activity.type}">
            ${this.getActivityIcon(activity.type)}
          </div>
          <div class="activity-content">
            <strong>${this.escapeHtml(activity.title)}</strong>
            <span>${this.escapeHtml(activity.description)} • ${time}</span>
          </div>
        </div>
      `;
    }).join('');
    
    this.activityList.innerHTML = html;
  }

  getActivityIcon(type) {
    switch (type) {
      case 'join':
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>';
      case 'record':
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>';
      case 'transcribe':
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
      default:
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';
    }
  }

  handleMessage(message) {
    switch (message.action) {
      case 'botStatusUpdate':
        this.updateStatus(message.status, message.text, message.details);
        break;
      case 'meetingDetected':
        if (this.botEnabled && this.settings.autoRecord) {
          this.logActivity('Meeting detected', message.platform || 'Unknown platform', 'join');
        }
        break;
      case 'recordingStarted':
        this.logActivity('Recording started', message.meeting || 'Active meeting', 'record');
        this.updateStatus('recording', 'Recording', message.meeting || 'Active meeting');
        break;
      case 'recordingComplete':
        this.logActivity('Recording complete', message.duration || 'Unknown duration', 'record');
        if (this.botEnabled) {
          this.updateStatus('active', 'Bot Active', 'Monitoring for meetings...');
        } else {
          this.updateStatus('idle', 'Bot Idle', 'Ready to join meetings automatically');
        }
        break;
      case 'meetingEnded':
        this.logActivity('Meeting ended', message.reason || 'User left', 'join');
        if (this.botEnabled) {
          this.updateStatus('active', 'Bot Active', 'Monitoring for meetings...');
        } else {
          this.updateStatus('idle', 'Bot Idle', 'Ready to join meetings automatically');
        }
        break;
      case 'transcriptionComplete':
        this.logActivity('Transcription complete', message.meeting || 'Recent recording', 'transcribe');
        break;
    }
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize bot when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new VividBot();
});
