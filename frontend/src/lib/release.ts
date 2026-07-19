export interface ClientReleaseMetadata {
  app: string
  branch: string
  sha: string
  buildId: string
  environment: 'cloudflare-workers-builds' | 'github-actions' | 'local'
  builtAt: string
}

declare const __BESTCODE_RELEASE__: ClientReleaseMetadata

export const clientRelease: ClientReleaseMetadata = __BESTCODE_RELEASE__

export function shortSha(value: string | null | undefined): string {
  if (!value || value === 'unknown') return 'тодорхойгүй'
  return value.slice(0, 8)
}
