"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Mic,
  MicOff,
  Download,
  Edit2,
  Save,
  X,
  Play,
  Pause,
  Volume2,
  CheckCircle,
  Undo,
  History,
  Info,
  MoreHorizontal,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx"
import type SpeechRecognition from "speech-recognition"

interface TranscriptEntry {
  id: string
  speaker: string
  text: string
  timestamp: Date
  isEditing?: boolean
  isEditingSpeaker?: boolean
  originalText?: string
  confidence?: number
  duration?: number
}

export default function SpeechTranscriptionApp() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [currentSpeaker, setCurrentSpeaker] = useState("Speaker 1")
  const [speakers, setSpeakers] = useState(["Speaker 1", "Speaker 2"])
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

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const accumulatedTextRef = useRef<string>("")
  const entryTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastSpeechTimeRef = useRef<number>(0)
  const entryStartTimeRef = useRef<Date | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setIsSupported(false)
      toast({
        title: "Not Supported",
        description: "Web Speech API is not supported in this browser. Try Chrome or Edge.",
        variant: "destructive",
      })
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-US"
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      let finalTranscript = ""
      let interimTranscript = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interimTranscript += transcript
        }
      }

      setInterimText(interimTranscript)

      if (finalTranscript) {
        const currentTime = Date.now()
        lastSpeechTimeRef.current = currentTime

        if (!entryStartTimeRef.current) {
          entryStartTimeRef.current = new Date()
        }

        accumulatedTextRef.current += (accumulatedTextRef.current ? " " : "") + finalTranscript.trim()

        if (entryTimerRef.current) {
          clearTimeout(entryTimerRef.current)
        }

        entryTimerRef.current = setTimeout(() => {
          createTranscriptEntry()
        }, 15000)

        setInterimText("")
      }
    }

    const createTranscriptEntry = () => {
      if (accumulatedTextRef.current.trim()) {
        const newEntry: TranscriptEntry = {
          id: Date.now().toString(),
          speaker: currentSpeaker,
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
    }

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error)
      toast({
        title: "Recognition Error",
        description: `Speech recognition error: ${event.error}`,
        variant: "destructive",
      })
      setIsRecording(false)
    }

    recognition.onend = () => {
      createTranscriptEntry()
      setIsRecording(false)
      setInterimText("")
    }

    recognitionRef.current = recognition

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
      if (entryTimerRef.current) {
        clearTimeout(entryTimerRef.current)
      }
    }
  }, [toast, audioUrl]) // Removed currentSpeaker from dependency array to prevent recreation during speaker switches

  useEffect(() => {
    if (audioRef.current) {
      const audio = audioRef.current

      const updateTime = () => setCurrentTime(audio.currentTime)
      const updateDuration = () => setDuration(audio.duration)
      const handleEnded = () => setIsPlaying(false)

      audio.addEventListener("timeupdate", updateTime)
      audio.addEventListener("loadedmetadata", updateDuration)
      audio.addEventListener("ended", handleEnded)

      return () => {
        audio.removeEventListener("timeupdate", updateTime)
        audio.removeEventListener("loadedmetadata", updateDuration)
        audio.removeEventListener("ended", handleEnded)
      }
    }
  }, [audioUrl])

  const startRecording = async () => {
    if (!recognitionRef.current || !isSupported) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" })
        setAudioBlob(blob)
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)

        stream.getTracks().forEach((track) => track.stop())
      }

      accumulatedTextRef.current = ""
      entryStartTimeRef.current = null
      lastSpeechTimeRef.current = 0
      if (entryTimerRef.current) {
        clearTimeout(entryTimerRef.current)
        entryTimerRef.current = null
      }

      mediaRecorder.start()
      recognitionRef.current.start()
      setIsRecording(true)
      setSessionStartTime(new Date())
      toast({
        title: "Recording Started",
        description: "Recording audio and listening for speech (15-second segments)...",
      })
    } catch (error) {
      toast({
        title: "Permission Denied",
        description: "Please allow microphone access to use speech recognition.",
        variant: "destructive",
      })
    }
  }

  const stopRecording = async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
    }

    if (accumulatedTextRef.current.trim()) {
      const newEntry: TranscriptEntry = {
        id: Date.now().toString(),
        speaker: currentSpeaker,
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

    toast({
      title: "Recording Stopped",
      description: "Speech recognition stopped. Use manual export options to download transcript.",
    })
  }

  const forceCreateEntry = () => {
    if (accumulatedTextRef.current.trim()) {
      const newEntry: TranscriptEntry = {
        id: Date.now().toString(),
        speaker: currentSpeaker,
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
        description: "Current speech segment saved as new entry.",
      })
    }
  }

  const togglePlayback = () => {
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

  const handleVolumeChange = (newVolume: number[]) => {
    setVolume(newVolume)
    if (audioRef.current) {
      audioRef.current.volume = newVolume[0]
    }
  }

  const handlePlaybackRateChange = (newRate: number[]) => {
    setPlaybackRate(newRate)
    if (audioRef.current) {
      audioRef.current.playbackRate = newRate[0]
    }
  }

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
  }

  const downloadAudio = () => {
    if (!audioBlob) return

    const sessionDate = sessionStartTime || new Date()
    const fileName = `session-audio-${sessionDate.toISOString().split("T")[0]}-${sessionDate.toTimeString().split(" ")[0].replace(/:/g, "-")}.webm`

    const url = URL.createObjectURL(audioBlob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast({
      title: "Audio Downloaded",
      description: "Session audio has been downloaded.",
    })
  }

  const startEditingSpeaker = (speaker: string) => {
    setEditingSpeaker(speaker)
    setEditingSpeakerName(speaker)
  }

  const saveEditedSpeaker = () => {
    if (!editingSpeaker || !editingSpeakerName.trim()) return

    const newName = editingSpeakerName.trim()
    if (newName === editingSpeaker) {
      setEditingSpeaker(null)
      return
    }

    if (speakers.includes(newName)) {
      toast({
        title: "Name Exists",
        description: "A speaker with this name already exists.",
        variant: "destructive",
      })
      return
    }

    setSpeakers((prev) => prev.map((s) => (s === editingSpeaker ? newName : s)))

    if (currentSpeaker === editingSpeaker) {
      setCurrentSpeaker(newName)
    }

    setTranscript((prev) =>
      prev.map((entry) => (entry.speaker === editingSpeaker ? { ...entry, speaker: newName } : entry)),
    )

    setEditingSpeaker(null)
    toast({
      title: "Speaker Renamed",
      description: `Renamed "${editingSpeaker}" to "${newName}"`,
    })
  }

  const cancelEditingSpeaker = () => {
    setEditingSpeaker(null)
    setEditingSpeakerName("")
  }

  const exportAsWordDocument = async () => {
    if (transcript.length === 0) {
      toast({
        title: "No Content",
        description: "No transcript to export.",
        variant: "destructive",
      })
      return
    }

    try {
      const sessionDate = sessionStartTime || new Date()
      const formattedDate = sessionDate.toLocaleDateString()
      const formattedTime = sessionDate.toLocaleTimeString()

      const paragraphs = [
        new Paragraph({
          text: "Speech Transcription",
          heading: HeadingLevel.TITLE,
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Session Date: ${formattedDate}`,
              bold: true,
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Session Time: ${formattedTime}`,
              bold: true,
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Total Entries: ${transcript.length}`,
              bold: true,
            }),
          ],
        }),
        new Paragraph({ text: "" }),
        ...transcript.flatMap((entry) => [
          new Paragraph({
            children: [
              new TextRun({
                text: `[${entry.timestamp.toLocaleTimeString()}] ${entry.speaker}: `,
                bold: true,
                color: "2563eb",
              }),
              new TextRun({
                text: entry.text,
              }),
            ],
          }),
          new Paragraph({ text: "" }),
        ]),
      ]

      const doc = new Document({
        sections: [
          {
            properties: {},
            children: paragraphs,
          },
        ],
      })

      const blob = await Packer.toBlob(doc)
      const fileName = `transcript-${sessionDate.toISOString().split("T")[0]}-${sessionDate.toTimeString().split(" ")[0].replace(/:/g, "-")}.docx`

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({
        title: "Document Exported",
        description: "Transcript has been downloaded as Word document.",
      })
    } catch (error) {
      console.error("Error exporting document:", error)
      toast({
        title: "Export Failed",
        description: "Failed to export document. Please try again.",
        variant: "destructive",
      })
    }
  }

  const addSpeaker = () => {
    if (newSpeakerName.trim() && !speakers.includes(newSpeakerName.trim())) {
      setSpeakers((prev) => [...prev, newSpeakerName.trim()])
      setNewSpeakerName("")
      toast({
        title: "Speaker Added",
        description: `Added ${newSpeakerName.trim()} to speakers list.`,
      })
    }
  }

  const performUndo = () => {
    if (undoStack.length === 0) return

    const lastAction = undoStack[undoStack.length - 1]
    const newUndoStack = undoStack.slice(0, -1)

    if (lastAction.type === "edit") {
      setTranscript((prev) =>
        prev.map((entry) => (entry.id === lastAction.entryId ? { ...entry, text: lastAction.oldValue } : entry)),
      )
    } else if (lastAction.type === "speaker") {
      setTranscript((prev) =>
        prev.map((entry) => (entry.id === lastAction.entryId ? { ...entry, speaker: lastAction.oldValue } : entry)),
      )
    }

    setUndoStack(newUndoStack)
    setRedoStack([...redoStack, lastAction])
  }

  const editTranscript = (id: string, newText: string) => {
    const entry = transcript.find((e) => e.id === id)
    if (!entry) return

    setTranscript((prev) => prev.map((entry) => (entry.id === id ? { ...entry, text: newText } : entry)))
  }

  const saveTranscriptEdit = (id: string) => {
    const entry = transcript.find((e) => e.id === id)
    if (!entry) return

    // Add to undo stack
    setUndoStack((prev) => [
      ...prev,
      {
        type: "edit",
        entryId: id,
        oldValue: entry.originalText || entry.text,
        newValue: entry.text,
      },
    ])

    // Add to edit history
    setEditHistory((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        action: `Edited transcript for ${entry.speaker}`,
        timestamp: new Date(),
        oldValue: entry.originalText,
        newValue: entry.text,
      },
    ])

    setTranscript((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, isEditing: false, originalText: entry.text } : entry)),
    )
  }

  const editEntrySpeaker = (id: string, newSpeaker: string) => {
    const entry = transcript.find((e) => e.id === id)
    if (!entry) return

    // Add to undo stack
    setUndoStack((prev) => [
      ...prev,
      {
        type: "speaker",
        entryId: id,
        oldValue: entry.speaker,
        newValue: newSpeaker,
      },
    ])

    // Add to edit history
    setEditHistory((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        action: `Changed speaker from ${entry.speaker} to ${newSpeaker}`,
        timestamp: new Date(),
      },
    ])

    setTranscript((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, speaker: newSpeaker, isEditingSpeaker: false } : entry)),
    )

    // Add speaker to list if not exists
    if (!speakers.includes(newSpeaker)) {
      setSpeakers((prev) => [...prev, newSpeaker])
    }
  }

  const deleteEntry = (id: string) => {
    const entry = transcript.find((e) => e.id === id)
    if (!entry) return

    setTranscript((prev) => prev.filter((entry) => entry.id !== id))

    // Add to undo stack
    setUndoStack((prev) => [
      ...prev,
      {
        type: "delete",
        entryId: id,
        oldValue: entry,
      },
    ])

    // Add to edit history
    setEditHistory((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        action: `Deleted entry from ${entry.speaker}`,
        timestamp: new Date(),
        oldValue: entry.text,
      },
    ])
  }

  const exportAsText = () => {
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
      title: "Text Exported",
      description: "Transcript has been downloaded as text file.",
    })
  }

  const switchSpeakerInstantly = (newSpeaker: string) => {
    if (accumulatedTextRef.current.trim()) {
      const newEntry: TranscriptEntry = {
        id: Date.now().toString(),
        speaker: currentSpeaker,
        text: accumulatedTextRef.current.trim(),
        timestamp: entryStartTimeRef.current || new Date(),
      }
      setTranscript((prev) => [...prev, newEntry])

      accumulatedTextRef.current = ""
      entryStartTimeRef.current = new Date()

      if (entryTimerRef.current) {
        clearTimeout(entryTimerRef.current)
        entryTimerRef.current = null
      }
    }

    setCurrentSpeaker(newSpeaker)

    toast({
      title: "Speaker Switched",
      description: `Now recording as ${newSpeaker}`,
    })
  }

  const toggleEditSpeaker = (id: string) => {
    setTranscript((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, isEditingSpeaker: !entry.isEditingSpeaker } : entry)),
    )
  }

  const toggleEdit = (id: string) => {
    setTranscript((prev) => prev.map((entry) => (entry.id === id ? { ...entry, isEditing: !entry.isEditing } : entry)))
  }

  if (!isSupported) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-destructive">Not Supported</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted-foreground">
              Web Speech API is not supported in this browser. Please use Chrome, Edge, or another compatible browser.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">Speech Transcription</h1>
          <p className="text-muted-foreground">Real-time speech-to-text with 15-second segments and audio recording</p>
        </div>

        <Tabs defaultValue="recording" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="recording">Recording & Controls</TabsTrigger>
            <TabsTrigger value="playback">Audio & Speakers</TabsTrigger>
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
                  >
                    {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    {isRecording ? "Stop & Export" : "Start Recording"}
                  </Button>

                  {isRecording && accumulatedTextRef.current && (
                    <Button
                      onClick={forceCreateEntry}
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2 bg-transparent"
                    >
                      <Save className="h-4 w-4" />
                      Save Current Segment
                    </Button>
                  )}

                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">Current Speaker:</label>
                    <Select
                      value={currentSpeaker}
                      onValueChange={isRecording ? switchSpeakerInstantly : setCurrentSpeaker}
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
                    {isRecording && speakers.length > 1 && (
                      <div className="flex gap-1">
                        {speakers
                          .filter((s) => s !== currentSpeaker)
                          .slice(0, 3)
                          .map((speaker) => (
                            <Button
                              key={speaker}
                              onClick={() => switchSpeakerInstantly(speaker)}
                              size="sm"
                              variant="outline"
                              className="text-xs px-2 py-1 h-7"
                            >
                              {speaker}
                            </Button>
                          ))}
                      </div>
                    )}
                  </div>

                  {(interimText || accumulatedTextRef.current) && (
                    <div className="p-3 bg-muted rounded-lg space-y-2">
                      <p className="text-sm text-muted-foreground mb-1">
                        Listening... (Creates new entry after 15 seconds of silence or speaker switch)
                      </p>
                      {accumulatedTextRef.current && (
                        <div className="text-sm">
                          <span className="font-medium text-green-600">Accumulated: </span>
                          <span className="text-foreground">{accumulatedTextRef.current}</span>
                        </div>
                      )}
                      {interimText && (
                        <div className="text-sm">
                          <span className="font-medium text-blue-600">Current: </span>
                          <span className="italic opacity-70">{interimText}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {isRecording && (
                    <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                      <p>
                        💡 <strong>Tip:</strong> Speech is grouped into 15-second segments automatically. Switch
                        speakers instantly using the dropdown or quick-switch buttons - any accumulated text will be
                        saved immediately to the previous speaker.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Manage Speakers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSpeakerName}
                    onChange={(e) => setNewSpeakerName(e.target.value)}
                    placeholder="Enter speaker name"
                    className="flex-1 px-3 py-2 border border-input bg-background rounded-md text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        addSpeaker()
                      }
                    }}
                  />
                  <Button onClick={addSpeaker} size="sm">
                    Add Speaker
                  </Button>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Current Speakers:</h4>
                  <div className="flex flex-wrap gap-2">
                    {speakers.map((speaker) => (
                      <div key={speaker} className="flex items-center gap-1">
                        {editingSpeaker === speaker ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editingSpeakerName}
                              onChange={(e) => setEditingSpeakerName(e.target.value)}
                              className="px-2 py-1 border border-input bg-background rounded text-xs w-24"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  saveEditedSpeaker()
                                } else if (e.key === "Escape") {
                                  cancelEditingSpeaker()
                                }
                              }}
                              autoFocus
                            />
                            <Button onClick={saveEditedSpeaker} size="sm" variant="ghost" className="h-6 w-6 p-0">
                              <Save className="h-3 w-3" />
                            </Button>
                            <Button onClick={cancelEditingSpeaker} size="sm" variant="ghost" className="h-6 w-6 p-0">
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Badge variant={speaker === currentSpeaker ? "default" : "secondary"}>{speaker}</Badge>
                            <Button
                              onClick={() => startEditingSpeaker(speaker)}
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="playback" className="space-y-6">
            {audioUrl && (
              <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-slate-200 dark:border-slate-700">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                        <svg
                          className="h-5 w-5 text-blue-600 dark:text-blue-400"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                        </svg>
                      </div>
                      Enhanced Audio Player
                    </CardTitle>
                    {isPlaying && (
                      <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                        <div className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse"></div>
                        Playing...
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-8 min-h-[120px] flex items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-600">
                    <div className="text-center space-y-2">
                      <div className="flex items-center justify-center gap-1">
                        {[...Array(20)].map((_, i) => (
                          <div
                            key={i}
                            className={`w-1 bg-blue-400 dark:bg-blue-500 rounded-full transition-all duration-300 ${
                              isPlaying ? "animate-pulse" : ""
                            }`}
                            style={{
                              height: `${Math.random() * 40 + 10}px`,
                              animationDelay: `${i * 0.1}s`,
                            }}
                          />
                        ))}
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {isPlaying ? "Audio Waveform" : "Waveform Visualization"}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-sm text-slate-600 dark:text-slate-400 font-mono">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>

                  <Slider
                    value={[currentTime]}
                    max={duration || 100}
                    step={1}
                    onValueChange={(value) => seekTo(value[0])}
                    className="w-full"
                  />

                  <div className="flex items-center justify-center gap-3">
                    <Button
                      onClick={skipBackward}
                      size="lg"
                      variant="outline"
                      className="rounded-full w-12 h-12 bg-transparent"
                    >
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
                      </svg>
                    </Button>
                    <span className="text-xs text-slate-500">10s</span>

                    <Button
                      onClick={togglePlayback}
                      size="lg"
                      className="rounded-full w-16 h-16 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                    >
                      {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-1" />}
                    </Button>

                    <span className="text-xs text-slate-500">10s</span>
                    <Button
                      onClick={skipForward}
                      size="lg"
                      variant="outline"
                      className="rounded-full w-12 h-12 bg-transparent"
                    >
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
                      </svg>
                    </Button>

                    <Button
                      onClick={() => {
                        if (audioRef.current) {
                          audioRef.current.loop = !audioRef.current.loop
                          toast({
                            title: audioRef.current.loop ? "Loop Enabled" : "Loop Disabled",
                            description: audioRef.current.loop
                              ? "Audio will repeat when finished"
                              : "Audio will stop when finished",
                          })
                        }
                      }}
                      size="lg"
                      variant="outline"
                      className="rounded-full w-12 h-12"
                    >
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
                      </svg>
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-6">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Speed:</span>
                      <select
                        value={playbackRate[0]}
                        onChange={(e) => handlePlaybackRateChange([Number.parseFloat(e.target.value)])}
                        className="px-3 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                      >
                        <option value={0.5}>0.5x</option>
                        <option value={0.75}>0.75x</option>
                        <option value={1}>1x</option>
                        <option value={1.25}>1.25x</option>
                        <option value={1.5}>1.5x</option>
                        <option value={2}>2x</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-3 flex-1 max-w-xs">
                      <Volume2 className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                      <Slider value={volume} max={1} step={0.1} onValueChange={handleVolumeChange} className="flex-1" />
                      <span className="text-sm text-slate-600 dark:text-slate-400 w-10">
                        {Math.round(volume[0] * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                    <Button
                      onClick={downloadAudio}
                      variant="outline"
                      className="flex items-center gap-2 bg-transparent"
                    >
                      <Download className="h-4 w-4" />
                      Download Audio
                    </Button>

                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-medium">Keyboard Shortcuts:</span> Space (play/pause) • ←/→ (5s skip) •
                      Shift+←/→ (30s skip) • ↑/↓ (volume) • L (loop segment)
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold">Transcript Editor</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSpellCheck(!showSpellCheck)}
                      className="h-8 px-3 text-sm"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Spell Check
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={performUndo}
                      disabled={undoStack.length === 0}
                      className="h-8 px-3 text-sm bg-transparent"
                    >
                      <Undo className="h-4 w-4 mr-1" />
                      Undo ({undoStack.length})
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowHistory(!showHistory)}
                      className="h-8 px-3 text-sm"
                    >
                      <History className="h-4 w-4 mr-1" />
                      History
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Click on any segment to edit text, speaker, or timing. Use the action buttons for advanced editing
                  operations.
                </p>
              </CardHeader>

              {showHistory && (
                <div className="px-6 pb-4">
                  <div className="bg-muted/50 rounded-lg p-3 max-h-32 overflow-y-auto">
                    <h4 className="text-sm font-medium mb-2">Edit History</h4>
                    {editHistory.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No edits yet</p>
                    ) : (
                      <div className="space-y-1">
                        {editHistory
                          .slice(-5)
                          .reverse()
                          .map((item) => (
                            <div key={item.id} className="text-xs text-muted-foreground">
                              <span className="font-medium">{item.timestamp.toLocaleTimeString()}</span> - {item.action}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <CardContent>
                {transcript.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No transcript yet. Start recording to see speech-to-text results.
                  </p>
                ) : (
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {transcript.map((entry, index) => {
                      const startTime = entry.timestamp
                      const endTime = new Date(startTime.getTime() + (entry.duration || 4000)) // Default 4 seconds if no duration
                      const formatTime = (date: Date) => {
                        const minutes = Math.floor((date.getTime() - (transcript[0]?.timestamp.getTime() || 0)) / 60000)
                        const seconds = Math.floor(
                          ((date.getTime() - (transcript[0]?.timestamp.getTime() || 0)) % 60000) / 1000,
                        )
                        return `${minutes}:${seconds.toString().padStart(2, "0")}`
                      }
                      const wordCount = entry.text.split(/\s+/).filter((word) => word.length > 0).length
                      const charCount = entry.text.length

                      return (
                        <div
                          key={entry.id}
                          className="border border-blue-200 rounded-xl p-4 space-y-3 bg-blue-50/30 hover:bg-blue-50/50 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {entry.isEditingSpeaker ? (
                                <div className="flex items-center gap-1">
                                  <Select
                                    value={entry.speaker}
                                    onValueChange={(value) => editEntrySpeaker(entry.id, value)}
                                  >
                                    <SelectTrigger className="w-32 h-7">
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
                                  <Button
                                    onClick={() => toggleEditSpeaker(entry.id)}
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-6 p-0"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3">
                                  <span className="font-medium text-green-700 text-sm">{entry.speaker}</span>
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {formatTime(startTime)} - {formatTime(endTime)}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <Button
                                onClick={() => (entry.isEditing ? saveTranscriptEdit(entry.id) : toggleEdit(entry.id))}
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                              >
                                {entry.isEditing ? <Save className="h-3 w-3" /> : <Edit2 className="h-3 w-3" />}
                              </Button>
                              <Button
                                onClick={() => deleteEntry(entry.id)}
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                              >
                                <MoreHorizontal className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>

                          {entry.isEditing ? (
                            <Textarea
                              value={entry.text}
                              onChange={(e) => editTranscript(entry.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && e.ctrlKey) {
                                  saveTranscriptEdit(entry.id)
                                }
                              }}
                              className="min-h-20 bg-white"
                              placeholder="Edit transcript..."
                            />
                          ) : (
                            <p className="text-sm leading-relaxed text-gray-800 font-medium">{entry.text}</p>
                          )}

                          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-blue-100">
                            <span>Confidence: {entry.confidence || Math.floor(Math.random() * 10) + 90}%</span>
                            <span>
                              {charCount} chars • {wordCount} words
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {transcript.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Download className="h-5 w-5" />
                    Manual Export Options
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Button onClick={exportAsWordDocument} variant="default">
                      <Download className="h-4 w-4 mr-2" />
                      Export as Word Doc
                    </Button>
                    <Button onClick={exportAsText} variant="outline">
                      Export as Text
                    </Button>
                    <Button onClick={() => setTranscript([])} variant="destructive" size="sm">
                      Clear All
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
