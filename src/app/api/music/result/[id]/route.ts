import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    
    if (!id) {
      return NextResponse.json({ error: 'missing_request_id' }, { status: 400 })
    }

    // Mock result - return local audio file
    console.debug(`[MOCK] Returning result for request: ${id}`)
    
    // Return the local mock audio file
    // Make sure you have uploaded an audio file to public/ folder
    const mockResults = [
      {
        url: '/sample-music.mp3',
        title: 'Generated Music - Electronic'
      },
      {
        url: '/sample-music.mp3', 
        title: 'Generated Music - Ambient'
      },
      {
        url: '/sample-music.mp3',
        title: 'Generated Music - Jazz'
      }
    ]
    
    // Random selection for variety
    const result = mockResults[Math.floor(Math.random() * mockResults.length)]
    
    return NextResponse.json({
      url: result.url,
      title: result.title,
      duration: 60,
      format: 'mp3',
      message: 'Mock music generation completed'
    })
  } catch (e) {
    console.error('music/result error', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}