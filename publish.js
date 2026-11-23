import { cmsSessionToken, githubGet, publishedTag, repository, sourceBranch, watchDeployments } from './deployments.js'

const button = document.querySelector('#publish')
const statusElement = document.querySelector('#status')
const changes = document.querySelector('#changes')
const files = document.querySelector('#files')
const actions = document.querySelector('#actions')
let publishing = false
let requestedAt = 0
let requestedRunId = 0

function showPublishing(message) {
  publishing = true
  button.disabled = true
  files.hidden = true
  changes.textContent = message
}

document.querySelector('[data-workflow]').addEventListener('deployments-updated', ({ detail: runs }) => {
  const active = runs.some(run => run.status !== 'completed')
  const requestedRun = requestedAt && runs.find(run => requestedRunId
    ? run.id === requestedRunId
    : run.event === (sourceBranch === 'main' ? 'repository_dispatch' : 'workflow_dispatch')
      && new Date(run.created_at).getTime() >= requestedAt - 5000)

  if (active) {
    showPublishing('Publication in progress…')
  }
  else if (publishing && (!requestedAt || requestedRun)) {
    publishing = false
    requestedAt = 0
    requestedRunId = 0
    button.disabled = false
    void checkPendingChanges()
  }
  else if (!publishing) {
    // Keep the pending list current even if GitHub updates the tag slightly later.
    void checkPendingChanges()
  }
})

async function checkPendingChanges() {
  try {
    const comparison = await githubGet(`/repos/${repository}/compare/${encodeURIComponent(`${publishedTag}...${sourceBranch}`)}`, cmsSessionToken())
    if (publishing) {
      return
    }

    files.replaceChildren()
    const changed = comparison.files ?? []
    changes.textContent = changed.length
      ? `${changed.length} changed file${changed.length === 1 ? '' : 's'} awaiting publication:`
      : 'No changes awaiting publication.'
    for (const { status, filename } of changed.slice(0, 30)) {
      const item = document.createElement('li')
      item.textContent = `${status}: ${filename}`
      files.append(item)
    }
    if (changed.length > 30) {
      const item = document.createElement('li')
      item.textContent = `…and ${changed.length - 30} more files`
      files.append(item)
    }
    files.hidden = !changed.length
  }
  catch (error) {
    if (publishing) {
      return
    }

    files.hidden = true
    changes.textContent = error.message === 'GitHub API returned HTTP 404'
      ? 'Production baseline not initialized. Publish once to start tracking changes.'
      : 'Could not check unpublished changes.'
  }
}

button.addEventListener('click', async () => {
  // eslint-disable-next-line no-alert -- explicit confirmation before publishing
  if (!confirm('Are you sure you want to publish all changes to the production website?')) {
    return
  }

  button.disabled = true
  actions.hidden = true
  statusElement.hidden = false
  statusElement.textContent = 'Requesting publication…'

  try {
    const token = cmsSessionToken()
    const [user, repo] = await Promise.all([githubGet('/user', token), githubGet(`/repos/${repository}`, token)])
    if (repo.full_name !== repository || repo.permissions?.push !== true) {
      throw new Error(`GitHub account ${user.login} has no write access to ${repository}`)
    }

    const dispatchStartedAt = Date.now()
    const isMain = sourceBranch === 'main'
    const endpoint = isMain ? 'dispatches' : 'actions/workflows/deploy-prod.yml/dispatches'
    const body = isMain ? { event_type: 'sveltia-cms-publish' } : { ref: sourceBranch }
    const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`GitHub rejected the publication request: HTTP ${response.status}`)
    }
    requestedRunId = response.status === 200 ? (await response.json()).workflow_run_id ?? 0 : 0

    statusElement.textContent = 'Publication requested. Follow its status below.'
    requestedAt = dispatchStartedAt
    showPublishing('Publication requested… Pending changes will update after deployment.')
    watchDeployments()
    actions.href = `https://github.com/${repository}/actions/workflows/deploy-prod.yml`
    actions.hidden = false
  }
  catch (error) {
    statusElement.textContent = error.message === 'GitHub API returned HTTP 401'
      ? 'GitHub session expired. Refresh or sign in to Sveltia CMS and retry.'
      : error.message || 'Failed to request publication.'
  }
  finally {
    button.disabled = publishing
  }
})

void checkPendingChanges()
