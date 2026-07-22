import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-password',
}

const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD')
const BUCKET = 'games'
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,49}$/
const PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/ ()]{0,499}$/

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isSafePath(p: string): boolean {
  return PATH_RE.test(p) && !p.includes('..') && !p.startsWith('/') && !p.endsWith('/')
}

// storage.list() is not recursive — walk folders to collect every object key
async function listAllFiles(supabase: ReturnType<typeof createClient>, prefix: string): Promise<string[]> {
  const files: string[] = []
  const queue = [prefix]
  while (queue.length > 0) {
    const dir = queue.pop()!
    let offset = 0
    while (true) {
      const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 100, offset })
      if (error) throw error
      if (!data || data.length === 0) break
      for (const entry of data) {
        const full = dir ? `${dir}/${entry.name}` : entry.name
        if (entry.id === null) queue.push(full) // folder
        else files.push(full)
      }
      if (data.length < 100) break
      offset += 100
    }
  }
  return files
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
        const files = await listAllFiles(supabase, game.slug)
        if (game.cover_path) files.push(game.cover_path)
        for (let i = 0; i < files.length; i += 100) {
          const { error } = await supabase.storage.from(BUCKET).remove(files.slice(i, i + 100))
          if (error) throw error
        }
        const { error } = await supabase.from('games').delete().eq('id', id)
        if (error) throw error
        return respond({ success: true })
      }

      // Clear a game's previous build files before uploading a new one
      case 'clear_files': {
        const { slug } = body
        if (!slug || !SLUG_RE.test(slug)) return respond({ error: '잘못된 slug입니다.' }, 400)
        const files = await listAllFiles(supabase, slug)
        for (let i = 0; i < files.length; i += 100) {
          const { error } = await supabase.storage.from(BUCKET).remove(files.slice(i, i + 100))
          if (error) throw error
        }
        return respond({ success: true, removed: files.length })
      }

      // Issue signed upload URLs so the browser uploads directly to storage
      case 'sign_uploads': {
        const { slug, paths } = body
        if (!slug || !SLUG_RE.test(slug)) return respond({ error: '잘못된 slug입니다.' }, 400)
        if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
          return respond({ error: '경로는 1~100개씩 요청해주세요.' }, 400)
        }
        const signed = []
        for (const p of paths) {
          if (typeof p !== 'string' || !isSafePath(p)) return respond({ error: `잘못된 경로: ${p}` }, 400)
          const fullPath = `${slug}/${p}`
          const { data, error } = await supabase.storage.from(BUCKET)
            .createSignedUploadUrl(fullPath, { upsert: true })
          if (error) throw error
          signed.push({ path: p, signedUrl: data.signedUrl, token: data.token })
        }
        return respond({ signed })
      }

      // Covers live under _covers/ so replacing a build doesn't wipe them
      case 'sign_cover': {
        const { slug, ext } = body
        if (!slug || !SLUG_RE.test(slug)) return respond({ error: '잘못된 slug입니다.' }, 400)
        if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return respond({ error: '지원하지 않는 이미지 형식입니다.' }, 400)
        const coverPath = `_covers/${slug}.${ext}`
        await supabase.storage.from(BUCKET).remove([coverPath])
        const { data, error } = await supabase.storage.from(BUCKET)
          .createSignedUploadUrl(coverPath, { upsert: true })
        if (error) throw error
        return respond({ path: coverPath, signedUrl: data.signedUrl, token: data.token })
      }

      default:
        return respond({ error: '알 수 없는 액션입니다.' }, 400)
    }
  } catch (e) {
    return respond({ error: (e as Error).message || '요청 처리 중 오류 발생' }, 500)
  }
})
