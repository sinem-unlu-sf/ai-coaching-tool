import { NextRequest, NextResponse } from 'next/server';
import { audioStore } from '../../store';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const audioId = params.id;
    
    if (!audioId) {
      return NextResponse.json({ error: 'Missing audio ID' }, { status: 400 });
    }

    const audioBuffer = audioStore.get(audioId);
    
    if (!audioBuffer) {
      console.error('[server] Audio not found in store:', audioId);
      return NextResponse.json({ error: 'Audio not found' }, { status: 404 });
    }

    console.log('[server] Serving audio:', { audioId, size: audioBuffer.length });

    return new NextResponse(new Uint8Array(audioBuffer), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error fetching audio:', error);
    return NextResponse.json({ error: 'Failed to fetch audio' }, { status: 500 });
  }
}
