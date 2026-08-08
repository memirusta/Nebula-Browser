/*******************************************************************************

    Nebula integration readiness bridge for uBlock Origin Lite

    This script runs only in Nebula's application shell. It asks the uBOL
    service worker for a response; background.js answers only after its own
    isFullyInitialized promise has completed.

*/

(async function signalNebulaReadiness() {
    try {
        const status = await chrome.runtime.sendMessage({ what: 'nebulaReady' });
        if ( status?.ready !== true ) { return; }
        document.documentElement.dataset.nebulaUblockReady = 'true';
    } catch {
        // The application has a bounded fallback timeout. A later reload will
        // retry this bridge if the extension was installed during this load.
    }
})();
