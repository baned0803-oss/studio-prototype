// ==========================================
// ユーティリティ関数 - 共通処理
// ==========================================

/**
 * 時刻を分に変換
 */
export function toMinutes(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

/**
 * HTMLエスケープ処理（XSS対策）
 */
export function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * 属性値のエスケープ処理
 */
export function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
}

/**
 * 価格をフォーマット
 */
export function formatPrice(price) {
    return `¥${(price || 0).toLocaleString()}`;
}

/**
 * 日付から曜日を取得（日本語）
 */
export function getDayOfWeek(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const days = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'];
    return days[date.getDay()];
}

/**
 * 深夜パック料金かどうかを判定
 */
export function isNightPackRate(rate) {
    return rate.rate_name && rate.rate_name.includes('深夜');
}

/**
 * 今日の日付を取得（YYYY-MM-DD形式）
 */
export function getTodayDateString() {
    const today = new Date();
    return today.getFullYear() + '-' + 
           String(today.getMonth() + 1).padStart(2, '0') + '-' + 
           String(today.getDate()).padStart(2, '0');
}

/**
 * JSONデータを取得
 */
export async function fetchData(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}