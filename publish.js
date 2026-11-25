import { branch, cmsSessionToken, githubGet, previewPr, repository, watchDeployments } from './deployments.js'

const button = document.querySelector('#publish')
const statusElement = document.querySelector('#status')
const changes = document.querySelector('#changes')
const files = document.querySelector('#files')
let publishing = false
let requestedAt = 0
const preview = branch !== 'main' || !!previewPr
const tag = preview ? `pr-${previewPr}-prod-published` : 'prod-published'

function showPublishing(message) {
  publishing = true
  button.disabled = true
  files.hidden = true
  changes.textContent = message
}

document.querySelector('[data-workflow]').addEventListener('deployments-updated', ({ detail: runs }) => {
  const active = runs.some(run => run.status !== 'completed')
  const requestedRun = requestedAt && runs.find(run => run.event === 'workflow_dispatch'
    && new Date(run.created_at).getTime() >= requestedAt - 5000)

  if (active) {
    showPublishing('Publication in progress…')
  }
  else if (publishing && (!requestedAt || requestedRun || Date.now() - requestedAt > 120_000)) {
    publishing = false
    requestedAt = 0
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
    const comparison = await githubGet(`/repos/${repository}/compare/${tag}...${encodeURIComponent(branch)}`)
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
      ? 'Production baseline not initialized.'
      : 'Could not check unpublished changes.'
  }
}

const dialog = document.querySelector('#publish-dialog')
document.querySelector('#publish-target').textContent = `Publish all saved changes to ${preview ? `PROD preview PR #${previewPr}` : 'production'}?`
button.addEventListener('click', () => {
  dialog.returnValue = ''
  dialog.showModal()
})

dialog.addEventListener('close', async () => {
  if (dialog.returnValue !== 'publish' || button.disabled) {
    return
  }

  button.disabled = true
  statusElement.hidden = false
  statusElement.textContent = 'Requesting publication…'

  try {
    const token = cmsSessionToken()
    const dispatchStartedAt = Date.now()
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/deploy-prod.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: branch, inputs: { pr_deployment: preview, pr_number: previewPr, force_build: false } }),
    })
    if (!response.ok) {
      throw new Error(`GitHub rejected the publication request: HTTP ${response.status}`)
    }

    statusElement.textContent = 'Publication requested. Follow its status below.'
    requestedAt = dispatchStartedAt
    showPublishing('Publication requested… Pending changes will update after deployment.')
    watchDeployments()
  }
  catch (error) {
    statusElement.textContent = error.message === 'GitHub rejected the publication request: HTTP 401'
      ? 'GitHub session expired. Refresh or sign in to Sveltia CMS and retry.'
      : error.message || 'Failed to request publication.'
  }
  finally {
    button.disabled = publishing
  }
})

void checkPendingChanges()
