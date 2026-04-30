// ═══════════════════════════════════════════════
//   SYSTEM.JS — Web2APK Core System (Web Version)
//   APK Builder: build.js + result.js API
//   Bukan Bot Telegram — Pure Web/Browser Version
// ═══════════════════════════════════════════════

// ─── API CONFIG ───────────────────────────────
const APK_CONFIG = {
    apikey    : "KeyNoah",
    build_api : "https://web-build-navy-zeta.vercel.app/api/build.js",
    result_api: "https://web-build-navy-zeta.vercel.app/api/result.js",
};

// ─── Vercel Deploy API Keys (round-robin) ─────
const VERCEL_TOKENS = [
    "0VgHwBSPDXEgOQKJ3Ghw0UAeMB7Ur332mDFXJrhENQSazSjlZJ0lr2z1",
    "59UNM1U1bPCjNiDuCWu31kwroCcdozfnbmGcNm55c1GZKmBw934PDmnE",
    "1SFXP39nS7IrEvbmBLN7tHQtSCtvoPiFXsydUbwWoyrbWlWqQr3zJ21M",
];
let _vercelKeyIdx = 0;
function getVercelToken() {
    const token = VERCEL_TOKENS[_vercelKeyIdx % VERCEL_TOKENS.length];
    _vercelKeyIdx++;
    return token;
}

// ─── Utility: delay ───────────────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════
//   MODULE 1: APK BUILDER
//   Wrapper untuk build.js dan result.js API
// ═══════════════════════════════════════════════

/**
 * Mulai build APK dari URL website
 */
async function _systemStartApkBuild(appName, appUrl, iconUrl = "", callbacks = {}) {
    const { onProgress, onDone, onError } = callbacks;

    const emit = (step, msg, pct) => {
        if (typeof onProgress === "function") onProgress(step, msg, pct);
    };

    emit(1, "Menghubungkan ke build server...", 5);

    let jobId;
    try {
        const params = new URLSearchParams({
            apikey : APK_CONFIG.apikey,
            appName: appName,
            appUrl : appUrl,
            iconUrl: iconUrl,
        });

        const res  = await fetch(`${APK_CONFIG.build_api}?${params}`);
        const data = await res.json();

        if (!data?.success) {
            throw new Error(data?.message || "Build gagal dimulai");
        }

        jobId = data.jobId;
        emit(2, `Job diterima — ID: ${jobId}`, 15);

    } catch (err) {
        if (typeof onError === "function") onError(err.message);
        return () => {};
    }

    let step       = 1;
    const startAt  = Date.now();
    let cancelled  = false;

    const pollInterval = setInterval(async () => {
        if (cancelled) return;

        step = Math.min(step + 1, 9);
        const elapsed = Math.floor((Date.now() - startAt) / 1000);
        const pct     = 15 + (step * 9);

        emit(step + 2, `Membangun APK... (${elapsed}s)`, pct);

        try {
            const res    = await fetch(`${APK_CONFIG.result_api}?jobId=${jobId}`);
            const result = await res.json();

            if (result?.status === "done") {
                clearInterval(pollInterval);
                emit(12, "✅ Build selesai!", 100);
                if (typeof onDone === "function") {
                    onDone(result.download, appName, jobId);
                }
                return;
            }

            if (result?.status === "error") {
                clearInterval(pollInterval);
                if (typeof onError === "function") {
                    onError(result.message || "Build gagal pada sisi server");
                }
                return;
            }

            if (result?.info) {
                emit(step + 2, `${result.info} (${elapsed}s)`, pct);
            }

        } catch (e) { /* silent polling error */ }

    }, 10000);

    return () => {
        cancelled = true;
        clearInterval(pollInterval);
    };
}

// ═══════════════════════════════════════════════
//   MODULE 2: VERCEL DEPLOY
// ═══════════════════════════════════════════════

async function deployToVercel(fileOrContent, projectName, onProgress) {
    const emit = (msg, pct) => {
        if (typeof onProgress === "function") onProgress(msg, pct);
    };

    emit("Membaca file HTML...", 10);

    let htmlContent;
    if (typeof fileOrContent === "string") {
        htmlContent = fileOrContent;
    } else {
        htmlContent = await fileOrContent.text();
    }

    emit("Menyusun konfigurasi Vercel...", 25);

    const projSlug  = projectName.toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 50);
    const uniqueName = `${projSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const htmlB64 = btoa(unescape(encodeURIComponent(htmlContent)));
    const cfgObj  = {
        version: 2,
        name: uniqueName,
        builds: [{ src: "index.html", use: "@vercel/static" }],
        routes: [{ src: "/(.*)", dest: "/index.html" }],
    };
    const cfgB64 = btoa(JSON.stringify(cfgObj));

    const payload = {
        name : uniqueName,
        files: [
            { file: "index.html", data: htmlB64, encoding: "base64" },
            { file: "vercel.json", data: cfgB64, encoding: "base64" },
        ],
        projectSettings: {
            framework      : null,
            devCommand     : null,
            installCommand : null,
            buildCommand   : null,
            outputDirectory: ".",
            rootDirectory  : null,
        },
    };

    emit("Mengunggah ke cloud Vercel...", 55);

    // Try each token until one works
    let lastError = null;
    for (let i = 0; i < VERCEL_TOKENS.length; i++) {
        const token = VERCEL_TOKENS[i];
        try {
            const res = await fetch("https://api.vercel.com/v13/deployments", {
                method : "POST",
                headers: {
                    "Content-Type" : "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                emit("Menghubungkan domain...", 80);
                await delay(1200);
                emit("✅ Deployment selesai!", 100);
                const deployUrl = `https://${uniqueName}.vercel.app`;
                return { url: deployUrl, name: uniqueName };
            }

            const err = await res.json();
            lastError = new Error(err?.error?.message || `HTTP ${res.status}`);
        } catch (e) {
            lastError = e;
        }
    }

    throw lastError || new Error("Semua token gagal. Coba lagi nanti.");
}

// ═══════════════════════════════════════════════
//   MODULE 3: HTML SOURCE EXTRACTOR (Browser)
// ═══════════════════════════════════════════════

async function extractHtmlSource(targetUrl, onProgress) {
    const emit = (msg, pct) => {
        if (typeof onProgress === "function") onProgress(msg, pct);
    };

    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = "https://" + targetUrl;

    emit("Menghubungkan ke server target...", 15);
    await delay(300);
    emit("Menganalisa struktur frontend...", 35);

    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    const res      = await fetch(proxyUrl);
    const data     = await res.json();

    if (!data?.contents) {
        throw new Error("Tidak bisa mengakses website ini. Mungkin diblokir firewall.");
    }

    emit("Mengekstrak source code...", 70);
    await delay(300);
    emit("Memproses hasil scan...", 90);
    await delay(200);
    emit("✅ Scanning selesai!", 100);

    return {
        html    : data.contents,
        hostname: new URL(targetUrl).hostname,
        url     : targetUrl,
    };
}

// ─── Export untuk Node.js ───
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        APK_CONFIG,
        getVercelToken,
        startApkBuild,
        deployToVercel,
        extractHtmlSource,
    };
}
