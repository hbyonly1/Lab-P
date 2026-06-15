function loadJSON(key, fallback) {
    try {
        const s = localStorage.getItem(key);
        return s ? JSON.parse(s) : fallback;
    } catch {
        return fallback;
    }
}
function saveJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
}

// Initialize state (can be called after all function declarations are hoisted)
function initState() {
    state.config = loadJSON(LS_KEY_CONFIG, null);
    state.activeProfileName = localStorage.getItem(LS_KEY_PROFILE) || "";
    // Always start with empty store on page load (don't persist temporary data)
    state.store = { extract: {}, computed: {}, meta: {} };
    // Preserve default custom data values (don't reset to empty)
    if (!state.custom || Object.keys(state.custom).length === 0) {
        state.custom = { c: 0.260 }; // Default custom data
    }

    // Clear the persisted store from localStorage
    localStorage.removeItem(LS_KEY_STORE);
}

function getProfiles() {
    return (state.config && state.config.profiles) ? state.config.profiles : {};
}

function getActiveProfile() {
    const profiles = getProfiles();
    if (!state.activeProfileName || !profiles[state.activeProfileName]) {
        const first = Object.keys(profiles)[0] || "";
        state.activeProfileName = first;
        localStorage.setItem(LS_KEY_PROFILE, first);
    }
    return profiles[state.activeProfileName] || null;
}

// Explicitly define changeProfile to ensure it's available
function changeProfile(name) {
    if (state.config && state.config.profiles && state.config.profiles[name]) {
        state.activeProfileName = name;
        localStorage.setItem(LS_KEY_PROFILE, name);
        console.log(`[Store] Switched profile to: ${name}`);

        // Update UI if present
        const sel = document.getElementById("__tm_profile");
        if (sel) sel.value = name;
    } else {
        console.warn(`[Store] Profile not found: ${name}`);
    }
}
