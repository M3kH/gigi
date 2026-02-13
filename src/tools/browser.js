import { browserManager } from '../lib/browser-manager.js';

/**
 * MCP Browser Tool - Control browser for web navigation and interaction
 */
export default {
  name: 'browser',
  description: 'Control a browser instance for web navigation and interaction',

  async handler({ action, ...params }) {
    // Initialize browser if not already initialized
    if (!browserManager.browser && !browserManager.nekoConnection) {
      const mode = process.env.BROWSER_MODE || 'headless';
      await browserManager.initialize({
        mode,
        nekoHost: process.env.NEKO_HOST || 'localhost',
        nekoPort: parseInt(process.env.NEKO_PORT) || 8080,
        nekoPassword: process.env.NEKO_PASSWORD || 'neko',
        wsPort: parseInt(process.env.WS_PORT) || 3001
      });
    }

    switch (action) {
      case 'navigate':
        return await navigate(params.url, params.options);

      case 'click':
        return await click(params.selector, params.options);

      case 'type':
        return await type(params.selector, params.text, params.options);

      case 'screenshot':
        return await screenshot(params.options);

      case 'evaluate':
        return await evaluate(params.script);

      case 'get_elements':
        return await getElements(params.selector);

      case 'switch_mode':
        return await switchMode(params.mode);

      case 'status':
        return await getStatus();

      default:
        throw new Error(`Unknown browser action: ${action}`);
    }
  },

  parameters: {
    action: {
      type: 'string',
      required: true,
      enum: ['navigate', 'click', 'type', 'screenshot', 'evaluate', 'get_elements', 'switch_mode', 'status']
    },
    url: {
      type: 'string',
      description: 'URL to navigate to (for navigate action)'
    },
    selector: {
      type: 'string',
      description: 'CSS selector for element interaction'
    },
    text: {
      type: 'string',
      description: 'Text to type (for type action)'
    },
    script: {
      type: 'string',
      description: 'JavaScript to evaluate in page context'
    },
    mode: {
      type: 'string',
      enum: ['headless', 'interactive'],
      description: 'Browser mode to switch to'
    },
    options: {
      type: 'object',
      description: 'Additional options for the action'
    }
  }
};

/**
 * Navigate to a URL
 */
async function navigate(url, options = {}) {
  if (!url) {
    throw new Error('URL is required for navigation');
  }

  await browserManager.navigate(url, options);

  // Return current state
  return {
    success: true,
    url: browserManager.page?.url() || url,
    title: browserManager.page ? await browserManager.page.title() : null,
    mode: browserManager.config.mode
  };
}

/**
 * Click on an element
 */
async function click(selector, options = {}) {
  if (!selector) {
    throw new Error('Selector is required for clicking');
  }

  await browserManager.click(selector, options);

  return {
    success: true,
    selector,
    action: 'clicked'
  };
}

/**
 * Type text into an element
 */
async function type(selector, text, options = {}) {
  if (!selector || text === undefined) {
    throw new Error('Selector and text are required for typing');
  }

  await browserManager.type(selector, text, options);

  return {
    success: true,
    selector,
    text,
    action: 'typed'
  };
}

/**
 * Take a screenshot
 */
async function screenshot(options = {}) {
  const screenshotData = await browserManager.captureScreenshot(options);

  return {
    success: true,
    data: screenshotData,
    format: 'base64',
    mode: browserManager.config.mode
  };
}

/**
 * Evaluate JavaScript in the page
 */
async function evaluate(script) {
  if (!script) {
    throw new Error('Script is required for evaluation');
  }

  const result = await browserManager.evaluate(script);

  return {
    success: true,
    result,
    script
  };
}

/**
 * Get information about elements matching a selector
 */
async function getElements(selector) {
  if (!selector) {
    throw new Error('Selector is required');
  }

  const elements = await browserManager.getElements(selector);

  return {
    success: true,
    selector,
    count: elements.length,
    elements
  };
}

/**
 * Switch browser mode between headless and interactive
 */
async function switchMode(mode) {
  if (!mode || !['headless', 'interactive'].includes(mode)) {
    throw new Error('Valid mode (headless or interactive) is required');
  }

  await browserManager.switchMode(mode);

  return {
    success: true,
    previousMode: browserManager.config.mode === mode ? 'already in this mode' : browserManager.config.mode,
    currentMode: mode
  };
}

/**
 * Get current browser status
 */
async function getStatus() {
  const status = {
    mode: browserManager.config.mode,
    initialized: !!(browserManager.browser || browserManager.nekoConnection),
    wsPort: browserManager.config.wsPort,
    wsClients: browserManager.wsClients?.size || 0
  };

  if (browserManager.config.mode === 'headless' && browserManager.page) {
    status.currentUrl = browserManager.page.url();
    status.title = await browserManager.page.title();
  } else if (browserManager.config.mode === 'interactive') {
    status.nekoConnected = browserManager.nekoConnection?.readyState === 1;
    status.nekoHost = browserManager.config.nekoHost;
    status.nekoPort = browserManager.config.nekoPort;
  }

  return status;
}