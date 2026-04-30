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
    "IHtNSFLiFVxB82X3aWkXI6xS",
    "2pBETEiPjhtjGXFWM77jMo0C",
    "gOFb5AtmpEkVGqvpGCGmcZoD",
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
 * @param {string} appName  - Nama aplikasi
 * @param {string} appUrl   - URL website yang akan dijadikan APK
 * @param {string} iconUrl  - URL ikon aplikasi (opsional)
 * @param {object} callbacks
 *   - onProgress(step, message, percent)
 *   - onDone(downloadUrl, appName, jobId)
 *   - onError(message)
 * @returns {function} cancelFn - panggil untuk batalkan polling
 */
async function startApkBuild(appName, appUrl, iconUrl = "", callbacks = {}) {
    const { onProgress, onDone, onError } = callbacks;

    const emit = (step, msg, pct) => {
        if (typeof onProgress === "function") onProgress(step, msg, pct);
    };

    emit(1, "Menghubungkan ke build server...", 5);

    // ─── Step 1: Hit build.js API ─────────────
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

    // ─── Step 2: Poll result.js API ───────────
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

            // masih processing — update info
            if (result?.info) {
                emit(step + 2, `${result.info} (${elapsed}s)`, pct);
            }

        } catch (e) { /* silent polling error */ }

    }, 10000);

    // ─── Return cancel function ────────────────
    return () => {
        cancelled = true;
        clearInterval(pollInterval);
    };
}

// ═══════════════════════════════════════════════
//   MODULE 2: VERCEL DEPLOY
//   Deploy HTML file ke Vercel via API
// ═══════════════════════════════════════════════

/**
 * Deploy file HTML ke Vercel
 * @param {File|string} fileOrContent - File object atau string HTML
 * @param {string} projectName        - Nama project (slug)
 * @param {function} onProgress       - callback(msg, pct)
 * @returns {Promise<{url, name}>}
 */
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
        .slice(0, 40);
    const uniqueName = `${projSlug}-${Math.random().toString(36).slice(2, 7)}`;

    // ✅ FIX: Encode unicode dengan benar (btoa() tidak support karakter non-latin)
    const htmlB64 = btoa(
        encodeURIComponent(htmlContent).replace(/%([0-9A-F]{2})/g, (_, p1) =>
            String.fromCharCode("0x" + p1)
        )
    );

    // ✅ FIX: Hanya kirim index.html — TANPA vercel.json (menyebabkan 404)
    const payload = {
        name : uniqueName,
        files: [
            { file: "index.html", data: htmlB64, encoding: "base64" },
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

    const token = getVercelToken();
    const res   = await fetch("https://api.vercel.com/v13/deployments", {
        method : "POST",
        headers: {
            "Content-Type" : "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();

    emit("Menghubungkan domain...", 85);
    await delay(800);
    emit("✅ Deployment selesai!", 100);

    // ✅ FIX: Ambil URL dari response (bukan buat manual)
    const deployUrl = data.alias && data.alias.length > 0
        ? `https://${data.alias[0]}`
        : data.url
            ? `https://${data.url}`
            : `https://${uniqueName}.vercel.app`;

    return { url: deployUrl, name: data.name || uniqueName };
}

// ═══════════════════════════════════════════════
//   MODULE 3: HTML SOURCE EXTRACTOR (Browser)
//   Fetch HTML via proxy (allorigins) — no server
// ═══════════════════════════════════════════════

/**
 * Ambil source code HTML dari URL (via proxy)
 * @param {string} targetUrl  - URL website target
 * @param {function} onProgress
 * @returns {Promise<{html, hostname, url}>}
 */
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

// ─── Export untuk Node.js (jika dipakai di server) ───
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        APK_CONFIG,
        getVercelToken,
        startApkBuild,
        deployToVercel,
        extractHtmlSource,
    };
}
