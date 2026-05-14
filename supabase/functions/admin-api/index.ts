import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PUBLIC_RESULT_URL = Deno.env.get('PUBLIC_RESULT_URL') || 'https://61315gamelab.github.io/apply/#/result'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-password',
}

const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD')

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function hashAccessCode(code: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(code)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Generate slot ISO strings for the Saturday & Sunday of the deadline week in KST
function generateSlotDatetimes(endDateStr: string): string[] {
  const KST_OFFSET = 9 * 60 * 60 * 1000
  const endDate = new Date(endDateStr)
  // Work in KST
  const kstTime = endDate.getTime() + KST_OFFSET
  const kstDate = new Date(kstTime)
  const day = kstDate.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat

  // Find days until Saturday in KST
  let daysToSat: number
  if (day === 0) daysToSat = 6 // Sunday → next Saturday
  else if (day === 6) daysToSat = 0 // Already Saturday
  else daysToSat = 6 - day // Mon(1)→5, Tue(2)→4, ... Fri(5)→1

  const slots: string[] = []
  for (const offset of [daysToSat, daysToSat + 1]) { // Sat, Sun
    for (let h = 21; h < 24; h++) {
      for (let m = 0; m < 60; m += 20) {
        // Build KST datetime then convert to UTC
        const slotKST = new Date(kstDate)
        slotKST.setUTCDate(kstDate.getUTCDate() + offset)
        slotKST.setUTCHours(h, m, 0, 0)
        const slotUTC = new Date(slotKST.getTime() - KST_OFFSET)
        slots.push(slotUTC.toISOString())
      }
    }
  }
  return slots
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
      // ---- Seasons ----
      case 'list_seasons': {
        const { data, error } = await supabase.from('recruitment_seasons').select('*').order('created_at', { ascending: false })
        if (error) throw error
        return respond({ seasons: data })
      }

      case 'create_season': {
        const { name } = body
        if (!name || name.length > 100) return respond({ error: '시즌 이름을 확인해주세요.' }, 400)
        const { data, error } = await supabase.from('recruitment_seasons').insert({ name }).select().single()
        if (error) throw error
        return respond({ season: data })
      }

      case 'delete_season': {
        const { id } = body
        const { error } = await supabase.from('recruitment_seasons').delete().eq('id', id)
        if (error) throw error
        return respond({ success: true })
      }

      // ---- Applicants (legacy) ----
      case 'list_applicants': {
        const { search } = body
        let query = supabase.from('applicants').select('*').order('created_at', { ascending: false })
        if (search) query = query.ilike('name', `%${search}%`)
        const { data, error } = await query
        if (error) throw error
        const safe = data?.map(({ access_code_hash: _, ...rest }: Record<string, unknown>) => rest) || []
        return respond({ applicants: safe })
      }

      case 'create_applicant': {
        const { name, access_code, track_type, status } = body
        const access_code_hash = await hashAccessCode(access_code)
        const { data, error } = await supabase.from('applicants').insert({ name, access_code_hash, track_type, status: status || 'submitted' }).select()
        if (error) throw error
        return respond({ applicant: data?.[0] })
      }

      case 'update_applicant': {
        const { id, updates } = body
        const { access_code_hash: _h, access_code, ...safeUpdates } = updates
        if (access_code) safeUpdates.access_code_hash = await hashAccessCode(access_code)
        const { data, error } = await supabase.from('applicants').update(safeUpdates).eq('id', id).select()
        if (error) throw error
        return respond({ applicant: data?.[0] })
      }

      case 'delete_applicant': {
        const { id } = body
        const { error } = await supabase.from('applicants').delete().eq('id', id)
        if (error) throw error
        return respond({ success: true })
      }

      // ---- Tracks ----
      case 'list_tracks': {
        const { season_id } = body
        let query = supabase.from('admission_tracks').select('*')
        if (season_id) query = query.eq('season_id', season_id)
        const { data, error } = await query
        if (error) throw error
        return respond({ tracks: data })
      }

      case 'update_track': {
        const { id, updates } = body
        updates.updated_at = new Date().toISOString()
        const { data, error } = await supabase.from('admission_tracks').update(updates).eq('id', id).select()
        if (error) throw error
        return respond({ track: data?.[0] })
      }

      // ---- Applications ----
      case 'list_applications': {
        const { search, season_id } = body
        let query = supabase.from('applications').select('*, interview_slots(slot_datetime)').order('created_at', { ascending: false })
        if (season_id) query = query.eq('season_id', season_id)
        if (search) query = query.ilike('name', `%${search}%`)
        const { data, error } = await query
        if (error) throw error
        return respond({ applications: data || [] })
      }

      case 'update_application': {
        const { id, updates } = body
        const { data, error } = await supabase.from('applications').update(updates).eq('id', id).select('*, interview_slots(slot_datetime)').single()
        if (error) throw error

        // Send email notification on stage change
        if (updates.stage && data?.email) {
          const stageLabels: Record<string, string> = {
            '서류접수': '서류 접수',
            '1차합격': '1차 합격',
            '최종합격': '최종 합격',
            '불합격': '불합격',
          }
          const stageLabel = stageLabels[updates.stage] || updates.stage
          try {
            const emailRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                to: data.email,
                subject: `[61315 GAMELAB] 지원 결과 안내 - ${stageLabel}`,
                html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
                  <h2 style="color:#34495e;">61315 GAMELAB</h2>
                  <p>${data.name}님, 안녕하세요.</p>
                  <p>지원하신 건의 전형 결과가 <strong>${stageLabel}</strong>(으)로 변경되었습니다.</p>
                  <p>자세한 내용은 홈페이지에서 확인해주세요.</p>
                  <a href="${PUBLIC_RESULT_URL}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#34495e;color:#fff;text-decoration:none;border-radius:8px;">결과 확인하기</a>
                  <p style="margin-top:24px;color:#999;font-size:12px;">본 메일은 발신 전용입니다.</p>
                </div>`,
              }),
            })
            const emailData = await emailRes.text()
            console.log('Email sent:', emailData)
          } catch (emailErr) {
            console.error('Failed to send stage change email:', emailErr)
          }
        }

        return respond({ application: data })
      }

      case 'delete_application': {
        const { id } = body
        const { data: app } = await supabase.from('applications').select('interview_slot_id').eq('id', id).single()
        if (app?.interview_slot_id) {
          await supabase.rpc('unreserve_slot', { p_slot_id: app.interview_slot_id })
        }
        const { error } = await supabase.from('applications').delete().eq('id', id)
        if (error) throw error
        return respond({ success: true })
      }

      // ---- Interview Evaluations ----
      case 'list_evaluations': {
        const { application_id } = body
        const { data, error } = await supabase.from('interview_evaluations').select('*').eq('application_id', application_id).order('created_at', { ascending: true })
        if (error) throw error
        return respond({ evaluations: data || [] })
      }

      case 'add_evaluation': {
        const { application_id, evaluator_name, score, comment } = body
        if (!evaluator_name || evaluator_name.length > 50) return respond({ error: '평가자 이름을 확인해주세요.' }, 400)
        if (score === undefined || score === null || score < 0 || score > 100) return respond({ error: '점수는 0~100 사이여야 합니다.' }, 400)
        const { data, error } = await supabase.from('interview_evaluations').insert({ application_id, evaluator_name, score, comment: comment || '' }).select().single()
        if (error) throw error
        return respond({ evaluation: data })
      }

      case 'delete_evaluation': {
        const { id } = body
        const { error } = await supabase.from('interview_evaluations').delete().eq('id', id)
        if (error) throw error
        return respond({ success: true })
      }

      // ---- Application Settings ----
      case 'get_application_settings': {
        const { season_id } = body
        let query = supabase.from('application_settings').select('*')
        if (season_id) query = query.eq('season_id', season_id)
        const { data, error } = await query.limit(1).single()
        if (error && error.code !== 'PGRST116') throw error
        return respond({ settings: data })
      }

      case 'update_application_settings': {
        const { settings: newSettings, season_id } = body
        const { data: existing } = await supabase.from('application_settings').select('id').eq('season_id', season_id).limit(1).single()
        
        if (existing) {
          const { data, error } = await supabase.from('application_settings')
            .update({ start_date: newSettings.start_date, end_date: newSettings.end_date, grace_hours: newSettings.grace_hours })
            .eq('id', existing.id).select().single()
          if (error) throw error
          return respond({ settings: data })
        } else {
          const { data, error } = await supabase.from('application_settings')
            .insert({ start_date: newSettings.start_date, end_date: newSettings.end_date, grace_hours: newSettings.grace_hours, season_id })
            .select().single()
          if (error) throw error
          return respond({ settings: data })
        }
      }

      case 'regenerate_slots': {
        const { end_date, season_id } = body
        if (season_id) {
          await supabase.from('interview_slots').delete().eq('reserved_count', 0).eq('season_id', season_id)
        } else {
          await supabase.from('interview_slots').delete().eq('reserved_count', 0)
        }

        const slotDatetimes = generateSlotDatetimes(end_date)
        const slots = slotDatetimes.map(dt => {
          const slot: { slot_datetime: string; season_id?: string } = { slot_datetime: dt }
          if (season_id) slot.season_id = season_id
          return slot
        })

        if (slots.length > 0) {
          const { error } = await supabase.from('interview_slots').upsert(slots, { onConflict: 'slot_datetime' })
          if (error) throw error
        }

        let slotQuery = supabase.from('interview_slots').select('*').order('slot_datetime')
        if (season_id) slotQuery = slotQuery.eq('season_id', season_id)
        const { data: allSlots } = await slotQuery
        return respond({ slots: allSlots })
      }

      // ---- Check result by phone ----
      case 'check_by_phone': {
        const { name, phone_last4 } = body
        if (!name || !phone_last4 || phone_last4.length !== 4) {
          return respond({ error: '이름과 전화번호 뒷 4자리를 입력해주세요.' }, 400)
        }
        const { data, error } = await supabase.from('applications').select('id, name, phone, part, stage, is_late, created_at, season_id').ilike('name', name).like('phone', `%${phone_last4}`)
        if (error) throw error
        if (!data || data.length === 0) {
          return respond({ error: '일치하는 지원 정보를 찾을 수 없습니다.' }, 404)
        }
        // Return with masked phone
        const results = data.map(a => ({ ...a, phone: a.phone.slice(0, -4).replace(/./g, '*') + a.phone.slice(-4) }))
        return respond({ applications: results })
      }

      // ---- Interview Schedule ----
      case 'list_schedule': {
        const { season_id } = body
        let slotQuery = supabase.from('interview_slots').select('*').order('slot_datetime')
        if (season_id) slotQuery = slotQuery.eq('season_id', season_id)
        const { data: slots, error: slotErr } = await slotQuery
        if (slotErr) throw slotErr

        // Get all applications with interview slots for this season
        let appQuery = supabase.from('applications').select('id, name, part, phone, email, stage, interview_slot_id, created_at').order('created_at')
        if (season_id) appQuery = appQuery.eq('season_id', season_id)
        const { data: apps } = await appQuery

        // Group applications by slot and assign order numbers
        const slotApps: Record<string, { order: number; name: string; part: string; phone: string; email: string; stage: string; id: string }[]> = {}
        if (apps) {
          for (const a of apps) {
            if (a.interview_slot_id) {
              if (!slotApps[a.interview_slot_id]) slotApps[a.interview_slot_id] = []
              slotApps[a.interview_slot_id].push({
                order: slotApps[a.interview_slot_id].length + 1,
                name: a.name,
                part: a.part,
                phone: a.phone,
                email: a.email,
                stage: a.stage,
                id: a.id,
              })
            }
          }
        }

        const schedule = (slots || []).map(s => ({
          ...s,
          applicants: slotApps[s.id] || [],
        }))

        return respond({ schedule })
      }

      default:
        return respond({ error: '알 수 없는 액션입니다.' }, 400)
    }
  } catch (e) {
    return respond({ error: (e as Error).message || '요청 처리 중 오류 발생' }, 500)
  }
})
