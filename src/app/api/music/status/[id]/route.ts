import { NextRequest, NextResponse } from 'next/server'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params

    if (!id) {
      return NextResponse.json({ error: 'missing_request_id' }, { status: 400 })
    }

    // Mock status check - simulate completion after some time
    // In production, this would check actual generation status

    console.debug(`[MOCK] Checking status for request: ${id}`)

    // Simulate random completion for demo
    const isCompleted = Math.random() > 0.3 // 70% chance of completion

    const status = isCompleted ? 'completed' : 'running'

    return NextResponse.json({
      status,
      progress: isCompleted ? 100 : Math.floor(Math.random() * 90),
      message: status === 'completed' ? 'Music generation complete' : 'Generating music...',
    })
  } catch (e) {
    console.error('music/status error', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
