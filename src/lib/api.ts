import axios from 'axios';

// Use environment variable - MUST be configured in Vercel dashboard for production
// For local: VITE_API_URL=http://localhost:4000
// For Vercel: VITE_API_URL=https://ifagent-server.onrender.com
const API_BASE_URL = import.meta.env.VITE_API_URL;

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000, // 2 minutes for image generation
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor for logging
apiClient.interceptors.request.use(
  (config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('[API] Request error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    console.log(`[API] Response ${response.status}`);
    return response;
  },
  (error) => {
    if (error.response) {
      console.error(`[API] Error ${error.response.status}:`, error.response.data);
    } else if (error.request) {
      console.error('[API] No response received:', error.message);
    } else {
      console.error('[API] Error:', error.message);
    }
    return Promise.reject(error);
  }
);

// API methods
export const generateHero = (formData: FormData) =>
  apiClient.post('/api/generate', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000
  });

export const getLogs = () =>
  apiClient.get('/api/logs', {
    timeout: 10000
  });

export const checkHealth = () =>
  apiClient.get('/health', {
    timeout: 5000
  });

export { API_BASE_URL };
