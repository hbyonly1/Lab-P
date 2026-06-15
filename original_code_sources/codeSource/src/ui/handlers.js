/** ---------------------------
 *  Event Handlers (Lightweight Wrappers)
 *  事件处理器 - 轻量包装，转发到 actions 层
 *  --------------------------- */

// Handle: Recognize Experiment Data
async function handleRecognizeData() {
    await recognizeDataAction();
}

// Handle: Generate Answer
async function handleGenerateAnswer() {
    await generateAnswerAction();
}

// Handle: Upload Experiment Image
async function handleUploadExpImage() {
    await uploadExpImageAction();
}
