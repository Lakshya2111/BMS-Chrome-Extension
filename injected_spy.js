// BMS Spy v5 (Konva Brute Force)
// Strategy: Ignore globals. Wait for Konva Stage rendering (triggered by Click).

(function () {
    let sentInfo = false;
    const POLLER_MS = 200;

    const poller = setInterval(() => {
        if (sentInfo) {
            clearInterval(poller);
            return;
        }

        // Only look for the Visual Stage
        checkKonva();

    }, POLLER_MS);

    function checkKonva() {
        const K = window.Konva || window._Konva;
        if (!K || !K.stages || K.stages.length === 0) return;

        // Found Stage!
        const stage = K.stages[0];

        // Analyze
        const stats = analyzeStage(stage);
        if (stats && stats.total > 0) {
            broadcast(stats);
        }
    }

    function analyzeStage(stage) {
        try {
            let total = 0, available = 0;
            const textNodes = stage.find('Text');

            textNodes.forEach(t => {
                if (!t.isVisible()) return;

                const str = (t.text() || "").trim();
                // Check if text is numeric (e.g. "1", "01", "25")
                // Adjust regex if we need to support "A1" etc, but user asked for numeric.
                if (!/^\d+$/.test(str)) return;

                const parent = t.parent;
                if (!parent) return;

                // We found a seat number. Now find its background shape.
                // Usually a sibling in the same Group, or the Group itself?
                // In Konva, often the Group contains a Rect/Circle and the Text.

                // Find a shape that is NOT this text node
                const bg = parent.children.find(c => c !== t && (c.getClassName() === 'Rect' || c.getClassName() === 'Circle' || c.getClassName() === 'Path'));

                if (bg && bg.isVisible()) {
                    total++;
                    const fill = (bg.fill() || "").toLowerCase();
                    const stroke = (bg.stroke() || "").toLowerCase();

                    // Availability Logic
                    // White fill usually means available
                    // Green stroke usually means available (or selected?)
                    if (fill === '#ffffff' || fill === 'white' || stroke === '#2ecc71') {
                        available++;
                    }
                }
            });

            return { available, total };
        } catch (e) { }
        return null;
    }

    function broadcast(stats) {
        sentInfo = true;
        window.postMessage({
            type: 'BMS_SPY_DATA',
            subType: 'KONVA_STATS',
            payload: JSON.stringify(stats)
        }, '*');
    }

})();
