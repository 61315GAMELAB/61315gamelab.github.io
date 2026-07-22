import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-password',
}

const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD')
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,49}$/
const PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/ ()]{0,499}$/

// Game files live in Cloudflare R2 (S3-compatible); metadata stays in Supabase.
const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID')!
const R2_BUCKET = Deno.env.get('R2_BUCKET')!
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  service: 's3',
  region: 'auto',
})

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isSafePath(p: string): boolean {
  return PATH_RE.test(p) && !p.includes('..') && !p.startsWith('/') && !p.endsWith('/')
}

function objectUrl(key: string): string {
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  return `${R2_ENDPOINT}/${R2_BUCKET}/${encoded}`
}

async function presignPut(key: string, expiresSeconds = 3600): Promise<string> {
  const url = new URL(objectUrl(key))
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds))
  const signed = await r2.sign(new Request(url.toString(), { method: 'PUT' }), {
    aws: { signQuery: true },
  })
  return signed.url
}

// Hard cap so the bucket stays inside R2's 10GB free tier
const MAX_BUCKET_BYTES = 10 * 1000 ** 3

function unescapeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

async function listObjects(prefix: string): Promise<{ key: string; size: number }[]> {
  const objects: { key: string; size: number }[] = []
  let token: string | undefined
  do {
    const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}`)
    url.searchParams.set('list-type', '2')
    url.searchParams.set('prefix', prefix)
    if (token) url.searchParams.set('continuation-token', token)
    const res = await r2.fetch(url.toString())
    if (!res.ok) throw new Error(`R2 list failed (${res.status})`)
    const xml = await res.text()
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = m[1].match(/<Key>([^<]+)<\/Key>/)?.[1]
      const size = m[1].match(/<Size>(\d+)<\/Size>/)?.[1]
      if (key) objects.push({ key: unescapeXml(key), size: Number(size || 0) })
    }
    token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
  } while (token)
  return objects
}

async function listKeys(prefix: string): Promise<string[]> {
  return (await listObjects(prefix)).map((o) => o.key)
}

async function bucketUsage(): Promise<number> {
  return (await listObjects('')).reduce((sum, o) => sum + o.size, 0)
}

async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 10) {
    const batch = keys.slice(i, i + 10)
    const results = await Promise.all(
      batch.map((key) => r2.fetch(objectUrl(key), { method: 'DELETE' }))
    )
    for (const res of results) {
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status})`)
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const password = req.headers.get('x-admin-password')
  if (!ADMIN_PASSWORD) {
    return respond({ error: '관리자 비밀번호가 설정되지 않았습니다.' }, 500)
  }
  if (password !== ADMIN_PASSWORD) {
    return respond({ error: '관리자 인증 실패' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'list_games': {
        const { data, error } = await supabase.from('games').select('*').order('created_at', { ascending: false })
        if (error) throw error
        return respond({ games: data })
      }

      case 'create_game': {
        const { slug, title, description, width, height, entry_path } = body
        if (!slug || !SLUG_RE.test(slug)) return respond({ error: 'slug는 소문자/숫자/하이픈만 사용할 수 있습니다.' }, 400)
        if (!title) return respond({ error: '제목을 입력해주세요.' }, 400)
        const { data, error } = await supabase.from('games').insert({
          slug,
          title,
          description: description || '',
          width: width || 960,
          height: height || 600,
          entry_path: entry_path || 'index.html',
        }).select().single()
        if (error) throw error
        return respond({ game: data })
      }

      case 'update_game': {
        const { id, updates } = body
        const allowed = ['title', 'description', 'width', 'height', 'published', 'entry_path', 'cover_path']
        const safeUpdates: Record<string, unknown> = {}
        for (const key of allowed) {
          if (key in (updates || {})) safeUpdates[key] = updates[key]
        }
        safeUpdates.updated_at = new Date().toISOString()
        const { data, error } = await supabase.from('games').update(safeUpdates).eq('id', id).select().single()
        if (error) throw error
        return respond({ game: data })
      }

      case 'delete_game': {
        const { id } = body
        const { data: game, error: getErr } = await supabase.from('games').select('slug, cover_path').eq('id', id).single()
        if (getErr) throw getErr
        const keys = await listKeys(`${game.slug}/`)
        if (game.cover_path) keys.push(game.cover_path)
        await deleteKeys(keys)
        const { error } = await supabase.from('games').delete().eq('id', id)
        if (error) throw error
        return respond({ success: true })
      }

      // Clear a game's previous build files before uploading a new one
      case 'clear_files': {
        const { slug } = body
        if (!slug || !SLUG_RE.test(slug)) return respond({ error: '잘못된 slug입니다.' }, 400)
        const keys = await listKeys(`${slug}/`)
        await deleteKeys(keys)
        return respond({ success: true, removed: keys.length })
      }

      case 'bucket_usage': {
        const used = await bucketUsage()
        return respond({ used, limit: MAX_BUCKET_BYTES })
      }

      // Issue presigned R2 PUT URLs so the browser uploads directly
      case 'sign_uploads': {
        const { slug, paths, bytes } = body
        if (!slug || !SLUG_RE.test(slug)) return respond({ error: '잘못된 slug입니다.' }, 400)
        if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
          return respond({ error: '경로는 1~100개씩 요청해주세요.' }, 400)
        }
        const used = await bucketUsage()
        const incoming = typeof bytes === 'number' && bytes > 0 ? bytes : 0
        if (used + incoming > MAX_BUCKET_BYTES) {
          return respond({
            error: `저장 용량 한도(10GB)를 초과합니다. 현재 ${(used / 1e9).toFixed(2)}GB 사용 중 — 기존 게임을 삭제한 뒤 다시 시도해주세요.`,
          }, 400)
        }
        const signed = []
        for (const p of paths) {
          if (typeof p !== 'string' || !isSafePath(p)) return respond({ error: `잘못된 경로: ${p}` }, 400)
          signed.push({ path: p, signedUrl: await presignPut(`${slug}/${p}`) })
        }
        return respond({ signed })
      }

      // Covers live under _covers/ so replacing a build doesn't wipe them
      case 'sign_cover': {
        const { slug, ext } = body
        if (!slug || !SLUG_RE.test(slug)) return respond({ error: '잘못된 slug입니다.' }, 400)
        if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return respond({ error: '지원하지 않는 이미지 형식입니다.' }, 400)
        if (await bucketUsage() >= MAX_BUCKET_BYTES) {
          return respond({ error: '저장 용량 한도(10GB)에 도달했습니다. 기존 게임을 삭제한 뒤 다시 시도해주세요.' }, 400)
        }
        const oldCovers = await listKeys(`_covers/${slug}.`)
        await deleteKeys(oldCovers)
        const coverPath = `_covers/${slug}.${ext}`
        return respond({ path: coverPath, signedUrl: await presignPut(coverPath) })
      }

      default:
        return respond({ error: '알 수 없는 액션입니다.' }, 400)
    }
  } catch (e) {
    return respond({ error: (e as Error).message || '요청 처리 중 오류 발생' }, 500)
  }
})
