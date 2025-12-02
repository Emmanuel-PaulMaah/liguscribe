"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { useToast } from "@/hooks/use-toast"
import {
  Mic,
  MicOff,
  Download,
  Trash2,
  Play,
  Pause,
  Volume2,
  SkipBack,
  SkipForward,
  Plus,
  Edit2,
  Check,
  X,
  FileText,
  Users,
  Settings,
  Clock,
  RotateCcw,
  History,
  SpellCheck,
  Info,
} from "lucide-react"
import { Document, Packer, Paragraph, TextRun } from "docx"

interface TranscriptEntry {
  id: string
  speaker: string
  text: string
  timestamp: Date
  isEditing?: boolean
  isEditingSpeaker?: boolean
  originalText?: string
}

export default function SpeechTranscriptionApp() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [currentSpeaker, setCurrentSpeaker] = useState("Speaker 1")
  const [speakers, setSpeakers] = useState(["Speaker 1", "Speaker 2", "Speaker 3", "Speaker 4", "Speaker 5"])
  const [newSpeakerName, setNewSpeakerName] = useState("")
  const [isSupported, setIsSupported] = useState(true)
  const [interimText, setInterimText] = useState("")
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null)
  const [editingSpeakerName, setEditingSpeakerName] = useState("")
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState([1])
  const [playbackRate, setPlaybackRate] = useState([1])
  const [editHistory, setEditHistory] = useState<
    Array<{ id: string; action: string; timestamp: Date; oldValue?: string; newValue?: string }>
  >([])
  const [undoStack, setUndoStack] = useState<
    Array<{ type: "edit" | "delete" | "speaker"; entryId: string; oldValue: any; newValue: any }>
  >([])
  const [redoStack, setRedoStack] = useState<
    Array<{ type: "edit" | "delete" | "speaker"; entryId: string; oldValue: any; newValue: any }>
  >([])
  const [showSpellCheck, setShowSpellCheck] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [currentTranscriptIndex, setCurrentTranscriptIndex] = useState<number | null>(null)

  const [connectionStatus, setConnectionStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected")

  const deepgramSocketRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioRecorderRef = useRef<MediaRecorder | null>(null) // Separate recorder for playback
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const accumulatedTextRef = useRef<string>("")
  const entryTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastSpeechTimeRef = useRef<number>(0)
  const entryStartTimeRef = useRef<Date | null>(null)
  const currentSpeakerRef = useRef(currentSpeaker)
  const { toast } = useToast()

  // Keep currentSpeakerRef in sync
  useEffect(() => {
    currentSpeakerRef.current = currentSpeaker
  }, [currentSpeaker])

  const togglePlayback = useCallback(() => {
    if (!audioUrl) return

    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl)
      audioRef.current.volume = volume[0]
      audioRef.current.playbackRate = playbackRate[0]
    }

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }, [audioUrl, isPlaying, volume, playbackRate])

  const handleVolumeChange = useCallback((newVolume: number[]) => {
    setVolume(newVolume)
    if (audioRef.current) {
      audioRef.current.volume = newVolume[0]
    }
  }, [])

  const handlePlaybackRateChange = (newRate: number[]) => {
    setPlaybackRate(newRate)
    if (audioRef.current) {
      audioRef.current.playbackRate = newRate[0]
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const downloadAudio = () => {
    if (!audioUrl) return

    const a = document.createElement("a")
    a.href = audioUrl
    a.download = `session-audio-${new Date().toISOString().split("T")[0]}.webm`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    toast({
      title: "Download Started",
      description: "Session audio download started.",
    })
  }

  const startEditingSpeaker = (speaker: string) => {
    setEditingSpeaker(speaker)
    setEditingSpeakerName(speaker)
  }

  const saveEditingSpeaker = () => {
    if (editingSpeaker && editingSpeakerName.trim() && editingSpeakerName !== editingSpeaker) {
      setSpeakers((prev) => prev.map((s) => (s === editingSpeaker ? editingSpeakerName.trim() : s)))
      setTranscript((prev) =>
        prev.map((entry) =>
          entry.speaker === editingSpeaker ? { ...entry, speaker: editingSpeakerName.trim() } : entry,
        ),
      )
      if (currentSpeaker === editingSpeaker) {
        setCurrentSpeaker(editingSpeakerName.trim())
      }
      toast({
        title: "Speaker Renamed",
        description: `${editingSpeaker} renamed to ${editingSpeakerName.trim()}`,
      })
    }
    setEditingSpeaker(null)
    setEditingSpeakerName("")
  }

  const deleteSpeaker = (speaker: string) => {
    if (speakers.length > 1) {
      setSpeakers((prev) => prev.filter((s) => s !== speaker))
      if (currentSpeaker === speaker) {
        setCurrentSpeaker(speakers.find((s) => s !== speaker) || speakers[0])
      }
      toast({
        title: "Speaker Deleted",
        description: `${speaker} has been removed.`,
      })
    }
  }

  const updateEntryText = (id: string, newText: string) => {
    setTranscript((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, text: newText, isEditing: false } : entry)),
    )
  }

  const updateEntrySpeaker = (id: string, newSpeaker: string) => {
    setTranscript((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, speaker: newSpeaker, isEditingSpeaker: false } : entry)),
    )
    if (!speakers.includes(newSpeaker)) {
      setSpeakers((prev) => [...prev, newSpeaker])
    }
  }

  const deleteEntry = (id: string) => {
    setTranscript((prev) => prev.filter((entry) => entry.id !== id))
  }

  const clearTranscript = () => {
    setTranscript([])
    toast({
      title: "Transcript Cleared",
      description: "All entries have been removed.",
    })
  }

  const exportAsWordDocument = async () => {
    if (transcript.length === 0) {
      toast({
        title: "No Transcript",
        description: "There is no transcript to export.",
        variant: "destructive",
      })
      return
    }

    try {
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Speech Transcription",
                    bold: true,
                    size: 32,
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Session Date: ${sessionStartTime?.toLocaleDateString() || new Date().toLocaleDateString()}`,
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Total Entries: ${transcript.length}`,
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({ children: [] }),
              ...transcript.flatMap((entry) => [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `[${entry.timestamp.toLocaleTimeString()}] ${entry.speaker}:`,
                      bold: true,
                      size: 24,
                    }),
                  ],
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: entry.text,
                      size: 24,
                    }),
                  ],
                }),
                new Paragraph({ children: [] }),
              ]),
            ],
          },
        ],
      })

      const blob = await Packer.toBlob(doc)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `transcript-${new Date().toISOString().split("T")[0]}.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({
        title: "Export Successful",
        description: "Transcript exported as Word document.",
      })
    } catch (error) {
      console.error("Error exporting document:", error)
      toast({
        title: "Export Failed",
        description: "Failed to export transcript.",
        variant: "destructive",
      })
    }
  }

  const exportAsText = () => {
    if (transcript.length === 0) {
      toast({
        title: "No Transcript",
        description: "There is no transcript to export.",
        variant: "destructive",
      })
      return
    }

    const textContent = transcript
      .map((entry) => `[${entry.timestamp.toLocaleTimeString()}] ${entry.speaker}: ${entry.text}`)
      .join("\n\n")

    const blob = new Blob([textContent], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `transcript-${new Date().toISOString().split("T")[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast({
      title: "Export Successful",
      description: "Transcript exported as text file.",
    })
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isRecording && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key
        if (key >= "1" && key <= "5") {
          e.preventDefault()
          const speakerIndex = Number.parseInt(key) - 1
          if (speakerIndex < speakers.length) {
            setCurrentSpeaker(speakers[speakerIndex])
          }
        }
      }
    },
    [isRecording, speakers],
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  const performUndo = () => {
    if (undoStack.length === 0) return

    const lastAction = undoStack[undoStack.length - 1]
    setUndoStack((prev) => prev.slice(0, -1))

    if (lastAction.type === "edit") {
      setTranscript((prev) =>
        prev.map((entry) => (entry.id === lastAction.entryId ? { ...entry, text: lastAction.oldValue } : entry)),
      )
      setRedoStack((prev) => [...prev, lastAction])
    }

    toast({
      title: "Undo",
      description: "Last action undone.",
    })
  }

  const addSpeaker = () => {
    if (newSpeakerName.trim() && !speakers.includes(newSpeakerName.trim())) {
      setSpeakers((prev) => [...prev, newSpeakerName.trim()])
      setNewSpeakerName("")
      toast({
        title: "Speaker Added",
        description: `${newSpeakerName.trim()} has been added.`,
      })
    }
  }

  const createTranscriptEntry = useCallback(() => {
    if (accumulatedTextRef.current.trim()) {
      const newEntry: TranscriptEntry = {
        id: Date.now().toString(),
        speaker: currentSpeakerRef.current,
        text: accumulatedTextRef.current.trim(),
        timestamp: entryStartTimeRef.current || new Date(),
      }
      setTranscript((prev) => [...prev, newEntry])

      accumulatedTextRef.current = ""
      entryStartTimeRef.current = null

      if (entryTimerRef.current) {
        clearTimeout(entryTimerRef.current)
        entryTimerRef.current = null
      }
    }
  }, [])

  const startRecording = async () => {
    try {
      setConnectionStatus("connecting")

      // Get API key from server
      const response = await fetch("/api/deepgram")
      const { apiKey, error } = await response.json()

      if (error || !apiKey) {
        throw new Error(error || "Failed to get API key")
      }

      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream

      // Create MediaRecorder for audio playback (separate from Deepgram)
      const audioRecorder = new MediaRecorder(stream)
      audioRecorderRef.current = audioRecorder
      chunksRef.current = []

      audioRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      audioRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" })
        setAudioBlob(blob)
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
      }

      // Start audio recorder for playback
      audioRecorder.start()

      const deepgramUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&utterance_end_ms=1500&vad_events=true&endpointing=300`

      const socket = new WebSocket(deepgramUrl, ["token", apiKey])
      deepgramSocketRef.current = socket

      socket.onopen = () => {
        setConnectionStatus("connected")
        setIsRecording(true)
        setSessionStartTime(new Date())

        // Create MediaRecorder for sending audio to Deepgram
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus",
        })
        mediaRecorderRef.current = mediaRecorder

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data)
          }
        }

        mediaRecorder.start(250) // Send data every 250ms

        toast({
          title: "Recording Started",
          description: "Connected to Deepgram. Listening for speech...",
        })
      }

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data)

        if (data.type === "Results") {
          const transcript = data.channel?.alternatives?.[0]?.transcript || ""
          const isFinal = data.is_final

          if (transcript) {
            if (isFinal) {
              // Final result - accumulate text
              const currentTime = Date.now()
              lastSpeechTimeRef.current = currentTime

              if (!entryStartTimeRef.current) {
                entryStartTimeRef.current = new Date()
              }

              accumulatedTextRef.current += (accumulatedTextRef.current ? " " : "") + transcript.trim()

              // Reset timer for entry creation
              if (entryTimerRef.current) {
                clearTimeout(entryTimerRef.current)
              }

              entryTimerRef.current = setTimeout(() => {
                createTranscriptEntry()
              }, 15000)

              setInterimText("")
            } else {
              // Interim result - show preview
              setInterimText(transcript)
            }
          }
        } else if (data.type === "UtteranceEnd") {
          // End of utterance detected - create entry
          createTranscriptEntry()
        }
      }

      socket.onerror = (error) => {
        console.error("Deepgram WebSocket error:", error)
        setConnectionStatus("disconnected")
        toast({
          title: "Connection Error",
          description: "Failed to connect to Deepgram. Please try again.",
          variant: "destructive",
        })
      }

      socket.onclose = () => {
        setConnectionStatus("disconnected")
        // Create final entry if there's accumulated text
        createTranscriptEntry()
      }

      // Reset accumulated text
      accumulatedTextRef.current = ""
      entryStartTimeRef.current = null
      lastSpeechTimeRef.current = 0
      if (entryTimerRef.current) {
        clearTimeout(entryTimerRef.current)
        entryTimerRef.current = null
      }
    } catch (error: any) {
      setConnectionStatus("disconnected")
      console.error("Recording error:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to start recording. Please check microphone permissions.",
        variant: "destructive",
      })
    }
  }

  const stopRecording = async () => {
    // Close Deepgram connection
    if (deepgramSocketRef.current) {
      deepgramSocketRef.current.close()
      deepgramSocketRef.current = null
    }

    // Stop media recorders
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    if (audioRecorderRef.current && audioRecorderRef.current.state === "recording") {
      audioRecorderRef.current.stop()
    }

    // Stop stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    // Create final entry if there's accumulated text
    if (accumulatedTextRef.current.trim()) {
      const newEntry: TranscriptEntry = {
        id: Date.now().toString(),
        speaker: currentSpeakerRef.current,
        text: accumulatedTextRef.current.trim(),
        timestamp: entryStartTimeRef.current || new Date(),
      }
      setTranscript((prev) => [...prev, newEntry])
      accumulatedTextRef.current = ""
      entryStartTimeRef.current = null
    }

    if (entryTimerRef.current) {
      clearTimeout(entryTimerRef.current)
      entryTimerRef.current = null
    }

    setIsRecording(false)
    setConnectionStatus("disconnected")

    toast({
      title: "Recording Stopped",
      description: "Speech recognition stopped. Use manual export options to download transcript.",
    })
  }

  const forceCreateEntry = () => {
    if (accumulatedTextRef.current.trim()) {
      const newEntry: TranscriptEntry = {
        id: Date.now().toString(),
        speaker: currentSpeakerRef.current,
        text: accumulatedTextRef.current.trim(),
        timestamp: entryStartTimeRef.current || new Date(),
      }
      setTranscript((prev) => [...prev, newEntry])

      accumulatedTextRef.current = ""
      entryStartTimeRef.current = null

      if (entryTimerRef.current) {
        clearTimeout(entryTimerRef.current)
        entryTimerRef.current = null
      }

      toast({
        title: "Entry Created",
        description: "Current segment saved to transcript.",
      })
    } else {
      toast({
        title: "No Text",
        description: "No accumulated text to save.",
        variant: "destructive",
      })
    }
  }

  const quickSwitchSpeaker = (speaker: string) => {
    if (speaker !== currentSpeaker) {
      // Save current accumulated text before switching
      if (accumulatedTextRef.current.trim()) {
        const newEntry: TranscriptEntry = {
          id: Date.now().toString(),
          speaker: currentSpeakerRef.current,
          text: accumulatedTextRef.current.trim(),
          timestamp: entryStartTimeRef.current || new Date(),
        }
        setTranscript((prev) => [...prev, newEntry])
        accumulatedTextRef.current = ""
        entryStartTimeRef.current = null
        if (entryTimerRef.current) {
          clearTimeout(entryTimerRef.current)
          entryTimerRef.current = null
        }
      }
      setCurrentSpeaker(speaker)
      toast({
        title: "Speaker Changed",
        description: `Now recording: ${speaker}`,
      })
    }
  }

  const seekTo = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const skipBackward = () => {
    if (audioRef.current) {
      const newTime = Math.max(0, audioRef.current.currentTime - 10)
      seekTo(newTime)
    }
  }

  const skipForward = () => {
    if (audioRef.current) {
      const newTime = Math.min(duration, audioRef.current.currentTime + 10)
      seekTo(newTime)
    }
  }

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (deepgramSocketRef.current) {
        deepgramSocketRef.current.close()
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
      if (entryTimerRef.current) {
        clearTimeout(entryTimerRef.current)
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [audioUrl])

  useEffect(() => {
    if (audioUrl && audioRef.current) {
      const audio = audioRef.current

      const handleTimeUpdate = () => {
        setCurrentTime(audio.currentTime)
      }

      const handleLoadedMetadata = () => {
        setDuration(audio.duration)
      }

      const handleEnded = () => {
        setIsPlaying(false)
      }

      audio.addEventListener("timeupdate", handleTimeUpdate)
      audio.addEventListener("loadedmetadata", handleLoadedMetadata)
      audio.addEventListener("ended", handleEnded)

      return () => {
        audio.removeEventListener("timeupdate", handleTimeUpdate)
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata)
        audio.removeEventListener("ended", handleEnded)
      }
    }
  }, [audioUrl])

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Liguscribe</h1>
          <p className="text-muted-foreground">
            Courtroom Transcription Software – Record and transcribe speech from multiple speakers
          </p>
          <div className="flex justify-center gap-2">
            <Badge
              variant={
                connectionStatus === "connected"
                  ? "default"
                  : connectionStatus === "connecting"
                    ? "secondary"
                    : "outline"
              }
            >
              {connectionStatus === "connected"
                ? "Connected"
                : connectionStatus === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="recording" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="recording" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Recording & Controls
            </TabsTrigger>
            <TabsTrigger value="playback" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Audio & Speakers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="recording" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mic className="h-5 w-5" />
                  Recording Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-4 items-center">
                  <Button
                    onClick={isRecording ? stopRecording : startRecording}
                    variant={isRecording ? "destructive" : "default"}
                    size="lg"
                    className="flex items-center gap-2"
                    disabled={connectionStatus === "connecting"}
                  >
                    {connectionStatus === "connecting" ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Connecting...
                      </>
                    ) : isRecording ? (
                      <>
                        <MicOff className="h-4 w-4" />
                        Stop & Export
                      </>
                    ) : (
                      <>
                        <Mic className="h-4 w-4" />
                        Start Recording
                      </>
                    )}
                  </Button>

                  <Select value={currentSpeaker} onValueChange={quickSwitchSpeaker}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {speakers.map((speaker) => (
                        <SelectItem key={speaker} value={speaker}>
                          {speaker}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {isRecording && (
                    <Button variant="outline" onClick={forceCreateEntry}>
                      <Plus className="h-4 w-4 mr-2" />
                      Save Current Segment
                    </Button>
                  )}
                </div>

                {isRecording && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <span className="text-sm text-muted-foreground mr-2">Quick Switch (1-5):</span>
                      {speakers.slice(0, 5).map((speaker, index) => (
                        <Button
                          key={speaker}
                          variant={currentSpeaker === speaker ? "default" : "outline"}
                          size="sm"
                          onClick={() => quickSwitchSpeaker(speaker)}
                          className="relative"
                        >
                          <span className="absolute -top-1 -left-1 bg-primary text-primary-foreground rounded-full w-4 h-4 text-xs flex items-center justify-center">
                            {index + 1}
                          </span>
                          {speaker}
                          {currentSpeaker === speaker && (
                            <span className="ml-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          )}
                        </Button>
                      ))}
                    </div>

                    <div className="p-4 bg-muted rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-green-600">{currentSpeaker} is speaking</span>
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      </div>
                      <div className="min-h-16 p-3 bg-background rounded border">
                        {accumulatedTextRef.current && <p className="text-foreground">{accumulatedTextRef.current}</p>}
                        {interimText && <p className="text-muted-foreground italic">{interimText}</p>}
                        {!accumulatedTextRef.current && !interimText && (
                          <p className="text-muted-foreground">Listening...</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Manage Speakers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Add new speaker..."
                    value={newSpeakerName}
                    onChange={(e) => setNewSpeakerName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addSpeaker()}
                  />
                  <Button onClick={addSpeaker}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  {speakers.map((speaker) => (
                    <div key={speaker} className="flex items-center justify-between p-2 border rounded">
                      {editingSpeaker === speaker ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            value={editingSpeakerName}
                            onChange={(e) => setEditingSpeakerName(e.target.value)}
                            className="flex-1"
                          />
                          <Button size="sm" onClick={saveEditingSpeaker}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingSpeaker(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className={currentSpeaker === speaker ? "font-bold" : ""}>{speaker}</span>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => startEditingSpeaker(speaker)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            {speakers.length > 1 && (
                              <Button size="sm" variant="ghost" onClick={() => deleteSpeaker(speaker)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="playback" className="space-y-6">
            {audioUrl && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Volume2 className="h-5 w-5" />
                    Session Audio Player
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Button variant="outline" size="icon" onClick={skipBackward}>
                      <SkipBack className="h-4 w-4" />
                    </Button>
                    <Button onClick={togglePlayback} size="lg">
                      {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                    </Button>
                    <Button variant="outline" size="icon" onClick={skipForward}>
                      <SkipForward className="h-4 w-4" />
                    </Button>

                    <div className="flex-1">{/* Slider code remains unchanged */}</div>
                  </div>

                  <div className="flex items-center gap-4">
                    <Volume2 className="h-4 w-4" />
                    <Slider value={volume} max={1} step={0.01} onValueChange={handleVolumeChange} className="w-24" />

                    <Select
                      value={playbackRate[0].toString()}
                      onValueChange={(value) => {
                        const rate = Number.parseFloat(value)
                        handlePlaybackRateChange([rate])
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.5">0.5x</SelectItem>
                        <SelectItem value="0.75">0.75x</SelectItem>
                        <SelectItem value="1">1x</SelectItem>
                        <SelectItem value="1.25">1.25x</SelectItem>
                        <SelectItem value="1.5">1.5x</SelectItem>
                        <SelectItem value="2">2x</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button variant="outline" onClick={downloadAudio}>
                      <Download className="h-4 w-4 mr-2" />
                      Download Audio
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Transcript Editor
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowSpellCheck(!showSpellCheck)}>
                      <SpellCheck className="h-4 w-4 mr-1" />
                      Spell Check
                    </Button>
                    <Button variant="outline" size="sm" onClick={performUndo} disabled={undoStack.length === 0}>
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Undo ({undoStack.length})
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
                      <History className="h-4 w-4 mr-1" />
                      History
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-2">
                  <Info className="h-4 w-4" />
                  Click on any segment to edit text, speaker, or timing. Use the action buttons for advanced editing
                  operations.
                </p>
              </CardHeader>
              <CardContent>
                {transcript.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No transcript entries yet. Start recording to begin.
                  </p>
                ) : (
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {transcript.map((entry, index) => (
                      <div
                        key={entry.id}
                        className={`border rounded-lg p-4 space-y-2 transition-colors ${
                          currentTranscriptIndex === index ? "bg-blue-50 border-blue-300" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {entry.isEditingSpeaker ? (
                              <Select
                                value={entry.speaker}
                                onValueChange={(value) => updateEntrySpeaker(entry.id, value)}
                              >
                                <SelectTrigger className="w-32">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {speakers.map((speaker) => (
                                    <SelectItem key={speaker} value={speaker}>
                                      {speaker}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="cursor-pointer"
                                onClick={() =>
                                  setTranscript((prev) =>
                                    prev.map((e) => (e.id === entry.id ? { ...e, isEditingSpeaker: true } : e)),
                                  )
                                }
                              >
                                {entry.speaker}
                              </Badge>
                            )}
                            <span className="text-sm text-muted-foreground">
                              <Clock className="h-3 w-3 inline mr-1" />
                              {entry.timestamp.toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setTranscript((prev) =>
                                  prev.map((e) =>
                                    e.id === entry.id ? { ...e, isEditing: true, originalText: e.text } : e,
                                  ),
                                )
                              }
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => deleteEntry(entry.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        {entry.isEditing ? (
                          <div className="space-y-2">
                            <Textarea
                              value={entry.text}
                              onChange={(e) =>
                                setTranscript((prev) =>
                                  prev.map((en) => (en.id === entry.id ? { ...en, text: e.target.value } : en)),
                                )
                              }
                              rows={3}
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => {
                                  setUndoStack((prev) => [
                                    ...prev,
                                    {
                                      type: "edit",
                                      entryId: entry.id,
                                      oldValue: entry.originalText,
                                      newValue: entry.text,
                                    },
                                  ])
                                  setTranscript((prev) =>
                                    prev.map((e) => (e.id === entry.id ? { ...e, isEditing: false } : e)),
                                  )
                                  setEditHistory((prev) => [
                                    ...prev,
                                    {
                                      id: entry.id,
                                      action: "Text edited",
                                      timestamp: new Date(),
                                      oldValue: entry.originalText,
                                      newValue: entry.text,
                                    },
                                  ])
                                }}
                              >
                                <Check className="h-4 w-4 mr-1" />
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setTranscript((prev) =>
                                    prev.map((e) =>
                                      e.id === entry.id
                                        ? { ...e, text: e.originalText || e.text, isEditing: false }
                                        : e,
                                    ),
                                  )
                                }
                              >
                                <X className="h-4 w-4 mr-1" />
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-foreground">{entry.text}</p>
                        )}

                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>
                            {entry.text.length} chars · {entry.text.split(/\s+/).filter(Boolean).length} words
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {showHistory && editHistory.length > 0 && (
                  <div className="mt-4 p-4 bg-muted rounded-lg">
                    <h4 className="font-medium mb-2">Edit History</h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {editHistory
                        .slice(-10)
                        .reverse()
                        .map((item, idx) => (
                          <div key={idx} className="text-sm">
                            <span className="text-muted-foreground">{item.timestamp.toLocaleTimeString()}</span>
                            {" - "}
                            {item.action}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Manual Export Options
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  <Button onClick={exportAsWordDocument} disabled={transcript.length === 0}>
                    <FileText className="h-4 w-4 mr-2" />
                    Export as Word (.docx)
                  </Button>
                  <Button variant="outline" onClick={exportAsText} disabled={transcript.length === 0}>
                    <FileText className="h-4 w-4 mr-2" />
                    Export as Text (.txt)
                  </Button>
                  <Button variant="destructive" onClick={clearTranscript} disabled={transcript.length === 0}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear Transcript
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
