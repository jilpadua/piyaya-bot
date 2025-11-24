import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

const app = express();
const upload = multer({ dest: "uploads/" });

const COOKIES_PATH = process.env.YT_COOKIES_PATH || "/app/cookies.txt";

// Upload form
app.get("/upload", (req, res) => {
    res.send(`
        <h2>Upload cookies.txt</h2>
        <form enctype="multipart/form-data" method="POST" action="/upload">
            <input type="file" name="cookies" />
            <button type="submit">Upload</button>
        </form>
    `);
});

// Handle upload
app.post("/upload", upload.single("cookies"), (req, res) => {
    if (!req.file) {
        return res.status(400).send("No file uploaded.");
    }

    const tempPath = req.file.path;

    try {
        fs.renameSync(tempPath, COOKIES_PATH);
        res.send("✅ cookies.txt uploaded successfully!");
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to save cookies.");
    }
});

// Healthcheck
app.get("/", (req, res) => res.send("Cookie uploader is running."));

// Required for Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Uploader running on port", PORT);
});