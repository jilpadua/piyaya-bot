import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

const app = express();

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/app/uploads";
const COOKIES_PATH = process.env.YT_COOKIES_PATH || "/app/cookies/cookies.txt";

// ensure dir exists
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(COOKIES_PATH), { recursive: true });
} catch (err) {
  // ignore, mkdir may fail under non-root - but we created dirs in Dockerfile
}

const storage = multer.diskStorage({
  destination: function (_, __, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (_, file, cb) {
    // Save to a safe name, we'll move it to COOKIES_PATH after
    const filename = `cookies-${Date.now()}.txt`;
    cb(null, filename);
  }
});

const upload = multer({ storage });

app.get("/", (req, res) => {
  res.send("Cookie uploader running. POST a file to /upload (form field 'cookies').");
});

// Serve upload form (GET /upload)
app.get("/upload", (req, res) => {
  res.send(`
    <html>
      <body style="font-family: sans-serif; padding: 40px;">
        <h2>Upload YouTube Cookies File</h2>
        <form action="/upload" method="post" enctype="multipart/form-data">
          <input type="file" name="cookies" accept=".txt" />
          <button type="submit">Upload</button>
        </form>
      </body>
    </html>
  `);
});

app.post("/upload", upload.single("cookies"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded. Use form field name 'cookies'.");
  const uploaded = req.file.path;
  // move to configured cookie path (overwrite)
  fs.copyFile(uploaded, COOKIES_PATH, (err) => {
    if (err) {
      console.error("Failed to save cookies:", err);
      return res.status(500).send("Failed to save cookies.");
    }
    // optionally remove uploaded file (keep it or remove)
    try { fs.unlinkSync(uploaded); } catch {}
    return res.send({ ok: true, savedTo: COOKIES_PATH });
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Uploader listening on ${port}`);
});