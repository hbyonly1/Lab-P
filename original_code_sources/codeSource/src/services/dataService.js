/** ---------------------------
 *  Data Service
 *  自定义数据管理服务
 *  --------------------------- */

/**
 * 获取自定义数据
 * @param {string} key - 键
 * @returns {*} - 值
 */
function getCustomData(key) {
    if (!state.custom) return undefined;
    return state.custom[key];
}

/**
 * 设置自定义数据
 * @param {string} key - 键
 * @param {*} value - 值
 */
function setCustomData(key, value) {
    if (!state.custom) state.custom = {};
    state.custom[key] = value;
}

/**
 * 删除自定义数据
 * @param {string} key - 键
 * @returns {boolean} - 是否删除成功
 */
function deleteCustomData(key) {
    if (!state.custom || !state.custom[key]) return false;
    delete state.custom[key];
    return true;
}

/**
 * 获取所有自定义数据
 * @returns {Object} - 所有数据
 */
function getAllCustomData() {
    return state.custom || {};
}
