# Voice AI Coach

A voice-based AI coaching application for career and academic goals, built with Next.js, Gemini API, and ElevenLabs.

## Features

- **Voice-first interaction**: Push-to-talk conversation interface
- **Personality customization**: Select up to 3 personality traits to customize coaching style
- **Goal-focused coaching**: AI coach helps clarify goals and create actionable next steps
- **Session summaries**: Generate written summaries on-demand or at session end
- **Ephemeral sessions**: All data is destroyed when sessions end - no persistence

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **AI**: Google Gemini API (STT + LLM)
- **Voice**: ElevenLabs API (TTS)
- **Deployment**: Vercel

## Prerequisites

- Node.js 18+ and npm
- Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))
- ElevenLabs API key ([Get one here](https://elevenlabs.io/)) - Optional but recommended

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   
   Create a `.env.local` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
   ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
   ```
   
   Note: `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are optional. If not provided, the app will work but without audio responses.

3. **Run the development server**:
   ```bash
   npm run dev
   ```

4. **Open your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Your Google Gemini API key for speech-to-text and LLM |
| `ELEVENLABS_API_KEY` | No | Your ElevenLabs API key for text-to-speech |
| `ELEVENLABS_VOICE_ID` | No | ElevenLabs voice ID (default: `21m00Tcm4TlvDq8ikWAM`) |

## Deployment to Vercel

1. **Push your code to a Git repository** (GitHub, GitLab, or Bitbucket)

2. **Import your project to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your repository

3. **Add environment variables**:
   - In your Vercel project settings, go to "Environment Variables"
   - Add all required environment variables (see above)

4. **Deploy**:
   - Vercel will automatically deploy your project
   - Your app will be available at `https://your-project.vercel.app`

## Usage

1. **Select Personality Traits**: Choose up to 3 traits that define how you want the coach to interact with you
2. **Start Session**: Click "Start Session" to begin
3. **Hold to Speak**: Press and hold the "Hold to Speak" button while speaking
4. **Release to Send**: Release the button to send your message
5. **Listen**: The AI coach will respond with voice (if ElevenLabs is configured) or text
6. **Request Summary**: Click "Request Summary" at any time to get a written summary
7. **Session End**: The session automatically ends when goals are clarified and next steps are defined

## Project Structure

```
/
├── app/
│   ├── api/
│   │   └── session/
│   │       ├── start/route.ts    # Session initialization
│   │       ├── turn/route.ts      # Voice processing pipeline
│   │       └── summary/route.ts   # Summary generation
│   ├── globals.css                # Global styles
│   ├── layout.tsx                 # Root layout
│   └── page.tsx                   # Main page with state management
├── components/
│   ├── SetupScreen.tsx            # Trait selection UI
│   ├── SessionScreen.tsx          # Voice interaction UI
│   └── SummaryScreen.tsx          # Summary display
└── pdr.md                         # Product Requirements Document
```

## API Endpoints

### POST `/api/session/start`
Start a new coaching session.

**Request Body**:
```json
{
  "traits": ["empathetic", "reflective", "goal-driven"]
}
```

**Response**:
```json
{
  "sessionId": "session_1234567890_abc123"
}
```

### POST `/api/session/turn`
Process a voice turn (audio → text → AI response → audio).

**Request**: FormData with `audio` (File) and `sessionId` (string)

**Response**:
```json
{
  "sessionEnded": false,
  "audioUrl": "data:audio/mpeg;base64,...",
  "response": "AI response text"
}
```

### POST `/api/session/summary`
Generate a written summary of the session.

**Request Body**:
```json
{
  "sessionId": "session_1234567890_abc123"
}
```

**Response**:
```json
{
  "summary": "Session summary text..."
}
```

## Limitations

- Sessions are stored in-memory only (ephemeral)
- No authentication or user accounts
- No data persistence across sessions
- Requires modern browser with MediaRecorder API support
- Microphone permissions required

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: May have limited MediaRecorder support
- Mobile browsers: Supported but may have limitations

## Troubleshooting

**Microphone not working**:
- Check browser permissions for microphone access
- Ensure you're using HTTPS (required for microphone access in production)
- Try a different browser

**Audio responses not playing**:
- Check if ElevenLabs API key is configured
- Check browser console for errors
- Ensure browser supports audio playback

**API errors**:
- Verify all environment variables are set correctly
- Check API key validity and quotas
- Review server logs for detailed error messages

## License

This project is for educational/demonstration purposes.

