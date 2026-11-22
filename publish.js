const repository = 'acid-fairies-lab/af-src'
const button = document.querySelector('#publish')
const statusElement = document.querySelector('#status')
const changes = document.querySelector('#changes')
const files = document.querySelector('#files')
const actions = document.querySelector('#actions')

function cmsSessionToken() {
  // Sveltia does not expose a public session API; keep this dependency isolated.
  const account = JSON.parse(localStorage.getItem('sveltia-cms.user') || '{}')
  if (account.backendName !== 'github' || typeof account.token !== 'string' || !account.token) {
    throw new Error('No GitHub session found. Sign in to Sveltia CMS and retry.')
  }
  return account.token
}

async function githubGet(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) {
    throw new Error(`GitHub API returned HTTP ${response.status}`)
  }
  return response.json()
}

async function checkPendingChanges() {
  files.replaceChildren()
  try {
    const comparison = await githubGet(`/repos/${repository}/compare/prod-published...main`, cmsSessionToken())
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

    const response = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'sveltia-cms-publish' }),
    })
    if (response.status !== 204) {
      throw new Error(`GitHub rejected the publication request: HTTP ${response.status}`)
    }

    statusElement.textContent = 'Publication requested. Follow its result in GitHub Actions.'
    actions.href = `https://github.com/${repository}/actions/workflows/prod.yml`
    actions.hidden = false
  }
  catch (error) {
    statusElement.textContent = error.message === 'GitHub API returned HTTP 401'
      ? 'GitHub session expired. Refresh or sign in to Sveltia CMS and retry.'
      : error.message || 'Failed to request publication.'
  }
  finally {
    button.disabled = false
  }
})

checkPendingChanges()
