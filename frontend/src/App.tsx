import { Suspense, lazy, useState } from 'react'
import { TabBar } from './components/layout/TabBar'
import { ChatView } from './components/chat/ChatView'
import { FilesView } from './components/files/FilesView'
import { ChangesView } from './components/changes/ChangesView'
import { SettingsView } from './components/settings/SettingsView'

// esbuild-wasm's JS glue is sizeable — only pull it into the bundle once the user opens Preview.
const PreviewView = lazy(() => import('./components/preview/PreviewView').then((module) => ({ default: module.PreviewView })))

export type Tab = 'chat' | 'files' | 'changes' | 'preview' | 'settings'

function App() {
  const [tab, setTab] = useState<Tab>('chat')

  return (
    <>
      {tab === 'chat' && <ChatView />}
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
