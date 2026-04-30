// ═══════════════════════════════════════════════
//   DEVTOOLS.JS — HTML Extractor / Crawler System
//   Get Source Code Website (Frontend Extractor)
//   Tanpa Bot Telegram — Pure Web/Node.js Version
// ═══════════════════════════════════════════════

const axios   = require("axios");
const cheerio = require("cheerio");
const fs      = require("fs");
const path    = require("path");
const archiver= require("archiver");
const { URL } = require("url");

const MAX_PAGES = 30;

// ─── Download single file asset (js/css/img/font) ───
async function downloadFile(url, baseDir) {
    try {
        const u        = new URL(url);
        let   filePath = path.join(baseDir, u.pathname);

        if (filePath.endsWith("/")) filePath += "index.html";

        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });

        const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 15000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
            }
        });

        fs.writeFileSync(filePath, res.data);
        return filePath;
    } catch {
        return null;
    }
}

// ─── Extract all asset/page links from HTML ───
function extractLinks($, base) {
    const links = new Set();

    const tryAdd = (raw) => {
        if (!raw || raw.startsWith("data:") || raw.startsWith("#")) return;
        try { links.add(new URL(raw, base).href); } catch {}
    };

    $("script[src]").each((_, el) => tryAdd($(el).attr("src")));
    $("link[href]").each((_, el)   => tryAdd($(el).attr("href")));
    $("img[src]").each((_, el)     => tryAdd($(el).attr("src")));
    $("img[data-src]").each((_, el)=> tryAdd($(el).attr("data-src")));
    $("source[src]").each((_, el)  => tryAdd($(el).attr("src")));
    $("video[src]").each((_, el)   => tryAdd($(el).attr("src")));
    $("a[href]").each((_, el)      => tryAdd($(el).attr("href")));

    return [...links];
}

// ─── Main Crawl Function ───
async function crawl(startUrl, options = {}) {
    const {
        maxPages   = MAX_PAGES,
        onProgress = null,   // callback(step, message, percent)
        outDir     = null,   // custom output dir
    } = options;

    const base    = new URL(startUrl).origin;
    const tempDir = outDir || `site_${Date.now()}`;
    fs.mkdirSync(tempDir, { recursive: true });

    const visited = new Set();
    const queue   = [startUrl];
    const assets  = new Set();
    const failed  = [];

    const emit = (step, msg, pct) => {
        if (typeof onProgress === "function") onProgress(step, msg, pct);
        else console.log(`[${pct}%] ${msg}`);
    };

    emit(1, "Menghubungkan ke server target...", 10);

    while (queue.length && visited.size < maxPages) {
        const url = queue.shift();
        if (visited.has(url)) continue;
        visited.add(url);

        const pct = Math.min(10 + Math.round((visited.size / maxPages) * 60), 70);
        emit(2, `Crawling halaman (${visited.size}/${maxPages})...`, pct);

        try {
            const res  = await axios.get(url, {
                timeout: 15000,
                headers: { "User-Agent": "Mozilla/5.0 Chrome/122" }
            });
            const html = res.data;

            const u        = new URL(url);
            let   filePath = path.join(tempDir, u.pathname);
            if (filePath.endsWith("/")) filePath += "index.html";

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, html);

            const $     = cheerio.load(html);
            const links = extractLinks($, url);

            for (const link of links) {
                let linkURL;
                try { linkURL = new URL(link); } catch { continue; }
                if (linkURL.origin !== base) continue;

                const ext = path.extname(linkURL.pathname).toLowerCase();
                const assetExts = [".js",".css",".png",".jpg",".jpeg",".svg",
                                   ".gif",".webp",".woff",".woff2",".ttf",
                                   ".eot",".ico",".json",".xml",".mp4",".mp3"];

                if (assetExts.includes(ext)) {
                    assets.add(link);
                } else if (ext === ".html" || linkURL.pathname.endsWith("/")) {
                    if (!visited.has(link)) queue.push(link);
                }
            }
        } catch (e) {
            failed.push(url);
        }
    }

    // ─── Download all assets ───
    emit(3, "Mengunduh assets (CSS, JS, gambar)...", 75);
    let downloaded = 0;
    for (const asset of assets) {
        await downloadFile(asset, tempDir);
        downloaded++;
        const pct = 75 + Math.round((downloaded / assets.size) * 15);
        emit(4, `Mengunduh asset ${downloaded}/${assets.size}...`, Math.min(pct, 90));
    }

    // ─── Pack into ZIP ───
    emit(5, "Mengemas file ke ZIP...", 93);
    const zipName = `Result_Frontend_${new URL(startUrl).hostname}_${Date.now()}.zip`;
    const output  = fs.createWriteStream(zipName);
    const archive = archiver("zip", { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
        output.on("close", resolve);
        archive.on("error", reject);
        archive.pipe(output);
        archive.directory(tempDir, false);
        archive.finalize();
    });

    // ─── Cleanup temp dir ───
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}

    emit(6, "✅ Selesai!", 100);

    return {
        zip      : zipName,
        pages    : visited.size,
        assets   : assets.size,
        failed   : failed.length,
        baseUrl  : startUrl,
        hostname : new URL(startUrl).hostname,
    };
}

// ─── Get raw HTML source (single page, via proxy-friendly) ───
async function getHtmlSource(url) {
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res      = await axios.get(proxyUrl, { timeout: 20000 });
    const data     = res.data;
    if (!data?.contents) throw new Error("Tidak bisa mengakses website. Mungkin diblokir.");
    return {
        html     : data.contents,
        hostname : new URL(url).hostname,
        url,
    };
}

// ─── CLI Usage (node devtools.js <url>) ───
if (require.main === module) {
    const target = process.argv[2];
    if (!target) {
        console.error("Usage: node devtools.js <url>");
        process.exit(1);
    }
    crawl(target).then(result => {
        console.log("\n✅ Crawl selesai!");
        console.log(`📄 Halaman    : ${result.pages}`);
        console.log(`🖼  Assets     : ${result.assets}`);
        console.log(`❌ Gagal      : ${result.failed}`);
        console.log(`📦 File ZIP   : ${result.zip}`);
    }).catch(err => {
        console.error("❌ Error:", err.message);
        process.exit(1);
    });
}

module.exports = { crawl, getHtmlSource, downloadFile, extractLinks };
