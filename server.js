/**
 * ShortsGen AI - Server Side Renderer
 * 
 * This server acts as a bridge between a REST API and the Client-Side React App.
 * It uses Puppeteer to launch a headless browser, load the React App, 
 * inject the script, and capture the generated video.
 * 
 * Dependencies: express, puppeteer, cors, uuid, @google/genai
 * Run: node server.js
 */

import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

// Replicate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_URL = `http://localhost:${PORT}`; // We serve the static app on the same port

// Configuration
const VIDEO_STORAGE_DIR = path.join(__dirname, 'public', 'videos');
const RETENTION_MS = 48 * 60 * 60 * 1000; // 48 Hours

// Available voices from Gemini TTS
const AVAILABLE_VOICES = ['Kore', 'Puck', 'Fenrir', 'Charon', 'Zephyr'];

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow large script payloads

// 1. Serve the React App Static Files
const DIST_DIR = path.join(__dirname, 'dist');
if (!fs.existsSync(DIST_DIR)) {
    console.warn("\n⚠️  WARNING: 'dist' directory not found.");
    console.warn("   Please run 'npm run build' to compile the React app before starting the server.\n");
}
app.use(express.static(DIST_DIR));
app.use('/videos', express.static(VIDEO_STORAGE_DIR));

// In-memory Job Store
const jobs = new Map();

// Helper: Ensure storage dir exists
if (!fs.existsSync(VIDEO_STORAGE_DIR)){
    fs.mkdirSync(VIDEO_STORAGE_DIR, { recursive: true });
}

// Helper: Clean old files (Retention Policy)
setInterval(() => {
    console.log('🧹 Running cleanup task...');
    const now = Date.now();
    fs.readdir(VIDEO_STORAGE_DIR, (err, files) => {
        if (err) return console.error('Cleanup read error:', err);
        files.forEach(file => {
            const filePath = path.join(VIDEO_STORAGE_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                // Delete if older than RETENTION_MS
                if (now - stats.mtimeMs > RETENTION_MS) {
                    fs.unlink(filePath, () => console.log(`🗑️  Deleted expired video: ${file}`));
                    
                    // Also clean map (simple linear scan)
                    for (const [key, val] of jobs.entries()) {
                        if (val.filename === file) jobs.delete(key);
                    }
                }
            });
        });
    });
}, 60 * 60 * 1000); // Run every hour

// --- API Endpoints ---

/**
 * GET /api/voices
 * Returns list of supported voices
 */
app.get('/api/voices', (req, res) => {
    res.json({ voices: AVAILABLE_VOICES });
});

/**
 * POST /api/generate
 * Headers: 
 *   x-google-api-key: "YOUR_GEMINI_KEY"
 * 
 * Body: { 
 *   script: [{ voiceOverText, imagePrompt }, ...], 
 *   voice: "Kore", 
 *   showSubtitles: true,
 *   apiKey: "OPTIONAL_ALTERNATIVE_LOCATION" 
 * }
 */
app.post('/api/generate', async (req, res) => {
    const { script, voice = 'Kore', showSubtitles = true } = req.body;
    
    // 1. Extract API Key
    const apiKey = req.headers['x-google-api-key'] || req.body.apiKey;

    if (!apiKey) {
        return res.status(401).json({ 
            error: "Authentication required. Please provide a Gemini API Key via 'x-google-api-key' header or 'apiKey' body field." 
        });
    }

    // 2. Validate API Key (Lightweight check)
    try {
        const ai = new GoogleGenAI({ apiKey });
        // We fetch a model definition to verify the key is active
        await ai.models.get({ model: 'gemini-2.5-flash' });
    } catch (e) {
        console.error("Auth failed:", e.message);
        return res.status(401).json({ error: "Invalid Gemini API Key provided." });
    }

    if (!script || !Array.isArray(script)) {
        return res.status(400).json({ error: "Invalid script format. Must be an array of scenes." });
    }

    const jobId = uuidv4();
    
    const jobConfig = { 
        script, 
        voice, 
        showSubtitles, 
        apiKey // Pass the validated key to the worker
    };

    jobs.set(jobId, {
        id: jobId,
        status: 'queued',
        progress: 0,
        createdAt: Date.now(),
        config: { ...jobConfig, sceneCount: script.length }
    });

    // Start background processing
    processJob(jobId, jobConfig);

    res.json({ 
        jobId, 
        status: 'queued',
        progress: 0,
        message: "Video generation started.",
        statusUrl: `${CLIENT_URL}/api/status/${jobId}`
    });
});

/**
 * GET /api/status/:id
 * Checks the status of a job.
 */
app.get('/api/status/:id', (req, res) => {
    const jobId = req.params.id;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: "Job not found" });
    }

    // Don't leak the API key in the status response
    const { config, ...safeJobData } = job;
    
    // Explicitly ensure progress is set
    const responseData = {
        ...safeJobData,
        progress: safeJobData.progress || 0
    };
    
    if (responseData.status === 'completed') {
        return res.json({
            id: responseData.id,
            status: 'completed',
            progress: 100,
            videoUrl: `${CLIENT_URL}/videos/${responseData.filename}`,
            expiresIn: "48 hours",
            completedAt: responseData.completedAt
        });
    }

    res.json(responseData);
});

// --- Worker Logic ---

/**
 * Launches Puppeteer to render the video.
 */
async function processJob(jobId, config) {
    const job = jobs.get(jobId);
    job.status = 'processing';
    console.log(`[${jobId}] 🚀 Processing started...`);

    let browser;
    try {
        // Detect system browser to avoid architecture issues (ARM vs x64)
        let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        if (!executablePath) {
            const commonPaths = [
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/google-chrome'
            ];
            for (const p of commonPaths) {
                if (fs.existsSync(p)) {
                    executablePath = p;
                    console.log(`[${jobId}] ℹ️  Using system browser: ${executablePath}`);
                    break;
                }
            }
        }

        const launchConfig = {
            headless: "new",
            protocolTimeout: 0, // Disable protocol timeout to allow long renders
            dumpio: true, // Log stdio from browser
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Important for containerized envs
                '--autoplay-policy=no-user-gesture-required',
                '--use-gl=egl'
            ]
        };

        if (executablePath) {
            launchConfig.executablePath = executablePath;
        }

        browser = await puppeteer.launch(launchConfig);

        const page = await browser.newPage();
        
        // Log console messages from the browser for debugging
        page.on('console', msg => {
            const text = msg.text();
            // Filter logs to reduce noise, keep relevant ones
            if (text.includes('Headless Job') || text.includes('Export') || text.includes('Error')) {
                console.log(`[${jobId} Browser] ${text}`);
            }
        });

        // Navigate to the local React App
        await page.goto(`${CLIENT_URL}`, { waitUntil: 'networkidle0' });

        // Inject the Job
        console.log(`[${jobId}] Injecting script...`);
        
        // 1. Trigger the job (Fire and Forget in context)
        const triggerResult = await page.evaluate((jobConfig) => {
            if (!(window).startHeadlessJob) {
                return { error: "App not ready or headless hook missing. Did the page load correctly?" };
            }
            
            // Kick off the async job without awaiting it here
            (window).startHeadlessJob(jobConfig)
                .catch(err => {
                    console.error("Headless Job Failed inside App:", err);
                    (window).JOB_ERROR = err.message || "Unknown error";
                });

            return { success: true };
        }, config);

        if (triggerResult.error) {
            throw new Error(triggerResult.error);
        }

        // 2. Poll for the result while updating progress
        console.log(`[${jobId}] Waiting for render...`);
        
        const TIMEOUT_MS = 1800000; // 30 minutes
        const POLL_INTERVAL_MS = 2000;
        const startTime = Date.now();
        let finalData = null;

        while (Date.now() - startTime < TIMEOUT_MS) {
            // Check status in browser
            const status = await page.evaluate(() => ({
                data: (window).RENDERED_VIDEO_DATA,
                error: (window).JOB_ERROR,
                progress: (window).JOB_PROGRESS || 0
            }));

            if (status.data) {
                finalData = status.data;
                job.progress = 100;
                break;
            }

            if (status.error) {
                throw new Error(status.error);
            }

            // Update job progress in memory so API clients see it
            job.progress = Math.round(status.progress);
            
            // Sleep
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        }

        if (!finalData) {
            throw new Error("Timeout waiting for video render (30m limit exceeded)");
        }

        // Save File
        console.log(`[${jobId}] Rendering complete. Saving file...`);
        
        // The data is a Base64 Data URL: "data:video/mp4;base64,AAAA..."
        const base64Data = finalData.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `${jobId}.mp4`;
        const filePath = path.join(VIDEO_STORAGE_DIR, filename);
        
        fs.writeFileSync(filePath, buffer);

        // Update Job Status
        job.status = 'completed';
        job.filename = filename;
        job.completedAt = Date.now();
        
        console.log(`[${jobId}] ✅ Finished. URL: ${CLIENT_URL}/videos/${filename}`);

    } catch (error) {
        console.error(`[${jobId}] ❌ Failed:`, error.message);
        job.status = 'error';
        job.error = error.message;
    } finally {
        if (browser) await browser.close();
    }
}

app.listen(PORT, () => {
    console.log(`\n--- ShortsGen AI API Server ---`);
    console.log(`Server running at: ${CLIENT_URL}`);
    console.log(`Video Storage:     ${VIDEO_STORAGE_DIR}`);
    console.log(`Retention Policy:  48 Hours`);
    console.log(`\nEndpoints:`);
    console.log(`- POST /api/generate (Requires 'x-google-api-key' header)`);
    console.log(`- GET  /api/status/:id`);
    console.log(`- GET  /api/voices`);
});