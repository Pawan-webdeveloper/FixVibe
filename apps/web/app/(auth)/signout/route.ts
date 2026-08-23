import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server.ts'

export const runtime = 'nodejs'

/** POST only: a GET sign-out can be triggered by an image tag on another site. */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/', request.url), { status: 303 })
}
