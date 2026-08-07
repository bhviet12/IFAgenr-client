import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import axios from 'axios';
import { Camera, Download, SunMoon, UploadCloud, AlertCircle, CheckCircle, Loader2, X } from 'lucide-react';
import Webcam from 'react-webcam';

// API Base URL - MUST be configured in Vercel dashboard for production
// For local: VITE_API_URL=http://localhost:4000
// For Vercel: VITE_API_URL=https://ifagent-server.onrender.com
const API_BASE_URL = import.meta.env.VITE_API_URL;

// API Helper functions
// NOTE: VITE_API_URL must be set in Vercel dashboard for production
const api = {
  generate: (formData: FormData) => {
    if (!API_BASE_URL) {
      return Promise.reject(new Error('API URL not configured. Set VITE_API_URL environment variable.'));
    }
    return axios.post(`${API_BASE_URL}/api/generate`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000 // 2 minute timeout for generation
    });
  },

  getLogs: () => {
    if (!API_BASE_URL) {
      return Promise.reject(new Error('API URL not configured. Set VITE_API_URL environment variable.'));
    }
    return axios.get(`${API_BASE_URL}/api/logs`, { timeout: 10000 });
  }
};

interface LogEntry {
  timestamp: string;
  requestPayload: Record<string, unknown>;
  prompt: string;
  provider: string;
  statusCode: number;
  latency: number;
  success: boolean;
  error?: string;
  response?: string;
  usedFallback?: boolean;
  generationModel?: string;
  inputImageSize?: number;
  outputImageSize?: number;
}

interface GenerationMetadata {
  name: string;
  provider: string;
  model: string;
  usedFallback: boolean;
  inputSize: number;
  outputSize: number;
  dimensions: string;
  latency: number;
  generationTime: number;
  overlayTime: number;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const HomePage = () => {
  // State
  const [name, setName] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultMetadata, setResultMetadata] = useState<GenerationMetadata | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const webcamRef = useRef<Webcam>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  const previewImage = useMemo(() => capturedImage || selectedImage, [capturedImage, selectedImage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    };
  }, []);

  const stopCameraStream = () => {
    const stream = webcamRef.current?.video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
  };

  // Load logs on mount
  useEffect(() => {
    void loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      const res = await api.getLogs();
      setLogs(res.data.logs ?? []);
    } catch (error) {
      console.error('Failed to load logs:', error);
      setLogs([]);
    }
  };

  const showMessage = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage(msg);
    setMessageType(type);
    // Auto-clear success messages after 5 seconds
    if (type === 'success') {
      setTimeout(() => {
        setMessage(prev => prev === msg ? '' : prev);
      }, 5000);
    }
  };

  const clearMessage = () => {
    setMessage('');
  };

  const validateInput = (): string[] => {
    const errors: string[] = [];

    // Validate name
    if (!name.trim()) {
      errors.push('Please enter your superhero name');
    } else if (name.trim().length < 2) {
      errors.push('Name must be at least 2 characters');
    } else if (name.trim().length > 50) {
      errors.push('Name must be less than 50 characters');
    }

    // Validate image
    if (!previewImage) {
      errors.push('Please upload or capture an image');
    }

    return errors;
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      setValidationErrors(['Invalid file type. Please upload JPEG, PNG, WebP, or GIF.']);
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setValidationErrors([`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`]);
      return;
    }

    setValidationErrors([]);
    setCapturedImage(null);
    const reader = new FileReader();
    reader.onload = () => setSelectedImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleCameraToggle = () => {
    if (cameraOpen) {
      stopCameraStream();
      setCameraOpen(false);
      setIsCameraLoading(false);
      return;
    }

    setCameraOpen(true);
    setCameraError('');
    setIsCameraLoading(true);
    setValidationErrors([]);
  };

  const handleCapture = () => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      stopCameraStream();
      setCapturedImage(imageSrc);
      setSelectedImage(null);
      setCameraOpen(false);
      setIsCameraLoading(false);
      setCameraError('');
      setValidationErrors([]);
    } else {
      setCameraError('Camera capture failed. Please try again.');
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setSelectedImage(null);
    setCameraError('');
    setValidationErrors([]);
    setIsCameraLoading(true);
    setCameraOpen(true);
  };

  const clearResult = () => {
    setResultUrl(null);
    setResultMetadata(null);
  };

  const handleGenerate = async () => {
    // Validate input
    const errors = validateInput();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setIsGenerating(true);
    setMessage('');
    setValidationErrors([]);
    setGenerationProgress(0);

    // Start progress animation
    progressInterval.current = setInterval(() => {
      setGenerationProgress(prev => Math.min(prev + 5, 90));
    }, 500);

    const formData = new FormData();
    formData.append('name', name.trim());

    // Convert data URL to file
    const response = await fetch(previewImage!);
    const blob = await response.blob();
    const file = new File([blob], 'capture.png', { type: blob.type || 'image/png' });
    formData.append('image', file);

    try {
      const res = await api.generate(formData);

      // Clear progress interval and set to 100%
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
      setGenerationProgress(100);

      const imageUrl = res.data.imageUrl ? `${API_BASE_URL}${res.data.imageUrl}` : null;
      setResultUrl(imageUrl);

      if (res.data.metadata) {
        setResultMetadata(res.data.metadata);
      }

      // Show appropriate message based on whether fallback was used
      if (res.data.metadata?.usedFallback) {
        showMessage('Generated with name overlay (Gemini API unavailable or rate limited)', 'info');
      } else {
        showMessage('Superhero portrait generated successfully!', 'success');
      }

      // Reload logs
      await loadLogs();

      // Reset progress after a short delay
      setTimeout(() => setGenerationProgress(0), 1000);

    } catch (error) {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
      setGenerationProgress(0);

      let errorMsg = 'Generation failed. Please try again.';

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          errorMsg = 'Request timed out. The image generation took too long.';
        } else if (error.response?.data?.message) {
          errorMsg = error.response.data.message;
        } else if (!error.response) {
          errorMsg = 'Cannot connect to server. Please check your connection.';
        }
      } else if (error instanceof Error) {
        errorMsg = error.message;
      }

      setValidationErrors([errorMsg]);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={`min-h-screen px-4 py-6 text-slate-800 transition-colors duration-300 sm:px-6 lg:px-8 ${theme === 'dark' ? 'bg-[#181818] text-slate-100' : 'bg-[#f5f7fb] text-slate-800'}`}>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        {/* Header */}
        <header className={`rounded-[28px] border p-6 shadow-[0_20px_60px_rgba(0,0,0,0.18)] ${theme === 'dark' ? 'border-white/10 bg-[#202020] text-white' : 'border-slate-200 bg-white text-slate-800'}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className={`text-sm font-semibold uppercase tracking-[0.3em] ${theme === 'dark' ? 'text-cyan-300' : 'text-blue-600'}`}>Superhero Generator</p>
              <h1 className="mt-2 text-3xl font-semibold">Superhero Generator</h1>
              <p className={`mt-2 max-w-2xl text-sm ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                Create a polished comic-book hero portrait from a selfie with Gemini-powered generation and a custom name overlay.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className={`rounded-full px-3 py-2 text-sm font-medium ${theme === 'dark' ? 'border border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border border-blue-200 bg-blue-50 text-blue-700'}`}>
                Gemini Image API
              </div>
              <button
                onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
                className={`rounded-full p-2.5 ${theme === 'dark' ? 'bg-white/10 text-slate-100 hover:bg-white/20' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                <SunMoon size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className={`rounded-[32px] border p-4 sm:p-6 ${theme === 'dark' ? 'border-white/10 bg-[#f7f7f7] text-slate-800' : 'border-slate-200 bg-white text-slate-800'}`}>
          <div className="flex flex-col gap-4 xl:flex-row">
            {/* Left Column - Input and Results */}
            <div className="flex-1 space-y-4">
              {/* Controls Card */}
              <div className={`rounded-[24px] border p-4 sm:p-6 ${theme === 'dark' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-white'}`}>
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  {/* Name Input */}
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setValidationErrors([]);
                    }}
                    placeholder="Enter your superhero name"
                    disabled={isGenerating}
                    className={`w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors xl:max-w-xs ${theme === 'dark' ? 'border-slate-200 bg-slate-50 text-slate-800' : 'border-slate-200 bg-slate-50 text-slate-800'} disabled:opacity-50`}
                  />

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 xl:gap-3">
                    <label className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white transition-opacity ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}>
                      <UploadCloud size={16} />
                      Upload Image
                      <input onChange={handleFile} type="file" accept="image/*" className="hidden" disabled={isGenerating} />
                    </label>

                    <button
                      onClick={handleCameraToggle}
                      disabled={isGenerating}
                      className={`rounded-xl px-4 py-3 text-sm font-medium text-white transition-opacity disabled:opacity-50 ${theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-900 hover:bg-slate-800'}`}
                    >
                      <span className="flex items-center gap-2">
                        <Camera size={16} />
                        {cameraOpen ? 'Close Camera' : 'Open Camera'}
                      </span>
                    </button>

                    <button
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all disabled:cursor-not-allowed disabled:opacity-60 hover:bg-emerald-700"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Generating...
                        </>
                      ) : (
                        'Generate'
                      )}
                    </button>

                    {resultUrl && !isGenerating && (
                      <a
                        href={resultUrl}
                        download={`superhero-${name || 'hero'}.png`}
                        className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                      >
                        <Download size={16} />
                        Download
                      </a>
                    )}

                    {resultUrl && !isGenerating && (
                      <button
                        onClick={clearResult}
                        className="flex items-center gap-2 rounded-xl bg-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-300"
                      >
                        <X size={16} />
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Validation Errors */}
                {validationErrors.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {validationErrors.map((error, idx) => (
                      <div key={idx} className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        <AlertCircle size={16} />
                        {error}
                      </div>
                    ))}
                  </div>
                )}

                {/* Success/Info Message */}
                {message && !validationErrors.length && (
                  <div className={`mt-4 flex items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm ${messageType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                    <div className="flex items-center gap-2">
                      {messageType === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                      {message}
                    </div>
                    <button onClick={clearMessage} className="text-current opacity-60 hover:opacity-100">
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Progress Bar */}
                {isGenerating && (
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>Generating your superhero...</span>
                      <span>{generationProgress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                        style={{ width: `${generationProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Camera Section */}
                {cameraOpen && (
                  <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-800">Live Camera</h3>
                      <button
                        onClick={handleCapture}
                        disabled={isCameraLoading}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:bg-blue-700"
                      >
                        {isCameraLoading ? 'Starting...' : 'Capture Photo'}
                      </button>
                    </div>

                    {cameraError && (
                      <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
                        <AlertCircle size={14} className="inline mr-1" />
                        {cameraError}
                      </div>
                    )}

                    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black">
                      {isCameraLoading && (
                        <div className="absolute inset-0 z-10 flex h-[260px] items-center justify-center bg-white/90">
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Loader2 size={16} className="animate-spin" />
                            Requesting camera access...
                          </div>
                        </div>
                      )}
                      <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/png"
                        videoConstraints={{ facingMode: 'user' }}
                        className="h-[260px] w-full object-cover"
                        onUserMedia={() => {
                          setIsCameraLoading(false);
                          setCameraError('');
                        }}
                        onUserMediaError={() => {
                          setIsCameraLoading(false);
                          setCameraOpen(false);
                          setCameraError('Camera access denied. Please allow camera permission in your browser settings.');
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Captured Photo Ready */}
                {!cameraOpen && capturedImage && !isGenerating && (
                  <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <CheckCircle size={16} className="text-emerald-500" />
                      Photo captured and ready
                    </div>
                    <button
                      onClick={handleRetake}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      Retake
                    </button>
                  </div>
                )}
              </div>

              {/* Image Previews */}
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Preview Card */}
                <div className={`rounded-[24px] border p-4 ${theme === 'dark' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-white'}`}>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-slate-800">Preview</h2>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Input</span>
                  </div>
                  {previewImage ? (
                    <img src={previewImage} alt="Preview" className="h-[320px] w-full rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                      Upload or capture an image to preview
                    </div>
                  )}
                </div>

                {/* Generated Hero Card */}
                <div className={`rounded-[24px] border p-4 ${theme === 'dark' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-white'}`}>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-slate-800">Generated Hero</h2>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">Output</span>
                  </div>
                  {resultUrl ? (
                    <div className="relative">
                      <img src={resultUrl} alt="Generated superhero" className="h-[320px] w-full rounded-2xl object-cover" />
                      {resultMetadata && (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span className="rounded bg-slate-100 px-2 py-1">{resultMetadata.dimensions}</span>
                          <span className="rounded bg-slate-100 px-2 py-1">{resultMetadata.provider}</span>
                          <span className="rounded bg-slate-100 px-2 py-1">{resultMetadata.latency}ms</span>
                          {resultMetadata.usedFallback && (
                            <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">Fallback</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                      {isGenerating ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 size={24} className="animate-spin text-blue-500" />
                          <span>Generating...</span>
                        </div>
                      ) : (
                        'Click Generate to create your hero'
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Log Viewer */}
            <aside className={`w-full xl:max-w-[340px] rounded-[24px] border p-4 ${theme === 'dark' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-white'}`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">Generation Logs</h2>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Live</span>
              </div>
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                    No activity yet. Generate your first superhero!
                  </div>
                ) : (
                  logs.slice(0, 10).map((log, index) => (
                    <div key={`${log.timestamp}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          log.success
                            ? 'bg-emerald-100 text-emerald-700'
                            : log.error
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {log.success ? 'Success' : log.error ? 'Error' : 'Pending'}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <p><span className="font-semibold text-slate-700">Latency:</span> {log.latency}ms</p>
                        <p><span className="font-semibold text-slate-700">Provider:</span> {log.provider}</p>
                        {log.generationModel && (
                          <p><span className="font-semibold text-slate-700">Model:</span> {log.generationModel}</p>
                        )}
                        <p><span className="font-semibold text-slate-700">Prompt:</span> {log.prompt.substring(0, 60)}...</p>
                        <p><span className="font-semibold text-slate-700">Response:</span> {log.response ? `${API_BASE_URL}${log.response}` : '—'}</p>
                        {log.usedFallback !== undefined && (
                          <p><span className="font-semibold text-slate-700">Fallback:</span> {log.usedFallback ? 'Yes ⚠️' : 'No ✅'}</p>
                        )}
                        {log.error && (
                          <p className="text-rose-600"><span className="font-semibold">Error:</span> {log.error}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        </div>

        {/* Footer */}
        <footer className={`flex flex-col items-center justify-between gap-2 rounded-[24px] border px-4 py-4 text-sm sm:flex-row ${theme === 'dark' ? 'border-white/10 bg-[#202020] text-slate-300' : 'border-slate-200 bg-white text-slate-600'}`}>
          <span>© 2026 | Superhero Generator</span>
          <span>Powered by Gemini Image API</span>
        </footer>
      </div>
    </div>
  );
};

export default HomePage;
