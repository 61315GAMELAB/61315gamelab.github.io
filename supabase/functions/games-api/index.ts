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

// Hard cap so the bucket stays inside R2's 10GB free tier
const MAX_BUCKET_BYTES = 10 * 1000 ** 3
// Anonymous-upload abuse guard: games one IP can create per 24h
const MAX_GAMES_PER_IP_PER_DAY = 10
// Games above this size require naming a 61315 staff member.
// The roster lives ONLY in the STAFF_NAMES secret (comma-separated) — never in this repo.
const BIG_GAME_BYTES = 500 * 1000 ** 2
const STAFF_NAMES = (Deno.env.get('STAFF_NAMES') || '')
  .split(',').map((n) => n.replace(/\s+/g, '')).filter(Boolean)

// Columns safe to return to clients (never upload_token; uploader_ip is admin-only)
const GAME_COLS = 'id, slug, title, description, entry_path, cover_path, width, height, published, created_at, updated_at'
const ADMIN_GAME_COLS = `${GAME_COLS}, uploader_ip`

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isIpish(s: string): boolean {
  return /^[0-9a-fA-F:.]{3,45}$/.test(s)
}

// Supabase 게이트웨이가 채워주는 x-forwarded-for의 첫 항목만 신뢰한다.
// x-real-ip는 클라이언트가 임의로 넣어 차단/한도를 우회할 수 있으므로 기본 신뢰하지 않고,
// x-forwarded-for가 아예 없을 때만 보조로 사용한다.
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0].trim()
    if (isIpish(first)) return first
  }
  const real = req.headers.get('x-real-ip')?.trim()
  if (real && isIpish(real)) return real
  return 'unknown'
}

// 비밀번호를 상수 시간에 비교해 타이밍 사이드채널을 막는다.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const va = new Uint8Array(ha)
  const vb = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
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

// Actions anyone may call (uploads are anonymous; ownership is proven by upload_token)
const PUBLIC_ACTIONS = ['create_game', 'sign_uploads', 'sign_cover', 'clear_files', 'finish_upload']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const isAdmin = !!ADMIN_PASSWORD && await timingSafeEqual(req.headers.get('x-admin-password') || '', ADMIN_PASSWORD)

  // Fetch a game by slug and verify the caller owns it via upload_token
  async function requireOwner(slug: unknown, token: unknown) {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null
    if (typeof token !== 'string' || !token) return null
    const { data } = await supabase.from('games').select('*').eq('slug', slug).maybeSingle()
    if (!data || data.upload_token !== token) return null
    return data
  }

  try {
    const body = await req.json()
    const { action } = body
    const ip = clientIp(req)

    if (PUBLIC_ACTIONS.includes(action)) {
      const { data: blocked } = await supabase.from('blocked_ips').select('ip').eq('ip', ip).maybeSingle()
      if (blocked) return respond({ error: '차단된 IP입니다. 업로드할 수 없습니다.' }, 403)
    }

    switch (action) {
      // ---------- 공개 액션 (비밀번호 불필요) ----------

      case 'create_game': {
        const { slug, title, description, width, height, entry_path } = body
        if (!slug || !SLUG_RE.test(slug)) return respond({ error: 'slug는 소문자/숫자/하이픈만 사용할 수 있습니다.' }, 400)
        if (!title) return respond({ error: '제목을 입력해주세요.' }, 400)

        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
        const { count } = await supabase.from('games')
          .select('id', { count: 'exact', head: true })
          .eq('uploader_ip', ip).gte('created_at', since)
        if ((count ?? 0) >= MAX_GAMES_PER_IP_PER_DAY) {
          return respond({ error: `하루 업로드 한도(${MAX_GAMES_PER_IP_PER_DAY}개)를 초과했습니다. 내일 다시 시도해주세요.` }, 429)
        }

        const { data, error } = await supabase.from('games').insert({
          slug,
          title,
          description: description || '',
          width: width || 960,
          height: height || 600,
          entry_path: entry_path || 'index.html',
          published: false, // finish_upload가 파일 업로드 완료 후 공개로 전환
          uploader_ip: ip,
        }).select(`${GAME_COLS}, upload_token`).single()
        if (error) {
          if (error.code === '23505') return respond({ error: '이미 사용 중인 주소(slug)입니다. 다른 slug를 골라주세요.' }, 409)
          throw error
        }
        const { upload_token, ...game } = data
        return respond({ game, upload_token })
      }

      // Issue presigned R2 PUT URLs so the browser uploads directly
      case 'sign_uploads': {
        const { slug, paths, bytes, token } = body
        const game = await requireOwner(slug, token)
        if (!game) return respond({ error: '업로드 권한이 없습니다. (slug/토큰 불일치)' }, 403)
        if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
          return respond({ error: '경로는 1~100개씩 요청해주세요.' }, 400)
        }
        const objects = await listObjects('')
        const used = objects.reduce((sum, o) => sum + o.size, 0)
        const incoming = typeof bytes === 'number' && bytes > 0 ? bytes : 0
        if (used + incoming > MAX_BUCKET_BYTES) {
          return respond({
            error: `저장 용량 한도(10GB)를 초과합니다. 현재 ${(used / 1e9).toFixed(2)}GB 사용 중입니다.`,
          }, 400)
        }
        // 500MB가 넘는 게임은 운영진 이름을 알아야 올릴 수 있다 (이미 올라간 실제 크기 기준)
        const gameUsed = objects.filter((o) => o.key.startsWith(`${slug}/`)).reduce((sum, o) => sum + o.size, 0)
        if (gameUsed + incoming > BIG_GAME_BYTES) {
          const answer = typeof body.staff_name === 'string' ? body.staff_name.replace(/\s+/g, '') : ''
          if (STAFF_NAMES.length === 0) {
            return respond({ error: '500MB가 넘는 게임 업로드는 현재 비활성화되어 있습니다.' }, 403)
          }
          if (!STAFF_NAMES.includes(answer)) {
            return respond({ error: 'STAFF_CHECK_FAILED' }, 403)
          }
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
        const { slug, ext, token } = body
        const game = await requireOwner(slug, token)
        if (!game) return respond({ error: '업로드 권한이 없습니다. (slug/토큰 불일치)' }, 403)
        if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return respond({ error: '지원하지 않는 이미지 형식입니다.' }, 400)
        if (await bucketUsage() >= MAX_BUCKET_BYTES) {
          return respond({ error: '저장 용량 한도(10GB)에 도달했습니다.' }, 400)
        }
        const oldCovers = await listKeys(`_covers/${slug}.`)
        await deleteKeys(oldCovers)
        const coverPath = `_covers/${slug}.${ext}`
        return respond({ path: coverPath, signedUrl: await presignPut(coverPath) })
      }

      // Clear a game's previous build files before uploading a new one
      case 'clear_files': {
        const { slug, token } = body
        const game = await requireOwner(slug, token)
        if (!game) return respond({ error: '권한이 없습니다. (slug/토큰 불일치)' }, 403)
        const keys = await listKeys(`${slug}/`)
        await deleteKeys(keys)
        return respond({ success: true, removed: keys.length })
      }

      // Mark the game live once all files are uploaded (also updates metadata)
      case 'finish_upload': {
        const { slug, token, title, description, width, height, cover_path } = body
        const game = await requireOwner(slug, token)
        if (!game) return respond({ error: '권한이 없습니다. (slug/토큰 불일치)' }, 403)

        // 신고값(bytes)이 아니라 R2에 실제로 올라간 크기로 한도·게이트를 다시 검증한다.
        // (sign_uploads의 검사는 클라이언트가 보낸 bytes에 의존하므로 우회될 수 있다.)
        const objects = await listObjects('')
        const bucketUsed = objects.reduce((sum, o) => sum + o.size, 0)
        if (bucketUsed > MAX_BUCKET_BYTES) {
          return respond({
            error: `저장 용량 한도(10GB)를 초과했습니다. 현재 ${(bucketUsed / 1e9).toFixed(2)}GB 사용 중입니다.`,
          }, 400)
        }
        const gameKeys = objects.filter((o) => o.key.startsWith(`${slug}/`))
        const gameUsed = gameKeys.reduce((sum, o) => sum + o.size, 0)
        if (gameUsed > BIG_GAME_BYTES) {
          const answer = typeof body.staff_name === 'string' ? body.staff_name.replace(/\s+/g, '') : ''
          if (STAFF_NAMES.length === 0 || !STAFF_NAMES.includes(answer)) {
            // 게이트를 통과하지 못한 대용량 업로드는 공개하지 않고 파일을 되돌린다.
            await deleteKeys(gameKeys.map((o) => o.key))
            return respond({
              error: STAFF_NAMES.length === 0 ? '500MB가 넘는 게임 업로드는 현재 비활성화되어 있습니다.' : 'STAFF_CHECK_FAILED',
            }, 403)
          }
        }

        const updates: Record<string, unknown> = { published: true, updated_at: new Date().toISOString() }
        if (typeof title === 'string' && title) updates.title = title
        if (typeof description === 'string') updates.description = description
        if (typeof width === 'number') updates.width = width
        if (typeof height === 'number') updates.height = height
        if (typeof cover_path === 'string' && cover_path) updates.cover_path = cover_path
        const { data, error } = await supabase.from('games').update(updates).eq('id', game.id).select(GAME_COLS).single()
        if (error) throw error
        return respond({ game: data })
      }

      // ---------- 관리자 액션 (x-admin-password 필요) ----------

      default: {
        if (!ADMIN_PASSWORD) return respond({ error: '관리자 비밀번호가 설정되지 않았습니다.' }, 500)
        if (!isAdmin) return respond({ error: '관리자 인증 실패' }, 401)

        switch (action) {
          case 'list_games': {
            const { data, error } = await supabase.from('games').select(ADMIN_GAME_COLS).order('created_at', { ascending: false })
            if (error) throw error
            return respond({ games: data })
          }

          case 'update_game': {
            const { id, updates } = body
            const allowed = ['title', 'description', 'width', 'height', 'published', 'entry_path', 'cover_path']
            const safeUpdates: Record<string, unknown> = {}
            for (const key of allowed) {
              if (key in (updates || {})) safeUpdates[key] = updates[key]
            }
            safeUpdates.updated_at = new Date().toISOString()
            const { data, error } = await supabase.from('games').update(safeUpdates).eq('id', id).select(ADMIN_GAME_COLS).single()
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

          // Blocking also unpublishes that IP's games (reversible via update_game)
          case 'block_ip': {
            const { ip: target, reason } = body
            if (typeof target !== 'string' || !target.trim()) return respond({ error: 'IP를 입력해주세요.' }, 400)
            const { error } = await supabase.from('blocked_ips').upsert({ ip: target.trim(), reason: reason || '' })
            if (error) throw error
            await supabase.from('games').update({ published: false, updated_at: new Date().toISOString() }).eq('uploader_ip', target.trim())
            return respond({ success: true })
          }

          case 'unblock_ip': {
            const { ip: target } = body
            const { error } = await supabase.from('blocked_ips').delete().eq('ip', target)
            if (error) throw error
            return respond({ success: true })
          }

          case 'list_blocked_ips': {
            const { data, error } = await supabase.from('blocked_ips').select('*').order('created_at', { ascending: false })
            if (error) throw error
            return respond({ blocked: data })
          }

          case 'bucket_usage': {
            const used = await bucketUsage()
            return respond({ used, limit: MAX_BUCKET_BYTES })
          }

          default:
            return respond({ error: '알 수 없는 액션입니다.' }, 400)
        }
      }
    }
  } catch (e) {
    return respond({ error: (e as Error).message || '요청 처리 중 오류 발생' }, 500)
  }
})
