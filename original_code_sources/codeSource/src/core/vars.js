/** ---------------------------
 *  Storage model
 *  ---------------------------
 *  config: loaded JSON config
 *  activeProfileName: current profile key
 *  store: runtime data
 *    - extract: { [id]: string }
 *    - computed: { [key]: any }
 */
const LS_KEY_CONFIG = "__tm_cfg_toolkit_config_v1";
const LS_KEY_PROFILE = "__tm_cfg_toolkit_active_profile_v1";
const LS_KEY_STORE = "__tm_cfg_toolkit_store_v1";

// Shared state object (hoisted in IIFE scope)
const state = {
    config: null, // Will be initialized in store.js or main.js logic? 
    // Actually cyclic dependency risk if we initialize here calling loadJSON which is in store.js.
    // Better to define state here as null/empty, and init in a setup function or just allow loadJSON to be hoisted.
    // In IIFE concatenation, functions are hoisted. 
    // Let's defer initialization of properties to first use or main init if possible, or just assume loadJSON is available if variables are at top.
    // To be safe: initialize with basic structure or nulls.
    activeProfileName: "",
    store: { extract: {}, meta: {} },
    custom: { c: 0.260 }, // Default custom data
    userInfo: { name: "", studentId: "" },
    configFiles: [] // Store all files from selected config directory
    // config: loadJSON(...) <- cannot call loadJSON here if it's defined later in the concatenated file?
    // IF we concat vars.js BEFORE store.js, loadJSON is undefined at this line.
    // So we should init state properties separately or just define the variable here.
};

// Custom functions registry
const customFunctions = {};

// Batch Queue
const batchQueue = {
    isRunning: false,
    isPaused: false,
    currentIndex: 0,
    queue: [],
    config: null,
    onProgress: null,
    onComplete: null,

    // logic will be attached in crossSite.js or defined here if circular deps. 
    // Ideally defined in crossSite.js but state is shared. 
    // Let's define the object structure here and attach methods in crossSite.js? 
    // Or just put the whole batchQueue object in crossSite.js if it doesn't need to be accessed by other early modules.
    // It's accessed by UI (ui.js). So it needs to be visible.
};
