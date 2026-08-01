import { Suspense, lazy, useEffect, useState } from 'react'
import { TabBar } from './components/layout/TabBar'
import { MissionWorkspace } from './components/mission/MissionWorkspace'
import { FilesView } from './components/files/FilesView'
import { ChangesView } from './components/changes/ChangesView'
import { SettingsView } from './components/settings/SettingsView'
import { importGitHubWorkspace } from './lib/workspace'
import { clientRelease } from './lib/release'
import { useFsStore } from './store/fsStore'
import { useSettingsStore } from './store/settingsStore'

// esbuild-wasm's JS glue is sizeable — only pull it into the bundle once the user opens Preview.
const PreviewView = lazy(() => import('./components/preview/PreviewView').then((module) => ({ default: module.PreviewView })))

const LEGACY_PREVIEW_SOURCE_KEY = 'codeide-workspace-source'
const PREVIEW_ISOLATION_REPAIR_KEY = 'codeide-preview-isolation-repair-v1'

export type Tab = 'chat' | 'files' | 'changes' | 'preview' | 'settings'

function App() {
  const [tab, setTab] = useState<Tab>('chat')

  useEffect(() => {
    const legacyPreviewSource = window.localStorage.getItem(LEGACY_PREVIEW_SOURCE_KEY)
    if (!legacyPreviewSource || window.localStorage.getItem(PREVIEW_ISOLATION_REPAIR_KEY)) return

    let cancelled = false
    const repairLegacyPreviewImport = async () => {
      const settings = useSettingsStore.getState()
      const branch = clientRelease.branch && clientRelease.branch !== 'local' ? clientRelease.branch : 'main'
      const repository = {
        owner: settings.owner || 'enkhbat194',
        name: clientRelease.app,
        defaultBranch: branch,
      }

      settings.setOwner(repository.owner)
      settings.setRepo(repository.name)
      settings.setBranch(repository.defaultBranch)

      try {
        await importGitHubWorkspace(repository, 300)
        if (cancelled) return
        await useFsStore.getState().refresh()
        window.localStorage.removeItem(LEGACY_PREVIEW_SOURCE_KEY)
        window.localStorage.setItem(PREVIEW_ISOLATION_REPAIR_KEY, 'done')
      } catch (error) {
        console.error('Legacy preview workspace repair failed', error)
      }
    }

    void repairLegacyPreviewImport()
    return () => { cancelled = true }
  }, [])

  return (
    <>
      {tab === 'chat' && <MissionWorkspace />}
      {tab === 'files' && <FilesView />}
      {tab === 'changes' && <ChangesView />}
      {tab === 'preview' && (
        <Suspense fallback={null}>
          <PreviewView />
        </Suspense>
      )}
      {tab === 'settings' && <SettingsView />}
      <TabBar active={tab} onChange={setTab} />
    </>
  )
}

export default App
