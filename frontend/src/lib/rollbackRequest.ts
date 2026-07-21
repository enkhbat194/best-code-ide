import { useSettingsStore } from '../store/settingsStore'

interface ActionEnvelope<T> {
  ok: boolean
  operation_id: string
  status: string
  result?: T
  error?: { code: string; message: string; action_required: string }
}

interface ProjectListItem { id: string; repository: string }

export interface RollbackRequestInput {
  worker: 'best-code-ide' | 'best-code-ide-appl'
  targetVersionId: string
  targetCommitSha: string
  incidentNote: string
  smokeExpectation: string
}

export interface RollbackRequestResult {
  operationId: string
  status: string
  currentMainSha: string
  targetCommitSha: string
}

async function action<T>(name: string, body: Record<string, unknown>): Promise<ActionEnvelope<T>> {
  const settings = useSettingsStore.getState()
  if (!settings.isConfigured()) throw new Error('Backend тохиргоо дутуу байна')
  const response = await fetch(`${settings.backendUrl}/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.authToken}` },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as ActionEnvelope<T>
  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(payload.error ? `${payload.error.code}: ${payload.error.message} ${payload.error.action_required}` : 'Rollback хүсэлт амжилтгүй')
  }
  return payload
}

export async function requestRollback(input: RollbackRequestInput): Promise<RollbackRequestResult> {
  const settings = useSettingsStore.getState()
  const expectedRepo = `${settings.owner}/${settings.repo}`.toLowerCase()
  const projects = await action<{ items: ProjectListItem[] }>('projects_list', { limit: 50 })
  const project = projects.result?.items.find((item) => item.repository.toLowerCase() === expectedRepo)
  if (!project) throw new Error('BestCode project registry-д repository олдсонгүй')

  const result = await action<{
    current_main_sha: string
    target_commit_sha: string
  }>('rollback_request', {
    project_id: project.id,
    worker: input.worker,
    target_version_id: input.targetVersionId.trim(),
    target_commit_sha: input.targetCommitSha.trim(),
    incident_note: input.incidentNote.trim(),
    smoke_expectation: input.smokeExpectation.trim(),
  })

  return {
    operationId: result.operation_id,
    status: result.status,
    currentMainSha: result.result!.current_main_sha,
    targetCommitSha: result.result!.target_commit_sha,
  }
}
