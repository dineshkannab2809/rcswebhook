const axios = require('axios');

class TemplateService {
  constructor() {
    this.authUrl =
      process.env.DOTGO_TEMPLATE_AUTH_URL ||
      'https://auth.dotgo.com/auth/oauth/token?grant_type=client_credentials';
    this.apiRoot =
      process.env.DOTGO_TEMPLATE_API_ROOT || 'https://developer-api.dotgo.com';
    this.botId = process.env.DOTGO_TEMPLATE_BOT_ID || 'h8kMH3EwmDcWGKCS1V';
    this.authUsername =
      process.env.DOTGO_TEMPLATE_AUTH_USERNAME || 'YWRtaW4uc2thbGVib3RAZGVza2FsYS5pbg';
    this.authPassword =
      process.env.DOTGO_TEMPLATE_AUTH_PASSWORD || 'OP20e0bSVlYD76z3vA7t7ga76i5t0AoV';
    this.cachedAccessToken = null;
    this.accessTokenExpiresAt = 0;
    this.pendingTokenRequest = null;
    this.tokenRefreshBufferMs = 60 * 1000;
  }

  async getAccessToken() {
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

    this.pendingTokenRequest = this.fetchAccessToken();
    try {
      return await this.pendingTokenRequest;
    } finally {
      this.pendingTokenRequest = null;
    }
  }

  async fetchAccessToken() {
    if (!this.authUsername || !this.authPassword) {
      throw new Error(
        'Template auth credentials are missing. Set DOTGO_TEMPLATE_AUTH_USERNAME and DOTGO_TEMPLATE_AUTH_PASSWORD.'
      );
    }

    const response = await axios.post(
      this.authUrl,
      null,
      {
        auth: {
          username: this.authUsername,
          password: this.authPassword
        }
      }
    );

    const accessToken = response?.data?.access_token;
    if (!accessToken) {
      throw new Error('Template auth response did not contain access_token');
    }

    const expiresInSeconds = Number(response?.data?.expires_in) || 3600;
    this.cachedAccessToken = accessToken;
    this.accessTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
    return accessToken;
  }

  async createTemplate(template) {
    if (!this.botId) {
      throw new Error('DOTGO_TEMPLATE_BOT_ID is missing');
    }

    const remoteName = this.buildRemoteTemplateName(template.code, template.title);
    const accessToken = await this.getAccessToken();
    const endpoint = `${this.apiRoot}/directory/secure/api/v1/bots/${encodeURIComponent(this.botId)}/templates`;

    const richTemplateData = {
      name: remoteName,
      type: template.type || 'text_message',
      templateUseCase: template.templateUseCase || 'Transactional',
      textMessageContent: template.content,
      suggestions: Array.isArray(template.suggestions) ? template.suggestions : []
    };

    const form = new FormData();
    form.append('rich_template_data', JSON.stringify(richTemplateData));

    const response = await axios.post(
      endpoint,
      form,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    return {
      remoteName,
      remoteTemplateId:
        response?.data?.id ||
        response?.data?.templateId ||
        response?.data?.name ||
        remoteName,
      raw: response.data
    };
  }

  buildRemoteTemplateName(code, title) {
    const source = `${code || ''} ${title || ''}`.trim();
    const alphaNumericOnly = source.replace(/[^a-zA-Z0-9]/g, '');
    let candidate = alphaNumericOnly.slice(0, 20);

    if (!/[a-zA-Z]/.test(candidate)) {
      candidate = `tpl${candidate}`.slice(0, 20);
    }

    if (!candidate) {
      throw new Error(
        'Template name is invalid. Use a code or title with at least one alphabet and keep it reasonably short.'
      );
    }

    return candidate;
  }
}

module.exports = new TemplateService();
