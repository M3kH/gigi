/**
 * Gitea API helper functions
 *
 * Provides direct access to Gitea API for internal services
 */

const GITEA_URL = process.env.GITEA_URL || 'http://192.168.1.80:3000';
const GITEA_TOKEN = process.env.GITEA_TOKEN;

/**
 * Make a request to the Gitea API
 * @private
 */
async function request(method, path, body = null) {
  if (!GITEA_TOKEN) {
    throw new Error('GITEA_TOKEN environment variable not set');
  }

  const opts = {
    method,
    headers: {
      'Authorization': `token ${GITEA_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    opts.body = JSON.stringify(body);
  }

  const response = await fetch(`${GITEA_URL}/api/v1${path}`, opts);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Gitea API error ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Get issues from Gitea
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name (optional, gets all repos if null)
 * @param {Object} options - Query options
 * @param {string} options.state - Issue state (open, closed, all)
 * @param {string} options.labels - Comma-separated label names
 * @param {number} options.limit - Maximum number of results
 * @returns {Promise<Array>} Array of issues
 */
export async function getIssues(owner, repo = null, options = {}) {
  const { state = 'open', labels = '', limit = 100 } = options;

  if (repo) {
    // Get issues from specific repo
    const params = new URLSearchParams({
      state,
      limit: limit.toString()
    });

    if (labels) {
      params.append('labels', labels);
    }

    return request('GET', `/repos/${owner}/${repo}/issues?${params}`);
  } else {
    // Get issues from all repos owned by owner
    // First get all repos
    const repos = await request('GET', `/orgs/${owner}/repos?limit=50`);

    // Then get issues from each repo
    const allIssues = [];

    for (const r of repos) {
      const params = new URLSearchParams({
        state,
        limit: limit.toString()
      });

      if (labels) {
        params.append('labels', labels);
      }

      try {
        const issues = await request('GET', `/repos/${owner}/${r.name}/issues?${params}`);
        // Add repo info to each issue
        const issuesWithRepo = issues.map(issue => ({
          ...issue,
          repository: r
        }));
        allIssues.push(...issuesWithRepo);
      } catch (error) {
        console.error(`Error fetching issues from ${r.name}:`, error.message);
      }
    }

    return allIssues;
  }
}