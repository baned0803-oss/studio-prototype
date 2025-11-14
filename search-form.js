// ==========================================
// 検索フォーム処理 (index.html用)
// ==========================================

import { CONFIG, SEARCH_MODE } from './config.js';
import { toMinutes, getTodayDateString } from './utils.js';

// DOM要素の取得
const dateInput = document.getElementById('dateInput');
const startTimeInput = document.getElementById('startTimeInput');
const endTimeInput = document.getElementById('endTimeInput');
const priceInput = document.getElementById('priceInput');
const peopleInput = document.getElementById('peopleInput');
const searchBtn = document.getElementById('searchBtn');
const areaInfo = document.getElementById('areaInfo');
const searchModeDayBtn = document.getElementById('searchModeDay');
const searchModeNightBtn = document.getElementById('searchModeNight');
const areaCheckboxes = document.querySelectorAll('input[name="area"]');
const selectAllAreasBtn = document.getElementById('selectAllAreas');
const deselectAllAreasBtn = document.getElementById('deselectAllAreas');

let searchMode = SEARCH_MODE.DAY;

// ==========================================
// 初期化処理
// ==========================================

// LocalStorageからの初期値読み込み
const saved = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '{}');

// 初期値設定
if (saved.date) dateInput.value = saved.date;
if (saved.startTime) startTimeInput.value = saved.startTime;
if (saved.endTime) endTimeInput.value = saved.endTime;
if (saved.price) priceInput.value = saved.price;
if (saved.people) peopleInput.value = saved.people;

// デフォルト値
if (!dateInput.value) dateInput.value = getTodayDateString();
if (!startTimeInput.value) startTimeInput.value = '18:00';
if (!endTimeInput.value) endTimeInput.value = '20:00';
if (!priceInput.value) priceInput.value = '5000';
if (!peopleInput.value) peopleInput.value = '5';

// 最小日付を設定
dateInput.min = getTodayDateString();

// 検索モードの復元
if (saved.mode) {
    searchMode = saved.mode;
    if (searchMode === SEARCH_MODE.NIGHT) {
        searchModeDayBtn.classList.remove('active');
        searchModeNightBtn.classList.add('active');
        startTimeInput.style.display = 'none';
        endTimeInput.style.display = 'none';
        areaInfo.textContent = '深夜パックは時間帯に関係なく検索されます。';
        searchBtn.textContent = '🌜 深夜パックを検索';
    } else {
        startTimeInput.style.display = 'block';
        endTimeInput.style.display = 'block';
        searchBtn.textContent = '🔍 スタジオを検索';
    }
}

// ==========================================
// エリアフィルター機能
// ==========================================

// すべて選択ボタン
selectAllAreasBtn.addEventListener('click', () => {
    areaCheckboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
});

// すべて解除ボタン
deselectAllAreasBtn.addEventListener('click', () => {
    areaCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
});

// 選択されたエリアを取得する関数
function getSelectedAreas() {
    const selected = [];
    areaCheckboxes.forEach(checkbox => {
        if (checkbox.checked) {
            selected.push(checkbox.value);
        }
    });
    return selected;
}

// ==========================================
// UI更新処理
// ==========================================

/**
 * 必要な広さを表示
 */
function updateAreaInfo(people) {
    if (people > 0) {
        const requiredArea = people * CONFIG.AREA_PER_PERSON;
        areaInfo.innerHTML = `人数 (${people}人) に必要な目安の広さ以上で検索します: <strong>${requiredArea}㎡</strong>`;
    } else {
        areaInfo.textContent = '希望人数を入力してください。';
    }
}

peopleInput.addEventListener('input', () => {
    updateAreaInfo(Number(peopleInput.value));
});

// 検索モード切り替え
searchModeDayBtn.addEventListener('click', () => {
    searchMode = SEARCH_MODE.DAY;
    searchModeDayBtn.classList.add('active');
    searchModeNightBtn.classList.remove('active');
    startTimeInput.style.display = 'block';
    endTimeInput.style.display = 'block';
    searchBtn.textContent = '🔍 スタジオを検索';
    updateAreaInfo(Number(peopleInput.value));
});

searchModeNightBtn.addEventListener('click', () => {
    searchMode = SEARCH_MODE.NIGHT;
    searchModeDayBtn.classList.remove('active');
    searchModeNightBtn.classList.add('active');
    startTimeInput.style.display = 'none';
    endTimeInput.style.display = 'none';
    searchBtn.textContent = '🌜 深夜パックを検索';
    areaInfo.textContent = '深夜パックは時間帯に関係なく検索されます。';
});

// ==========================================
// 検索処理
// ==========================================

/**
 * 検索ボタン押下時の処理
 */
function handleSearch() {
    const date = dateInput.value;
    const st = startTimeInput.value;
    const et = endTimeInput.value;
    const maxPrice = priceInput.value || 999999;
    const requestedPeople = peopleInput.value || 0;
    const selectedAreas = getSelectedAreas();
    
    // Dayモードでのバリデーション
    if (searchMode === SEARCH_MODE.DAY && (!date || !st || !et)) {
        alert('通常検索では、利用日、開始時間、終了時間、希望人数をすべて入力してください。');
        return;
    }

    if (Number(requestedPeople) <= 0) {
        alert('希望人数は1人以上である必要があります。');
        return;
    }
    
    // エリアが1つも選択されていない場合のバリデーション
    if (selectedAreas.length === 0) {
        alert('少なくとも1つのエリアを選択してください。');
        return;
    }
    
    const startMinutes = toMinutes(st);
    const endMinutes = toMinutes(et);
    
    if (searchMode === SEARCH_MODE.DAY && startMinutes >= endMinutes) {
        alert('開始時間は終了時間よりも前に設定してください。');
        return;
    }

    // LocalStorageに現在の状態を保存
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
        date: date,
        startTime: st,
        endTime: et,
        price: priceInput.value,
        people: requestedPeople,
        mode: searchMode,
        areas: selectedAreas
    }));

    // URLパラメータを作成して results.html へ遷移
    const params = new URLSearchParams();
    params.append('date', date);
    params.append('startTime', st);
    params.append('endTime', et);
    params.append('price', maxPrice);
    params.append('people', requestedPeople);
    params.append('mode', searchMode);
    params.append('areas', selectedAreas.join(','));
    
    window.location.href = `results.html?${params.toString()}`;
}

searchBtn.addEventListener('click', handleSearch);

// Enterキーでも検索
[dateInput, startTimeInput, endTimeInput, priceInput, peopleInput].forEach(inp => {
    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
});

// ==========================================
// 初期表示処理
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    updateAreaInfo(Number(peopleInput.value));
    
    // 保存されたエリア選択を復元
    if (saved.areas && Array.isArray(saved.areas)) {
        // まず全てのチェックを外す
        areaCheckboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
        // 保存されていたエリアのみチェック
        areaCheckboxes.forEach(checkbox => {
            if (saved.areas.includes(checkbox.value)) {
                checkbox.checked = true;
            }
        });
    }
});