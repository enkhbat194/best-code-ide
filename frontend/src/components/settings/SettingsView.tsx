import { useSettingsStore } from '../../store/settingsStore'
import styles from './SettingsView.module.css'

export function SettingsView() {
  const s = useSettingsStore()
  const configured = s.isConfigured()

  return (
    <div className={`${styles.wrap} scroll-y`}>
      <div className={styles.status}>
        <span className={`${styles.dot} ${configured ? styles.ok : ''}`} />
        {configured ? 'Backend тохируулагдсан' : 'Backend тохируулаагүй байна'}
      </div>

      <div className={styles.field}>
        <label>Worker backend URL</label>
        <input
          placeholder="https://mobilecode-ai.your-name.workers.dev"
          value={s.backendUrl}
          onChange={(e) => s.setBackendUrl(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      <div className={styles.field}>
        <label>Auth token (Worker дээр тохируулсан AUTH_TOKEN)</label>
        <input
          type="password"
          value={s.authToken}
          onChange={(e) => s.setAuthToken(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      <div className={styles.field}>
        <label>GitHub owner</label>
        <input value={s.owner} onChange={(e) => s.setOwner(e.target.value)} placeholder="enkhbat194" />
      </div>

      <div className={styles.field}>
        <label>GitHub repo</label>
        <input value={s.repo} onChange={(e) => s.setRepo(e.target.value)} placeholder="best-code-ide" />
      </div>

      <div className={styles.field}>
        <label>Branch</label>
        <input value={s.branch} onChange={(e) => s.setBranch(e.target.value)} placeholder="main" />
      </div>

      <p className={styles.hint}>
        DeepSeek API key болон GitHub token нь энэ апп дотор биш, зөвхөн Cloudflare Worker дээр нууцаар
        хадгалагдана. Энд оруулсан "Auth token" нь зөвхөн энэ апп/AI chat-ыг таны Worker-тэй холбоход
        ашиглагдана.
      </p>
    </div>
  )
}
