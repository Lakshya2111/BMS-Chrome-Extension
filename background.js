// BookMyShow Extension - Background Worker (v15 Header Safety Check)

// console.log("BMS Background: Safety Check Loaded");

chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        if (details.url.includes("seat-layout")) {
            const xFrame = details.responseHeaders.find(h => h.name.toLowerCase() === 'x-frame-options');
            if (xFrame) {
                // console.warn(">>> X-FRAME-OPTIONS DETECTED:", xFrame.value);
                // console.warn(">>> This might block the iframe!");
            } else {
                // console.log(">>> No X-Frame-Options found. Iframe should work.");
            }
        }
    },
    { urls: ["*://*.bookmyshow.com/*"] },
    ["responseHeaders"]
);
