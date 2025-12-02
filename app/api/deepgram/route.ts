import { NextResponse } from "next/server"

export async function GET() {
  // Return the API key for client-side WebSocket connection
  // In production, you might want to use Deepgram's temporary keys instead
  const apiKey = process.env.liguscribe_alpha_key

  if (!apiKey) {
    return NextResponse.json({ error: "Deepgram API key not configured" }, { status: 500 })
  }

  return NextResponse.json({ apiKey })
}
