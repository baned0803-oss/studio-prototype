// script.js (index.html用 - フォーム処理とリダイレクトのみ)

const LSKEY = 'studio_search_conditions_v5'; // Keyをv5に更新
const AREA_PER_PERSON = 5; 

// DOM要素の取得を更新
const dateInput = document.getElementById('dateInput');
const startTimeInput = document.getElementById('startTimeInput'); // 以前のtimeInput
const endTimeInput = document.getElementById('endTimeInput'); // New
const priceInput = document.getElementById('priceInput');
const peopleInput = document.getElementById('peopleInput'); 
const searchBtn = document.getElementById('searchBtn');
const areaInfo = document.getElementById('areaInfo');
const searchModeDayBtn = document.getElementById('searchModeDay');
const searchModeNightBtn = document.getElementById('searchModeNight');

let searchMode = 'day'; 

// --- 初期化処理 ---
function getTodayDateString() {
    const today = new Date();
    // YYYY-MM-DD 形式で返す
    return today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
}

// LocalStorageからの初期値読み込みとUIの初期化
const saved = JSON.parse(localStorage.getItem(LSKEY) || '{}');

// 初期値設定
if(saved.date) dateInput.value = saved.date;
if(saved.startTime) startTimeInput.value = saved.startTime;
if(saved.endTime) endTimeInput.value = saved.endTime;
if(saved.price) priceInput.value = saved.price;
if(saved.people) peopleInput.value = saved.people; 

// デフォルト値
if (!dateInput.value) dateInput.value = getTodayDateString();
if (!startTimeInput.value) startTimeInput.value = '18:00';
if (!endTimeInput.value) endTimeInput.value = '20:00';
if (!priceInput.value) priceInput.value = '5000';
if (!peopleInput.value) peopleInput.value = '5';

// 最小日付を設定（過去日を選択できないようにする）
dateInput.min = getTodayDateString();


if(saved.mode) {
    searchMode = saved.mode;
    if (searchMode === 'night') {
        searchModeDayBtn.classList.remove('active');
        searchModeNightBtn.classList.add('active');
        startTimeInput.style.display = 'none';
        endTimeInput.style.display = 'none'; // 終了時間も非表示
        areaInfo.textContent = '深夜パックは時間帯に関係なく検索されます。';
        searchBtn.textContent = '🌜 深夜パックを検索';
    } else {
        startTimeInput.style.display = 'block';
        endTimeInput.style.display = 'block';
        searchBtn.textContent = '🔍 スタジオを検索';
    }
}


function updateAreaInfo(people) {
    // ... (変更なし) ...
    if (people > 0) {
        const requiredArea = people * AREA_PER_PERSON;
        areaInfo.innerHTML = `人数 (${people}人) に必要な目安の広さ以上で検索します: <strong>${requiredArea}㎡</strong>`;
    } else {
        areaInfo.textContent = '希望人数を入力してください。';
    }
}

peopleInput.addEventListener('input', () => {
    updateAreaInfo(Number(peopleInput.value));
});

// 検索モード切り替え時のUI更新
searchModeDayBtn.addEventListener('click', ()=>{
    searchMode = 'day';
    searchModeDayBtn.classList.add('active');
    searchModeNightBtn.classList.remove('active');
    startTimeInput.style.display = 'block';
    endTimeInput.style.display = 'block';
    searchBtn.textContent = '🔍 スタジオを検索';
    updateAreaInfo(Number(peopleInput.value));
});

searchModeNightBtn.addEventListener('click', ()=>{
    searchMode = 'night';
    searchModeDayBtn.classList.remove('active');
    searchModeNightBtn.classList.add('active');
    startTimeInput.style.display = 'none';
    endTimeInput.style.display = 'none';
    searchBtn.textContent = '🌜 深夜パックを検索';
    areaInfo.textContent = '深夜パックは時間帯に関係なく検索されます。';
});

// 検索ボタン押下時の処理 (リダイレクト)
function handleSearch(){
    const date = dateInput.value;
    const st = startTimeInput.value;
    const et = endTimeInput.value;
    const maxPrice = priceInput.value || 999999;
    const requestedPeople = peopleInput.value || 0; 
    
    // Dayモードでのバリデーション
    if (searchMode === 'day' && (!date || !st || !et)) {
        alert('通常検索では、利用日、開始時間、終了時間、希望人数をすべて入力してください。');
        return;
    }

    if (Number(requestedPeople) <= 0) {
        alert('希望人数は1人以上である必要があります。');
        return;
    }
    
    const startMinutes = toMinutes(st);
    const endMinutes = toMinutes(et);
    
    if (searchMode === 'day' && startMinutes >= endMinutes) {
        alert('開始時間は終了時間よりも前に設定してください。');
        return;
    }


    // LocalStorageに現在の状態を保存
    localStorage.setItem(LSKEY, JSON.stringify({
        date: date,
        startTime: st, 
        endTime: et, 
        price: priceInput.value, 
        people: requestedPeople, 
        mode: searchMode
    }));

    // URLパラメータを作成して results.html へ遷移
    const params = new URLSearchParams();
    params.append('date', date);
    params.append('startTime', st);
    params.append('endTime', et);
    params.append('price', maxPrice);
    params.append('people', requestedPeople);
    params.append('mode', searchMode);
    
    window.location.href = `results.html?${params.toString()}`;
}

searchBtn.addEventListener('click', handleSearch);
[dateInput, startTimeInput, endTimeInput, priceInput, peopleInput].forEach(inp=>{
    inp.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') handleSearch(); });
});

document.addEventListener('DOMContentLoaded', () => {
    updateAreaInfo(Number(peopleInput.value));
});

function toMinutes(hhmm){
    if(!hhmm) return null;
    const [h,m] = hhmm.split(':').map(Number);
    return h*60 + m;
}