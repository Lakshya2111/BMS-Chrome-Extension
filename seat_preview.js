// BookMyShow Seat Preview (v52 Aggressive Clicker)
// Feature: Shows Available/Total seats in a Toast.
// Logic: Aggressively clicks buttons to force Konva rendering. Best for reliability.

const CACHE = {};
const TIME_TO_ID_MAP = {};
let canvasFound = false;
let activeSessionId = null;
let currentIframe = null;
let toastEl = null;

const IS_SEAT_LAYOUT = window.location.href.includes('seat-layout');

if (IS_SEAT_LAYOUT) {
    runExtractorMode();
} else {
    if (document.body) runUIMode();
    else document.addEventListener('DOMContentLoaded', runUIMode);
}

// ==========================================
// 1. EXTRACTOR MODE
// ==========================================
function runExtractorMode() {
    injectSpy();
}

function injectSpy() {

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected_spy.js');
    script.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(script);

    window.addEventListener('message', (e) => {
        // Security: Weak check here as spy is same-origin, but good practice
        // if (e.origin !== window.location.origin) return; 

        if (!e.data || e.data.type !== 'BMS_SPY_DATA') return;

        if (e.data.subType === 'KONVA_STATS') {
            try {
                canvasFound = true; // STOP CLICKING
                const stats = JSON.parse(e.data.payload);
                window.parent.postMessage({ type: 'SEAT_DATA_RESULT', url: window.location.href, stats: stats }, '*');
            } catch (err) {
                window.parent.postMessage({ type: 'SEAT_DATA_ERROR', url: window.location.href, reason: "Parse Error" }, '*');
            }
        }
    });
}

// ==========================================
// 2. UI MODE
// ==========================================
let fetchTimeout = null;

function runUIMode() {
    extractStateFromDOM();

    window.addEventListener('message', (e) => {
        // Security: Only accept messages from the same origin (BookMyShow)
        if (e.origin !== window.location.origin) return;

        if (e.data && e.data.type === 'SEAT_DATA_RESULT') {
            clearTimeout(fetchTimeout);
            const stats = e.data.stats;
            const cleanKey = e.data.url.split('?')[0];
            CACHE[cleanKey] = { ...stats, ts: Date.now() };
            showToast(stats);
        }
        if (e.data && e.data.type === 'SEAT_DATA_ERROR') {
            clearTimeout(fetchTimeout);
            showToast({ error: true, msg: "Unable to view" });
        }
    });

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target.id === 'bms-seat-toast') return;

        const text = target.innerText || "";
        // Phantom Fix: Ignore large blocks
        if (text.length > 50) return;

        const timeMatch = text.match(/(\d{1,2}:\d{2}\s?[AP]M)/i);
        if (!timeMatch) return;

        let container = target.closest('a') || target.closest('[data-id]') || target.closest('[data-session-id]') || target;
        if (container && container.innerText && container.innerText.length > 60) return;
        if (container === document.body) return;

        const sessionId = container.getAttribute('data-id') || container.getAttribute('data-session-id') || timeMatch[0];
        // console.log(`[sessionId]: "${sessionId}"`);
        if (activeSessionId === sessionId) return;
        // console.log(`[activeSessionId]: "${activeSessionId}"`);
        activeSessionId = sessionId;

        container.addEventListener('mouseleave', () => {
            activeSessionId = null;
            if (toastEl) toastEl.style.display = 'none';
            if (currentIframe) currentIframe.remove();
            clearTimeout(fetchTimeout);
        }, { once: true });

        handleHover(container, timeMatch[0], sessionId);

    }, true);

    function handleHover(startEl, timeStr, sessionId) {
        const currentVenueCode = findVenueCode(startEl);
        let realSessionId = null;

        // Context Aware ID Resolution
        if (/^\d+$/.test(sessionId)) {
            realSessionId = sessionId;
        } else {
            const mins = parseToMinutes(timeStr);
            const candidates = TIME_TO_ID_MAP[mins];
            if (candidates && candidates.length > 0) {
                const exactMatch = candidates.find(c => c.venue === currentVenueCode);
                if (exactMatch) realSessionId = exactMatch.id;
                else realSessionId = candidates[0].id;
            } else {
                realSessionId = sessionId;
            }
            // console.log(`[realSessionId]: "${realSessionId}"`);
        }

        const date = findActiveDate() || '20251225';
        const venueCode = currentVenueCode || "PVOO";
        const eMatch = window.location.href.match(/(ET\d+)/);
        const regionMatch = window.location.href.match(/movies\/([^/]+)/);

        if (!eMatch) return;

        const meta = { sessionId: realSessionId, venueCode, eventId: eMatch[1], date: date, region: regionMatch ? regionMatch[1] : 'bang' };
        // console.log('[meta]:', JSON.stringify(meta, null, 2));
        const cleanUrl = constructSeatUrl(meta);

        if (CACHE[cleanUrl]) {
            if (Date.now() - CACHE[cleanUrl].ts < 5 * 60 * 1000) {
                showToast(CACHE[cleanUrl]);
                return;
            }
        }

        showToast({ loading: true });

        clearTimeout(fetchTimeout);
        fetchTimeout = setTimeout(() => {
            showToast({ error: true, msg: "Timed out" });
            if (currentIframe) currentIframe.remove();
        }, 20000); // 20s safety limit

        const iframeUrl = cleanUrl + `?ts=${Date.now()}`;
        // console.log(`[iframeUrl]: "${iframeUrl}"`);
        if (currentIframe) currentIframe.remove();
        currentIframe = document.createElement('iframe');
        currentIframe.src = iframeUrl;
        currentIframe.style.cssText = "position:fixed; bottom:0; left:0; width:1366px; height:768px; opacity:0.001; pointer-events:none; z-index:-1;";

        // RETRY LOGIC
        // Strategies: 
        // 1. Map Lookup (e.g. bengaluru -> bang)
        // 2. 3-char substring (e.g. hyderabad -> hyd)
        // 3. 4-char substring (e.g. hyderabad -> hyde)

        const REGION_MAP = {
            "bengaluru": "bang",
            "hyderabad": "hyd",
            "mumbai": "mumbai",
            "national-capital-region-ncr": "ncr",
            "chennai": "chen",
            "pune": "pune",
            "kolkata": "kolk",
            "kochi": "koch",
            "chandigarh": "chd",
            "ahmedabad": "ahd",
        };

        currentIframe.onload = function () {
            try {
                const currentUrl = this.contentWindow.location.href;

                if (!currentUrl.includes('seat-layout')) {
                    let retryLevel = parseInt(this.dataset.retryLevel || '0');
                    if (retryLevel < 3) {
                        retryLevel++;
                        this.dataset.retryLevel = retryLevel;

                        // console.log(`[RetryLogic] Redirected to ${currentUrl}. Retry Level: ${retryLevel}`);

                        let newRegion = null;
                        const originalRegion = meta.region.toLowerCase();

                        if (retryLevel === 1) {
                            // Strategy 1: Map Lookup
                            newRegion = REGION_MAP[originalRegion];
                            if (!newRegion) {
                                // console.log(`[RetryLogic] No map entry for ${originalRegion}, skipping to Level 2`);
                                retryLevel++; // Skip to level 2 immediately
                                this.dataset.retryLevel = retryLevel;
                            }
                        }

                        if (retryLevel === 2) {
                            // Strategy 2: 3-char substring
                            newRegion = originalRegion.substring(0, 3);
                        }

                        if (retryLevel === 3) {
                            // Strategy 3: 4-char substring
                            newRegion = originalRegion.substring(0, 4);
                        }

                        if (newRegion) {
                            // console.log(`[RetryLogic] Retrying with region: ${newRegion}`);
                            const newMeta = { ...meta, region: newRegion };
                            const newUrl = constructSeatUrl(newMeta) + `?ts=${Date.now()}`;
                            // console.log(`[RetryLogic] New URL: ${newUrl}`);
                            this.src = newUrl;
                        } else {
                            // console.log(`[RetryLogic] Aborting, no region strategy found.`);
                        }
                    }
                }
            } catch (err) {
                // console.log("[RetryLogic] Unable to check iframe location (likely cross-origin redirect).", err);
            }
        };

        document.body.appendChild(currentIframe);
    }
}

// --- TOAST UI ---
function showToast(stats) {
    if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'bms-seat-toast';
        toastEl.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: #fff;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            border-radius: 12px;
            padding: 16px;
            z-index: 2147483647; 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            min-width: 220px;
            border: 1px solid #eee;
            pointer-events: none; 
            transition: opacity 0.2s ease;
        `;
        document.body.appendChild(toastEl);
    }
    toastEl.style.display = 'block';

    if (stats.error) {
        toastEl.innerHTML = `<div style="display:flex; align-items:center; gap:10px;"><span style='color:#e74c3c; font-weight:600; font-size:14px;'>⚠ ${stats.msg}</span></div>`;
        return;
    }

    if (stats.loading) {
        toastEl.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:16px; height:16px; border:2px solid #f3f3f3; border-top:2px solid #d35400; border-radius:50%; animation:spin 1s linear infinite;"></div>
                <span style='color:#d35400; font-weight:600; font-size:14px;'>Checking seats...</span>
            </div>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
    } else {
        const percent = Math.round((stats.available / stats.total) * 100);
        let color = '#2ecc71';
        if (percent < 20) color = '#e74c3c';
        else if (percent < 50) color = '#f39c12';

        toastEl.innerHTML = `
            <div style="font-size:12px; color:#888; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Seat Availability</div>
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px;">
                 <span style="font-weight:700; font-size:20px; color:#222;">${stats.available} <span style="font-size:13px; color:#999; font-weight:500;">/ ${stats.total}</span></span>
                 <span style="font-weight:bold; color:${color}; margin-left:8px; font-size:14px;">${percent}%</span>
            </div>
            <div style="width:100%; height:6px; background:#f0f0f0; border-radius:3px; overflow:hidden;">
                <div style="width:${percent}%; height:100%; background:${color}; transition: width 0.3s ease;"></div>
            </div>
        `;
    }
}

// --- UTILS ---
function findActiveDate() {
    const dMatch = window.location.href.match(/\/(\d{8})/);
    return dMatch ? dMatch[1] : '20251225';
}
function constructSeatUrl(meta) { return `https://in.bookmyshow.com/movies/${meta.region}/seat-layout/${meta.eventId}/${meta.venueCode}/${meta.sessionId}/${meta.date}`; }
function parseToMinutes(t) {
    const m = t.match(/(\d+):(\d+)/);
    if (!m) return 0;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (t.toUpperCase().includes('PM') && h < 12) h += 12;
    return h * 60 + min;
}
function findVenueCode(el) {
    let curr = el;
    while (curr && curr !== document.body) {
        const link = curr.querySelector('a[href*="/buytickets/"]');
        if (link) {
            const parts = link.href.split('/');
            for (let p of parts) if (/^[A-Z0-9]{4}$/.test(p) && !/^\d+$/.test(p)) return p;
        }
        else if (curr.getAttribute('href') && curr.getAttribute('href').includes('/buytickets/')) {
            const parts = curr.href.split('/');
            for (let p of parts) if (/^[A-Z0-9]{4}$/.test(p) && !/^\d+$/.test(p)) return p;
        }
        if (curr.hasAttribute('data-venue-code')) return curr.getAttribute('data-venue-code');
        curr = curr.parentElement;
    }
    return null;
}
function extractBalancedJson(text, startIndex) {
    let balance = 0, inString = false;
    for (let i = startIndex; i < text.length; i++) {
        if (text[i] === '"') inString = !inString;
        if (!inString) {
            if (text[i] === '{') balance++;
            else if (text[i] === '}') {
                balance--;
                if (balance === 0) return text.substring(startIndex, i + 1);
            }
        }
    }
    return null;
}
function extractStateFromDOM() {
    const scripts = document.getElementsByTagName('script');
    for (const s of scripts) {
        if (s.textContent.includes("__INITIAL_STATE__")) {
            try {
                const json = extractBalancedJson(s.textContent, s.textContent.indexOf("{", s.textContent.indexOf("__INITIAL_STATE__")));
                const state = JSON.parse(json);
                mapShowtimes(state.showtimesByEvent || state.showTimes);
            } catch (e) { }
        }
    }
}
function mapShowtimes(root) {
    if (!root) return;
    const visit = (obj, contextVenue = null) => {
        if (!obj || typeof obj !== 'object') return;
        let newContextVenue = contextVenue;
        if (obj.venueCode) newContextVenue = obj.venueCode;
        if (obj.showTime && obj.sessionId) {
            const m = parseToMinutes(obj.showTime);
            if (!TIME_TO_ID_MAP[m]) TIME_TO_ID_MAP[m] = [];
            TIME_TO_ID_MAP[m].push({ id: obj.sessionId, venue: newContextVenue });
        }
        if (Array.isArray(obj)) { obj.forEach(start => visit(start, newContextVenue)); }
        else { Object.values(obj).forEach(val => visit(val, newContextVenue)); }
    };
    visit(root);
}
