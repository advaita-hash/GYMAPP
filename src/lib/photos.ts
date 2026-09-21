import { supabase } from './supabase'

const BUCKET = 'gym-photos'
const urlCache = new Map<string, { url: string; expires: number }>()

/** Upload a workout photo into the caller's own folder. Returns the storage path. */
export async function uploadWorkoutPhoto(userId: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type || 'image/jpeg',
  })
  if (error) throw error
  return path
}

/**
 * Best-effort photo removal. Callers delete the database row first, so a failure
 * here only leaves an unreferenced object in the bucket — never a workout whose
 * proof photo has gone missing. Returns false if the object outlived its row.
 */
export async function deleteWorkoutPhoto(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  urlCache.delete(path)
  return !error
}

/** Signed URL for one photo (cached ~50 min; links are valid 1 h). */
export async function photoUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path)
  if (hit && hit.expires > Date.now()) return hit.url
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data) return null
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 })
  return data.signedUrl
}

/** Batch-sign many photo paths at once (for the feed). Returns path -> url. */
export async function photoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const missing: string[] = []
  for (const p of paths) {
    const hit = urlCache.get(p)
    if (hit && hit.expires > Date.now()) out.set(p, hit.url)
    else missing.push(p)
  }
  if (missing.length > 0) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(missing, 3600)
    for (const item of data ?? []) {
      if (item.signedUrl && item.path) {
        out.set(item.path, item.signedUrl)
        urlCache.set(item.path, { url: item.signedUrl, expires: Date.now() + 50 * 60 * 1000 })
      }
    }
  }
  return out
}
