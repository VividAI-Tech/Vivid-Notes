// VividAI Popup Script
class FlyRecPopup {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.timerInterval = null;
    this.elapsedSeconds = 0;
    this.startTime = null;
    this.transcript = [];
    this.summary = null;
    this.currentPlatform = null;
    this.totalCost = 0;
    
    // Recording related
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.audioChunks = [];
    
    // History pagination and filtering
    this.allHistory = [];
    this.filteredHistory = [];
    this.currentPage = 1;
    this.itemsPerPage = 10;
    this.searchQuery = '';
    this.dateFilter = 'all';
    this.dateFrom = null;
    this.dateTo = null;
    
    this.initElements();
    this.initEventListeners();
    this.checkApiKey();
    this.checkCurrentPlatform();
    this.loadState();
    this.loadHistory();
    this.listenForStorageChanges();
    this.checkBotStatus();
  }
  
  listenForStorageChanges() {
    // Listen for storage changes to update popup when recording completes
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'session') {
        console.log('Storage changed:', changes);
        
        // If recording state changed to false, reload everything
        if (changes.isRecording && changes.isRecording.newValue === false) {
          this.isRecording = false;
          this.isPaused = false;
          this.stopTimer();
          this.updateUIForRecording();
          this.checkBotStatus(); // Update bot status dot
        }
        
        // If recording started, update bot status
        if (changes.isRecording && changes.isRecording.newValue === true) {
          this.checkBotStatus();
        }
        
        // If transcript was updated, reload it
        if (changes.transcript && changes.transcript.newValue) {
          this.transcript = changes.transcript.newValue;
          this.renderTranscript();
        }
        
        // If summary was updated, reload it
        if (changes.summary && changes.summary.newValue) {
          this.summary = changes.summary.newValue;
          this.renderSummary();
        }
        
        // If cost was updated, display it
        if (changes.totalCost && changes.totalCost.newValue) {
          this.totalCost = changes.totalCost.newValue;
          this.displayCost(this.totalCost);
        }
        
        // If elapsed seconds updated
        if (changes.elapsedSeconds && changes.elapsedSeconds.newValue) {
          this.elapsedSeconds = changes.elapsedSeconds.newValue;
          this.updateTimer();
        }
        
        // Enable export if we have transcript
        if (this.transcript && this.transcript.length > 0) {
          this.exportBtn.disabled = false;
          this.copyBtn.disabled = false;
        }
        
        // Reload history if recording just completed
        if (changes.isRecording && changes.isRecording.newValue === false) {
          this.loadHistory();
        }
      }
    });
  }

  initElements() {
    // Buttons
    this.recordBtn = document.getElementById('recordBtn');
    this.pauseBtn = document.getElementById('pauseBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.expandBtn = document.getElementById('expandBtn');
    this.botBtn = document.getElementById('botBtn');
    this.botStatusDot = document.getElementById('botStatusDot');
    this.exportBtn = document.getElementById('exportBtn');
    this.copyBtn = document.getElementById('copyBtn');
    
    // Display elements
    this.timerDisplay = document.getElementById('timerDisplay');
    this.platformBanner = document.getElementById('platformBanner');
    this.platformText = document.getElementById('platformText');
    this.apiWarning = document.getElementById('apiWarning');
    this.processingOverlay = document.getElementById('processingOverlay');
    this.processingText = document.getElementById('processingText');
    
    // Cost display
    this.costDisplay = document.getElementById('costDisplay');
    this.costValue = document.getElementById('costValue');
    this.backHomeBtn = document.getElementById('backHomeBtn');
    
    // Containers
    this.transcriptContainer = document.getElementById('transcriptContainer');
    this.summaryContainer = document.getElementById('summaryContainer');
    this.historyContainer = document.getElementById('historyContainer');
    
    // Language selector
    this.displayLanguage = document.getElementById('displayLanguage');
    
    // Tab buttons
    this.tabButtons = document.querySelectorAll('.tab-btn');
    this.tabPanes = document.querySelectorAll('.tab-pane');
    
    // History filters and pagination
    this.historySearch = document.getElementById('historySearch');
    this.dateFilterSelect = document.getElementById('dateFilter');
    this.dateRangePicker = document.getElementById('dateRangePicker');
    this.dateFromInput = document.getElementById('dateFrom');
    this.dateToInput = document.getElementById('dateTo');
    this.pagination = document.getElementById('pagination');
    this.prevPageBtn = document.getElementById('prevPage');
    this.nextPageBtn = document.getElementById('nextPage');
    this.pageInfo = document.getElementById('pageInfo');
  }

  initEventListeners() {
    // Control buttons
    this.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    
    // Settings
    this.settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    
    // Bot page
    this.botBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('bot/bot.html') });
    });
    
    // API key link
    document.getElementById('setApiKey').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    
    // Tabs
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });
    
    // Language selector
    this.displayLanguage.addEventListener('change', () => this.renderTranscript());
    
    // Export and copy
    this.exportBtn.addEventListener('click', () => this.exportData());
    this.copyBtn.addEventListener('click', () => this.copyToClipboard());
    
    // Back to home
    this.backHomeBtn.addEventListener('click', () => this.resetToHome());
    
    // Open in new tab
    this.expandBtn.addEventListener('click', () => this.openInNewTab());
    
    // History search
    this.historySearch.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.currentPage = 1;
      this.applyFilters();
    });
    
    // Date filter
    this.dateFilterSelect.addEventListener('change', (e) => {
      this.dateFilter = e.target.value;
      this.currentPage = 1;
      if (this.dateFilter === 'custom') {
        this.dateRangePicker.style.display = 'flex';
      } else {
        this.dateRangePicker.style.display = 'none';
      }
      this.applyFilters();
    });
    
    // Custom date range
    this.dateFromInput.addEventListener('change', () => {
      this.dateFrom = this.dateFromInput.value ? new Date(this.dateFromInput.value) : null;
      this.applyFilters();
    });
    
    this.dateToInput.addEventListener('change', () => {
      this.dateTo = this.dateToInput.value ? new Date(this.dateToInput.value + 'T23:59:59') : null;
      this.applyFilters();
    });
    
    // Pagination
    this.prevPageBtn.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.renderHistory();
      }
    });
    
    this.nextPageBtn.addEventListener('click', () => {
      const totalPages = Math.ceil(this.filteredHistory.length / this.itemsPerPage);
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.renderHistory();
      }
    });
    
    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message);
    });
  }

  async checkApiKey() {
    const result = await chrome.storage.local.get('openai_api_key');
    if (!result.openai_api_key) {
      this.apiWarning.style.display = 'flex';
      this.recordBtn.disabled = true;
    } else {
      this.apiWarning.style.display = 'none';
      this.recordBtn.disabled = false;
    }
  }

  async checkCurrentPlatform() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const platform = this.detectPlatform(tab.url);
        if (platform) {
          this.currentPlatform = platform;
          this.platformBanner.classList.add('detected');
          this.platformText.textContent = `${platform.name} meeting detected`;
        }
      }
    } catch (error) {
      console.error('Error checking platform:', error);
    }
  }

  detectPlatform(url) {
    const platforms = [
      { name: 'Google Meet', pattern: /meet\.google\.com/ },
      { name: 'Zoom', pattern: /zoom\.us/ },
      { name: 'Webex', pattern: /webex\.com/ },
      { name: 'WhatsApp', pattern: /web\.whatsapp\.com/ },
      { name: 'Microsoft Teams', pattern: /teams\.microsoft\.com/ }
    ];
    
    for (const platform of platforms) {
      if (platform.pattern.test(url)) {
        return platform;
      }
    }
    return null;
  }

  async loadState() {
    try {
      const state = await chrome.storage.session.get([
        'isRecording', 'isPaused', 'elapsedSeconds', 'startTime',
        'transcript', 'summary', 'totalCost'
      ]);
      
      console.log('Loading state:', state);
      
      // First check recording state
      // Only consider recording if there's actually a recorder window open
      let recorderOpen = false;
      try {
        const recorderUrl = chrome.runtime.getURL('recorder/recorder.html');
        const windows = await chrome.windows.getAll({ populate: true });
        for (const win of windows) {
          for (const tab of win.tabs || []) {
            if (tab.url === recorderUrl) {
              recorderOpen = true;
              break;
            }
          }
        }
      } catch (e) {
        console.log('Could not check windows');
      }
      
      // If recorder window is not open, recording has stopped
      if (!recorderOpen && state.isRecording) {
        // Clear the recording state
        await chrome.storage.session.set({ isRecording: false, startTime: null });
        state.isRecording = false;
      }
      
      // Load transcript/summary data (if any)
      const hasTranscript = state.transcript && (Array.isArray(state.transcript) ? state.transcript.length > 0 : state.transcript);
      if (hasTranscript) {
        this.transcript = state.transcript;
        this.summary = state.summary;
        this.totalCost = state.totalCost || 0;
        this.elapsedSeconds = state.elapsedSeconds || 0;
        
        this.renderTranscript();
        this.renderSummary();
        this.updateTimer();
        
        if (this.totalCost > 0) {
          this.displayCost(this.totalCost);
        }
        
        this.exportBtn.disabled = false;
        this.copyBtn.disabled = false;
      }
      
      // Check if recording is actually in progress (recorder window is open)
      if (state.isRecording && recorderOpen) {
        this.isRecording = true;
        this.isPaused = state.isPaused || false;
        this.startTime = state.startTime;
        
        // Calculate actual elapsed time based on start time
        if (this.startTime && !this.isPaused) {
          this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        } else {
          this.elapsedSeconds = state.elapsedSeconds || 0;
        }
        
        this.updateUIForRecording();
        this.updateTimer();
        
        if (!this.isPaused) {
          this.startTimer();
        }
      } else {
        // Not recording - make sure UI reflects this
        this.isRecording = false;
        this.isPaused = false;
        this.updateUIForRecording();
      }
    } catch (error) {
      console.error('Error loading state:', error);
    }
  }

  async toggleRecording() {
    if (!this.isRecording) {
      await this.startRecording();
    } else {
      await this.stopRecording();
    }
  }

  async startRecording() {
    try {
      // Open dedicated recorder window for persistent recording
      const recorderUrl = chrome.runtime.getURL('recorder/recorder.html');
      
      // Check if recorder window already exists (use startsWith to match with query params)
      const windows = await chrome.windows.getAll({ populate: true });
      let recorderWindow = null;
      
      for (const win of windows) {
        for (const tab of win.tabs || []) {
          if (tab.url && tab.url.startsWith(recorderUrl)) {
            recorderWindow = win;
            break;
          }
        }
      }
      
      if (recorderWindow) {
        // Focus existing recorder window
        await chrome.windows.update(recorderWindow.id, { focused: true });
      } else {
        // Create new recorder window
        await chrome.windows.create({
          url: recorderUrl,
          type: 'popup',
          width: 450,
          height: 700,
          left: 100,
          top: 100
        });
      }
      
      // Close the popup after opening recorder
      window.close();
      
    } catch (error) {
      console.error('Error opening recorder:', error);
      alert('Failed to open recorder window: ' + error.message);
    }
  }
  
  getSupportedMimeType() {
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

  updateUIForRecording() {
    this.recordBtn.classList.toggle('recording', this.isRecording);
    this.recordBtn.querySelector('span').textContent = this.isRecording ? 'Recording' : 'Record';
    this.pauseBtn.disabled = !this.isRecording;
    this.stopBtn.disabled = !this.isRecording;
    this.timerDisplay.classList.toggle('recording', this.isRecording && !this.isPaused);
    
    if (this.isPaused) {
      this.pauseBtn.classList.add('paused');
      this.pauseBtn.querySelector('span').textContent = 'Resume';
    } else {
      this.pauseBtn.classList.remove('paused');
      this.pauseBtn.querySelector('span').textContent = 'Pause';
    }
  }

  async togglePause() {
    if (!this.mediaRecorder) return;
    
    this.isPaused = !this.isPaused;
    
    if (this.isPaused) {
      this.mediaRecorder.pause();
      this.stopTimer();
    } else {
      this.mediaRecorder.resume();
      this.startTimer();
    }
    
    this.updateUIForRecording();
    await this.saveState();
  }

  async stopRecording() {
    try {
      // Find and focus the recorder window if it exists
      const recorderUrl = chrome.runtime.getURL('recorder/recorder.html');
      const windows = await chrome.windows.getAll({ populate: true });
      
      for (const win of windows) {
        for (const tab of win.tabs || []) {
          if (tab.url === recorderUrl) {
            // Focus the recorder window so user can stop there
            await chrome.windows.update(win.id, { focused: true });
            return;
          }
        }
      }
      
      // If no recorder window, just update state
      this.isRecording = false;
      this.isPaused = false;
      this.stopTimer();
      this.updateUIForRecording();
      await this.saveState();
      
    } catch (error) {
      console.error('Error stopping recording:', error);
    }
  }
  
  async processRecordingData() {
    try {
      if (this.audioChunks.length === 0) {
        this.hideProcessing();
        alert('No audio was recorded.');
        return;
      }
      
      // Combine audio chunks into a blob
      const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
      const audioBlob = new Blob(this.audioChunks, { type: mimeType });
      
      // Convert to base64 for sending to background
      const base64Audio = await this.blobToBase64(audioBlob);
      
      // Send to background for transcription
      this.showProcessing('Transcribing audio with AI...');
      
      const transcriptResponse = await chrome.runtime.sendMessage({
        action: 'transcribeAudio',
        audioData: base64Audio,
        audioDuration: this.elapsedSeconds
      });
      
      let transcriptCost = 0;
      let summaryCost = 0;
      
      if (transcriptResponse.success) {
        this.transcript = transcriptResponse.transcript;
        transcriptCost = transcriptResponse.cost?.total || 0;
        this.renderTranscript();
        
        // Generate summary
        this.showProcessing('Generating summary...');
        
        const summaryResponse = await chrome.runtime.sendMessage({
          action: 'generateSummary',
          transcript: this.transcript
        });
        
        if (summaryResponse.success) {
          this.summary = summaryResponse.summary;
          summaryCost = summaryResponse.cost || 0;
          this.renderSummary();
        }
        
        // Calculate and display total cost
        this.totalCost = transcriptCost + summaryCost;
        this.displayCost(this.totalCost);
        
        // Save to history
        await this.saveToHistory({
          platform: this.currentPlatform?.name || 'Unknown',
          duration: this.elapsedSeconds,
          transcript: this.transcript,
          summary: this.summary,
          generatedTitle: summaryResponse.title,
          totalCost: this.totalCost,
          language: transcriptResponse.language
        });
        
        // Enable export buttons
        this.exportBtn.disabled = false;
        this.copyBtn.disabled = false;
        
        await this.saveState();
        
        // Reload history
        await this.loadHistory();
      } else {
        alert(transcriptResponse.error || 'Failed to transcribe audio');
      }
      
      this.hideProcessing();
      
      // Cleanup
      this.audioChunks = [];
      this.mediaRecorder = null;
      this.mediaStream = null;
      
    } catch (error) {
      console.error('Error processing recording:', error);
      this.hideProcessing();
      alert('Failed to process recording. Please check your API key.');
    }
  }
  
  displayCost(cost) {
    this.costDisplay.style.display = 'flex';
    this.costValue.textContent = `$${cost.toFixed(4)}`;
  }
  
  resetToHome() {
    // Clear current recording data
    this.transcript = [];
    this.summary = null;
    this.totalCost = 0;
    this.elapsedSeconds = 0;
    
    // Reset timer display
    this.timerDisplay.textContent = '00:00:00';
    
    // Hide cost display
    this.costDisplay.style.display = 'none';
    
    // Reset UI elements
    this.renderTranscript();
    this.renderSummary();
    
    // Disable export buttons
    this.exportBtn.disabled = true;
    this.copyBtn.disabled = true;
    
    // Clear session storage for viewed recording
    chrome.storage.session.set({
      transcript: [],
      summary: null,
      totalCost: 0,
      elapsedSeconds: 0
    });
    
    // Switch to transcript tab
    this.switchTab('transcript');
  }
  
  async saveToHistory(recording) {
    try {
      await chrome.runtime.sendMessage({
        action: 'saveRecording',
        recording: recording
      });
    } catch (error) {
      console.error('Error saving to history:', error);
    }
  }
  
  async loadHistory() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getHistory' });
      if (response.success) {
        this.allHistory = response.history || [];
        this.applyFilters();
      }
    } catch (error) {
      console.error('Error loading history:', error);
    }
  }
  
  // Open extension in new tab
  openInNewTab() {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
  }
  
  // Apply search and date filters
  applyFilters() {
    let filtered = [...this.allHistory];
    
    // Apply search filter
    if (this.searchQuery) {
      filtered = filtered.filter(item => {
        const title = (item.title || '').toLowerCase();
        const category = (item.category || '').toLowerCase();
        const tags = (item.tags || []).join(' ').toLowerCase();
        const searchText = item.searchText || ''; // Pre-indexed search text from transcript/summary
        
        return title.includes(this.searchQuery) ||
               category.includes(this.searchQuery) ||
               tags.includes(this.searchQuery) ||
               searchText.includes(this.searchQuery);
      });
    }
    
    // Apply date filter
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (this.dateFilter) {
      case 'today':
        filtered = filtered.filter(item => new Date(item.date) >= today);
        break;
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        filtered = filtered.filter(item => new Date(item.date) >= weekAgo);
        break;
      case 'month':
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        filtered = filtered.filter(item => new Date(item.date) >= monthAgo);
        break;
      case 'custom':
        if (this.dateFrom) {
          filtered = filtered.filter(item => new Date(item.date) >= this.dateFrom);
        }
        if (this.dateTo) {
          filtered = filtered.filter(item => new Date(item.date) <= this.dateTo);
        }
        break;
    }
    
    this.filteredHistory = filtered;
    
    // Ensure current page is valid
    const totalPages = Math.ceil(filtered.length / this.itemsPerPage);
    if (this.currentPage > totalPages && totalPages > 0) {
      this.currentPage = totalPages;
    }
    
    this.renderHistory();
  }
  
  renderHistory() {
    const history = this.filteredHistory;
    
    if (!history || history.length === 0) {
      this.historyContainer.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <p>${this.searchQuery || this.dateFilter !== 'all' ? 'No matching recordings' : 'No previous recordings'}</p>
        </div>
      `;
      this.pagination.style.display = 'none';
      return;
    }
    
    // Calculate pagination
    const totalPages = Math.ceil(history.length / this.itemsPerPage);
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const pageItems = history.slice(startIndex, endIndex);
    
    const html = pageItems.map(item => {
      const date = new Date(item.date);
      const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const duration = this.formatDuration(item.duration || 0);
      const cost = item.cost ? `$${item.cost.toFixed(4)}` : 'N/A';
      const category = item.category || 'Other';
      const tags = item.tags || [];
      
      // Generate tags HTML
      const tagsHtml = tags.length > 0 
        ? `<div class="history-tags">${tags.map(tag => `<span class="history-tag">${this.escapeHtml(tag)}</span>`).join('')}</div>`
        : '';
      
      return `
        <div class="history-item" data-id="${item.id}">
          <div class="history-item-header">
            <span class="history-date">${formattedDate}</span>
            <span class="history-category">${category}</span>
          </div>
          <div class="history-title-row">
            <input type="text" class="history-title-input" data-id="${item.id}" 
              value="${this.escapeHtml(item.title || 'Untitled Recording')}" 
              placeholder="Enter meeting title..."
              title="Click to edit title">
            <button class="history-title-save" data-id="${item.id}" title="Save title">✓</button>
          </div>
          ${tagsHtml}
          <div class="history-meta">
            <span>⏱️ ${duration}</span>
            <span class="history-cost">💰 ${cost}</span>
          </div>
          <div class="history-actions">
            <button class="history-action-btn view-btn" data-id="${item.id}">View</button>
            <button class="history-action-btn delete" data-id="${item.id}">Delete</button>
          </div>
        </div>
      `;
    }).join('');
    
    this.historyContainer.innerHTML = html;
    
    // Update pagination UI
    if (totalPages > 1) {
      this.pagination.style.display = 'flex';
      this.pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
      this.prevPageBtn.disabled = this.currentPage <= 1;
      this.nextPageBtn.disabled = this.currentPage >= totalPages;
    } else {
      this.pagination.style.display = 'none';
    }
    
    // Add event listeners for history actions
    this.historyContainer.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.viewRecording(btn.dataset.id);
      });
    });
    
    this.historyContainer.querySelectorAll('.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteRecording(btn.dataset.id);
      });
    });
    
    // Add event listeners for title editing
    this.historyContainer.querySelectorAll('.history-title-save').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const input = this.historyContainer.querySelector(`.history-title-input[data-id="${id}"]`);
        if (input) {
          this.updateRecordingTitle(id, input.value);
        }
      });
    });
    
    // Save on Enter key
    this.historyContainer.querySelectorAll('.history-title-input').forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.updateRecordingTitle(input.dataset.id, input.value);
        }
      });
      // Stop propagation to prevent item click
      input.addEventListener('click', (e) => e.stopPropagation());
    });
  }
  
  async updateRecordingTitle(id, title) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'updateRecordingTitle',
        id: id,
        title: title.trim()
      });
      
      if (response.success) {
        // Show brief confirmation
        const btn = this.historyContainer.querySelector(`.history-title-save[data-id="${id}"]`);
        if (btn) {
          btn.textContent = '✓';
          btn.style.color = '#22C55E';
          setTimeout(() => {
            btn.textContent = '✓';
            btn.style.color = '';
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Error updating title:', error);
    }
  }
  
  async viewRecording(id) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getRecordingById',
        id: id
      });
      
      if (response.success) {
        const recording = response.recording;
        this.transcript = recording.transcript || [];
        this.summary = recording.summary;
        this.totalCost = recording.totalCost || 0;
        this.elapsedSeconds = recording.duration || 0;
        
        this.renderTranscript();
        this.renderSummary();
        this.updateTimer();
        this.displayCost(this.totalCost);
        
        this.exportBtn.disabled = false;
        this.copyBtn.disabled = false;
        
        // Switch to transcript tab
        this.switchTab('transcript');
      }
    } catch (error) {
      console.error('Error viewing recording:', error);
    }
  }
  
  async deleteRecording(id) {
    if (!confirm('Are you sure you want to delete this recording?')) {
      return;
    }
    
    try {
      await chrome.runtime.sendMessage({
        action: 'deleteRecording',
        id: id
      });
      await this.loadHistory();
    } catch (error) {
      console.error('Error deleting recording:', error);
    }
  }
  
  blobToBase64(blob) {
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

  startTimer() {
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds++;
      this.updateTimer();
      this.saveState();
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateTimer() {
    const hours = Math.floor(this.elapsedSeconds / 3600);
    const minutes = Math.floor((this.elapsedSeconds % 3600) / 60);
    const seconds = this.elapsedSeconds % 60;
    
    this.timerDisplay.textContent = 
      `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  switchTab(tabId) {
    this.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    this.tabPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });
  }

  renderTranscript() {
    // Handle both array and string transcript formats
    if (!this.transcript || (Array.isArray(this.transcript) && this.transcript.length === 0)) {
      this.transcriptContainer.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <p>Start recording to see transcript</p>
        </div>
      `;
      return;
    }
    
    // Convert string to array format if needed
    if (typeof this.transcript === 'string') {
      this.transcript = [{ text: this.transcript, speaker: 'Speaker', timestamp: '00:00' }];
    }
    
    const displayMode = this.displayLanguage.value;
    
    const html = this.transcript.map(entry => {
      let textContent = '';
      
      if (displayMode === 'original' || displayMode === 'both') {
        textContent += `<div class="transcript-text">${this.escapeHtml(entry.text)}</div>`;
      }
      
      if ((displayMode === 'english' || displayMode === 'both') && entry.translation && entry.language !== 'en') {
        textContent += `<div class="transcript-translation">${this.escapeHtml(entry.translation)}</div>`;
      }
      
      if (displayMode === 'english' && entry.language === 'en') {
        textContent = `<div class="transcript-text">${this.escapeHtml(entry.text)}</div>`;
      }
      
      const languageTag = entry.language && entry.language !== 'en' 
        ? `<span class="language-tag">${entry.language.toUpperCase()}</span>` 
        : '';
      
      return `
        <div class="transcript-entry">
          <div class="transcript-header">
            <span class="speaker-name">${this.escapeHtml(entry.speaker || 'Unknown')}</span>
            <span class="timestamp">${entry.timestamp || ''}</span>
            ${languageTag}
          </div>
          ${textContent}
        </div>
      `;
    }).join('');
    
    this.transcriptContainer.innerHTML = html;
  }

  renderSummary() {
    if (!this.summary) {
      this.summaryContainer.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          <p>Summary will appear after recording</p>
        </div>
      `;
      return;
    }
    
    let html = '';
    
    if (this.summary.overview) {
      html += `
        <div class="summary-section">
          <h3>📋 Overview</h3>
          <p>${this.escapeHtml(this.summary.overview)}</p>
        </div>
      `;
    }
    
    if (this.summary.keyPoints && this.summary.keyPoints.length > 0) {
      html += `
        <div class="summary-section">
          <h3>🎯 Key Points</h3>
          <ul>
            ${this.summary.keyPoints.map(point => `<li>${this.escapeHtml(point)}</li>`).join('')}
          </ul>
        </div>
      `;
    }
    
    if (this.summary.decisions && this.summary.decisions.length > 0) {
      html += `
        <div class="summary-section">
          <h3>✅ Decisions Made</h3>
          <ul>
            ${this.summary.decisions.map(decision => `<li>${this.escapeHtml(decision)}</li>`).join('')}
          </ul>
        </div>
      `;
    }
    
    if (this.summary.nextSteps && this.summary.nextSteps.length > 0) {
      html += `
        <div class="summary-section">
          <h3>👉 Next Steps</h3>
          <ul>
            ${this.summary.nextSteps.map(step => `<li>${this.escapeHtml(step)}</li>`).join('')}
          </ul>
        </div>
      `;
    }
    
    this.summaryContainer.innerHTML = html;
  }

  async exportData() {
    const data = {
      date: new Date().toISOString(),
      duration: this.formatDuration(this.elapsedSeconds),
      platform: this.currentPlatform?.name || 'Unknown',
      transcript: this.transcript,
      summary: this.summary,
      cost: {
        total: this.totalCost,
        formatted: `$${this.totalCost.toFixed(4)}`
      }
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-transcript-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  }

  async copyToClipboard() {
    let text = '# Meeting Transcript\n\n';
    text += `Date: ${new Date().toLocaleDateString()}\n`;
    text += `Duration: ${this.formatDuration(this.elapsedSeconds)}\n`;
    text += `Platform: ${this.currentPlatform?.name || 'Unknown'}\n`;
    text += `Cost: $${this.totalCost.toFixed(4)}\n\n`;
    
    if (this.summary) {
      text += '## Summary\n\n';
      if (this.summary.overview) {
        text += `${this.summary.overview}\n\n`;
      }
      if (this.summary.keyPoints?.length > 0) {
        text += '### Key Points\n';
        this.summary.keyPoints.forEach(point => {
          text += `- ${point}\n`;
        });
        text += '\n';
      }
    }
    
    text += '## Transcript\n\n';
    this.transcript.forEach(entry => {
      text += `**${entry.speaker || 'Unknown'}** [${entry.timestamp || ''}]: ${entry.text}\n`;
      if (entry.translation && entry.language !== 'en') {
        text += `> Translation: ${entry.translation}\n`;
      }
      text += '\n';
    });
    
    try {
      await navigator.clipboard.writeText(text);
      this.copyBtn.querySelector('span')?.remove();
      const originalContent = this.copyBtn.innerHTML;
      this.copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Copied!';
      setTimeout(() => {
        this.copyBtn.innerHTML = originalContent;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }

  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  }

  showProcessing(text) {
    this.processingText.textContent = text;
    this.processingOverlay.style.display = 'flex';
  }

  hideProcessing() {
    this.processingOverlay.style.display = 'none';
  }

  handleMessage(message) {
    switch (message.action) {
      case 'transcriptUpdate':
        this.transcript = message.transcript;
        this.renderTranscript();
        break;
      case 'recordingStatus':
        this.isRecording = message.isRecording;
        this.isPaused = message.isPaused;
        this.updateUIForRecording();
        break;
    }
  }

  async saveState() {
    await chrome.storage.session.set({
      isRecording: this.isRecording,
      isPaused: this.isPaused,
      elapsedSeconds: this.elapsedSeconds,
      startTime: this.startTime,
      transcript: this.transcript,
      summary: this.summary,
      totalCost: this.totalCost
    });
    
    // Update badge in background
    await chrome.runtime.sendMessage({
      action: 'setRecordingState',
      state: {
        isRecording: this.isRecording,
        isPaused: this.isPaused
      }
    });
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  async checkBotStatus() {
    try {
      const result = await chrome.storage.local.get(['botEnabled']);
      const state = await chrome.storage.session.get(['isRecording']);
      
      if (state.isRecording) {
        this.botStatusDot.classList.remove('active');
        this.botStatusDot.classList.add('recording');
      } else if (result.botEnabled) {
        this.botStatusDot.classList.remove('recording');
        this.botStatusDot.classList.add('active');
      } else {
        this.botStatusDot.classList.remove('active', 'recording');
      }
    } catch (error) {
      console.error('Error checking bot status:', error);
    }
  }
}

// Initialize popup
window.flyrecPopup = new FlyRecPopup();
