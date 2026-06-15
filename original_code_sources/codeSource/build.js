const fs = require('fs');
const path = require('path');

// Order matters: vars -> store/utils -> basic functions -> business logic -> ui -> main
const order = [
    'src/core/header.js',
    'src/core/vars.js',
    'src/core/store.js',
    'src/core/utils.js',
    'src/services/computeService.js',
    'src/services/ai.js',
    'src/services/recognitionService.js',
    'src/services/answerService.js',
    'src/services/preRecognitionService.js',
    'src/services/imageUploadService.js',
    'src/services/imagePreviewService.js',
    'src/services/automationService.js',
    'src/services/fillService.js',
    'src/services/dataService.js',
    'src/services/authService.js',
    'src/services/validatorService.js',
    'src/services/crossSiteService.js',
    'src/ui/uiHelpers.js',
    'src/ui/modalHelper.js',
    'src/actions/uiActions.js',
    'src/actions/fillActions.js',
    'src/actions/pageActions.js',
    'src/ui/handlers.js',
    'src/ui/ui.js',
    'src/main.js'
];

const outputFile = 'dist/script_edit.user.js';

// Ensure dist exists
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
}

let content = "";
let header = "";

order.forEach(file => {
    if (!fs.existsSync(file)) {
        console.error(`File not found: ${file}`);
        process.exit(1);
    }
    const c = fs.readFileSync(file, 'utf-8');
    if (file === 'src/header.js') {
        header = c;
    } else {
        content += c + "\n";
    }
});

// Wrap logic in IIFE
const finalOutput = `${header}

(() => {
  "use strict";

${content}

})();
`;

fs.writeFileSync(outputFile, finalOutput);
console.log(`Build complete: ${outputFile}`);
