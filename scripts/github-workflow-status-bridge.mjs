#!/usr/bin/env node

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function safeText(value, max = 140) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function request(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${safeText(data?.message) || 'request failed'}`)
  return data
}

export function selectExpectedRun(runs, expectedSha) {
  return (Array.isArray(runs) ? runs : []).find((run) => (
    run?.head_sha === expectedSha
    && run?.event === 'push'
    && run?.status === 'completed'
    && Number.isSafeInteger(run?.id)
  )) ?? null
}

export function statusState(conclusion) {
  return conclusion === 'success' ? 'success' : 'failure'
}

async function main() {
  const token = required('GITHUB_TOKEN')
  const repository = required('GITHUB_REPOSITORY')
  const branch = required('GITHUB_REF_NAME')
  const currentSha = required('GITHUB_SHA')
  const expectedSha = required('EXPECTED_REHEARSAL_SHA')
  const base = `https://api.github.com/repos/${repository}`
  const query = new URLSearchParams({ branch, event: 'push', per_page: '20' })
  const runs = await request(`${base}/actions/workflows/rollback-rehearsal.yml/runs?${query}`, token)
  const run = selectExpectedRun(runs?.workflow_runs, expectedSha)
  if (!run) throw new Error(`Completed rollback rehearsal run not found for ${expectedSha}`)

  const state = statusState(run.conclusion)
  const description = `rollback rehearsal ${run.id}: ${safeText(run.conclusion || run.status, 40)}`.slice(0, 140)
  await request(`${base}/statuses/${currentSha}`, token, {
    method: 'POST',
    body: JSON.stringify({
      state,
      context: 'BestCode/Rollback Rehearsal Evidence',
      description,
      target_url: run.html_url,
    }),
  })
  console.log(description)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
