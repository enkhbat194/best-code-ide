import FS from '@isomorphic-git/lightning-fs'
import type { FileEntry } from '../types'

// Persists to IndexedDB under the hood — code survives offline / app restarts
// entirely on-device, independent of GitHub.
const fs = new FS('codeide-fs')
export const pfs = fs.promises

async function ensureDir(dirPath: string): Promise<void> {
  if (!dirPath || dirPath === '/') return
  const parts = dirPath.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    try {
      await pfs.mkdir(current)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'EEXIST') throw err
    }
  }
}

export async function listTree(root = '/'): Promise<FileEntry[]> {
  const results: FileEntry[] = []

  async function walk(dir: string) {
    let names: string[] = []
    try {
      names = await pfs.readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      const full = dir === '/' ? `/${name}` : `${dir}/${name}`
      const stat = await pfs.stat(full)
      if (stat.isDirectory()) {
        results.push({ path: full, isDir: true })
        await walk(full)
      } else {
        results.push({ path: full, isDir: false })
      }
    }
  }

  await walk(root)
  return results.sort((a, b) => a.path.localeCompare(b.path))
}

export async function readFile(path: string): Promise<string> {
  const data = await pfs.readFile(path, { encoding: 'utf8' })
  return data as string
}

export async function writeFile(path: string, content: string): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  await ensureDir(dir)
  await pfs.writeFile(path, content, 'utf8')
}

export async function deletePath(path: string): Promise<void> {
  const stat = await pfs.stat(path)
  if (stat.isDirectory()) {
    const names = await pfs.readdir(path)
    for (const name of names) {
      await deletePath(`${path}/${name}`)
    }
    await pfs.rmdir(path)
  } else {
    await pfs.unlink(path)
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await pfs.stat(path)
    return true
  } catch {
    return false
  }
}
