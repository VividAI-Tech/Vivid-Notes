// VividAI Options Page Script

// Provider configurations
const PROVIDER_CONFIG = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    hint: 'Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Platform</a>',
    placeholder: 'sk-...',
    requiresKey: true
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    hint: 'Get your API key from <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a>',
    placeholder: 'AIza...',
    requiresKey: true
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    hint: 'Get your API key from <a href="https://openrouter.ai/keys" target="_blank">OpenRouter</a>',
    placeholder: 'sk-or-...',
    requiresKey: true
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    hint: 'Get your API key from <a href="https://console.groq.com/keys" target="_blank">Groq Console</a>',
    placeholder: 'gsk_...',
    requiresKey: true
  },
  flotorch: {
    baseUrl: 'https://api.flotorch.ai/v1',
    hint: 'Get your API key from <a href="https://flotorch.ai" target="_blank">FloTorch</a>',
    placeholder: 'ft-...',
    requiresKey: true
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    hint: 'Make sure Ollama is running locally. API key is optional.',
    placeholder: '(optional)',
    requiresKey: false
  },
  custom: {
    baseUrl: '',
    hint: 'Enter the base URL of your OpenAI-compatible API',
    placeholder: 'your-api-key',
    requiresKey: true
  }
};

class OptionsManager {
  constructor() {
    this.initElements();
    this.initEventListeners();
    this.loadSettings();
  }
  
  initElements() {
    // AI Provider
    this.aiProvider = document.getElementById('aiProvider');
    this.baseUrlInput = document.getElementById('baseUrl');
    this.baseUrlGroup = document.getElementById('baseUrlGroup');
    this.baseUrlHint = document.getElementById('baseUrlHint');
    this.apiKeyGroup = document.getElementById('apiKeyGroup');
    this.apiKeyOptional = document.getElementById('apiKeyOptional');
    this.apiKeyHint = document.getElementById('apiKeyHint');
    
    // API Key
    this.apiKeyInput = document.getElementById('apiKey');
    this.toggleVisibilityBtn = document.getElementById('toggleVisibility');
    this.saveApiKeyBtn = document.getElementById('saveApiKey');
    this.testApiKeyBtn = document.getElementById('testApiKey');
    this.apiStatus = document.getElementById('apiStatus');
    
    // Language Settings
    this.defaultLanguage = document.getElementById('defaultLanguage');
    this.autoTranslate = document.getElementById('autoTranslate');
    this.showBothLanguages = document.getElementById('showBothLanguages');
    
    // Transcription Settings
    this.whisperModel = document.getElementById('whisperModel');
    this.summaryModel = document.getElementById('summaryModel');
    
    // Export Settings
    this.exportFormat = document.getElementById('exportFormat');
    this.includeTimestamps = document.getElementById('includeTimestamps');
    this.includeSpeakerNames = document.getElementById('includeSpeakerNames');
    
    // Data Management
    this.exportSettingsBtn = document.getElementById('exportSettings');
    this.importSettingsBtn = document.getElementById('importSettings');
    this.clearDataBtn = document.getElementById('clearData');
  }
  
  initEventListeners() {
    // AI Provider change
    this.aiProvider.addEventListener('change', () => this.onProviderChange());
    
    // API Key visibility toggle
    this.toggleVisibilityBtn.addEventListener('click', () => {
      const isPassword = this.apiKeyInput.type === 'password';
      this.apiKeyInput.type = isPassword ? 'text' : 'password';
      
      const eyeIcon = this.toggleVisibilityBtn.querySelector('.eye-icon');
      const eyeOffIcon = this.toggleVisibilityBtn.querySelector('.eye-off-icon');
      eyeIcon.style.display = isPassword ? 'none' : 'block';
      eyeOffIcon.style.display = isPassword ? 'block' : 'none';
    });
    
    // Save Settings
    this.saveApiKeyBtn.addEventListener('click', () => this.saveProviderSettings());
    
    // Test Connection
    this.testApiKeyBtn.addEventListener('click', () => this.testConnection());
    
    // Auto-save settings on change
    const settingsInputs = [
      this.defaultLanguage,
      this.autoTranslate,
      this.showBothLanguages,
      this.whisperModel,
      this.summaryModel,
      this.exportFormat,
      this.includeTimestamps,
      this.includeSpeakerNames
    ];
    
    settingsInputs.forEach(input => {
      input.addEventListener('change', () => this.saveSettings());
    });
    
    // Data Management
    this.exportSettingsBtn.addEventListener('click', () => this.exportSettings());
    this.importSettingsBtn.addEventListener('click', () => this.importSettings());
    this.clearDataBtn.addEventListener('click', () => this.clearAllData());
    
    // Enter key on API input
    this.apiKeyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.saveApiKey();
      }
    });
  }
  
  onProviderChange() {
    const provider = this.aiProvider.value;
    const config = PROVIDER_CONFIG[provider];
    
    // Update base URL
    this.baseUrlInput.value = config.baseUrl;
    this.baseUrlInput.placeholder = config.baseUrl || 'https://your-api.com/v1';
    
    // Show/hide base URL for custom provider
    if (provider === 'custom' || provider === 'ollama') {
      this.baseUrlGroup.style.display = 'block';
    } else {
      this.baseUrlGroup.style.display = 'block'; // Show for all to allow customization
    }
    
    // Update API key hints
    this.apiKeyHint.innerHTML = config.hint;
    this.apiKeyInput.placeholder = config.placeholder;
    
    // Show optional label for Ollama
    this.apiKeyOptional.style.display = config.requiresKey ? 'none' : 'inline';
    
    // Update base URL hint
    if (provider === 'ollama') {
      this.baseUrlHint.textContent = 'Default: http://localhost:11434/v1';
    } else if (provider === 'custom') {
      this.baseUrlHint.textContent = 'Enter the full base URL (e.g., https://api.example.com/v1)';
    } else {
      this.baseUrlHint.textContent = `Default: ${config.baseUrl}`;
    }
  }
  
  async loadSettings() {
    try {
      const settings = await chrome.storage.local.get([
        'ai_provider',
        'api_base_url',
        'openai_api_key',
        'default_language',
        'auto_translate',
        'show_both_languages',
        'whisper_model',
        'summary_model',
        'export_format',
        'include_timestamps',
        'include_speaker_names'
      ]);
      
      // Load AI Provider
      if (settings.ai_provider) {
        this.aiProvider.value = settings.ai_provider;
      }
      
      // Load Base URL
      if (settings.api_base_url) {
        this.baseUrlInput.value = settings.api_base_url;
      } else {
        const config = PROVIDER_CONFIG[this.aiProvider.value];
        this.baseUrlInput.value = config.baseUrl;
      }
      
      // Load API Key
      if (settings.openai_api_key) {
        this.apiKeyInput.value = settings.openai_api_key;
        this.apiKeyInput.placeholder = 'API key saved';
      }
      
      // Update UI based on provider
      this.onProviderChange();
      
      // Load Language Settings
      if (settings.default_language) {
        this.defaultLanguage.value = settings.default_language;
      }
      this.autoTranslate.checked = settings.auto_translate !== false;
      this.showBothLanguages.checked = settings.show_both_languages !== false;
      
      // Load Transcription Settings
      if (settings.whisper_model) {
        this.whisperModel.value = settings.whisper_model;
      }
      if (settings.summary_model) {
        this.summaryModel.value = settings.summary_model;
      }
      
      // Load Export Settings
      if (settings.export_format) {
        this.exportFormat.value = settings.export_format;
      }
      this.includeTimestamps.checked = settings.include_timestamps !== false;
      this.includeSpeakerNames.checked = settings.include_speaker_names !== false;
      
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }
  
  async saveProviderSettings() {
    const provider = this.aiProvider.value;
    const baseUrl = this.baseUrlInput.value.trim();
    const apiKey = this.apiKeyInput.value.trim();
    const config = PROVIDER_CONFIG[provider];
    
    // Validate API key (optional for Ollama)
    if (config.requiresKey && !apiKey) {
      this.showStatus('error', 'Please enter an API key');
      return;
    }
    
    // Use default base URL if not provided
    const finalBaseUrl = baseUrl || config.baseUrl;
    
    try {
      await chrome.storage.local.set({ 
        ai_provider: provider,
        api_base_url: finalBaseUrl,
        openai_api_key: apiKey 
      });
      this.showStatus('success', 'Settings saved successfully!');
    } catch (error) {
      this.showStatus('error', 'Failed to save settings: ' + error.message);
    }
  }
  
  async testConnection() {
    const provider = this.aiProvider.value;
    const baseUrl = this.baseUrlInput.value.trim() || PROVIDER_CONFIG[provider].baseUrl;
    const apiKey = this.apiKeyInput.value.trim();
    const config = PROVIDER_CONFIG[provider];
    
    if (config.requiresKey && !apiKey) {
      this.showStatus('error', 'Please enter an API key first');
      return;
    }
    
    this.showStatus('info', 'Testing connection...');
    this.testApiKeyBtn.disabled = true;
    
    try {
      // Build headers
      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      
      // Try to list models (works for most OpenAI-compatible APIs)
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: headers
      });
      
      if (response.ok) {
        const data = await response.json();
        const modelCount = data.data?.length || 'unknown';
        this.showStatus('success', `Connection successful! Found ${modelCount} models.`);
      } else {
        // Try a simple chat completion for APIs that don't support /models
        try {
          const chatResponse = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              model: provider === 'ollama' ? 'llama2' : 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: 'Hi' }],
              max_tokens: 5
            })
          });
          
          if (chatResponse.ok) {
            this.showStatus('success', 'Connection successful!');
          } else {
            const error = await chatResponse.json().catch(() => ({}));
            this.showStatus('error', error.error?.message || 'Connection failed');
          }
        } catch {
          const error = await response.json().catch(() => ({}));
          this.showStatus('error', error.error?.message || 'Invalid API key or endpoint');
        }
      }
    } catch (error) {
      this.showStatus('error', 'Connection failed: ' + error.message);
    } finally {
      this.testApiKeyBtn.disabled = false;
    }
  }
  
  async saveSettings() {
    try {
      await chrome.storage.local.set({
        default_language: this.defaultLanguage.value,
        auto_translate: this.autoTranslate.checked,
        show_both_languages: this.showBothLanguages.checked,
        whisper_model: this.whisperModel.value,
        summary_model: this.summaryModel.value,
        export_format: this.exportFormat.value,
        include_timestamps: this.includeTimestamps.checked,
        include_speaker_names: this.includeSpeakerNames.checked
      });
      
      // Brief visual feedback
      this.showStatus('success', 'Settings saved!');
      setTimeout(() => {
        this.apiStatus.style.display = 'none';
      }, 2000);
    } catch (error) {
      this.showStatus('error', 'Failed to save settings: ' + error.message);
    }
  }
  
  async exportSettings() {
    try {
      const settings = await chrome.storage.local.get(null);
      
      // Remove sensitive data
      const exportData = { ...settings };
      delete exportData.openai_api_key;
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `flyrec-settings-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      this.showStatus('success', 'Settings exported successfully!');
    } catch (error) {
      this.showStatus('error', 'Failed to export settings: ' + error.message);
    }
  }
  
  importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const settings = JSON.parse(text);
        
        // Don't overwrite API key
        const currentKey = await chrome.storage.local.get('openai_api_key');
        settings.openai_api_key = currentKey.openai_api_key;
        
        await chrome.storage.local.set(settings);
        this.loadSettings();
        this.showStatus('success', 'Settings imported successfully!');
      } catch (error) {
        this.showStatus('error', 'Failed to import settings: ' + error.message);
      }
    });
    
    input.click();
  }
  
  async clearAllData() {
    if (!confirm('Are you sure you want to clear all data? This will remove your API key and all settings.')) {
      return;
    }
    
    try {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
      
      // Reset form
      this.apiKeyInput.value = '';
      this.apiKeyInput.placeholder = 'sk-...';
      this.defaultLanguage.value = 'auto';
      this.autoTranslate.checked = true;
      this.showBothLanguages.checked = true;
      this.whisperModel.value = 'whisper-1';
      this.summaryModel.value = 'gpt-4o-mini';
      this.exportFormat.value = 'json';
      this.includeTimestamps.checked = true;
      this.includeSpeakerNames.checked = true;
      
      this.showStatus('success', 'All data cleared successfully!');
    } catch (error) {
      this.showStatus('error', 'Failed to clear data: ' + error.message);
    }
  }
  
  showStatus(type, message) {
    this.apiStatus.className = `status-message ${type}`;
    this.apiStatus.textContent = message;
    this.apiStatus.style.display = 'block';
  }
}

// Initialize options manager
new OptionsManager();
