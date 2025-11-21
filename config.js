// ==========================================
// 設定ファイル - 定数定義
// ==========================================

// config.js
export const CONFIG = {
    // AREA_PER_PERSON はデフォルト値として残す
    AREA_PER_PERSON: 5,
    STORAGE_KEY: 'studio_search_conditions_v5',
    DATA_URL: 'https://script.google.com/macros/s/AKfycbwaYfLxnR2IiVHyCPcQkbs5XHnNCIuokUWc_0DDZOGB081k0zuWucvszrzV1qcjSGWF/exec',
    
    // 🆕 追加: 利用スタイルごとの必要面積定義
    USAGE_TYPES: {
        'spacious': { label: 'ゆったり (5㎡/人)', area: 5, icon: '💃' },
        'standard': { label: '標準 (3㎡/人)', area: 3, icon: '🎵' },
        'packed':   { label: '詰め込み/少なめ (1.5㎡/人)', area: 1.5, icon: '🧘' }
    }
};

export const SEARCH_MODE = {
    DAY: 'day',
    NIGHT: 'night'
};
