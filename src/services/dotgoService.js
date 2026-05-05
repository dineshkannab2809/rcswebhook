const axios = require('axios');

class DotgoService {
  constructor() {
    this.apiKey = process.env.DOTGO_API_KEY;
    this.apiUrl = process.env.DOTGO_API_URL || 'https://api.dotgo.com/rcs/v1';
    this.senderId = process.env.DOTGO_SENDER_ID; // may not be needed for this endpoint
    this.botId = process.env.DOTGO_BOT_ID; // required for async messages

    // OAuth token endpoint for dynamic access token retrieval.
    this.authUrl = process.env.DOTGO_AUTH_URL || 'https://auth.dotgo.com/auth/oauth/token';
    this.authUsername = process.env.DOTGO_AUTH_USERNAME;
    this.authPassword = process.env.DOTGO_AUTH_PASSWORD;

    this.cachedAccessToken = null;
    this.accessTokenExpiresAt = 0;
    this.pendingTokenRequest = null;
    this.tokenRefreshBufferMs = 60 * 1000;
    this.defaultTemplateTtl = process.env.DOTGO_TEMPLATE_TTL || '10s';
  }

  formatPhoneNumber(recipient) {
    // Remove any whitespace
    let phone = recipient.toString().trim();

    // If already starts with +, return as is
    if (phone.startsWith('+')) {
      return phone;
    }

    // If starts with 91 (India code) without +, add +
    if (phone.startsWith('91') && phone.length === 12) {
      return `+${phone}`;
    }

    // If it's just 10 digits (Indian number), add +91
    if (phone.length === 10 && /^\d+$/.test(phone)) {
      return `+91${phone}`;
    }

    // Default: add +91 if it looks like an Indian number
    if (/^\d+$/.test(phone)) {
      return `+91${phone}`;
    }

    // Return as is if format is unknown
    return phone;
  }

  async getAccessToken() {
    // Backward compatibility: static token can still be used.
    if (this.apiKey) {
      return this.apiKey;
    }

    const now = Date.now();
    if (
      this.cachedAccessToken &&
      now < this.accessTokenExpiresAt - this.tokenRefreshBufferMs
    ) {
      return this.cachedAccessToken;
    }

    if (this.pendingTokenRequest) {
      return this.pendingTokenRequest;
    }

    if (!this.authUsername || !this.authPassword) {
      throw new Error(
        'Dotgo OAuth credentials are missing. Set DOTGO_AUTH_USERNAME and DOTGO_AUTH_PASSWORD, or provide DOTGO_API_KEY.'
      );
    }

    this.pendingTokenRequest = this.fetchAccessToken();
    try {
      return await this.pendingTokenRequest;
    } finally {
      this.pendingTokenRequest = null;
    }
  }

  async fetchAccessToken() {
    const response = await axios.post(
      this.authUrl,
      null,
      {
        params: { grant_type: 'client_credentials' },
        auth: {
          username: this.authUsername,
          password: this.authPassword
        },
        headers: {
          Accept: 'application/json'
        }
      }
    );

    const accessToken = response?.data?.access_token;
    if (!accessToken) {
      throw new Error('Dotgo OAuth response did not contain access_token');
    }

    const expiresInSeconds = Number(response?.data?.expires_in) || 3600;
    this.cachedAccessToken = accessToken;
    this.accessTokenExpiresAt = Date.now() + (expiresInSeconds * 1000);

    console.log(`Retrieved Dotgo access token; expires in ${expiresInSeconds} seconds.`);
    return accessToken;
  }

  extractMessageId(responseData) {
    if (responseData?.messageId) {
      return responseData.messageId;
    }

    const messageName = responseData?.name;
    if (!messageName || typeof messageName !== 'string') {
      return 'pending';
    }

    const segments = messageName.split('/');
    return segments[segments.length - 1] || 'pending';
  }

  async sendMessage(recipient, payload, botIdOverride) {
    try {
      const { message, templateCode, ttl } = payload || {};

      // Validate input
      if (!recipient || (!message && !templateCode)) {
        throw new Error('Recipient and either message or templateCode are required');
      }

      // Format phone number with country code
      const formattedRecipient = this.formatPhoneNumber(recipient);

      const botId = botIdOverride || this.botId;
      if (!botId) {
        throw new Error('DOTGO_BOT_ID not configured in environment or request');
      }

      const accessToken = await this.getAccessToken();

      console.log(`Sending RCS message to ${formattedRecipient} via bot ${botId}`);

      // POST /rcs/v1/phones/{recipient}/agentMessages/async?botId={botId}
      const endpoint = `${this.apiUrl}/phones/${encodeURIComponent(formattedRecipient)}/agentMessages/async`;
      const fullUrl = `${endpoint}?botId=${encodeURIComponent(botId)}`;
      console.log(`Calling Dotgo API: ${fullUrl}`);

      const requestBody = templateCode
        ? {
            contentMessage: {
              templateMessage: {
                templateCode
              }
            }
          }
        : {
            contentMessage: {
              text: message
            }
          };

      if (templateCode) {
        requestBody.ttl = ttl || this.defaultTemplateTtl;
      } else if (ttl) {
        requestBody.ttl = ttl;
      }

      const response = await axios.post(
        fullUrl,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Message sent successfully:', response.data);
      return {
        success: true,
        recipient: formattedRecipient,
        messageId: this.extractMessageId(response.data),
        messageName: response.data.name || null,
        sendTime: response.data.sendTime || null,
        timestamp: new Date().toISOString(),
        mode: templateCode ? 'template' : 'text'
      };
    } catch (error) {
      console.error('Error sending message:', error.message);
      if (error.response) {
        console.error('Dotgo response status:', error.response.status);
        console.error('Dotgo response data:', error.response.data);
      }
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = new DotgoService();
