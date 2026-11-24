export const repository = 'acid-fairies-lab/af-src'
export const branch = 'main'
export const previewPr = ''

export function cmsSessionToken() {
  // Sveltia does not expose a public session API; keep this dependency isolated.
  const account = JSON.parse(localStorage.getItem('sveltia-cms.user') || '{}')
  if (account.backendName !== 'github' || typeof account.token !== 'string' || !account.token) {
    throw new Error('No GitHub session found. Sign in to Sveltia CMS and retry.')
  }
  return account.token
}

export async function githubGet(path, token = cmsSessionToken()) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) {
    throw new Error(`GitHub API returned HTTP ${response.status}`)
  }
  return response.json()
}

const history = document.querySelector('[data-workflow]')
if (history) {
  history.querySelector('#actions').href = `https://github.com/${repository}/actions/workflows/${history.dataset.workflow}`
}
let timer
let watchingUntil = 0
let active = false

export function watchDeployments() {
  // repository_dispatch returns 204 without a run ID; allow time for the run to appear.
  watchingUntil = Date.now() + 120_000
  void refreshDeployments()
}

async function refreshDeployments() {
  if (!history) {
    return
  }

  clearTimeout(timer)
  const body = history.querySelector('tbody')
  const status = history.querySelector('[role="status"]')
  try {
    const previewPublish = previewPr && document.querySelector('#publish')
    const query = previewPublish
      ? 'per_page=100&branch=main&event=repository_dispatch'
      : `per_page=10&branch=${encodeURIComponent(branch)}`
    const { workflow_runs: allRuns = [] } = await githubGet(
      `/repos/${repository}/actions/workflows/${history.dataset.workflow}/runs?${query}`,
    )
    const runs = previewPublish
      ? allRuns.filter(run => run.display_title === `Publish PROD PR-${previewPr}`).slice(0, 10)
      : allRuns
    const labels = {
      queued: '… Queued',
      in_progress: '◌ Running',
      waiting: '… Waiting',
      pending: '… Pending',
      requested: '… Requested',
      success: '✓ Success',
      failure: '✕ Failed',
      cancelled: '– Cancelled',
      timed_out: '✕ Timed out',
      action_required: '! Action required',
      skipped: '– Skipped',
    }

    body.replaceChildren()
    for (const run of runs) {
      const row = document.createElement('tr')
      const runCell = document.createElement('td')
      const statusCell = document.createElement('td')
      const timeCell = document.createElement('td')
      const link = document.createElement('a')
      link.href = `https://github.com/${repository}/actions/runs/${run.id}`
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = `#${run.run_number}`
      const state = run.status === 'completed' ? run.conclusion : run.status
      const started = run.status === 'in_progress' ? (run.run_started_at ?? run.created_at) : run.created_at
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(started).getTime()) / 1000))
      const minutes = Math.floor(seconds / 60)
      const delayed = (state === 'queued' && minutes >= 5) || (state === 'in_progress' && minutes >= 15)
      const elapsed = run.status === 'completed' ? '' : ` — ${minutes}m ${seconds % 60}s${delayed ? ' (possibly delayed)' : ''}`
      runCell.append(link)
      statusCell.textContent = `${labels[state] ?? state ?? 'Unknown'}${elapsed}`
      timeCell.textContent = new Date(run.run_started_at ?? run.created_at).toLocaleString()
      row.append(runCell, statusCell, timeCell)
      body.append(row)
    }
    status.textContent = runs.length ? '' : 'No deployments yet.'
    active = runs.some(run => run.status !== 'completed')
    history.dispatchEvent(new CustomEvent('deployments-updated', { detail: runs }))
  }
  catch (error) {
    status.textContent = error.message === 'GitHub API returned HTTP 401'
      ? 'GitHub session expired. Sign in to Sveltia CMS and retry.'
      : error.message === 'GitHub API returned HTTP 403'
        ? 'Could not read GitHub Actions. Check session permissions (Actions: read).'
        : `Could not load deployment history: ${error.message}`
  }
  timer = setTimeout(refreshDeployments, active || Date.now() < watchingUntil ? 10_000 : 30_000)
}

history?.querySelector('[data-refresh]')?.addEventListener('click', () => {
  void refreshDeployments()
})
void refreshDeployments()
