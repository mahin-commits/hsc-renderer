/**
 * 🎨 HSC Slides — HTML to PNG Renderer
 * Uses @sparticuz/chromium for low-memory serverless environments
 * Compatible with Render.com free tier (512MB RAM)
 */

const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  
  console.log('Launching browser via @sparticuz/chromium...');
  
  const executablePath = await chromium.executablePath();
  console.log('Chromium path:', executablePath);
  
  browserInstance = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote'
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true
  });
  
  console.log('Browser launched successfully');
  return browserInstance;
}

// Health check
app.get('/', (req, res) => {
  res.send('HSC Renderer is running. POST /render with {html, width, scale}.');
});

// Diagnostic endpoint
app.get('/health', async (req, res) => {
  try {
    const browser = await getBrowser();
    const version = await browser.version();
    res.json({ ok: true, browser: version });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
});

// Render endpoint
app.post('/render', async (req, res) => {
  const { html, width = 800, scale = 2 } = req.body;
  
  if (!html) {
    return res.status(400).send('Missing "html" field');
  }
  
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    
    await page.setViewport({
      width: parseInt(width),
      height: 200,
      deviceScaleFactor: parseInt(scale)
    });
    
    await page.setContent(html, { 
      waitUntil: 'networkidle0', 
      timeout: 20000 
    });
    
    await new Promise(r => setTimeout(r, 1200));
    
    const dims = await page.evaluate(() => {
      const el = document.getElementById('content') || document.body;
      const rect = el.getBoundingClientRect();
      return {
        width: Math.ceil(rect.width) + 20,
        height: Math.ceil(rect.height) + 10
      };
    });
    
    await page.setViewport({
      width: Math.max(dims.width, 100),
      height: Math.max(dims.height, 50),
      deviceScaleFactor: parseInt(scale)
    });
    
    const png = await page.screenshot({
      type: 'png',
      omitBackground: true,
      clip: {
        x: 0, y: 0,
        width: Math.max(dims.width, 100),
        height: Math.max(dims.height, 50)
      }
    });
    
    await page.close();
    
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(png);
  } catch (e) {
    console.error('Render error:', e);
    if (page) {
      try { await page.close(); } catch {}
    }
    res.status(500).json({
      error: e.message,
      stack: e.stack
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HSC Renderer running on port ${PORT}`);
});
