const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-password',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD')
const GITHUB_TOKEN = Deno.env.get('GITHUB_CONTENT_TOKEN') || Deno.env.get('GITHUB_TOKEN') || ''
const REPO_OWNER = Deno.env.get('CONTENT_REPO_OWNER') || '61315GAMELAB'
const REPO_NAME = Deno.env.get('CONTENT_REPO_NAME') || '61315gamelab.github.io'
const REPO_BRANCH = Deno.env.get('CONTENT_REPO_BRANCH') || 'main'
const GITHUB_API_BASE = 'https://api.github.com'

const CONTENT_PATH_RE = /^content\/post\/(activity|meeting|project)\/([^/]+)\/index\.md$/
const VALID_CATEGORIES = new Set(['activity', 'meeting', 'project'])
const VALID_IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpg', '.jpeg', '.png', '.svg', '.webp'])

type ContentCategory = 'activity' | 'meeting' | 'project'

type GitRefResponse = {
  object: {
    sha: string
  }
}

type GitCommitResponse = {
  sha: string
  tree: {
    sha: string
  }
}

type GitTreeEntry = {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string | null
}

type GitTreeResponse = {
  tree: GitTreeEntry[]
}

type GitBlobResponse = {
  content: string
  encoding: string
}

type GitHubContentsResponse = {
  content: string
  encoding: string
}

type ContentPostInput = {
  category: ContentCategory
  slug: string
  title: string
  date: string
  description: string
  tags: string[]
  image?: string
  draft: boolean
  body: string
}

type ContentPost = {
  path: string
  category: ContentCategory
  slug: string
  title: string
  date: string
  description: string
  tags: string[]
  image?: string
  draft: boolean
  body: string
  markdown: string
}

type GitTreeChange = {
  path: string
  mode: string
  type: 'blob'
  sha?: string | null
  content?: string
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function requireGithubToken() {
  if (!GITHUB_TOKEN) {
    throw new Error('Supabase secret GITHUB_CONTENT_TOKEN is not configured.')
  }
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function decodeBase64Utf8(content: string) {
  const binary = atob(content.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function unescapeTomlString(value: string) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function escapeTomlString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function parseContentPath(path: string) {
  const match = path.match(CONTENT_PATH_RE)
  if (!match) return null

  return {
    category: match[1] as ContentCategory,
    slug: match[2],
  }
}

function getFileExtension(filename: string) {
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : ''
}

function normalizeAssetFilename(filename: string) {
  const basename = filename.split(/[/\\]/).pop()?.trim() || ''
  const normalized = basename
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')

  if (!normalized) {
    throw new Error('유효한 파일명이 없습니다.')
  }

  const extension = getFileExtension(normalized)
  if (!VALID_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('png, jpg, jpeg, gif, webp, avif, svg 이미지 파일만 업로드할 수 있습니다.')
  }

  return normalized
}

function splitFrontMatter(markdown: string) {
  const match = markdown.match(/^\+\+\+\s*\n([\s\S]*?)\n\+\+\+\s*\n?([\s\S]*)$/)
  if (!match) {
    return {
      frontMatter: '',
      body: markdown.trim(),
    }
  }

  return {
    frontMatter: match[1],
    body: match[2].trim(),
  }
}

function readTomlString(frontMatter: string, key: string) {
  const match = frontMatter.match(new RegExp(`^${key}\\s*=\\s*"((?:\\\\.|[^"])*)"`, 'm'))
  return match ? unescapeTomlString(match[1]) : ''
}

function readTomlBoolean(frontMatter: string, key: string) {
  const match = frontMatter.match(new RegExp(`^${key}\\s*=\\s*(true|false)`, 'm'))
  return match ? match[1] === 'true' : false
}

function readTomlStringArray(frontMatter: string, key: string) {
  const match = frontMatter.match(new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'))
  if (!match) return []

  return Array.from(match[1].matchAll(/"((?:\\.|[^"])*)"/g)).map((item) => unescapeTomlString(item[1]))
}

function buildMarkdown(post: ContentPostInput) {
  const tags = post.tags.length > 0 ? post.tags : [post.category]
  const lines = [
    '+++',
    `title = "${escapeTomlString(post.title)}"`,
    `date = "${post.date}"`,
    `draft = ${post.draft ? 'true' : 'false'}`,
    `description = "${escapeTomlString(post.description)}"`,
    'categories = [',
    `    "${post.category}"`,
    ']',
    'tags = [',
    ...tags.map((tag, index) => `    "${escapeTomlString(tag)}"${index === tags.length - 1 ? '' : ','}`),
    ']',
    ...(post.image ? [`image = "${escapeTomlString(post.image)}"`] : []),
    '+++',
    '',
    post.body.trim(),
    '',
  ]

  return lines.join('\n')
}

function parsePostFromMarkdown(path: string, markdown: string): ContentPost {
  const pathInfo = parseContentPath(path)
  if (!pathInfo) {
    throw new Error(`Unsupported content path: ${path}`)
  }

  const { frontMatter, body } = splitFrontMatter(markdown)
  const categories = readTomlStringArray(frontMatter, 'categories')
  const tags = readTomlStringArray(frontMatter, 'tags')
  const category = VALID_CATEGORIES.has(categories[0]) ? (categories[0] as ContentCategory) : pathInfo.category
  const image = readTomlString(frontMatter, 'image') || undefined

  return {
    path,
    category,
    slug: pathInfo.slug,
    title: readTomlString(frontMatter, 'title') || pathInfo.slug,
    date: readTomlString(frontMatter, 'date'),
    description: readTomlString(frontMatter, 'description'),
    tags: tags.length > 0 ? tags : [category],
    image,
    draft: readTomlBoolean(frontMatter, 'draft'),
    body,
    markdown,
  }
}

function validatePostInput(post: ContentPostInput) {
  if (!post || typeof post !== 'object') {
    throw new Error('게시글 데이터가 비어 있습니다.')
  }

  if (!VALID_CATEGORIES.has(post.category)) {
    throw new Error('지원하지 않는 게시글 카테고리입니다.')
  }

  const normalizedSlug = post.slug.trim()
  if (!normalizedSlug) {
    throw new Error('폴더명을 입력해주세요.')
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(normalizedSlug)) {
    throw new Error('폴더명은 한글, 영문, 숫자, 밑줄(_), 하이픈(-)만 사용할 수 있습니다.')
  }

  const normalizedTitle = post.title.trim()
  if (!normalizedTitle) {
    throw new Error('제목을 입력해주세요.')
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
    throw new Error('날짜 형식은 YYYY-MM-DD여야 합니다.')
  }

  const normalizedTags = Array.from(
    new Set(
      (post.tags || [])
        .map((tag) => String(tag).trim())
        .filter(Boolean),
    ),
  )

  return {
    category: post.category,
    slug: normalizedSlug,
    title: normalizedTitle,
    date: post.date,
    description: post.description?.replace(/\r?\n/g, ' ').trim() || '',
    tags: normalizedTags.length > 0 ? normalizedTags : [post.category],
    image: post.image?.trim() || undefined,
    draft: Boolean(post.draft),
    body: post.body?.replace(/\r\n/g, '\n') || '',
  } satisfies ContentPostInput
}

async function githubRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/vnd.github+json')
  if (GITHUB_TOKEN) {
    headers.set('Authorization', `Bearer ${GITHUB_TOKEN}`)
  }
  headers.set('X-GitHub-Api-Version', '2022-11-28')

  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    let message = `GitHub API request failed (${response.status})`

    const text = await response.text()
    if (text) {
      try {
        const data = JSON.parse(text)
        if (data?.message) {
          message = data.message
        } else {
          message = text
        }
      } catch {
        message = text
      }
    }

    throw new Error(message)
  }

  if (response.status === 204) {
    return null as T
  }

  return await response.json() as T
}

async function getRepositorySnapshot() {
  const ref = await githubRequest<GitRefResponse>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${encodeURIComponent(REPO_BRANCH)}`,
  )
  const commit = await githubRequest<GitCommitResponse>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${ref.object.sha}`,
  )
  const tree = await githubRequest<GitTreeResponse>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${commit.tree.sha}?recursive=1`,
  )

  return {
    commitSha: commit.sha,
    treeSha: commit.tree.sha,
    entries: tree.tree,
  }
}

async function getBlobText(sha: string) {
  const blob = await githubRequest<GitBlobResponse>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${sha}`,
  )

  if (blob.encoding !== 'base64') {
    throw new Error(`Unsupported blob encoding: ${blob.encoding}`)
  }

  return decodeBase64Utf8(blob.content)
}

function encodeBase64Bytes(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

async function createBlobFromBytes(bytes: Uint8Array) {
  const blob = await githubRequest<{ sha: string }>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: encodeBase64Bytes(bytes),
        encoding: 'base64',
      }),
    },
  )

  return blob.sha
}

async function getFileText(path: string) {
  const file = await githubRequest<GitHubContentsResponse>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodePath(path)}?ref=${encodeURIComponent(REPO_BRANCH)}`,
  )

  if (file.encoding !== 'base64') {
    throw new Error(`Unsupported file encoding: ${file.encoding}`)
  }

  return decodeBase64Utf8(file.content)
}

async function createCommitFromTree(
  baseTreeSha: string,
  parentCommitSha: string,
  message: string,
  tree: GitTreeChange[],
) {
  const createdTree = await githubRequest<{ sha: string }>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree,
      }),
    },
  )

  const createdCommit = await githubRequest<{ sha: string }>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        tree: createdTree.sha,
        parents: [parentCommitSha],
      }),
    },
  )

  await githubRequest(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${encodeURIComponent(REPO_BRANCH)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sha: createdCommit.sha,
        force: false,
      }),
    },
  )

  return createdCommit.sha
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405)
  }

  const password = req.headers.get('x-admin-password')
  if (!ADMIN_PASSWORD) {
    return respond({ error: '관리자 비밀번호가 설정되지 않았습니다.' }, 500)
  }
  if (password !== ADMIN_PASSWORD) {
    return respond({ error: '관리자 인증 실패' }, 401)
  }

  try {
    const contentType = req.headers.get('content-type') || ''
    const isMultipart = contentType.includes('multipart/form-data')
    const formData = isMultipart ? await req.formData() : null
    const body = isMultipart ? null : await req.json()
    const action = isMultipart ? String(formData?.get('action') || '') : body?.action

    switch (action) {
      case 'list_posts': {
        const { entries } = await getRepositorySnapshot()
        const postEntries = entries.filter((entry) => entry.type === 'blob' && CONTENT_PATH_RE.test(entry.path))

        const posts = (await Promise.all(
          postEntries.map(async (entry) => {
            try {
              const markdown = await getBlobText(entry.sha!)
              return parsePostFromMarkdown(entry.path, markdown)
            } catch (error) {
              console.error(`Failed to parse post ${entry.path}`, error)
              return null
            }
          }),
        ))
          .filter((post): post is ContentPost => post !== null)
          .map(({ body: _body, markdown: _markdown, ...summary }) => summary)
          .sort((left, right) => {
            const dateComparison = right.date.localeCompare(left.date)
            return dateComparison !== 0 ? dateComparison : left.title.localeCompare(right.title)
          })

        return respond({ posts })
      }

      case 'get_post': {
        const path = String(body?.path || '')
        if (!parseContentPath(path)) {
          return respond({ error: '지원하지 않는 게시글 경로입니다.' }, 400)
        }

        const markdown = await getFileText(path)
        return respond({ post: parsePostFromMarkdown(path, markdown) })
      }

      case 'upsert_post': {
        requireGithubToken()
        const previousPath = body?.previous_path ? String(body.previous_path) : null
        if (previousPath && !parseContentPath(previousPath)) {
          return respond({ error: '이전 게시글 경로가 올바르지 않습니다.' }, 400)
        }

        const post = validatePostInput(body?.post as ContentPostInput)
        const markdown = buildMarkdown(post)
        const targetPath = `content/post/${post.category}/${post.slug}/index.md`
        const targetDirectory = targetPath.slice(0, -'/index.md'.length)

        const snapshot = await getRepositorySnapshot()
        const existingPaths = new Set(snapshot.entries.filter((entry) => entry.type === 'blob').map((entry) => entry.path))

        if (!previousPath && existingPaths.has(targetPath)) {
          return respond({ error: '같은 경로의 게시글이 이미 존재합니다.' }, 409)
        }

        if (previousPath && previousPath !== targetPath && existingPaths.has(targetPath)) {
          return respond({ error: '이동할 대상 경로에 이미 게시글이 있습니다.' }, 409)
        }

        const treeChanges: GitTreeChange[] = []
        const previousDirectory = previousPath ? previousPath.slice(0, -'/index.md'.length) : null

        if (previousPath && previousDirectory && previousDirectory !== targetDirectory) {
          const movedEntries = snapshot.entries.filter(
            (entry) => entry.type === 'blob' && (entry.path === previousPath || entry.path.startsWith(`${previousDirectory}/`)),
          )

          if (movedEntries.length === 0) {
            return respond({ error: '이전 게시글을 찾을 수 없습니다.' }, 404)
          }

          for (const entry of movedEntries) {
            const relativePath = entry.path.slice(previousDirectory.length + 1)

            if (entry.path !== previousPath) {
              treeChanges.push({
                path: `${targetDirectory}/${relativePath}`,
                mode: entry.mode,
                type: 'blob',
                sha: entry.sha,
              })
            }

            treeChanges.push({
              path: entry.path,
              mode: entry.mode,
              type: 'blob',
              sha: null,
            })
          }
        }

        treeChanges.push({
          path: targetPath,
          mode: '100644',
          type: 'blob',
          content: markdown,
        })

        await createCommitFromTree(
          snapshot.treeSha,
          snapshot.commitSha,
          `${previousPath ? 'Update' : 'Create'} content post: ${post.title}`,
          treeChanges,
        )

        const savedPost = parsePostFromMarkdown(targetPath, markdown)
        const { body: _body, markdown: _rawMarkdown, ...summary } = savedPost
        return respond({ post: summary })
      }

      case 'upload_assets': {
        requireGithubToken()

        const path = String(formData?.get('path') || '')
        const pathInfo = parseContentPath(path)
        if (!pathInfo) {
          return respond({ error: '지원하지 않는 게시글 경로입니다.' }, 400)
        }

        const files = (formData?.getAll('files') || []).filter((entry): entry is File => entry instanceof File)
        if (files.length === 0) {
          return respond({ error: '업로드할 이미지 파일이 없습니다.' }, 400)
        }

        const snapshot = await getRepositorySnapshot()
        const existingPaths = new Set(snapshot.entries.filter((entry) => entry.type === 'blob').map((entry) => entry.path))
        if (!existingPaths.has(path)) {
          return respond({ error: '이미지를 업로드할 게시글을 먼저 저장해주세요.' }, 409)
        }

        const directory = path.slice(0, -'/index.md'.length)
        const seenNames = new Set<string>()
        const treeChanges: GitTreeChange[] = []
        const uploaded: Array<{ filename: string; path: string; markdown: string }> = []

        for (const file of files) {
          const filename = normalizeAssetFilename(file.name)
          if (seenNames.has(filename)) {
            return respond({ error: `같은 업로드 요청에 중복된 파일명이 있습니다: ${filename}` }, 400)
          }
          seenNames.add(filename)

          const bytes = new Uint8Array(await file.arrayBuffer())
          const blobSha = await createBlobFromBytes(bytes)
          const assetPath = `${directory}/${filename}`

          treeChanges.push({
            path: assetPath,
            mode: '100644',
            type: 'blob',
            sha: blobSha,
          })

          uploaded.push({
            filename,
            path: assetPath,
            markdown: `![](${filename})`,
          })
        }

        await createCommitFromTree(
          snapshot.treeSha,
          snapshot.commitSha,
          `Upload content assets: ${pathInfo.category}/${pathInfo.slug}`,
          treeChanges,
        )

        return respond({ uploaded })
      }

      case 'delete_post': {
        requireGithubToken()
        const path = String(body?.path || '')
        const pathInfo = parseContentPath(path)
        if (!pathInfo) {
          return respond({ error: '지원하지 않는 게시글 경로입니다.' }, 400)
        }

        const snapshot = await getRepositorySnapshot()
        const directory = path.slice(0, -'/index.md'.length)
        const deletions = snapshot.entries.filter(
          (entry) => entry.type === 'blob' && (entry.path === path || entry.path.startsWith(`${directory}/`)),
        )

        if (deletions.length === 0) {
          return respond({ error: '삭제할 게시글을 찾을 수 없습니다.' }, 404)
        }

        await createCommitFromTree(
          snapshot.treeSha,
          snapshot.commitSha,
          `Delete content post: ${pathInfo.category}/${pathInfo.slug}`,
          deletions.map((entry) => ({
            path: entry.path,
            mode: entry.mode,
            type: 'blob',
            sha: null,
          })),
        )

        return respond({ success: true })
      }

      default:
        return respond({ error: '지원하지 않는 작업입니다.' }, 400)
    }
  } catch (error) {
    console.error(error)
    return respond(
      { error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' },
      500,
    )
  }
})
