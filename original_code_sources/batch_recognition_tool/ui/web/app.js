/**
 * Data Verification App Logic
 */

// State
let currentStudentId = null;
let originalData = null;
let currentData = null;
let configData = null;
let autoSaveTimer = null;
let isDirty = false;

// DOM Elements
const els = {
    studentList: document.getElementById('studentList'),
    editorArea: document.getElementById('editorArea'),
    welcomeMsg: document.getElementById('welcomeMessage'),
    editorContent: document.getElementById('editorContent'),
    currentStudentLabel: document.getElementById('currentStudentLabel'),
    formContainer: document.getElementById('formContainer'),
    imageViewer: document.getElementById('imageViewer'),
    viewerHandle: document.getElementById('viewerHandle'),
    imageList: document.getElementById('imageList'),
    previewContainer: document.getElementById('previewContainer'),
    imagePreview: document.getElementById('imagePreview'),
    noImageMsg: document.getElementById('noImageMsg'),
    resizeHandle: document.getElementById('resizeHandle'),
    toast: document.getElementById('toast'),
    filenameSuffix: document.getElementById('filenameSuffix')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await refreshHistory();
    await refreshHistory();
    setupImageViewer();

    // Suffix change listener
    if (els.filenameSuffix) {
        els.filenameSuffix.addEventListener('change', () => {
            if (currentStudentId) {
                loadStudentData(currentStudentId);
            }
        });
    }
});

async function loadConfig() {
    try {
        const response = await fetch('/data.json');
        if (response.ok) {
            configData = await response.json();
            console.log('Config loaded', configData);
        }
    } catch (e) {
        console.error('Failed to load config', e);
    }
}

// --- History & Student List ---
let historyRecords = [];

async function refreshData() {
    if (isDirty && currentStudentId) {
        await saveChanges(true);
    }

    await refreshHistory();
    if (currentStudentId) {
        await loadStudentData(currentStudentId);
    }
    showToast('数据已刷新');
}

async function refreshHistory() {
    try {
        const response = await fetch('/api/history');
        historyRecords = await response.json();

        els.studentList.innerHTML = '';
        historyRecords.forEach(record => {
            const li = document.createElement('li');
            li.className = 'student-item';
            if (record.student_id === currentStudentId) {
                li.classList.add('active');
            }
            if (record.verified) {
                li.classList.add('verified');
            }
            if (record.completed) {
                li.classList.add('completed');
            }

            // Status Badge + Verified Indicator
            let statusHtml = `<span class="status-badge ${record.status}">${record.status}</span>`;
            if (record.verified) {
                statusHtml += ` <span class="verified-icon" title="已核对">✔</span>`;
            }

            li.innerHTML = `
                <span>${record.student_id}</span>
                ${statusHtml}
            `;
            li.onclick = () => selectStudent(record.student_id);
            els.studentList.appendChild(li);
        });

        // Update current toggle if needed
        if (currentStudentId) {
            updateToggleState(currentStudentId);
        }
    } catch (e) {
        console.error('Failed to load history', e);
    }
}

async function selectStudent(studentId) {
    // Auto-save previous if dirty
    if (isDirty && currentStudentId && currentStudentId !== studentId) {
        // Show minimal toast or silent save?
        // Let's rely on saveChanges feedback
        const statusLabel = document.getElementById('saveStatus');
        if (statusLabel) statusLabel.textContent = '切换前自动保存...';
        await saveChanges(true);
    }

    currentStudentId = studentId;

    // Update active class
    document.querySelectorAll('.student-item').forEach(item => {
        item.classList.remove('active');
        if (item.querySelector('span').textContent === studentId) {
            item.classList.add('active');
        }
    });

    updateToggleState(studentId);

    loadStudentData(studentId);
    loadStudentImages(studentId);
}

function updateToggleState(studentId) {
    const record = historyRecords.find(r => r.student_id === studentId);

    // Verify Checkbox
    const cbVerify = document.getElementById('verifyCheckbox');
    if (cbVerify) {
        cbVerify.checked = record ? !!record.verified : false;
        cbVerify.onchange = () => toggleVerification(studentId, cbVerify.checked);
    }

    // Complete Checkbox
    const cbComplete = document.getElementById('completeCheckbox');
    if (cbComplete) {
        cbComplete.checked = record ? !!record.completed : false;
        cbComplete.onchange = () => toggleCompletion(studentId, cbComplete.checked);
    }
}

async function toggleVerification(studentId, verified) {
    if (!studentId) return;

    try {
        const response = await fetch('/api/verify', {
            method: 'POST',
            body: JSON.stringify({
                student_id: studentId,
                verified: verified
            })
        });

        if (response.ok) {
            showToast(verified ? '已标记为核对完成' : '已取消核对标记');
            refreshHistory(); // Refresh sidebar to show status
        } else {
            showToast('状态更新失败', 'error');
            // Revert checkbox
            document.getElementById('verifyCheckbox').checked = !verified;
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
        document.getElementById('verifyCheckbox').checked = !verified;
    }
}

// --- Data Loading & Form Generation ---
async function loadStudentData(studentId) {
    els.welcomeMsg.style.display = 'none';
    els.editorContent.style.display = 'block';
    els.currentStudentLabel.textContent = `当前核对: ${studentId}`;

    try {
        const suffix = els.filenameSuffix ? els.filenameSuffix.value.trim() : '';
        const response = await fetch(`/api/data?student_id=${studentId}&suffix=${encodeURIComponent(suffix)}`);

        if (!response.ok) throw new Error('Failed to load data');

        originalData = await response.json();
        currentData = JSON.parse(JSON.stringify(originalData)); // Deep copy
        isDirty = false;

        renderForm();
    } catch (e) {
        console.error(e);
        showToast('加载数据失败', 'error');
    }
    isDirty = false; // Reset on load
}

function renderForm() {
    // ... existing ...
    els.formContainer.innerHTML = '';

    if (!configData || !configData.profiles) {
        els.formContainer.innerHTML = '<div>配置文件未加载或格式错误</div>';
        return;
    }

    // Iterate profiles from config (preserving order)
    for (const [profileName, profileCfg] of Object.entries(configData.profiles)) {
        const profileData = currentData[profileName] || {};
        const expName = profileCfg.expName || profileName;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'config-group';

        const title = document.createElement('div');
        title.className = 'group-title';
        title.style.display = 'flex';
        title.style.alignItems = 'center';
        title.style.justifyContent = 'space-between';

        const titleText = document.createElement('span');
        titleText.textContent = expName;
        title.appendChild(titleText);

        // Button Container
        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '5px';
        title.appendChild(btnContainer);

        // Copy Prompt Button
        if (profileCfg.prompts) {
            const promptItem = profileCfg.prompts.find(p => p.type === 'textRecognition');
            if (promptItem && promptItem.value) {
                const copyBtn = document.createElement('button');
                copyBtn.className = 'secondary';
                copyBtn.textContent = '📋 复制Prompt';
                copyBtn.title = '复制识别用的Prompt配置';
                copyBtn.style.fontSize = '12px';
                copyBtn.style.padding = '2px 8px';
                copyBtn.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(promptItem.value)
                        .then(() => showToast('Prompt已复制到剪贴板'))
                        .catch(() => showToast('复制失败', 'error'));
                };
                btnContainer.appendChild(copyBtn);
            }
        }

        // Export JSON Button (For all experiments)
        const exportBtn = document.createElement('button');
        exportBtn.className = 'secondary';
        exportBtn.textContent = '📤 导出JSON';
        exportBtn.title = '复制当前实验数据的JSON配置';
        exportBtn.style.fontSize = '12px';
        exportBtn.style.padding = '2px 8px';
        exportBtn.onclick = (e) => {
            e.stopPropagation();
            exportProfileData(profileName);
        };
        btnContainer.appendChild(exportBtn);

        if (expName.includes('弗兰克赫兹')) {
            const chartBtn = document.createElement('button');
            chartBtn.className = 'secondary';
            chartBtn.textContent = '📈生成并保存曲线';
            chartBtn.style.fontSize = '12px';
            chartBtn.style.padding = '2px 8px';
            chartBtn.onclick = (e) => {
                e.stopPropagation(); // prevent folding if implemented
                showFrankHertzChart();
            };
            btnContainer.appendChild(chartBtn);

            const fixBtn = document.createElement('button');
            fixBtn.className = 'secondary';
            fixBtn.textContent = '🔧修正FH数据';
            fixBtn.title = '修正弗兰克赫兹实验数据ID (F20->F100)';
            fixBtn.style.fontSize = '12px';
            fixBtn.style.padding = '2px 8px';
            fixBtn.onclick = (e) => {
                e.stopPropagation();
                fixData();
            };
            btnContainer.appendChild(fixBtn);

            const shiftBtn = document.createElement('button');
            shiftBtn.className = 'secondary';
            shiftBtn.textContent = '⬇️ 数据下移';
            shiftBtn.title = '将所有F开头的数据向下移动一行 (例如 F10 -> F11)';
            shiftBtn.style.fontSize = '12px';
            shiftBtn.style.padding = '2px 8px';
            shiftBtn.onclick = (e) => {
                e.stopPropagation();
                shiftFrankHertzData();
            };
            btnContainer.appendChild(shiftBtn);

            const shiftUpBtn = document.createElement('button');
            shiftUpBtn.className = 'secondary';
            shiftUpBtn.textContent = '⬆️ 数据上移';
            shiftUpBtn.title = '将所有F开头的数据向上移动一行 (例如 F11 -> F10)';
            shiftUpBtn.style.fontSize = '12px';
            shiftUpBtn.style.padding = '2px 8px';
            shiftUpBtn.onclick = (e) => {
                e.stopPropagation();
                shiftFrankHertzDataUp();
            };
            btnContainer.appendChild(shiftUpBtn);

            const smartFillBtn = document.createElement('button');
            smartFillBtn.className = 'secondary';
            smartFillBtn.textContent = '🛠️ 智能填充';
            smartFillBtn.title = '批量填充数据 (支持间隔采样、正倒序)';
            smartFillBtn.style.fontSize = '12px';
            smartFillBtn.style.padding = '2px 8px';
            smartFillBtn.onclick = (e) => {
                e.stopPropagation();
                openSmartFill(profileName);
            };
            btnContainer.appendChild(smartFillBtn);
        }

        if (expName.includes('磁滞回线与磁化曲线')) {
            const chartBtn = document.createElement('button');
            chartBtn.className = 'secondary';
            chartBtn.textContent = '📈 生成磁化曲线';
            chartBtn.style.fontSize = '12px';
            chartBtn.style.padding = '2px 8px';
            chartBtn.onclick = (e) => {
                e.stopPropagation();
                showMagnetizationChart();
            };
            btnContainer.appendChild(chartBtn);
        }

        if (expName.includes('分光计光栅实验')) {
            const convertBtn = document.createElement('button');
            convertBtn.className = 'secondary';
            convertBtn.textContent = '📐 角度转换';
            convertBtn.title = '将 度.分 (如 50.30) 转换为 十进制数 (50.5度)';
            convertBtn.style.fontSize = '12px';
            convertBtn.style.padding = '2px 8px';
            convertBtn.onclick = (e) => {
                e.stopPropagation();
                convertSpectrometerAngles(profileName);
            };
            btnContainer.appendChild(convertBtn);
        }

        groupDiv.appendChild(title);

        // 1. Fill Data Section
        if (profileData.fill && profileData.fill.length > 0) {
            // Find format string from prompts
            let formatStrings = [];
            let explicitKeys = [];

            if (profileCfg.prompts) {
                profileCfg.prompts.forEach(p => {
                    if (p.type === 'textRecognition' && p.value) {
                        let isJson = false;
                        // 1. Try parsing as JSON array first (User case: value is JSON string of list)
                        try {
                            const jsonData = JSON.parse(p.value);
                            if (Array.isArray(jsonData)) {
                                jsonData.forEach(item => {
                                    if (item.id) explicitKeys.push(item.id);
                                });
                                isJson = true;
                            } else if (jsonData.id) {
                                explicitKeys.push(jsonData.id);
                                isJson = true;
                            }
                        } catch (e) {
                            // Not JSON, continue to regex
                        }

                        // 2. Regex to capture patterns (Only if NOT JSON)
                        // If we successfully parsed JSON, we trust explicitKeys and skip regex to avoid matching values like "370" as keys.
                        if (!isJson) {
                            // Clean prompt: remove escaped newlines which might cause issues like "\\nC10" -> "nC10"
                            const cleanPrompt = p.value.replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\n/g, ' ');

                            // Regex to capture keys:
                            // 1. Hyphenated: Prefix-{Range} or Prefix-Number (e.g. FGJ10-0)
                            // 2. Alphanumeric: Must contain at least one letter to avoid matching pure numbers (e.g. Y4 is ok, 370 is not)
                            // Added \b to ensure we match at word boundaries (avoids "inC10" parsing as "inC10")
                            const matches = cleanPrompt.match(/\b[a-zA-Z0-9_]+-(?:\{[0-9]+\.\.[0-9]+\}|[0-9]+)|\b(?![0-9]+\b)[a-zA-Z0-9_]+\d+[a-zA-Z0-9_]*/g);
                            if (matches) formatStrings.push(...matches);
                        }
                    }
                });
            }

            // Expand formats
            let allKeys = [...explicitKeys];

            if (formatStrings.length > 0) {
                formatStrings.forEach(fmt => {
                    const parsed = parseFormat(fmt);
                    if (parsed) allKeys.push(...parsed);
                });
            }

            // Fallback: use keys from data if no format found and no explicit keys
            if (allKeys.length === 0 && profileData.fill && Array.isArray(profileData.fill)) {
                allKeys = profileData.fill.map(f => f.id || f.key).filter(k => k);
            }

            // Filter out any non-string or empty keys
            allKeys = allKeys.filter(k => typeof k === 'string' && k.trim() !== '');
            // Deduplicate
            allKeys = [...new Set(allKeys)];

            // Group by prefix
            const groups = groupByPrefix(allKeys);

            // Sort prefixes to ensure consistent order (e.g. DXYJ10 before DXYJ11)
            const sortedPrefixes = Object.keys(groups).sort((a, b) => {
                return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            });

            // Render groups
            for (const prefix of sortedPrefixes) {
                const keys = groups[prefix];

                // Sort keys within group
                keys.sort((a, b) => {
                    // Try to extract numbers for sorting
                    // Handle "Y4" vs "Y5" -> 4 vs 5
                    // Handle "DXYJ10-1" vs "DXYJ10-2" -> 1 vs 2

                    const numA = extractNumber(a);
                    const numB = extractNumber(b);

                    if (numA !== null && numB !== null) {
                        return numA - numB;
                    }
                    return a.localeCompare(b, undefined, { numeric: true });
                });

                const row = document.createElement('div');
                row.className = 'form-row';

                const label = document.createElement('div');
                label.className = 'row-label';
                label.textContent = prefix + ':';

                // Add Batch Operation Button for "磁滞回线"
                if (expName.includes('磁滞回线')) {
                    const batchBtn = document.createElement('button');
                    batchBtn.textContent = '⚡';
                    batchBtn.title = '批量处理整行 (支持: x10, /10, =15, +2, -2)';
                    batchBtn.className = 'icon-btn';
                    batchBtn.style.marginLeft = '4px';
                    batchBtn.style.fontSize = '10px';
                    batchBtn.style.padding = '0px 4px';
                    batchBtn.style.border = '1px solid #555';
                    batchBtn.style.borderRadius = '4px';
                    batchBtn.style.cursor = 'pointer';
                    batchBtn.onclick = (e) => {
                        e.stopPropagation();
                        // Find all inputs in this row? Use prefix strategy.
                        handleRowBatchOperation(profileName, prefix);
                    };
                    label.appendChild(batchBtn);
                }

                row.appendChild(label);

                keys.forEach(key => {
                    if (!key) return; // Skip invalid keys

                    // Find actual value
                    const item = profileData.fill ? profileData.fill.find(f => (f.id === key || f.key === key)) : null;
                    const value = item ? item.value : '';

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = value || '';
                    input.placeholder = key.replace(prefix, '').replace(/^-/, '') || key; // Simplified placeholder
                    input.id = `input-${key}`; // Ensure unique ID as requested
                    input.dataset.profile = profileName;
                    input.dataset.key = key;
                    input.dataset.type = 'fill';

                    input.oninput = (e) => updateData(profileName, 'fill', key, e.target.value);

                    row.appendChild(input);
                });

                groupDiv.appendChild(row);
            }
        }

        // 2. Generated Answer Section
        if (profileData.generatedAnswer !== undefined) {
            const row = document.createElement('div');
            row.className = 'field-group';
            row.style.marginTop = '15px';

            const label = document.createElement('div');
            label.className = 'field-label';
            label.textContent = '生成的答案:';

            const input = document.createElement('input');
            input.className = 'answer-field';
            input.type = 'text';
            input.value = profileData.generatedAnswer;
            input.oninput = (e) => updateData(profileName, 'answer', null, e.target.value);

            row.appendChild(label);
            row.appendChild(input);
            groupDiv.appendChild(row);
        }

        els.formContainer.appendChild(groupDiv);
    }
}

function updateData(profileName, type, key, value) {
    if (!currentData[profileName]) currentData[profileName] = {};
    isDirty = true;

    if (type === 'fill') {
        if (!currentData[profileName].fill) currentData[profileName].fill = [];

        // Find by id OR key
        let item = currentData[profileName].fill.find(f => (f.id === key || f.key === key));
        if (item) {
            item.value = value;
        } else {
            // New item: use 'id' to be consistent if that is the standard
            // We can also add 'key' just in case? Or just 'id'.
            // Let's use 'id' as primary.
            currentData[profileName].fill.push({ id: key, value: value });
        }
    } else if (type === 'answer') {
        currentData[profileName].generatedAnswer = value;
    }

    // Trigger Auto-Save
    triggerAutoSave();
}

function triggerAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);

    const statusLabel = document.getElementById('saveStatus') || createSaveStatusLabel();
    statusLabel.textContent = '修改未保存...';
    statusLabel.style.color = 'orange';

    autoSaveTimer = setTimeout(() => {
        saveChanges(true); // true = proper auto-save (silent or specific toast)
    }, 1000); // 1 second debounce
}

function createSaveStatusLabel() {
    // Create a status label in the header if not exists
    const header = document.querySelector('.header-right') || document.body; // Fallback
    // Ideally put it next to filename suffix
    const container = document.getElementById('filenameSuffix').parentNode.parentNode; // .control-group

    const label = document.createElement('span');
    label.id = 'saveStatus';
    label.style.marginLeft = '10px';
    label.style.fontSize = '12px';
    label.style.fontWeight = 'bold';
    container.appendChild(label);
    return label;
}

async function saveChanges(isAutoSave = false) {
    if (!currentStudentId) return;

    if (isAutoSave) {
        const statusLabel = document.getElementById('saveStatus');
        if (statusLabel) {
            statusLabel.textContent = '自动保存中...';
            statusLabel.style.color = 'blue';
        }
    }

    try {
        const suffix = els.filenameSuffix ? els.filenameSuffix.value.trim() : '';
        const response = await fetch('/api/save', {
            method: 'POST',
            body: JSON.stringify({
                student_id: currentStudentId,
                data: currentData,
                suffix: suffix
            })
        });

        if (response.ok) {
            originalData = JSON.parse(JSON.stringify(currentData));
            isDirty = false;

            if (isAutoSave) {
                const statusLabel = document.getElementById('saveStatus');
                if (statusLabel) {
                    statusLabel.textContent = '已自动保存';
                    statusLabel.style.color = 'green';
                    setTimeout(() => {
                        if (statusLabel.textContent === '已自动保存') statusLabel.textContent = '';
                    }, 2000);
                }
            } else {
                showToast('保存成功');
            }
        } else {
            showToast('保存失败', 'error');
            if (isAutoSave) {
                const statusLabel = document.getElementById('saveStatus');
                if (statusLabel) {
                    statusLabel.textContent = '自动保存失败';
                    statusLabel.style.color = 'red';
                }
            }
        }
    } catch (e) {
        console.error(e);
        showToast('保存异常', 'error');
    }
}

function resetChanges() {
    if (confirm('确定要撤销所有未保存的修改吗？')) {
        currentData = JSON.parse(JSON.stringify(originalData));
        renderForm();
        showToast('已撤销修改');
    }
}

// --- Utils: Format Parsing ---
function parseFormat(fmt) {
    const match = fmt.match(/\{(\d+)\.\.(\d+)\}/);
    if (!match) return [fmt];

    const start = parseInt(match[1]);
    const end = parseInt(match[2]);
    const result = [];

    for (let i = start; i <= end; i++) {
        result.push(fmt.replace(match[0], i));
    }
    return result;
}

function extractNumber(str) {
    // Extract last number sequence
    const match = str.match(/(\d+)$/);
    return match ? parseInt(match[1]) : null;
}

function groupByPrefix(keys) {
    const groups = {};
    keys.forEach(key => {
        if (!key || typeof key !== 'string') return;

        let prefix = key;

        // Strategy 1: Hyphen (e.g. FGJ10-0 -> FGJ10)
        if (key.includes('-')) {
            prefix = key.split('-')[0];
        }
        // Strategy 2: Trailing Digits (e.g. Y4 -> Y)
        else {
            const match = key.match(/^([a-zA-Z0-9_]*?)(\d+)$/);
            if (match && match[1]) {
                prefix = match[1];
            }
        }

        if (!groups[prefix]) groups[prefix] = [];
        groups[prefix].push(key);
    });
    return groups;
}

// --- Image Viewer Logic (Draggable, Zoomable) ---
async function loadStudentImages(studentId) {
    els.imageList.innerHTML = '';
    els.imagePreview.style.display = 'none';
    els.noImageMsg.style.display = 'block';

    try {
        const response = await fetch(`/api/images?student_id=${studentId}`);
        if (!response.ok) throw new Error('Failed to list images');

        let images = await response.json();

        // Custom Sort: 6, 7, 8, 9, 10, 1, 2, 3, 4, 5
        const sortOrder = [6, 7, 8, 9, 10, 1, 2, 3, 4, 5];

        images.sort((a, b) => {
            const extractNum = (str) => {
                const match = str.match(/^(\d+)/);
                return match ? parseInt(match[1]) : -1;
            };

            const numA = extractNum(a);
            const numB = extractNum(b);

            const idxA = sortOrder.indexOf(numA);
            const idxB = sortOrder.indexOf(numB);

            // Both in list: Sort by index in list
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;

            // Only A in list: A comes first
            if (idxA !== -1) return -1;

            // Only B in list: B comes first
            if (idxB !== -1) return 1;

            // Neither in list: Default numeric sort
            return numA - numB;
        });

        if (images && images.length > 0) {
            images.forEach((name, index) => {
                const url = `/personalData/${studentId}/${name}`;
                addImageThumbnail(url, name);

                // Auto select first image
                if (index === 0) {
                    selectImage(url);
                }
            });
        }
    } catch (e) {
        console.warn('Image listing failed, falling back to guessing', e);
        // Fallback or show error
        // The commonNames approach was causing 404s, so we just log warning here.
    }
}

function addImageThumbnail(url, name) {
    const thumb = document.createElement('img');
    thumb.src = url;
    thumb.className = 'thumbnail';
    thumb.onclick = () => selectImage(url, thumb);
    els.imageList.appendChild(thumb);
}

function selectImage(url, thumbEl) {
    els.imagePreview.src = url;
    els.imagePreview.style.display = 'block';
    els.noImageMsg.style.display = 'none';

    // Zoom reset
    resetZoom();

    // Highlight thumbnail
    document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
    if (thumbEl) thumbEl.classList.add('active');
}

// --- Zoom & Drag Logic ---
let scale = 1;
let translateX = 0;
let translateY = 0;
let isDraggingImage = false;
let startDragX, startDragY;

function setupImageViewer() {
    // Viewer Draggable (Window)
    setupDraggable(els.imageViewer, els.viewerHandle);

    // Viewer Resizable (Window)
    setupResizable(els.imageViewer, els.resizeHandle);

    // Image Zoom (Wheel) - Add limit
    els.previewContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;

        // Limit zoom
        const newScale = scale * delta;
        if (newScale > 0.1 && newScale < 10) {
            scale = newScale;
            updateTransform();
        }
    }, { passive: false });

    // Image Pan (Drag content)
    els.previewContainer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDraggingImage = true;
        startDragX = e.clientX - translateX;
        startDragY = e.clientY - translateY;
        els.previewContainer.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingImage) return;
        e.preventDefault();
        translateX = e.clientX - startDragX;
        translateY = e.clientY - startDragY;
        requestAnimationFrame(updateTransform);
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingImage) {
            isDraggingImage = false;
            els.previewContainer.style.cursor = 'grab';
        }
    });
}

function updateTransform() {
    if (els.imagePreview) {
        els.imagePreview.style.transform = `translate(-50%, -50%) translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }
}

function resetZoom() {
    scale = 1;
    translateX = 0;
    translateY = 0;
    updateTransform();
}

function toggleViewerHeight() {
    const viewer = document.getElementById('imageViewer');
    const btn = document.getElementById('toggleBtn');

    if (!viewer || !btn) return;

    viewer.classList.toggle('collapsed');

    if (viewer.classList.contains('collapsed')) {
        btn.textContent = '+';
        viewer.style.height = 'auto';
    } else {
        btn.textContent = '_';
        viewer.style.height = '400px';
    }
}

// Optimized Generic Draggable using requestAnimationFrame
function setupDraggable(element, handle) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    let currentX, currentY;
    let animationFrameId = null;

    handle.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return; // Ignore buttons in header
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        // Use offsetLeft/Top which is relative to the offsetParent (main-container)
        // This fixes the "jump" issue caused by getBoundingClientRect being relative to viewport
        initialLeft = element.offsetLeft;
        initialTop = element.offsetTop;

        // Prepare for movement: Switch to absolute positioning using left/top
        element.style.right = 'auto'; // Clear right constraint
        element.style.bottom = 'auto'; // Clear bottom constraint
        element.style.width = element.offsetWidth + 'px'; // Fix width to explicit pixel value to prevent resizing quirks
        element.style.height = element.offsetHeight + 'px'; // Fix height
        element.style.transition = 'none'; // Disable transition during drag

        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        e.preventDefault();
        currentX = e.clientX;
        currentY = e.clientY;

        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(() => {
                const dx = currentX - startX;
                const dy = currentY - startY;
                element.style.left = `${initialLeft + dx}px`;
                element.style.top = `${initialTop + dy}px`;
                animationFrameId = null;
            });
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        }
    });
}

// Generic Resizable
function setupResizable(element, handle) {
    let isResizing = false;
    let startX, startY, startW, startH;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = element.getBoundingClientRect();
        startW = rect.width;
        startH = rect.height;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        element.style.width = `${startW + dx}px`;
        element.style.height = `${startH + dy}px`;
    });

    document.addEventListener('mouseup', () => isResizing = false);
}

function showToast(msg, type = 'success') {
    els.toast.textContent = msg;
    els.toast.className = 'toast show ' + type;
    setTimeout(() => {
        els.toast.className = 'toast';
    }, 3000);
}

// --- Status Updates & Automation ---

async function toggleCompletion(studentId, completed) {
    if (!studentId) return;

    try {
        const response = await fetch('/api/complete', {
            method: 'POST',
            body: JSON.stringify({
                student_id: studentId,
                completed: completed
            })
        });

        if (response.ok) {
            showToast(completed ? '已标记为全部完成' : '已取消完成标记');
            refreshHistory();
        } else {
            showToast('状态更新失败', 'error');
            document.getElementById('completeCheckbox').checked = !completed;
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
        document.getElementById('completeCheckbox').checked = !completed;
    }
}

async function runAutomation() {
    if (!currentStudentId) {
        showToast('请先选择学号', 'error');
        return;
    }

    try {
        showToast('正在启动 Playwright Automation...', 'info');
        const response = await fetch('/api/run_automation', {
            method: 'POST',
            body: JSON.stringify({
                student_id: currentStudentId
            })
        });

        if (response.ok) {
            showToast('自动化脚本已启动');
        } else {
            showToast('启动失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('请求失败', 'error');
    }
}

async function fixData() {
    if (!currentStudentId) {
        showToast('请先选择学号', 'error');
        return;
    }

    if (!confirm('确定要修正该学生的弗兰克赫兹实验数据ID吗？(F20-F99 -> F100+)')) {
        return;
    }

    try {
        const suffix = els.filenameSuffix ? els.filenameSuffix.value.trim() : '';
        const response = await fetch('/api/fix_data', {
            method: 'POST',
            body: JSON.stringify({
                student_id: currentStudentId,
                suffix: suffix
            })
        });

        const resData = await response.json();

        if (response.ok) {
            if (resData.changed) {
                showToast('数据已修正，正在刷新...');
                loadStudentData(currentStudentId);
            } else {
                showToast('未检测到需要修正的数据', 'info');
            }
        } else {
            showToast('修正失败: ' + (resData.message || 'Unknown error'), 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('请求失败', 'error');
    }
}

/**
 * 根据字典数据填充表单
 * @param {string} jsonData - JSON 字符串
 * @returns {number} - 填充的项数
 */
function fillFromDictionary(jsonData) {
    if (!jsonData || !jsonData.trim()) {
        throw new Error("请输入数据");
    }

    let data = null;
    try {
        data = JSON.parse(jsonData);
    } catch (e1) {
        // Try wrapping in array
        try {
            data = JSON.parse(`[${jsonData}]`);
        } catch (e2) {
            throw new Error("无法解析数据。请确保格式正确(JSON对象或数组)");
        }
    }

    let items = [];
    if (Array.isArray(data)) {
        items = data;
    } else if (typeof data === "object") {
        if (data.id && data.value !== undefined) {
            items = [data];
        } else {
            for (const [k, v] of Object.entries(data)) {
                items.push({ id: k, value: v });
            }
        }
    }

    let count = 0;
    items.forEach(item => {
        if (item && item.id && item.value !== undefined) {
            // Adapted logic: Use 'input-' prefix mapping
            let el = document.getElementById(item.id);
            if (!el) {
                // Try finding by mapping if exact ID match failed (our inputs have input- prefix)
                el = document.getElementById('input-' + item.id);
            }

            if (el) {
                el.value = item.value;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                count++;
            }
        }
    });

    return count;
}

function openDictionaryFill() {
    if (!currentStudentId) {
        showToast('请先选择学号', 'error');
        return;
    }

    const input = prompt("请输入JSON数据 (对象或数组): \n例如: {\"F1-0\": \"1.0\"} 或 [{\"id\":\"F1-0\",\"value\":\"1.0\"}]");
    if (input === null) return; // Cancelled

    try {
        const count = fillFromDictionary(input);
        showToast(`成功填充 ${count} 项数据`);
    } catch (e) {
        alert(e.message);
    }
}

// Chart Logic
function closeChartModal() {
    document.getElementById('chartModal').style.display = 'none';
}

function showFrankHertzChart() {
    const modal = document.getElementById('chartModal');
    const canvas = document.getElementById('chartCanvas');
    if (!modal || !canvas) return;

    modal.style.display = 'flex';

    // 1. Collect Data
    // Pattern: inputs with id "input-F<num>-0" (X) and "input-F<num>-1" (Y)
    const dataPoints = [];
    const inputs = document.querySelectorAll('input[id^="input-F"]');

    // Map to group pairs
    const pairs = {}; // key: num, val: {x: val, y: val}

    inputs.forEach(inp => {
        const match = inp.id.match(/^input-F(\d+)-(\d+)$/);
        if (match) {
            const num = match[1];
            const type = match[2]; // 0 for X, 1 for Y

            if (!pairs[num]) pairs[num] = {};

            if (type === '0') pairs[num].x = parseFloat(inp.value);
            if (type === '1') pairs[num].y = parseFloat(inp.value);
        }
    });

    // Convert to array
    for (const k in pairs) {
        const p = pairs[k];
        if (p.x !== undefined && !isNaN(p.x) && p.y !== undefined && !isNaN(p.y)) {
            dataPoints.push({ x: p.x, y: p.y });
        }
    }

    // Sort by X
    dataPoints.sort((a, b) => a.x - b.x);

    if (dataPoints.length < 2) {
        alert("数据点不足，无法生成曲线");
        return;
    }

    // 2. Draw
    drawSplineChart(canvas, dataPoints, {
        filename: '8.1.jpg',
        title: '弗兰克-赫兹实验数据曲线',
        skipTitle: true // User requested no title for this one
    });
}

function showMagnetizationChart() {
    const modal = document.getElementById('chartModal');
    const canvas = document.getElementById('chartCanvas');
    if (!modal || !canvas) return;

    modal.style.display = 'flex';

    // Formula Constants
    const CH = 1044;
    const CB = 15.98;

    const dataPoints = [];

    // Iterate i from 0 to 9 strictly
    for (let i = 0; i < 10; i++) {
        // IDs: Ui -> C12-{i}, Uc -> C15-{i}
        // Wait, format is "input-ID".
        // ID in JSON is C12-0, C12-1...
        // Element ID is input-C12-0

        const uiEl = document.getElementById(`input-C12-${i}`);
        const ucEl = document.getElementById(`input-C15-${i}`);

        if (uiEl && ucEl) {
            const valUi = parseFloat(uiEl.value);
            const valUc = parseFloat(ucEl.value);

            if (!isNaN(valUi) && !isNaN(valUc)) {
                // Calculate
                const H = valUi * CH;
                const B = valUc * CB;
                dataPoints.push({ x: H, y: B });
            }
        }
    }

    if (dataPoints.length < 2) {
        alert("数据点不足 (需要 C12-0~9 和 C15-0~9)");
        return;
    }

    // 2. Draw
    drawSplineChart(canvas, dataPoints, {
        filename: '6.1.jpg',
        title: '磁化曲线 (Ui-Uc)',
        xLabel: 'H (A/m)',
        yLabel: 'B (T)',
        skipTitle: false
    });
}

function shiftFrankHertzData() {
    // if (!confirm('确定要将所有F数据向下移动一行吗？(例如 F19 -> F110)')) return;

    // 1. Identify all F-inputs and unique Row Numbers
    const inputs = Array.from(document.querySelectorAll('input[id^="input-F"]'));
    const rows = new Set();
    const dataMap = new Map(); // key: "num-type", value: val

    inputs.forEach(inp => {
        const match = inp.id.match(/^input-F(\d+)-(\d+)$/);
        if (match) {
            const num = parseInt(match[1]);
            const type = match[2];
            rows.add(num);
            dataMap.set(`${num}-${type}`, inp.value);
        }
    });

    if (rows.size === 0) {
        showToast('未找到有效数据', 'warning');
        return;
    }

    // 2. Sort Rows (e.g., [10, 11, ..., 19, 110])
    const sortedRows = Array.from(rows).sort((a, b) => a - b);

    // 3. Shift Values (Iterate from LAST row down to SECOND row)
    // We move data from (Index-1) to (Index)
    for (let i = sortedRows.length - 1; i > 0; i--) {
        const currentNum = sortedRows[i];      // Target (e.g., 110)
        const prevNum = sortedRows[i - 1];     // Source (e.g., 19)

        ['0', '1'].forEach(type => {
            const sourceKey = `${prevNum}-${type}`;
            const sourceVal = dataMap.get(sourceKey);

            const targetEl = document.getElementById(`input-F${currentNum}-${type}`);
            if (targetEl) {
                targetEl.value = sourceVal !== undefined ? sourceVal : '';
                targetEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }

    // 4. Clear the first row
    const firstNum = sortedRows[0];
    ['0', '1'].forEach(type => {
        const el = document.getElementById(`input-F${firstNum}-${type}`);
        if (el) {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    showToast('数据已向下移动');
}

function shiftFrankHertzDataUp() {
    // Shift all F-data UP by one row (e.g., F11 -> F10)

    const inputs = Array.from(document.querySelectorAll('input[id^="input-F"]'));
    const rows = new Set();
    const dataMap = new Map();

    inputs.forEach(inp => {
        const match = inp.id.match(/^input-F(\d+)-(\d+)$/);
        if (match) {
            const num = parseInt(match[1]);
            const type = match[2];
            rows.add(num);
            dataMap.set(`${num}-${type}`, inp.value);
        }
    });

    if (rows.size === 0) {
        showToast('未找到有效数据', 'warning');
        return;
    }

    const sortedRows = Array.from(rows).sort((a, b) => a - b);

    // Shift UP: copy from next row to current row
    for (let i = 0; i < sortedRows.length - 1; i++) {
        const currentNum = sortedRows[i];
        const nextNum = sortedRows[i + 1];

        ['0', '1'].forEach(type => {
            const sourceKey = `${nextNum}-${type}`;
            const sourceVal = dataMap.get(sourceKey);
            const targetEl = document.getElementById(`input-F${currentNum}-${type}`);
            if (targetEl) {
                targetEl.value = sourceVal !== undefined ? sourceVal : '';
                targetEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }

    // Clear last row
    const lastNum = sortedRows[sortedRows.length - 1];
    ['0', '1'].forEach(type => {
        const el = document.getElementById(`input-F${lastNum}-${type}`);
        if (el) {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    showToast('数据已向上移动');
}

function drawSmoothChart(canvas, data) {
    const ctx = canvas.getContext('2d');
    // Resize canvas to fit display
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const w = canvas.width;
    const h = canvas.height;
    const padding = { top: 40, right: 40, bottom: 40, left: 60 };

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    // Find Ranges
    let minX = 0, maxX = 0; // Fixed to 0 for physics exp usually
    let minY = 0, maxY = 0;

    data.forEach(p => {
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    });

    // Add some padding to ranges
    maxX = Math.ceil(maxX / 10) * 10 || 10;
    maxY = Math.ceil(maxY) || 1; // Round up to nearest integer

    // Scale helpers
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    const getX = (val) => padding.left + (val / maxX) * plotW;
    const getY = (val) => h - padding.bottom - (val / maxY) * plotH;

    // Draw Grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();

    // Vertical Grid - X axis with steps of 10
    const stepX = 10; // Fixed step of 10
    for (let v = 0; v <= maxX; v += stepX) {
        const x = getX(v);
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, h - padding.bottom);
        // Label
        ctx.fillStyle = '#666';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '12px Arial';
        ctx.fillText(v.toFixed(0), x, h - padding.bottom + 5);
    }

    // Horizontal Grid - Y axis with integer steps
    const stepY = Math.max(1, Math.ceil(maxY / 5)); // At least 1, aim for ~5 lines
    for (let v = 0; v <= maxY; v += stepY) {
        const y = getY(v);
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        // Label
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = '12px Arial';
        ctx.fillText(v.toFixed(0), padding.left - 5, y); // Integer format
    }
    ctx.stroke();

    // Draw Axes
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, h - padding.bottom); // Y Axis
    ctx.lineTo(w - padding.right, h - padding.bottom); // X Axis
    ctx.stroke();

    // Draw Curve
    if (data.length > 1) {
        ctx.strokeStyle = '#4472c4'; // Excel blue
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();

        // Simple straight line connect first (or basic spline if needed)
        // For physics experiment, smoothing is nice but raw data connect is safer for accuracy unless requested "smooth"
        // User requested "Generate curve ... like excel". Excel default is Scatter with Smooth Lines.
        // Implementing Catmull-Rom or similar is bit long. Basic cubic bezier between midpoints is easier.

        ctx.moveTo(getX(data[0].x), getY(data[0].y));

        // Quad curve to midpoints
        for (let i = 0; i < data.length - 1; i++) {
            const p0 = data[i];
            const p1 = data[i + 1];

            // Midpoint
            const midX = (p0.x + p1.x) / 2;
            const midY = (p0.y + p1.y) / 2;

            // Actually, connecting points with straight lines is "Scatter with Straight Lines". 
            // "Smooth Lines" uses interpolation.
            // Let's do straight lines for now, it matches true data more honestly. 
            // If points are dense (as in Frank Hertz), it looks smooth.

            ctx.lineTo(getX(p1.x), getY(p1.y));
        }

        ctx.stroke();
    }

    // Title
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('弗兰克-赫兹实验数据曲线', w / 2, padding.top - 20);
}


function drawSplineChart(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Default Options
    const opts = {
        title: options.title || '',
        xLabel: options.xLabel || '',
        yLabel: options.yLabel || '',
        filename: options.filename || 'chart.jpg',
        skipTitle: options.skipTitle || false
    };

    const w = canvas.width;
    const h = canvas.height;
    const padding = { top: 60, right: 40, bottom: 60, left: 80 }; // Increased padding for labels

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    // Find Ranges
    let minX = 0, maxX = 0;
    let minY = 0, maxY = 0;

    data.forEach(p => {
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    });

    maxX = Math.ceil(maxX / 10) * 10 || 10;
    maxY = Math.ceil(maxY) || 1; // Round up to nearest integer

    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;
    const getX = (val) => padding.left + (val / maxX) * plotW;
    const getY = (val) => h - padding.bottom - (val / maxY) * plotH;

    // Grid and Axes
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();

    const stepX = 10; // Fixed step of 10
    for (let v = 0; v <= maxX; v += stepX) {
        // Avoid infinite loop if stepX is 0 (unlikely handled by max check)
        if (stepX === 0) break;
        const x = getX(v);
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, h - padding.bottom);
        ctx.fillStyle = '#666';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '12px Arial';
        ctx.fillText(v.toFixed(0), x, h - padding.bottom + 5);
    }

    const stepY = Math.max(1, Math.ceil(maxY / 5)); // Integer steps
    for (let v = 0; v <= maxY; v += stepY) {
        if (stepY === 0) break;
        const y = getY(v);
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = '12px Arial';
        ctx.fillText(v.toFixed(0), padding.left - 5, y); // Integer format
    }
    ctx.stroke();

    // Axis Labels
    if (opts.xLabel) {
        ctx.fillStyle = '#333';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(opts.xLabel, padding.left + plotW / 2, h - 15);
    }

    if (opts.yLabel) {
        ctx.save();
        ctx.translate(20, padding.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#333';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(opts.yLabel, 0, 0);
        ctx.restore();
    }

    // Title
    if (!opts.skipTitle && opts.title) {
        ctx.fillStyle = '#333';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(opts.title, w / 2, padding.top - 20);
    }

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, h - padding.bottom);
    ctx.lineTo(w - padding.right, h - padding.bottom);
    ctx.stroke();

    // Spline Curve
    if (data.length > 1) {
        ctx.strokeStyle = '#4472c4';
        ctx.lineWidth = 2.0;
        ctx.lineJoin = 'round';
        ctx.beginPath();

        const getPts = (i) => {
            const p = data[Math.min(Math.max(i, 0), data.length - 1)];
            return { x: getX(p.x), y: getY(p.y) };
        };

        ctx.moveTo(getX(data[0].x), getY(data[0].y));

        for (let i = 0; i < data.length - 1; i++) {
            const p0 = getPts(i - 1);
            const p1 = getPts(i);
            const p2 = getPts(i + 1);
            const p3 = getPts(i + 2);

            const tension = 0.4;
            const cp1x = p1.x + (p2.x - p0.x) * tension / 6;
            const cp1y = p1.y + (p2.y - p0.y) * tension / 6;
            const cp2x = p2.x - (p3.x - p1.x) * tension / 6;
            const cp2y = p2.y - (p3.y - p1.y) * tension / 6;

            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
        ctx.stroke();
    }

    // Auto Save
    saveChartImage(canvas, opts.filename);
}

async function saveChartImage(canvas, filename) {
    if (!currentStudentId) return;

    try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const response = await fetch('/api/save_image', {
            method: 'POST',
            body: JSON.stringify({
                student_id: currentStudentId,
                image_data: dataUrl,
                filename: filename || 'chart.jpg'
            })
        });

        if (response.ok) {
            showToast(`已保存图表为 ${filename || 'chart.jpg'}`);
        } else {
            showToast('保存图表失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('保存异常', 'error');
    }
}

function restartServer() {
    if (!confirm('确定要重启服务以应用代码更新吗？页面可能需要手动刷新。')) return;

    fetch('/api/restart').then(() => {
        showToast('正在重启...请稍候刷新页面', 'warning');
        setTimeout(() => location.reload(), 5000);
    }).catch(e => {
        showToast('重启此功能需在本地运行环境有效', 'error');
    });
}

function manualAddStudent() {
    const id = prompt("请输入要打开的学号:");
    if (id && id.trim()) {
        const studentId = id.trim();
        selectStudent(studentId);

        // Optimistically add to list if not present
        const existingInfo = historyRecords.find(r => r.student_id === studentId);
        if (!existingInfo) {
            // Append temporary item to list UI
            const ul = document.getElementById('studentList');
            const li = document.createElement('li');
            li.className = 'student-item active'; // Activate immediately
            li.innerHTML = `<span>${studentId}</span>`;
            li.onclick = () => selectStudent(studentId);
            ul.insertBefore(li, ul.firstChild); // Add to top

            // Deactivate others
            document.querySelectorAll('.student-item').forEach(item => {
                if (item !== li) item.classList.remove('active');
            });
        }
    }
}

function convertSpectrometerAngles(profileName) {
    // if (!confirm('确定要将该实验的所有 "度.分" 格式数据 (如 50.30) 转换为十进制角度 (50.5度) 吗？')) return;

    const inputs = document.querySelectorAll(`input[data-profile="${profileName}"]`);
    let count = 0;

    inputs.forEach(inp => {
        // Exclude specific inputs: G3, G5
        if (inp.id === 'input-G3' || inp.id === 'input-G5') return;

        const valStr = inp.value.trim();
        if (!valStr) return;

        // Pattern: Integer + Dot + Integer (e.g. 50.30 or 50.3)
        if (!valStr.includes('.')) return;

        const parts = valStr.split('.');
        if (parts.length !== 2) return;

        const degStr = parts[0];
        let minStr = parts[1];

        // Ensure we handle "30" vs "3" correctly?
        // Standard parsing: "30" -> 30, "3" -> 3.
        // User's example: 50.30.
        // If user input 50.3? Standard is 3/10? No, this is degrees.minutes string format.
        // Context is Key: "50.30 (30 is minutes)".
        // So we strictly interpret the string after dot as minutes integer.
        // "05" -> 5 min. "50" -> 50 min.
        // "5" -> 5 min or 50?
        // Let's assume strict integer parsing of the string segment.

        const deg = parseInt(degStr);
        const min = parseInt(minStr);

        if (!isNaN(deg) && !isNaN(min)) {
            // Formula: Deg + Min/60
            const decimalDeg = deg + (min / 60.0);

            // Format to 3 decimals? e.g. 50.5
            // 30min = 0.5
            // 1min = 0.0166...
            // 3 decimals is usually safe for reasonable precision.
            // Or maybe 2 if enough? 50.30 -> 50.5. 50.50.
            // Let's use flexible string.
            const newVal = parseFloat(decimalDeg.toFixed(2)).toString();

            if (newVal !== valStr) {
                inp.value = newVal;
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                count++;
            }
        }
    });

    if (count > 0) {
        showToast(`已转换 ${count} 个数据`);
    } else {
        showToast('未找到可转换的数据 (需为 度.分 格式)', 'info');
    }
}

function handleRowBatchOperation(profileName, prefix) {
    // 1. Prompt for Operation
    const input = prompt(`请输入针对 "${prefix}" 行的操作:\n\n格式示例:\n x10  (乘以10)\n /10  (除以10)\n +2   (加2)\n -5   (减5)\n =15  (全填15)\n 15   (全填15)`);

    if (!input || !input.trim()) return;
    const opStr = input.trim();

    // 2. Parse Operation
    let opType = 'set'; // set, mul, div, add, sub
    let opValue = 0;

    if (opStr.startsWith('x') || opStr.startsWith('*')) {
        opType = 'mul';
        opValue = parseFloat(opStr.substring(1));
    } else if (opStr.startsWith('/')) {
        opType = 'div';
        opValue = parseFloat(opStr.substring(1));
    } else if (opStr.startsWith('+')) {
        opType = 'add';
        opValue = parseFloat(opStr.substring(1));
    } else if (opStr.startsWith('-')) {
        opType = 'sub';
        opValue = parseFloat(opStr.substring(1));
    } else if (opStr.startsWith('=')) {
        opType = 'set';
        opValue = parseFloat(opStr.substring(1));
    } else {
        // Just a number -> Set
        opType = 'set';
        opValue = parseFloat(opStr);
    }

    if (isNaN(opValue)) {
        alert("无效的操作数值");
        return;
    }

    // 3. Find Targets
    // We look for inputs that belong to this profile AND whose key starts with prefix
    // But prefix might be complex. However, we generated inputs with dataset.key.
    // Simpler: iterate input[data-profile="..."] and check dataset.key
    const inputs = document.querySelectorAll(`input[data-profile="${profileName}"]`);
    let count = 0;

    inputs.forEach(inp => {
        const key = inp.dataset.key;
        if (!key) return;

        // Exact prefix match logic used in groupByPrefix is complex.
        // But here we simply check if key STARTS with prefix?
        // Wait, prefix "C10" matches "C10-0", "C10-1". 
        // But what if prefix is "C1" and we have "C10"? "C10" starts with "C1".
        // We need robust checking.
        // Option 1: key.startsWith(prefix + '-')
        // Option 2: key === prefix (if single item)
        // Option 3: use the regex Strategy 2 logic.

        let match = false;
        if (key === prefix) match = true;
        else if (key.startsWith(prefix + '-')) match = true;
        else {
            // Trailing digits check: "Y4" -> prefix "Y", num "4".
            // If prefix is "Y", does "Y4" match? Yes.
            // But does "Y10" match "Y"? Yes.
            // The group logic grouped them.
            // If we passed "prefix" from the loop, it implies these keys belong to it.
            // We can check if `groupByPrefix([key])[prefix]` exists? No, inefficient.

            // Simple heuristic: key starts with prefix AND next char is digit or -?
            // Actually, verify against the grouping logic:
            // Strategy 1: key.split('-')[0] === prefix
            // Strategy 2: match(/^([a-zA-Z0-9_]+?)(\d+)$/)[1] === prefix

            if (key.includes('-')) {
                if (key.split('-')[0] === prefix) match = true;
            } else {
                const m = key.match(/^([a-zA-Z0-9_]*?)(\d+)$/);
                if (m && m[1] === prefix) match = true;
            }
        }

        if (match) {
            const currentVal = parseFloat(inp.value);
            let newVal = currentVal;

            if (opType === 'set') {
                newVal = opValue;
            } else {
                // Determine source value. If empty, assume 0? Or skip?
                // User might want to batch fill empty cells.
                // If set/fill, we don't care about current.
                // If calc, we need current.

                if (isNaN(currentVal)) {
                    // Skip calculation on empty/invalid cells?
                    // Unless user wants to assume 0?
                    // Let's skip to be safe.
                    return;
                }

                if (opType === 'mul') newVal = currentVal * opValue;
                if (opType === 'div') newVal = currentVal / opValue;
                if (opType === 'add') newVal = currentVal + opValue;
                if (opType === 'sub') newVal = currentVal - opValue;
            }

            // Format result. Try to keep reasonable precision.
            // If integer result, no decimals.
            // If float, maybe 3-4 decimals?
            // Let's use generic string conversion but limit insane precision.
            // +2 usually means exact. *10 usually exact.
            // /10 might create decimals.

            const newValStr = parseFloat(newVal.toFixed(6 /* generous */)).toString();

            if (inp.value !== newValStr) {
                inp.value = newValStr;
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                count++;
            }
        }
    });

    if (count > 0) {
        showToast(`已更新 ${count} 个数据`);
    } else {
        showToast('未找到匹配的数据行', 'info');
    }
}

// Smart Fill for Frank-Hertz
let smartFillProfileName = null;

function openSmartFill(profileName) {
    smartFillProfileName = profileName;

    // Get all keys for this profile
    const inputs = document.querySelectorAll(`input[data-profile="${profileName}"]`);
    const keys = [];
    inputs.forEach(inp => {
        const key = inp.dataset.key;
        if (key) keys.push(key);
    });

    // Sort keys (same logic as rendering)
    keys.sort((a, b) => {
        const numA = extractNumber(a);
        const numB = extractNumber(b);
        if (numA !== null && numB !== null) {
            return numA - numB;
        }
        return a.localeCompare(b, undefined, { numeric: true });
    });

    // Filter functions for different dropdowns
    const filterIntervalFill = (key) => key !== '80V' && !key.match(/^F\d+-0$/);
    const filterRangeFill = (key) => key !== '80V' && !key.match(/^F\d+-0$/);
    const filterSeqFill = (key) => key !== '80V' && !key.match(/^F\d+-1$/);

    // Populate interval fill start node (exclude 80V and Fxx-0)
    const intervalKeys = keys.filter(filterIntervalFill);
    const selectInterval = document.getElementById('smartFillStartNode');
    selectInterval.innerHTML = '';
    intervalKeys.forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key;
        selectInterval.appendChild(option);
    });

    // Populate range fill dropdowns (exclude 80V and Fxx-0)
    const rangeKeys = keys.filter(filterRangeFill);
    const selectRangeStart = document.getElementById('smartFillRangeStart');
    const selectRangeEnd = document.getElementById('smartFillRangeEnd');

    [selectRangeStart, selectRangeEnd].forEach(select => {
        select.innerHTML = '';
        rangeKeys.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            select.appendChild(option);
        });
    });

    // Populate sequential fill dropdowns (exclude 80V and Fxx-1)
    const seqKeys = keys.filter(filterSeqFill);
    const selectSeqStart = document.getElementById('smartFillSeqStart');
    const selectSeqEnd = document.getElementById('smartFillSeqEnd');

    [selectSeqStart, selectSeqEnd].forEach(select => {
        select.innerHTML = '';
        seqKeys.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            select.appendChild(option);
        });
    });

    // Set defaults for sequential fill
    if (seqKeys.includes('F10-0')) {
        selectSeqStart.value = 'F10-0';
    }
    if (seqKeys.includes('F179-0')) {
        selectSeqEnd.value = 'F179-0';
    }

    // Show modal
    document.getElementById('smartFillModal').style.display = 'flex';
}

function closeSmartFillModal() {
    document.getElementById('smartFillModal').style.display = 'none';
    smartFillProfileName = null;
}

function fillRangeWithZero() {
    if (!smartFillProfileName) return;

    const startNode = document.getElementById('smartFillRangeStart').value;
    const endNode = document.getElementById('smartFillRangeEnd').value;

    if (!startNode || !endNode) {
        showToast('请选择起始和结束节点', 'warning');
        return;
    }

    // Get all keys for this profile (sorted)
    const inputs = document.querySelectorAll(`input[data-profile="${smartFillProfileName}"]`);
    const keys = [];
    inputs.forEach(inp => {
        const key = inp.dataset.key;
        if (key) keys.push(key);
    });

    keys.sort((a, b) => {
        const numA = extractNumber(a);
        const numB = extractNumber(b);
        if (numA !== null && numB !== null) {
            return numA - numB;
        }
        return a.localeCompare(b, undefined, { numeric: true });
    });

    // Find indices
    const startIndex = keys.indexOf(startNode);
    const endIndex = keys.indexOf(endNode);

    if (startIndex === -1 || endIndex === -1) {
        showToast('节点选择无效', 'error');
        return;
    }

    // Ensure start <= end
    const [start, end] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

    // Fill range with 0.000
    let count = 0;
    for (let i = start; i <= end; i++) {
        const key = keys[i];
        const input = document.querySelector(`input[data-key="${key}"][data-profile="${smartFillProfileName}"]`);
        if (input) {
            input.value = '0.000';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            count++;
        }
    }

    showToast(`已将 ${count} 个节点填充为0.000`);
}

function fillRangeSequential() {
    if (!smartFillProfileName) return;

    const startNode = document.getElementById('smartFillSeqStart').value;
    const endNode = document.getElementById('smartFillSeqEnd').value;
    const startValue = parseInt(document.getElementById('smartFillSeqStartValue').value) || 0;
    const increment = parseInt(document.getElementById('smartFillSeqIncrement').value) || 1;

    if (!startNode || !endNode) {
        showToast('请选择起始和结束节点', 'warning');
        return;
    }

    // Get all keys for this profile (sorted)
    const inputs = document.querySelectorAll(`input[data-profile="${smartFillProfileName}"]`);
    const keys = [];
    inputs.forEach(inp => {
        const key = inp.dataset.key;
        if (key) keys.push(key);
    });

    keys.sort((a, b) => {
        const numA = extractNumber(a);
        const numB = extractNumber(b);
        if (numA !== null && numB !== null) {
            return numA - numB;
        }
        return a.localeCompare(b, undefined, { numeric: true });
    });

    // Find indices
    const startIndex = keys.indexOf(startNode);
    const endIndex = keys.indexOf(endNode);

    if (startIndex === -1 || endIndex === -1) {
        showToast('节点选择无效', 'error');
        return;
    }

    // Ensure start <= end
    const [start, end] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

    // Fill range with sequential values
    let count = 0;
    let currentValue = startValue;
    for (let i = start; i <= end; i++) {
        const key = keys[i];
        const input = document.querySelector(`input[data-key="${key}"][data-profile="${smartFillProfileName}"]`);
        if (input) {
            input.value = currentValue.toString();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            count++;
            currentValue += increment;
        }
    }

    showToast(`已顺序填充 ${count} 个节点 (${startValue} 到 ${currentValue - increment})`);
}

function applySmartFill() {
    if (!smartFillProfileName) return;

    // Get inputs
    const numbersText = document.getElementById('smartFillNumbers').value.trim();
    const startNode = document.getElementById('smartFillStartNode').value;
    const reverse = document.getElementById('smartFillReverse').checked;
    const step = parseInt(document.getElementById('smartFillStep').value) || 2;

    if (!numbersText) {
        showToast('请输入数据', 'warning');
        return;
    }

    // Parse numbers (comma or space separated)
    const rawNumbers = numbersText.split(/[,\s]+/).map(n => n.trim()).filter(n => n);

    // Apply step filter (take every Nth)
    const numbers = [];
    for (let i = 0; i < rawNumbers.length; i += step) {
        numbers.push(rawNumbers[i]);
    }

    if (numbers.length === 0) {
        showToast('没有有效数据', 'warning');
        return;
    }

    // Get all keys for this profile (sorted)
    const inputs = document.querySelectorAll(`input[data-profile="${smartFillProfileName}"]`);
    const keys = [];
    inputs.forEach(inp => {
        const key = inp.dataset.key;
        if (key) keys.push(key);
    });

    keys.sort((a, b) => {
        const numA = extractNumber(a);
        const numB = extractNumber(b);
        if (numA !== null && numB !== null) {
            return numA - numB;
        }
        return a.localeCompare(b, undefined, { numeric: true });
    });

    // Find start index
    const startIndex = keys.indexOf(startNode);
    if (startIndex === -1) {
        showToast('起始节点无效', 'error');
        return;
    }

    // Determine fill order
    let fillKeys = [];
    if (reverse) {
        // Reverse: from startIndex backwards
        for (let i = startIndex; i >= 0 && fillKeys.length < numbers.length; i--) {
            fillKeys.push(keys[i]);
        }
    } else {
        // Forward: from startIndex onwards
        for (let i = startIndex; i < keys.length && fillKeys.length < numbers.length; i++) {
            fillKeys.push(keys[i]);
        }
    }

    // Fill values
    let count = 0;
    fillKeys.forEach((key, idx) => {
        if (idx >= numbers.length) return;

        const input = document.querySelector(`input[data-key="${key}"][data-profile="${smartFillProfileName}"]`);
        if (input) {
            input.value = numbers[idx];
            input.dispatchEvent(new Event('input', { bubbles: true }));
            count++;
        }
    });

    closeSmartFillModal();
    showToast(`已填充 ${count} 个数据`);
}

function exportProfileData(profileName) {
    if (!currentData || !currentData[profileName]) {
        showToast('无数据可导出', 'warning');
        return;
    }

    // Export only the 'fill' array, as per user request (matching Import JSON format)
    const dataToExport = currentData[profileName].fill || [];

    // Format JSON with indentation for readability
    const jsonStr = JSON.stringify(dataToExport, null, 2);

    navigator.clipboard.writeText(jsonStr)
        .then(() => showToast('已复制JSON数据到剪贴板'))
        .catch(err => {
            console.error('Export failed:', err);
            showToast('复制失败', 'error');
        });
}
